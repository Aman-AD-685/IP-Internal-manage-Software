"""
Match duplicate company rows (same legal entity, different UUIDs) for lookups.
Mirrors fms-frontend/src/utils/companiesDedupe.ts so division lists follow the support form picker.
"""
from __future__ import annotations

import re
import time
from typing import Any

from app.supabase_client import supabase

_COMPANY_ROWS_CACHE: list[dict[str, Any]] | None = None
_COMPANY_ROWS_CACHE_AT: float = 0.0
_COMPANY_CACHE_TTL_SEC = 300.0

# Bulk-import / support-form bucket — tickets use division "All" (see COMPANY_ID_MAPPING.txt).
_ALL_COMPANY_PLACEHOLDER_IDS = frozenset({"2142d04b-67bc-4a7f-bd80-47cff23aa379"})
_ALL_COMPANY_DEFAULT_DIVISION = "All"


def is_all_company_placeholder(company_id: str | None, company_name: str | None = None) -> bool:
    cid = (company_id or "").strip()
    if cid and cid in _ALL_COMPANY_PLACEHOLDER_IDS:
        return True
    return normalize_company_dedupe_key(company_name) == "all company"


def normalize_company_dedupe_key(name: str | None) -> str:
    if not name:
        return ""
    s = str(name).strip().lower()
    s = re.sub(r"^m/s\.?\s*", "", s, flags=re.IGNORECASE)
    s = s.replace("-", " ")
    s = s.replace(".", " ")
    s = s.replace(",", " ")
    s = re.sub(r"\s*&\s*", " and ", s)
    s = re.sub(r"\([^)]*unit[^)]*2[^)]*\)", " unit2 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\bprivate limited\b", " pvtltd ", s, flags=re.IGNORECASE)
    s = re.sub(r"\bpvt\s+ltd\b", " pvtltd ", s, flags=re.IGNORECASE)
    s = re.sub(r"\bpublic limited\b", " publtd ", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_company_by_id(company_id: str) -> dict[str, Any] | None:
    """Direct DB lookup — avoids stale in-memory company list missing newly added rows."""
    cid = (company_id or "").strip()
    if not cid:
        return None
    try:
        r = supabase.table("companies").select("id, name").eq("id", cid).limit(1).execute()
        rows = r.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def division_names_from_ticket_history(company_ids: list[str]) -> list[str]:
    """Distinct division labels already used on tickets for these companies (fallback when master data is missing)."""
    ids = [str(x).strip() for x in company_ids if x and str(x).strip()]
    if not ids:
        return []
    names: list[str] = []
    seen: set[str] = set()
    try:
        r = (
            supabase.table("tickets")
            .select("division")
            .in_("company_id", ids)
            .not_.is_("division", "null")
            .limit(1000)
            .execute()
        )
        for row in r.data or []:
            label = str(row.get("division") or "").strip()
            if not label:
                continue
            key = label.lower()
            if key in seen:
                continue
            seen.add(key)
            names.append(label)
    except Exception:
        pass
    names.sort(key=lambda x: x.lower())
    return names


def invalidate_company_rows_cache() -> None:
    """Clear in-memory companies list (call after insert/update)."""
    global _COMPANY_ROWS_CACHE, _COMPANY_ROWS_CACHE_AT
    _COMPANY_ROWS_CACHE = None
    _COMPANY_ROWS_CACHE_AT = 0.0


def _fetch_all_company_rows(*, use_cache: bool) -> list[dict[str, Any]]:
    global _COMPANY_ROWS_CACHE, _COMPANY_ROWS_CACHE_AT
    now = time.time()
    if (
        use_cache
        and _COMPANY_ROWS_CACHE is not None
        and (now - _COMPANY_ROWS_CACHE_AT) < _COMPANY_CACHE_TTL_SEC
    ):
        return list(_COMPANY_ROWS_CACHE)
    rows: list[dict[str, Any]] = []
    page_size = 200
    page = 1
    for _ in range(100):
        offset = (page - 1) * page_size
        r = (
            supabase.table("companies")
            .select("id, name")
            .order("name")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        chunk = list(r.data or [])
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        page += 1
    if use_cache:
        _COMPANY_ROWS_CACHE = rows
        _COMPANY_ROWS_CACHE_AT = now
    return rows


def _load_all_companies() -> list[dict[str, Any]]:
    return _fetch_all_company_rows(use_cache=True)


def fetch_companies_for_support_lookup() -> list[dict[str, Any]]:
    """Fresh paginated read for support-ticket dropdowns (no stale TTL cache)."""
    return _fetch_all_company_rows(use_cache=False)


def _pick_canonical_company_row(group: list[dict[str, Any]]) -> dict[str, Any]:
    if len(group) == 1:
        return group[0]

    def sort_key(row: dict[str, Any]) -> tuple[int, str, str]:
        name = str(row.get("name") or "").strip()
        return (len(name), name.lower(), str(row.get("id") or ""))

    return sorted(group, key=sort_key)[0]


def dedupe_companies_for_select(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per normalized company name — mirrors fms-frontend companiesDedupe.ts."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        cid = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()
        if not cid or not name:
            continue
        key = normalize_company_dedupe_key(name)
        if not key:
            continue
        groups.setdefault(key, []).append({"id": cid, "name": name})
    out = [_pick_canonical_company_row(g) for g in groups.values()]
    out.sort(key=lambda x: str(x.get("name") or "").lower())
    return out


def companies_from_ticket_fallback() -> list[dict[str, Any]]:
    """Distinct companies already used on tickets when master lookup is empty."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    try:
        r = (
            supabase.table("tickets")
            .select("company_id, company_name")
            .not_.is_("company_id", "null")
            .limit(8000)
            .execute()
        )
        for row in r.data or []:
            cid = str(row.get("company_id") or "").strip()
            name = str(row.get("company_name") or "").strip()
            if not cid or not name or cid in seen:
                continue
            seen.add(cid)
            out.append({"id": cid, "name": name})
    except Exception:
        pass
    out.sort(key=lambda x: str(x.get("name") or "").lower())
    return out


def company_ids_for_division_lookup(company_id: str) -> list[str]:
    """
    All company UUIDs that share the same dedupe key as the selected company.
    Divisions may be linked to a duplicate row, not the canonical picker id.
    """
    cid = (company_id or "").strip()
    if not cid:
        return []
    anchor_row = fetch_company_by_id(cid)
    anchor_name = str(anchor_row.get("name") or "") if anchor_row else ""
    anchor_key = normalize_company_dedupe_key(anchor_name) if anchor_name else ""
    if not anchor_key:
        return [cid]
    ids = [str(r["id"]) for r in _load_all_companies() if normalize_company_dedupe_key(r.get("name")) == anchor_key]
    if cid not in ids:
        ids.insert(0, cid)
    return ids or [cid]


def _name_search_tokens(name: str, *, max_tokens: int = 3) -> list[str]:
    """Significant tokens for loose company name fallback (ilike)."""
    stop = frozenset(
        {
            "pvt",
            "ltd",
            "pvtltd",
            "private",
            "limited",
            "llp",
            "llc",
            "inc",
            "co",
            "company",
            "india",
            "the",
            "and",
            "of",
            "power",
            "pvt.",
        }
    )
    key = normalize_company_dedupe_key(name)
    parts = [p for p in key.split() if len(p) >= 3 and p not in stop]
    return parts[:max_tokens]


def company_ids_by_name_fallback(anchor_name: str, *, exclude_ids: set[str] | None = None) -> list[str]:
    """When dedupe ids have no divisions, include companies matching strong name tokens."""
    exclude = exclude_ids or set()
    tokens = _name_search_tokens(anchor_name)
    if not tokens:
        return []
    found: list[str] = []
    for row in _load_all_companies():
        rid = str(row.get("id") or "")
        if not rid or rid in exclude:
            continue
        norm = normalize_company_dedupe_key(row.get("name"))
        if all(tok in norm for tok in tokens[:2]):
            found.append(rid)
    return found


def _parse_division_names(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    parts = re.split(r"[,;/|]+", str(raw))
    return [p.strip() for p in parts if p and str(p).strip()]


def _client_onb_division_names(company_name: str) -> list[str]:
    """Division abbreviations from db_client_client_onb for this company (normalized name match)."""
    anchor_key = normalize_company_dedupe_key(company_name)
    if not anchor_key:
        return []
    names: list[str] = []
    tokens = _name_search_tokens(company_name)[:2]
    try:
        q = supabase.table("db_client_client_onb").select(
            "company_name, division_abbreviation, paid_divisions, name_of_divisions_cost_details"
        )
        if tokens:
            q = q.ilike("company_name", f"%{tokens[0]}%")
        r = q.limit(100).execute()

        for row in r.data or []:
            cn = normalize_company_dedupe_key(row.get("company_name"))
            if cn != anchor_key:
                continue
            for field in (
                row.get("division_abbreviation"),
                row.get("name_of_divisions_cost_details"),
            ):
                for part in _parse_division_names(field):
                    if part.isdigit():
                        continue
                    names.append(part)
    except Exception:
        pass
    # De-dupe case-insensitive, preserve first spelling
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        k = n.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(n)
    if out and not any(x.lower() == "other" for x in out):
        out.append("Other")
    return out


def ensure_divisions_for_companies(
    company_ids: list[str],
    company_name: str,
    *,
    extra_division_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    If divisions table has no rows for these companies, create them from Client ONB
    (division_abbreviation) so the support form can select a division_id.
    """
    division_names = _client_onb_division_names(company_name)
    for raw in extra_division_names or []:
        label = str(raw or "").strip()
        if not label:
            continue
        if not any(label.lower() == x.lower() for x in division_names):
            division_names.append(label)
    if not division_names and is_all_company_placeholder(None, company_name):
        division_names = [_ALL_COMPANY_DEFAULT_DIVISION]
    if not division_names and any(is_all_company_placeholder(cid) for cid in company_ids):
        division_names = [_ALL_COMPANY_DEFAULT_DIVISION]
    if not division_names:
        return []

    # Seed only the selected company row — siblings are read via company_ids_for_division_lookup.
    target_ids = [cid for cid in company_ids if cid]
    primary_id = target_ids[0] if target_ids else ""
    if not primary_id:
        return []

    existing_names: set[str] = set()
    try:
        existing = (
            supabase.table("divisions")
            .select("name")
            .eq("company_id", primary_id)
            .execute()
        )
        existing_names = {str(x.get("name") or "").strip().lower() for x in (existing.data or [])}
    except Exception:
        pass

    to_insert = [
        {"company_id": primary_id, "name": dname}
        for dname in division_names
        if dname.strip().lower() not in existing_names
    ]
    if to_insert:
        try:
            supabase.table("divisions").insert(to_insert).execute()
        except Exception:
            for row in to_insert:
                try:
                    supabase.table("divisions").insert(row).execute()
                except Exception:
                    pass

    r = (
        supabase.table("divisions")
        .select("id, name, company_id")
        .eq("company_id", primary_id)
        .order("name")
        .execute()
    )
    return dedupe_division_rows(list(r.data or []))


def dedupe_division_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per division name (case-insensitive), stable order by name."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda x: (str(x.get("name") or "").lower(), str(x.get("id") or ""))):
        key = str(row.get("name") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out
