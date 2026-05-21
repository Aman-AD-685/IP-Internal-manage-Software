"""Performance Monitoring NA — companies with any NA-marked response are hidden and excluded from Success KPI."""
from __future__ import annotations

from app.supabase_client import supabase

_MARKED_NA_COLUMN_SUPPORTED: bool | None = None


def _performance_marked_na_column_missing(err: str) -> bool:
    e = (err or "").lower()
    return "marked_na" in e and (
        "does not exist" in e
        or "42703" in e
        or "pgrst204" in e
        or "could not find" in e
        or "schema cache" in e
    )


def performance_marked_na_supported() -> bool:
    """True when PERFORMANCE_MONITORING_MARKED_NA.sql is applied. Only caches success (not transient failures)."""
    global _MARKED_NA_COLUMN_SUPPORTED
    if _MARKED_NA_COLUMN_SUPPORTED is True:
        return True
    try:
        supabase.table("performance_monitoring").select("id,marked_na").limit(1).execute()
        _MARKED_NA_COLUMN_SUPPORTED = True
        return True
    except Exception as e:
        err = str(e)
        if _performance_marked_na_column_missing(err):
            _MARKED_NA_COLUMN_SUPPORTED = False
            return False
        # Transient / RLS / network — do not cache False; retry on next call
        return False


def reset_performance_marked_na_cache() -> None:
    global _MARKED_NA_COLUMN_SUPPORTED
    _MARKED_NA_COLUMN_SUPPORTED = None


def performance_row_marked_na(row: dict) -> bool:
    v = row.get("marked_na")
    if v is True:
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "t", "1", "yes"):
        return True
    return False


def performance_marked_na_company_ids() -> set[str]:
    """Companies that have at least one performance_monitoring row marked NA."""
    if not performance_marked_na_supported():
        return set()
    try:
        r = (
            supabase.table("performance_monitoring")
            .select("company_id")
            .eq("marked_na", True)
            .limit(10000)
            .execute()
        )
        return {str(x["company_id"]) for x in (r.data or []) if x.get("company_id")}
    except Exception:
        return set()


def performance_row_matches_na_filter(
    row: dict,
    *,
    na_filter: str,
    na_company_ids: set[str] | None = None,
) -> bool:
    """exclude_na (default): hide companies with any NA row. only_na: show only those. all: no filter."""
    nf = (na_filter or "exclude_na").strip().lower()
    if nf == "all":
        return True
    cid = str(row.get("company_id") or "")
    na_ids = na_company_ids if na_company_ids is not None else performance_marked_na_company_ids()
    company_excluded = cid in na_ids
    if nf == "only_na":
        return company_excluded
    return not company_excluded


def filter_performance_rows(rows: list[dict], *, na_filter: str = "exclude_na") -> list[dict]:
    na_ids = performance_marked_na_company_ids()
    return [r for r in rows if performance_row_matches_na_filter(r, na_filter=na_filter, na_company_ids=na_ids)]


def enrich_performance_rows_na(rows: list[dict]) -> None:
    na_ids = performance_marked_na_company_ids()
    supported = performance_marked_na_supported()
    for row in rows:
        cid = str(row.get("company_id") or "")
        row["marked_na"] = performance_row_marked_na(row) if supported else False
        row["company_excluded_by_na"] = cid in na_ids if supported else False
