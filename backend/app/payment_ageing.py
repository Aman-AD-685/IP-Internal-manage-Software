"""
Fiscal quarter helpers (India FY: Apr–Mar) and payment-ageing bucket math.
"""
from __future__ import annotations

import re
import json
from functools import lru_cache
from pathlib import Path
from datetime import date, datetime
from typing import Any


# Corporate/legal tokens stripped so "Utkal Hydrocarbon" == "Utkal Hydrocarbon Pvt. Ltd."
_LEGAL_NAME_TOKENS = frozenset(
    {
        "pvt",
        "ltd",
        "limited",
        "private",
        "llp",
        "opc",
        "inc",
        "corp",
        "corporation",
        "company",
        "co",
    }
)


# Applied after legal-token strip. Keep Kodarma Chemical ≠ Kodarma Petrochemicals.
# Keep Orissa (base) ≠ Orissa (Raipur) — separate invoice entities.
_COMPANY_NAME_ALIASES: dict[str, str] = {
    "odissa concrete allied industries": "orissa concrete allied industries",
    "odissa concrete allied industries raipur": "orissa concrete allied industries raipur",
    "kodarma petrohemicals": "kodarma petrochemicals",
    "dadiji steels manufacture trade": "dadiji steel manufacture trade",
    "black rock steel power": "blackrock steel power",
}


def normalize_company_name(s: str | None) -> str:
    """Normalize names so master companies, invoices, and ageing rows match for dedupe + whitelist."""
    t = (s or "").strip().lower()
    if not t:
        return ""
    t = re.sub(r"[-–—]", " ", t)
    t = re.sub(r"[()\[\]{}]", " ", t)
    t = re.sub(r"[.,]", " ", t)
    t = re.sub(r"[&+]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    # "BR Refinery" vs "B R Refinery" when the sheet has no space after B
    t = re.sub(r"\bbr\s+refinery\b", "b r refinery", t)
    t = re.sub(r"\bprivate limited\b", "pvt ltd", t)
    t = re.sub(r"\bprivate ltd\b", "pvt ltd", t)
    t = re.sub(r"\blimited\b", "ltd", t)
    # Common spelling / plural drift between invoice spellings
    t = re.sub(r"\bsteels\b", "steel", t)
    t = re.sub(r"\bchemicals\b", "chemical", t)
    t = re.sub(r"\bpetrohemicals\b", "petrochemicals", t)
    t = re.sub(r"\btrading\b", "trade", t)
    t = re.sub(r"\bmanufacturing\b", "manufacture", t)
    t = re.sub(r"\bingols\b", "ingots", t)
    t = re.sub(r"\bodissa\b", "orissa", t)
    # Canonicalize known Hariom variant: "Ingots and Power" vs "Ingots & Power"
    t = re.sub(r"\bingots and power\b", "ingots power", t)
    # Drop legal-entity words so short vs Pvt Ltd spellings collapse to one key
    t = " ".join(tok for tok in t.split() if tok not in _LEGAL_NAME_TOKENS)
    t = re.sub(r"\s+", " ", t).strip()
    t = _COMPANY_NAME_ALIASES.get(t, t)
    return t


def compact_company_key(norm: str | None) -> str:
    """Letter-level key: drop spaces/punctuation so 'Black Rock' == 'BlackRock'."""
    return re.sub(r"[^a-z0-9]", "", (norm or "").lower())


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def names_letter_match(norm_a: str, norm_b: str) -> bool:
    """
    True when names match after ignoring spaces / tiny letter typos.
    Refuses prefix pairs (Orissa vs Orissa Raipur stay separate).
    """
    ca, cb = compact_company_key(norm_a), compact_company_key(norm_b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    # Site / unit suffix on otherwise-identical name → different company
    if ca.startswith(cb) or cb.startswith(ca):
        return False
    if abs(len(ca) - len(cb)) > 2:
        return False
    max_ed = 1 if min(len(ca), len(cb)) < 18 else 2
    return _levenshtein(ca, cb) <= max_ed


def name_token_jaccard(norm_a: str, norm_b: str) -> float:
    """Token-set Jaccard on already-normalized names (0..1)."""
    if not norm_a or not norm_b:
        return 0.0
    sa, sb = set(norm_a.split()), set(norm_b.split())
    u = len(sa | sb)
    if u == 0:
        return 0.0
    return len(sa & sb) / u


def collapse_near_duplicate_keys(keys: list[str], *, min_score: float = 0.78) -> dict[str, str]:
    """
    Map each normalized company key -> canonical key.

    Merge order:
    1) Same letter-compact key (Black Rock == BlackRock)
    2) Near letter match (1–2 char typo), not a prefix/suffix site pair
    3) Token Jaccard ≥ min_score (not a proper token subset — Raipur / Unit 2)
    """
    uniq = sorted({k for k in keys if k})
    parent = {k: k for k in uniq}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        # Prefer longer key as display root (more specific spelling)
        if len(rb) > len(ra) or (len(rb) == len(ra) and rb < ra):
            parent[ra] = rb
        else:
            parent[rb] = ra

    # (1) Exact letter-compact buckets
    by_compact: dict[str, list[str]] = {}
    for k in uniq:
        by_compact.setdefault(compact_company_key(k), []).append(k)
    for group in by_compact.values():
        root = group[0]
        for other in group[1:]:
            union(root, other)

    pairs: list[tuple[float, str, str]] = []
    for i, a in enumerate(uniq):
        sa = set(a.split())
        for b in uniq[i + 1 :]:
            if find(a) == find(b):
                continue
            sb = set(b.split())
            # Site / unit suffix → different company (Raipur, Unit 2, Bilaspur, …)
            if sa < sb or sb < sa:
                continue
            if names_letter_match(a, b):
                pairs.append((1.0, a, b))
                continue
            score = name_token_jaccard(a, b)
            if score < min_score:
                continue
            shared = len(sa & sb)
            if score < 0.999 and shared < 2:
                continue
            pairs.append((score, a, b))
    pairs.sort(key=lambda x: -x[0])
    for _score, a, b in pairs:
        union(a, b)

    return {k: find(k) for k in uniq}


def fuzzy_ageing_assignments(
    company_norm_keys: list[str],
    ageing_by_name: dict[str, dict],
    *,
    min_score: float = 0.68,
) -> dict[str, str]:
    """Map company normalized name -> ageing row key when exact match failed (one-to-one greedy)."""
    ageing_keys = [k for k in ageing_by_name if k]
    pairs: list[tuple[float, str, str]] = []
    for nm in company_norm_keys:
        if nm in ageing_by_name:
            continue
        for ak in ageing_keys:
            s = name_token_jaccard(nm, ak)
            if s >= min_score:
                pairs.append((s, nm, ak))
    pairs.sort(key=lambda x: -x[0])
    out: dict[str, str] = {}
    used_nm: set[str] = set()
    used_ak: set[str] = set()
    for s, nm, ak in pairs:
        if nm in used_nm or ak in used_ak:
            continue
        out[nm] = ak
        used_nm.add(nm)
        used_ak.add(ak)
    return out


# Payment Ageing grid: only these clients (matched by normalize_company_name) appear in the report.
# Update when the visible client set changes. Extra lines below the main list are legacy spellings
# still in companies / onboarding rows so the same client stays visible after name tweaks.
PAYMENT_AGEING_ALLOWED_COMPANY_NAMES: tuple[str, ...] = (
    # Authoritative — Payment Ageing Report visible set
    "GM Iron & Steels Ltd. Badampahar",
    "Dadiji Steel Manufacture & Trading Pvt Ltd",
    "Rausheena Udyog Ltd.",
    "Black Rock Steel & Power Pvt Ltd",
    "Bharat Hitech (Cements) Pvt Ltd",
    "Singhal Enterprises(Jharsuguda)Pvt Ltd",
    "Jay Iron & Steels Ltd.",
    "Agroha Steel and Power Pvt. Ltd.",
    "Gopal Sponge & Power Pvt. Ltd.",
    "Suprime Cement Pvt. Ltd.",
    "Karni Kripa Power Pvt Ltd",
    "GM Iron & Steel Pvt. Ltd.",
    "Crescent Foundry Co Pvt.Ltd.",
    "Maruti Ferrous Private Limited",
    "Vraj Iron & Steels Ltd. Bilaspur",
    "Spintech Tubes Pvt. Ltd.",
    "MVK Industries Pvt. Ltd.",
    "Shakambari Overseas Trade Pvt. Ltd.",
    "Pratishtha Polypack Pvt. Ltd.",
    "Rashmi Sponge Iron & Power Industries Pvt. Ltd.",
    "Indo East Corporation Pvt. Ltd.",
    "Agrawal Sponge Pvt. Ltd.",
    "Vraj Metaliks Pvt. Ltd.",
    "Maa Mangla Ispat Pvt. Ltd.",
    "B. R Sponge & Power Ltd.",
    "B R Refinery LLP",
    "Amiya Steel Pvt. Ltd.",
    "Sky Alloys and Power Pvt Ltd",
    "Nutan Ispat & Power Ltd",
    "Sri Venkatesh Iron & Alloys (India) Ltd.",
    "Maa Shakambari Steel Ltd.",
    "Balajee Mini Steels & Re Rolling Pvt. Ltd.",
    "Balmukund Sponge Iron Pvt. Ltd.",
    "Ugen Ferro Alloys Pvt. Ltd.",
    "Hariom Ingots & Power Pvt. Ltd.",
    "Surendra Mining Industries Pvt. Ltd.",
    "Mark Steels P Ltd.",
    "Hi-Tech Power & Steel Ltd.",
    "Sky Steel & Power Pvt. Ltd",
    "Maa Mangla Ispat Pvt. Ltd 2",
    "Salagram Power & Steels Ltd.",
    "Shikhara Steels Pvt. Ltd.",
    "Plascom Industries LLP",
    "Odissa Concrete & Allied Industries Limited",
    "Anjanisuta Steels Private Limited",
    "Niranjan Metalliks Ltd.",
    "Mangal Sponge & Steel Pvt. Ltd.",
    "Vaswani Industries Limited",
    "Flexicom Industries Pvt. Ltd.",
    "Orissa Concrete & Allied Industries Ltd. (Raipur)",
    "Brahmaputra Metallics Ltd.",
    "Roopgarh Power & Alloys Pvt. Ltd.",
    "Dinesh Brothers Pvt. Ltd.",
    "Govind Steel Co. Ltd.",
    "Kodarma Chemical Pvt. Ltd.",
    "Kodarma Petrochemicals Pvt. Ltd.",
    "Vighneshwar Ispat Pvt. Ltd.",
    "Shilphy Steels Pvt. Ltd.",
    "Coffers Metallics Pvt. Ltd.",
    "Bihar Foundry & Casting Limited",
    # Legacy aliases (same orgs; names in DB may differ slightly)
    "GM Iron & Steel Company Limited Badampahar",
    "Dadiji Steels Manufacture & Trade Pvt Ltd",
    "Black Rock Steels Pvt Ltd",
    "Niranjan Metallic Limited",
    "Hi.Tech Power & Steel Ltd.",
    "Vraj Iron & Steels Ltd (Bilaspur)",
    "Maruti Ferrous Pvt Ltd",
    "Govind Steel Co Ltd",
    "Orissa Concrete & Allied Industries Ltd",
    "Orissa Concrete & Allied Industries Ltd (New)",
    "Odissa Concrete & Allied Industries Ltd",
    "Anjanisuta Steels Pvt. Ltd.",
    "Salagram Power",
    "Kodarma Petrohemicals Pvt. Ltd.",
    "Hariom ingots and power private limited",
    "Hariom ingols and power private limited",
    "Maa Mangla Ispat Pvt. Ltd. (Unit.2)",
    # Seed / spreadsheet spellings not identical to companies.name
    "Shri Varu Polytex Pvt. Ltd.",
    "Govinda Polytex India Pvt. Ltd.",
    "Vraj Iron & Steels Ltd. (Siltara Div)",
    "Shree Parashnath Re-Roolling Mills Ltd.",
    "Maan Concast Pvt. Ltd.",
    "Maan Steel & Power Ltd.",
    "Dhanbad Fuels Ltd.",
    "Hitech Plastochem Udyog Pvt. Ltd.",
    "Rausheena Udyog Limited",
    # Invoice master (also on Add Invoice dropdown) — keep ageing in sync
    "Balmukund Cement & Roofing (P) Ltd.",
    "Ferro Metals",
    "Kedia Carbon Pvt. Ltd.",
    "Super Iron Foundry",
    "Utkal Hydrocarbon Pvt. Ltd.",
)

PAYMENT_AGEING_ALLOWED_COMPANY_KEYS: frozenset[str] = frozenset(
    normalize_company_name(x) for x in PAYMENT_AGEING_ALLOWED_COMPANY_NAMES if x.strip()
)


def _parse_date(val: Any) -> date | None:
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, str):
        s = val.strip()[:10]
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            try:
                return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))
            except ValueError:
                return None
    return None


def fiscal_year_start_for_date(d: date) -> int:
    """FY start calendar year (April–March)."""
    return d.year if d.month >= 4 else d.year - 1


def fy_quarter_key(d: date) -> tuple[int, int]:
    """(fy_start_year, quarter 1..4)."""
    fy = fiscal_year_start_for_date(d)
    if d.month >= 4 and d.month <= 6:
        q = 1
    elif d.month >= 7 and d.month <= 9:
        q = 2
    elif d.month >= 10:
        q = 3
    else:
        q = 4
    return (fy, q)


def quarter_label_from_key(fy_start: int, q: int) -> str:
    y1 = fy_start % 100
    y2 = (fy_start + 1) % 100
    return f"Q{q} FY {y1:02d}-{y2:02d}"


def quarter_date_bounds(fy_start: int, q: int) -> tuple[date, date]:
    """Inclusive start/end dates for India FY quarter (April–March). ``fy_start`` e.g. 2024 for FY 2024-25."""
    if q == 1:
        return (date(fy_start, 4, 1), date(fy_start, 6, 30))
    if q == 2:
        return (date(fy_start, 7, 1), date(fy_start, 9, 30))
    if q == 3:
        return (date(fy_start, 10, 1), date(fy_start, 12, 31))
    return (date(fy_start + 1, 1, 1), date(fy_start + 1, 3, 31))


def is_fiscal_quarter_complete(fy_start: int, q: int, as_of: date | None = None) -> bool:
    """True when the India FY quarter has ended (exclusive of the day after quarter end)."""
    as_of = as_of or date.today()
    _start, end = quarter_date_bounds(fy_start, q)
    return as_of > end


def ageing_summary_locked(qroll: list[tuple[int, int, str]], as_of: date | None = None) -> bool:
    """
    Summary day-bucket amounts stay zero while the report includes the current ongoing quarter.
    After that quarter completes (e.g. Q2 FY 26-27 after 30 Sep), amounts are shown.
    """
    as_of = as_of or date.today()
    current = fy_quarter_key(as_of)
    for fy, q, _label in qroll:
        if (fy, q) == current and not is_fiscal_quarter_complete(fy, q, as_of):
            return True
    return False


def previous_quarter(fy: int, q: int) -> tuple[int, int]:
    if q == 1:
        return (fy - 1, 4)
    return (fy, q - 1)


def last_n_fiscal_quarters(n: int, anchor: date | None = None) -> list[tuple[int, int, str]]:
    """The n most recent fiscal quarters, oldest first (for column order)."""
    anchor = anchor or date.today()
    fy, q = fy_quarter_key(anchor)
    newest = (fy, q)
    buf: list[tuple[int, int, str]] = []
    cf, cq = newest
    for _ in range(n):
        buf.append((cf, cq, quarter_label_from_key(cf, cq)))
        cf, cq = previous_quarter(cf, cq)
    buf.reverse()
    return buf


def _quarter_cmp(a: tuple[int, int], b: tuple[int, int]) -> int:
    if a[0] != b[0]:
        return -1 if a[0] < b[0] else 1
    if a[1] != b[1]:
        return -1 if a[1] < b[1] else 1
    return 0


def first_invoiced_quarter_index(
    qlist: list[tuple[int, int, str]], inv_date: date | None
) -> int:
    """Index in qlist (0..len-1) for the quarter containing inv_date; clamped."""
    if not qlist or inv_date is None:
        return 0
    key = fy_quarter_key(inv_date)
    keys = [(x[0], x[1]) for x in qlist]
    for i, k in enumerate(keys):
        if k == key:
            return i
    if _quarter_cmp(key, keys[0]) < 0:
        return 0
    if _quarter_cmp(key, keys[-1]) > 0:
        return len(keys) - 1
    for i, k in enumerate(keys):
        if _quarter_cmp(key, k) <= 0:
            return i
    return len(keys) - 1


def median_int(vals: list[int | None]) -> int:
    nums = sorted(int(v) for v in vals if v is not None)
    if not nums:
        return 0
    n = len(nums)
    mid = n // 2
    if n % 2 == 1:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) // 2


def median_int_or_none(vals: list[int]) -> int | None:
    """Median of ints; None when there are no values (use for quarter ageing cells)."""
    nums = sorted(int(v) for v in vals if v is not None)
    if not nums:
        return None
    n = len(nums)
    mid = n // 2
    if n % 2 == 1:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) // 2


def average_int(vals: list[int | None]) -> int:
    nums = [int(v) for v in vals if v is not None]
    if not nums:
        return 0
    return int(round(sum(nums) / len(nums)))


# Must match spreadsheet: Q3 FY 23-24 … Q4 FY 25-26 (10 fiscal quarters).
PAYMENT_AGEING_QUARTER_COUNT = 10

def payment_ageing_sheet_quarters() -> list[tuple[int, int, str]]:
    """Return rolling quarter columns (oldest→newest), always ending at the current ongoing FY quarter."""
    return last_n_fiscal_quarters(PAYMENT_AGEING_QUARTER_COUNT, date.today())

# Day buckets (inclusive) matching Excel SUMIFS: 0–7, 8–14, 15–21, 22–28, 29+
DAY_BUCKETS: list[tuple[str, int, int]] = [
    ("1-7 days", 0, 7),
    ("8-14 days", 8, 14),
    ("15-21 days", 15, 21),
    ("22-28 days", 22, 28),
    ("29-Rest", 29, 10**9),
]


def bucket_for_median_days(median_days: int | float | None) -> int:
    """Map median days-to-payment into Excel-style day buckets (1-7, 8-14, …)."""
    if median_days is None:
        return len(DAY_BUCKETS) - 1
    try:
        days = int(round(float(median_days)))
    except (TypeError, ValueError):
        return len(DAY_BUCKETS) - 1
    if days < 0:
        days = 0
    for i, (_, lo, hi) in enumerate(DAY_BUCKETS):
        if lo <= days <= hi:
            return i
    return len(DAY_BUCKETS) - 1


# Indices in quarter_days for FY 24-25 (see payment_ageing_sheet_quarters: Q1..Q4 FY 24-25)
FY24_25_Q1_IDX = 2
FY24_25_Q2_IDX = 3
FY24_25_Q3_IDX = 4
FY24_25_Q4_IDX = 5


def fy24_25_sum_days(qdays: list[int | None]) -> int:
    """Sum of day values across FY 24-25 Q1–Q4 (for weighting amount into quarter columns)."""
    s = 0
    for i in (FY24_25_Q1_IDX, FY24_25_Q2_IDX, FY24_25_Q3_IDX, FY24_25_Q4_IDX):
        if i < len(qdays) and qdays[i] is not None:
            s += int(qdays[i])
    return s


def weighted_fy_amount(amount: int, qdays: list[int | None], quarter_idx: int) -> int:
    """Allocate ``amount`` into one FY 24-25 quarter column proportional to that quarter's days."""
    total = fy24_25_sum_days(qdays)
    if total <= 0 or amount <= 0:
        return 0
    if quarter_idx >= len(qdays) or qdays[quarter_idx] is None:
        return 0
    return int(round(amount * int(qdays[quarter_idx]) / total))


def normalize_quarter_days(raw: Any, n: int | None = None) -> list[int | None]:
    if n is None:
        n = PAYMENT_AGEING_QUARTER_COUNT
    if raw is None:
        return [None] * n
    if isinstance(raw, str):
        try:
            import json

            raw = json.loads(raw)
        except Exception:
            return [None] * n
    if not isinstance(raw, list):
        return [None] * n
    out: list[int | None] = []
    for i in range(n):
        if i >= len(raw):
            out.append(None)
            continue
        v = raw[i]
        if v is None or v == "":
            out.append(None)
            continue
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            out.append(None)
    return out


@lru_cache(maxsize=1)
def _seed_quarter_days_by_norm_name() -> dict[str, list[int | None]]:
    """
    Load seeded ageing values from docs/payment_ageing_bulk_import.json once.
    Used as a recovery fallback when DB rows are accidentally nulled.
    """
    try:
        root = Path(__file__).resolve().parents[2]
        p = root / "docs" / "payment_ageing_bulk_import.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        rows = data.get("rows", []) if isinstance(data, dict) else []
    except Exception:
        return {}
    out: dict[str, list[int | None]] = {}
    for r in rows:
        cn = normalize_company_name((r or {}).get("company_name"))
        if not cn:
            continue
        qd = normalize_quarter_days((r or {}).get("quarter_days"), PAYMENT_AGEING_QUARTER_COUNT)
        if any(v is not None for v in qd):
            out[cn] = qd
    return out


def seed_quarter_days_for_company(norm_name: str) -> list[int | None] | None:
    if not norm_name:
        return None
    m = _seed_quarter_days_by_norm_name()
    qd = m.get(norm_name)
    return list(qd) if qd else None
