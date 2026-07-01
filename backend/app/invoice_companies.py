"""
Canonical company names for Add / Edit Invoice (Payment Management).
Seeded via database/INVOICE_COMPANY_MASTER.sql into public.companies.
"""
from __future__ import annotations

from app.payment_ageing import fuzzy_ageing_assignments, normalize_company_name

# Authoritative list — Add Invoice "Company Name" dropdown (order preserved in UI).
INVOICE_COMPANY_NAMES: tuple[str, ...] = (
    "Agrawal Sponge Pvt. Ltd.",
    "Amiya Steel Pvt. Ltd.",
    "Indo East Corporation Pvt. Ltd.",
    "Sri Venkatesh Iron & Alloys (India) Ltd.",
    "Anjanisuta Steels Pvt. Ltd.",
    "Balajee Mini Steels & Re Rolling Pvt. Ltd.",
    "Balmukund Sponge Iron Pvt. Ltd.",
    "Balmukund Cement & Roofing (P) Ltd.",
    "Bharat Hitech (Cements) Pvt Ltd",
    "Black Rock Steels Pvt Ltd",
    "B. R Sponge & Power Ltd.",
    "Maa Mangla Ispat Pvt. Ltd.",
    "Maa Shakambari Steel Ltd.",
    "Maa Mangla Ispat Pvt. Ltd. (Unit-2)",
    "B R Refinery LLP",
    "GM Iron & Steel Company Limited Badampahar",
    "Crescent Foundry Co Pvt.Ltd.",
    "Dadiji Steels Manufacture & Trade Pvt Ltd",
    "Niranjan Metallic Limited",
    "Dhanbad Fuels Ltd.",
    "Hitech Plastochem Udyog Pvt. Ltd.",
    "Maan Concast Pvt. Ltd.",
    "Maan Steel & Power Ltd.",
    "Mark Steels P Ltd.",
    "Singhal Enterprises(Jharsuguda)Pvt Ltd",
    "MVK Industries Pvt. Ltd.",
    "Pratishtha Polypack Pvt. Ltd.",
    "Pratishtha Spirits Pvt. Ltd",
    "Rausheena Udyog Ltd.",
    "Shakambari Overseas Trade Pvt. Ltd.",
    "Spintech Tubes Pvt. Ltd.",
    "Suprime Cement Pvt. Ltd.",
    "Shree Parashnath Re-Roolling Mills Ltd.",
    "Govinda Polytex India Pvt. Ltd.",
    "Shri Varu Polytex Pvt. Ltd.",
    "Sky Alloys and Power Pvt Ltd",
    "Sky Steel & Power Pvt. Ltd",
    "Ugen Ferro Alloys Pvt. Ltd.",
    "Surendra Mining Industries Pvt. Ltd.",
    "Vishal Metalliks",
    "Vraj Metaliks Pvt. Ltd.",
    "Gopal Sponge & Power Pvt. Ltd.",
    "Maruti Ferro",
    "Ghankun Steels Pvt Ltd",
    "Sunil Ispat & Power Pvt Ltd",
    "HSR",
    "Karni Kripa Power Pvt Ltd.",
    "Nutan Ispat & Power Ltd",
    "Hariom Ingots",
    "Epoxy (Hariom Coating)",
    "Hi-Tech Power & Steel Ltd.",
    "Jay Iron & Steels Ltd.",
    "Meta Sponge",
    "Plascom Industries LLP",
    "Flexicom Industries Pvt. Ltd.",
    "Salagram Power",
    "Big Mint",
    "Super Iron Foundry",
    "Orissa Concrete & Allied Industries Ltd",
    "GP Wire & Metals LLP",
    "H R Ispat Pvt. Ltd.",
    "Shambhavi Ispat Pvt. Ltd.",
    "Vaswani Industries Limited",
    "Govind Steel & Co. Ltd",
    "Dinesh Brothers Pvt. Ltd.",
    "Orissa Concrete & Allied Industries Ltd. Raipur",
    "Kodarma Chemicals Ltd.",
    "Kodarma Petrochemicals Pvt. Ltd.",
    "Roopgarh Power & Alloys Ltd.",
    "Mangal Sponge & Steel Pvt. Ltd.",
    "Brahmaputra Metallics Ltd.",
    "Vighneshwar Ispat Pvt. Ltd.",
    "Shilphy Steels Pvt. Ltd.",
    "Bihar Foundry & Casting Limited",
    "Utkal Hydrocarbon Pvt. Ltd.",
    "Kedia Carbon Pvt. Ltd.",
    "Ferro Metals",
)

INVOICE_COMPANY_KEYS: frozenset[str] = frozenset(
    normalize_company_name(x) for x in INVOICE_COMPANY_NAMES if x.strip()
)


def _index_companies_by_norm(companies_rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in companies_rows:
        name = (row.get("name") or "").strip()
        cid = row.get("id")
        if not name or not cid:
            continue
        nk = normalize_company_name(name)
        if nk and nk not in out:
            out[nk] = {"id": str(cid), "name": name}
    return out


def build_invoice_company_options(companies_rows: list[dict]) -> list[dict]:
    """Ordered {id, name} for invoice UI; matches master list to public.companies."""
    by_norm = _index_companies_by_norm(companies_rows)
    db_norm_keys = list(by_norm.keys())
    fuzzy: dict[str, str] = {}
    missing_keys = [
        normalize_company_name(n)
        for n in INVOICE_COMPANY_NAMES
        if normalize_company_name(n) and normalize_company_name(n) not in by_norm
    ]
    if missing_keys and db_norm_keys:
        fuzzy = fuzzy_ageing_assignments(missing_keys, {k: {} for k in db_norm_keys}, min_score=0.68)

    options: list[dict] = []
    for canonical in INVOICE_COMPANY_NAMES:
        nk = normalize_company_name(canonical)
        if not nk:
            continue
        hit = by_norm.get(nk)
        if not hit and nk in fuzzy:
            hit = by_norm.get(fuzzy[nk])
        if hit:
            options.append({"id": hit["id"], "name": hit["name"]})
        else:
            options.append({"id": nk, "name": canonical})
    return options


def resolve_invoice_company_name(
    company_name: str,
    companies_rows: list[dict] | None = None,
) -> str | None:
    """Map submitted name to canonical companies.name when in the invoice allowlist."""
    raw = (company_name or "").strip()
    if not raw:
        return None
    nk = normalize_company_name(raw)
    if nk not in INVOICE_COMPANY_KEYS:
        return None
    if companies_rows is None:
        return raw
    for opt in build_invoice_company_options(companies_rows):
        if normalize_company_name(opt["name"]) == nk or normalize_company_name(raw) == normalize_company_name(opt["name"]):
            return opt["name"]
    if nk in INVOICE_COMPANY_KEYS:
        for canonical in INVOICE_COMPANY_NAMES:
            if normalize_company_name(canonical) == nk:
                return canonical
    return None
