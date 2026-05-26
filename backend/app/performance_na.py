"""Performance Monitoring NA — companies with any NA-marked response are hidden and excluded from Success KPI."""
from __future__ import annotations

import time

from app.supabase_client import supabase

_MARKED_NA_COLUMN_SUPPORTED: bool | None = None
_NA_COMPANY_IDS_CACHE: tuple[float, set[str]] | None = None
_NA_COMPANY_IDS_TTL_SEC = 120
# PostgREST practical limit for .in_() filters
POSTGREST_IN_MAX = 400


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
    global _MARKED_NA_COLUMN_SUPPORTED, _NA_COMPANY_IDS_CACHE
    _MARKED_NA_COLUMN_SUPPORTED = None
    _NA_COMPANY_IDS_CACHE = None


def invalidate_performance_na_company_ids_cache() -> None:
    global _NA_COMPANY_IDS_CACHE
    _NA_COMPANY_IDS_CACHE = None


def performance_row_marked_na(row: dict) -> bool:
    v = row.get("marked_na")
    if v is True:
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "t", "1", "yes"):
        return True
    return False


def performance_marked_na_company_ids() -> set[str]:
    """Companies that have at least one performance_monitoring row marked NA."""
    global _NA_COMPANY_IDS_CACHE
    if not performance_marked_na_supported():
        return set()
    now = time.monotonic()
    if _NA_COMPANY_IDS_CACHE is not None:
        cached_at, cached_ids = _NA_COMPANY_IDS_CACHE
        if now - cached_at < _NA_COMPANY_IDS_TTL_SEC:
            return set(cached_ids)
    try:
        r = (
            supabase.table("performance_monitoring")
            .select("company_id")
            .eq("marked_na", True)
            .limit(10000)
            .execute()
        )
        ids = {str(x["company_id"]) for x in (r.data or []) if x.get("company_id")}
        _NA_COMPANY_IDS_CACHE = (now, ids)
        return ids
    except Exception:
        return set()


def apply_performance_list_query_filters(q, na_filter: str, na_company_ids: set[str]):
    """
    Push NA filtering into PostgREST when possible so list endpoints do not scan 10k rows in Python.
    Caller should still run filter_performance_rows() when len(na_company_ids) > POSTGREST_IN_MAX.
    """
    nf = (na_filter or "exclude_na").strip().lower()
    if nf == "all" or not performance_marked_na_supported():
        return q
    na_list = [cid for cid in na_company_ids if cid]
    if nf == "exclude_na":
        q = q.or_("marked_na.is.null,marked_na.eq.false")
        if na_list and len(na_list) <= POSTGREST_IN_MAX:
            q = q.not_.in_("company_id", na_list)
    elif nf == "only_na":
        if na_list and len(na_list) <= POSTGREST_IN_MAX:
            q = q.in_("company_id", na_list)
        else:
            q = q.eq("marked_na", True)
    return q


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


def filter_performance_rows(
    rows: list[dict],
    *,
    na_filter: str = "exclude_na",
    na_company_ids: set[str] | None = None,
) -> list[dict]:
    na_ids = na_company_ids if na_company_ids is not None else performance_marked_na_company_ids()
    return [r for r in rows if performance_row_matches_na_filter(r, na_filter=na_filter, na_company_ids=na_ids)]


def enrich_performance_rows_na(rows: list[dict], *, na_company_ids: set[str] | None = None) -> None:
    na_ids = na_company_ids if na_company_ids is not None else performance_marked_na_company_ids()
    supported = performance_marked_na_supported()
    for row in rows:
        cid = str(row.get("company_id") or "")
        row["marked_na"] = performance_row_marked_na(row) if supported else False
        row["company_excluded_by_na"] = cid in na_ids if supported else False
