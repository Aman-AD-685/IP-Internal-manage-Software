"""
Global similar-title lookup for the Support form (all companies, target <500ms).
Uses indexed ILIKE candidate fetch + in-app scoring (title + description).
Run database/TICKETS_SIMILAR_SEARCH.sql in Supabase for pg_trgm indexes.
"""
from __future__ import annotations

import re
from typing import Any

from app.supabase_client import supabase

SIMILAR_THRESHOLD = 90
NEAR_SIMILAR_MIN = 70
MIN_TITLE_LEN = 3

SIMILAR_EMPTY: dict[str, Any] = {
    "similar": [],
    "nearSimilar": [],
    "repeat_count": 0,
    "normalized_title": "",
    "has_open_repeat": False,
    "scope": "global",
    "matches": [],
}


def similar_tickets_access_allowed(email: str | None) -> bool:
    """All authenticated users (routes already require get_current_user)."""
    return bool((email or "").strip())


_TITLE_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "in",
        "on",
        "at",
        "to",
        "for",
        "is",
        "are",
        "was",
        "were",
        "be",
        "not",
        "no",
        "with",
        "from",
        "by",
        "as",
        "it",
        "this",
        "that",
        "issue",
        "problem",
        "error",
        "bug",
        "fix",
        "please",
        "need",
        "required",
        "working",
        "showing",
        "show",
        "unable",
    }
)

_TYPE_LABELS = {"chore": "Chores", "bug": "Bug", "feature": "Feature"}

_PLACEHOLDER_COMPANY_NAMES = frozenset(
    {
        "company a",
        "company b",
        "company c",
        "demo",
        "demo_c",
        "demo c",
        "demo_c ",
        "unknown",
        "n/a",
        "na",
        "test",
        "sample",
    }
)

_SIMILAR_SELECT = (
    "id,reference_no,title,description,type,company_id,company_name,created_at,status_2,status_3,status_4,"
    "quality_solution,approval_status,live_review_status,live_status,staging_planned,repeat_of_ticket_id"
)

_GLOBAL_CANDIDATE_LIMIT = 80


def _sanitize_ilike(value: str, max_len: int = 80) -> str:
    s = re.sub(r"[%_,\\]", "", str(value or "").strip())
    return s[:max_len]


def normalize_ticket_title(title: str | None) -> str:
    if not title:
        return ""
    s = str(title).strip().lower()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _title_tokens(title: str | None) -> list[str]:
    norm = normalize_ticket_title(title)
    if not norm:
        return []
    tokens = [t for t in norm.split() if len(t) >= 3 and t not in _TITLE_STOP_WORDS]
    tokens.sort(key=len, reverse=True)
    return tokens


def _fuzzy_token_match(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 3 and len(b) >= 3 and (a.startswith(b) or b.startswith(a)):
        return True
    return False


def _fuzzy_token_overlap(ta: set[str], tb: set[str]) -> set[str]:
    matched: set[str] = set()
    for a in ta:
        for b in tb:
            if _fuzzy_token_match(a, b):
                matched.add(a)
                break
    return matched


def title_similarity_score(a: str | None, b: str | None) -> int:
    na = normalize_ticket_title(a)
    nb = normalize_ticket_title(b)
    if not na or not nb:
        return 0
    if na == nb:
        return 100
    if na in nb or nb in na:
        return 95
    ta, tb = set(_title_tokens(a)), set(_title_tokens(b))
    if not ta or not tb:
        return 0
    inter = _fuzzy_token_overlap(ta, tb)
    union = ta | tb
    jaccard = int(round(100 * len(inter) / len(union))) if union else 0
    if len(inter) >= 2:
        return max(jaccard, 75)
    if inter and any(len(t) >= 4 for t in inter):
        return max(jaccard, 72)
    if inter:
        return max(jaccard, 70)
    return jaccard


def combined_similarity_score(query: str, row: dict[str, Any]) -> int:
    title_score = title_similarity_score(query, row.get("title"))
    desc_raw = str(row.get("description") or "")[:500]
    desc_score = title_similarity_score(query, desc_raw)
    return max(title_score, int(round(desc_score * 0.85)))


def _search_tokens(title: str) -> list[str]:
    tokens = [_sanitize_ilike(t) for t in _title_tokens(title) if len(t) >= 3]
    tokens = [t for t in tokens if t]
    if tokens:
        return tokens[:2]
    compact = _sanitize_ilike(normalize_ticket_title(title).replace(" ", ""), max_len=16)
    if len(compact) >= MIN_TITLE_LEN:
        return [compact[:12]]
    raw = _sanitize_ilike(title.strip(), max_len=12)
    return [raw] if len(raw) >= MIN_TITLE_LEN else []


def ticket_status_summary(row: dict[str, Any]) -> str:
    t = (row.get("type") or "").strip().lower()
    if t == "feature":
        ap = (row.get("approval_status") or "").strip().lower() or None
        live = (row.get("live_review_status") or row.get("live_status") or "").strip().lower()
        if live == "completed":
            return "Live completed"
        if ap == "hold":
            return "Approval hold"
        if ap == "rejected":
            return "Approval rejected"
        if ap in (None, "unapproved"):
            return "Approval pending"
        return f"Feature · {ap or 'pending'}"
    qs = row.get("quality_solution")
    if qs is not None and str(qs).strip() and str(qs).strip().lower() not in ("null", "none"):
        return "Register"
    s2 = (row.get("status_2") or "").strip().lower()
    s4 = (row.get("status_4") or "").strip().lower()
    if s2 == "rejected":
        return "Rejected"
    if s2 == "staging" or row.get("staging_planned"):
        return "Staging"
    if s4 == "completed":
        return "Completed"
    return f"Stage 2 {s2 or 'pending'}"


def _is_placeholder_company_name(name: str | None) -> bool:
    if not name:
        return True
    normalized = str(name).strip().lower()
    if not normalized or normalized in ("null", "none", "-"):
        return True
    return normalized in _PLACEHOLDER_COMPANY_NAMES


def _row_needs_ref_no_company_lookup(row: dict[str, Any]) -> bool:
    ref = row.get("reference_no")
    if not ref:
        return False
    if row.get("company_id"):
        return False
    stored = (row.get("company_name") or "").strip()
    if stored and not _is_placeholder_company_name(stored):
        return False
    return True


def _ref_no_to_company_for_rows(rows: list[dict[str, Any]]) -> dict[str, str]:
    refs: list[str] = []
    seen: set[str] = set()
    for row in rows:
        ref = row.get("reference_no")
        if not ref or not _row_needs_ref_no_company_lookup(row):
            continue
        key = str(ref).strip()
        if key and key not in seen:
            seen.add(key)
            refs.append(key)
    if not refs:
        return {}
    out: dict[str, str] = {}
    for i in range(0, len(refs), 80):
        chunk = refs[i : i + 80]
        try:
            r = (
                supabase.table("tickets")
                .select("reference_no, company_name, company_id")
                .in_("reference_no", chunk)
                .execute()
            )
            for hit in r.data or []:
                ref = str(hit.get("reference_no") or "").strip()
                name = (hit.get("company_name") or "").strip()
                if ref and name and not _is_placeholder_company_name(name):
                    out.setdefault(ref, name)
        except Exception:
            pass
    return out


def _resolve_company_name(
    row: dict[str, Any],
    companies_map: dict[str, str],
    ref_to_company: dict[str, str],
) -> str:
    cid = row.get("company_id")
    stored = (row.get("company_name") or "").strip()
    from_id = (companies_map.get(cid) or "").strip() if cid else ""
    from_ref = (ref_to_company.get(str(row.get("reference_no") or "").strip()) or "").strip()
    for candidate in (from_id, stored, from_ref):
        if candidate and not _is_placeholder_company_name(candidate):
            return candidate
    return from_id or stored or from_ref or ""


def _enrich_similar_company_names(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    ref_to_company = _ref_no_to_company_for_rows(rows)
    company_ids = {r.get("company_id") for r in rows if r.get("company_id")}
    companies_map: dict[str, str] = {}
    if company_ids:
        id_list = list(company_ids)
        for i in range(0, len(id_list), 80):
            chunk = id_list[i : i + 80]
            try:
                r = supabase.table("companies").select("id,name").in_("id", chunk).execute()
                for company in r.data or []:
                    cid = company.get("id")
                    name = (company.get("name") or "").strip()
                    if cid and name:
                        companies_map[cid] = name
            except Exception:
                pass
    for row in rows:
        row["company_name"] = _resolve_company_name(row, companies_map, ref_to_company)


def is_ticket_still_open(row: dict[str, Any]) -> bool:
    """Open = Pending / Hold / Staging / in-progress — not Completed, Register, or Rejected."""
    t = (row.get("type") or "").strip().lower()
    if t == "feature":
        live = (row.get("live_review_status") or row.get("live_status") or "").strip().lower()
        ap = (row.get("approval_status") or "").strip().lower()
        if ap == "rejected":
            return False
        if live == "completed":
            return False
        return True
    qs = row.get("quality_solution")
    if qs is not None and str(qs).strip() and str(qs).strip().lower() not in ("null", "none"):
        return False
    s2 = (row.get("status_2") or "").strip().lower()
    s4 = (row.get("status_4") or "").strip().lower()
    if s2 == "rejected":
        return False
    if s4 == "completed":
        return False
    return True


def ticket_open_stage_label(row: dict[str, Any]) -> str:
    t = (row.get("type") or "").strip().lower()
    if t == "feature":
        ap = (row.get("approval_status") or "").strip().lower()
        if ap == "hold":
            return "Hold"
        if ap in ("", "unapproved", "null", "none"):
            return "Pending"
        if ap == "approved":
            live = (row.get("live_review_status") or row.get("live_status") or "").strip().lower()
            return "Live pending" if live != "completed" else "Live completed"
        return ap.capitalize() if ap else "Pending"
    s2 = (row.get("status_2") or "").strip().lower()
    s3 = (row.get("status_3") or "").strip().lower()
    if s2 == "hold" or s3 == "hold":
        return "Hold"
    if s2 == "pending" or s2 in ("", "null", "none"):
        return "Pending"
    if s2 == "staging":
        return "Staging"
    if (row.get("status_4") or "").strip().lower() == "completed":
        return "Completed"
    return ticket_status_summary(row)


def _query_candidate_rows(tokens: list[str], *, include_description: bool) -> list[dict[str, Any]]:
    try:
        if len(tokens) == 1:
            t0 = tokens[0]
            if include_description:
                filt = f"title.ilike.%{t0}%,description.ilike.%{t0}%"
            else:
                filt = f"title.ilike.%{t0}%"
            q = (
                supabase.table("tickets")
                .select(_SIMILAR_SELECT)
                .or_(filt)
                .order("created_at", desc=True)
            )
        else:
            t0, t1 = tokens[0], tokens[1]
            if include_description:
                filt = (
                    f"title.ilike.%{t0}%,description.ilike.%{t0}%,"
                    f"title.ilike.%{t1}%,description.ilike.%{t1}%"
                )
            else:
                filt = f"title.ilike.%{t0}%,title.ilike.%{t1}%"
            q = (
                supabase.table("tickets")
                .select(_SIMILAR_SELECT)
                .or_(filt)
                .order("created_at", desc=True)
            )
        r = q.limit(_GLOBAL_CANDIDATE_LIMIT).execute()
        return list(r.data or [])
    except Exception:
        return []


def _fetch_global_candidates(title: str) -> list[dict[str, Any]]:
    tokens = _search_tokens(title)
    if not tokens:
        return []
    # Title-only first — fast on production without description trigram index.
    rows = _query_candidate_rows(tokens, include_description=False)
    if len(rows) < 20:
        extra = _query_candidate_rows(tokens, include_description=True)
        seen = {str(r.get("id")) for r in rows if r.get("id")}
        for row in extra:
            rid = str(row.get("id") or "")
            if rid and rid not in seen:
                rows.append(row)
                seen.add(rid)
    return rows[:_GLOBAL_CANDIDATE_LIMIT]


def _row_to_match(score: int, row: dict[str, Any]) -> dict[str, Any]:
    ticket_type = (row.get("type") or "").strip().lower()
    if score >= 100:
        match_kind = "exact"
    elif score >= SIMILAR_THRESHOLD:
        match_kind = "similar"
    else:
        match_kind = "near_similar"
    return {
        "id": row.get("id"),
        "reference_no": row.get("reference_no"),
        "title": row.get("title"),
        "type": ticket_type,
        "type_label": _TYPE_LABELS.get(ticket_type, ticket_type),
        "company_name": row.get("company_name") or "",
        "created_at": row.get("created_at"),
        "status_summary": ticket_status_summary(row),
        "status": "Open" if is_ticket_still_open(row) else "Closed",
        "is_open": is_ticket_still_open(row),
        "match_score": score,
        "match_kind": match_kind,
    }


def find_similar_tickets(
    *,
    title: str,
    limit: int = 10,
    min_score: int = NEAR_SIMILAR_MIN,
) -> dict[str, Any]:
    title = (title or "").strip()
    empty = {**SIMILAR_EMPTY, "normalized_title": normalize_ticket_title(title)}
    if len(title) < MIN_TITLE_LEN or not _search_tokens(title):
        return empty

    rows = _fetch_global_candidates(title)
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        score = combined_similarity_score(title, row)
        if score < min_score:
            continue
        scored.append((score, row))

    scored.sort(
        key=lambda x: (-x[0], str(x[1].get("created_at") or ""), str(x[1].get("reference_no") or ""))
    )

    picked: list[tuple[int, dict[str, Any]]] = []
    for score, row in scored:
        if len(picked) >= limit:
            break
        picked.append((score, row))

    _enrich_similar_company_names([row for _, row in picked])

    similar: list[dict[str, Any]] = []
    near_similar: list[dict[str, Any]] = []
    for score, row in picked:
        match = _row_to_match(score, row)
        if score >= SIMILAR_THRESHOLD:
            similar.append(match)
        else:
            near_similar.append(match)

    matches = similar + near_similar
    return {
        "similar": similar,
        "nearSimilar": near_similar,
        "repeat_count": len(scored),
        "normalized_title": normalize_ticket_title(title),
        "has_open_repeat": any(m.get("is_open") for m in matches),
        "scope": "global",
        "matches": matches,
    }


def _row_to_repeat_match(row: dict[str, Any], score: int, *, is_self: bool = False) -> dict[str, Any]:
    ticket_type = (row.get("type") or "").strip().lower()
    return {
        "id": row.get("id"),
        "reference_no": row.get("reference_no"),
        "title": row.get("title"),
        "type": ticket_type,
        "type_label": _TYPE_LABELS.get(ticket_type, ticket_type),
        "company_name": row.get("company_name") or "",
        "created_at": row.get("created_at"),
        "status_summary": ticket_status_summary(row),
        "stage": ticket_open_stage_label(row),
        "status": "Open" if is_ticket_still_open(row) else "Closed",
        "is_open": is_ticket_still_open(row),
        "match_score": score,
        "is_self": is_self,
        "repeat_of_ticket_id": row.get("repeat_of_ticket_id"),
    }


def _row_to_child_repeat(row: dict[str, Any]) -> dict[str, Any]:
    ticket_type = (row.get("type") or "").strip().lower()
    return {
        "id": row.get("id"),
        "reference_no": row.get("reference_no"),
        "title": row.get("title"),
        "description": row.get("description") or "",
        "type": ticket_type,
        "type_label": _TYPE_LABELS.get(ticket_type, ticket_type),
        "company_name": row.get("company_name") or "",
        "created_at": row.get("created_at"),
        "status_summary": ticket_status_summary(row),
        "stage": ticket_open_stage_label(row),
        "is_open": is_ticket_still_open(row),
    }


def fetch_repeat_child_counts(parent_ids: list[str]) -> dict[str, int]:
    """Count tickets created with repeat_of_ticket_id pointing at each parent."""
    out: dict[str, int] = {}
    ids = [str(i).strip() for i in parent_ids if i]
    if not ids:
        return out
    for i in range(0, len(ids), 80):
        chunk = ids[i : i + 80]
        try:
            r = (
                supabase.table("tickets")
                .select("repeat_of_ticket_id")
                .in_("repeat_of_ticket_id", chunk)
                .execute()
            )
            for row in r.data or []:
                pid = str(row.get("repeat_of_ticket_id") or "").strip()
                if pid:
                    out[pid] = out.get(pid, 0) + 1
        except Exception:
            pass
    return out


def attach_repeat_child_counts(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    parent_ids = [str(r.get("id") or "") for r in rows if r.get("id")]
    counts = fetch_repeat_child_counts(parent_ids)
    for row in rows:
        rid = str(row.get("id") or "")
        row["repeat_child_count"] = counts.get(rid, 0)


def find_repeats_for_ticket(ticket_id: str, *, limit: int = 50) -> dict[str, Any]:
    """Tickets created from this parent (repeat_of_ticket_id = ticket_id)."""
    empty: dict[str, Any] = {
        "childCount": 0,
        "children": [],
        "referenceNo": None,
        "title": None,
    }
    ticket_id = (ticket_id or "").strip()
    if not ticket_id:
        return empty
    try:
        pr = (
            supabase.table("tickets")
            .select("id,reference_no,title")
            .eq("id", ticket_id)
            .single()
            .execute()
        )
        parent = pr.data or {}
    except Exception:
        parent = {}
    try:
        cr = (
            supabase.table("tickets")
            .select(_SIMILAR_SELECT)
            .eq("repeat_of_ticket_id", ticket_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        child_rows = list(cr.data or [])
    except Exception:
        child_rows = []
    _enrich_similar_company_names(child_rows)
    children = [_row_to_child_repeat(row) for row in child_rows]
    return {
        "childCount": len(children),
        "children": children,
        "referenceNo": parent.get("reference_no"),
        "title": parent.get("title"),
    }
