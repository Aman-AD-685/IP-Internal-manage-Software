"""
Global similar-title lookup for the Support form (all companies, target <500ms).
"""
from __future__ import annotations

import re
from typing import Any

from app.supabase_client import supabase

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

# Narrow columns — keeps PostgREST payload small for sub-500ms responses.
_SIMILAR_SELECT = (
    "id,reference_no,title,type,company_name,created_at,status_2,status_4,"
    "quality_solution,approval_status,live_review_status,live_status,staging_planned"
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
    inter = ta & tb
    union = ta | tb
    jaccard = int(round(100 * len(inter) / len(union))) if union else 0
    if len(inter) >= 2:
        return max(jaccard, 75)
    if inter and any(len(t) >= 5 for t in inter):
        return max(jaccard, 70)
    return jaccard


def _search_tokens(title: str) -> list[str]:
    tokens = [_sanitize_ilike(t) for t in _title_tokens(title) if len(t) >= 4]
    tokens = [t for t in tokens if t]
    if tokens:
        return tokens[:2]
    norm = _sanitize_ilike(normalize_ticket_title(title).replace(" ", ""), max_len=16)
    return [norm] if len(norm) >= 4 else []


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


def is_ticket_still_open(row: dict[str, Any]) -> bool:
    t = (row.get("type") or "").strip().lower()
    if t == "feature":
        live = (row.get("live_review_status") or row.get("live_status") or "").strip().lower()
        ap = (row.get("approval_status") or "").strip().lower()
        if ap == "rejected":
            return False
        return live != "completed"
    qs = row.get("quality_solution")
    if qs is not None and str(qs).strip() and str(qs).strip().lower() not in ("null", "none"):
        return False
    if (row.get("status_2") or "").strip().lower() == "rejected":
        return False
    if (row.get("status_4") or "").strip().lower() == "completed":
        return False
    return True


def _fetch_global_candidates(title: str) -> list[dict[str, Any]]:
    tokens = _search_tokens(title)
    if not tokens:
        return []
    try:
        if len(tokens) == 1:
            q = (
                supabase.table("tickets")
                .select(_SIMILAR_SELECT)
                .ilike("title", f"%{tokens[0]}%")
                .order("created_at", desc=True)
            )
        else:
            t0, t1 = tokens[0], tokens[1]
            q = (
                supabase.table("tickets")
                .select(_SIMILAR_SELECT)
                .or_(f"title.ilike.%{t0}%,title.ilike.%{t1}%")
                .order("created_at", desc=True)
            )
        r = q.limit(_GLOBAL_CANDIDATE_LIMIT).execute()
        return list(r.data or [])
    except Exception:
        return []


def find_similar_tickets(
    *,
    title: str,
    limit: int = 10,
    min_score: int = 70,
) -> dict[str, Any]:
    title = (title or "").strip()
    empty: dict[str, Any] = {
        "repeat_count": 0,
        "normalized_title": normalize_ticket_title(title),
        "has_open_repeat": False,
        "scope": "global",
        "matches": [],
    }
    if len(title) < 6 or not _search_tokens(title):
        return empty

    rows = _fetch_global_candidates(title)
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        score = title_similarity_score(title, row.get("title"))
        if score < min_score:
            continue
        scored.append((score, row))

    scored.sort(key=lambda x: (-x[0], str(x[1].get("created_at") or ""), str(x[1].get("reference_no") or "")))
    matches: list[dict[str, Any]] = []
    for score, row in scored[:limit]:
        ticket_type = (row.get("type") or "").strip().lower()
        matches.append(
            {
                "id": row.get("id"),
                "reference_no": row.get("reference_no"),
                "title": row.get("title"),
                "type": ticket_type,
                "type_label": _TYPE_LABELS.get(ticket_type, ticket_type),
                "company_name": row.get("company_name") or "",
                "created_at": row.get("created_at"),
                "status_summary": ticket_status_summary(row),
                "is_open": is_ticket_still_open(row),
                "match_score": score,
                "match_kind": "exact" if score >= 100 else "similar",
            }
        )

    return {
        **empty,
        "repeat_count": len(scored),
        "has_open_repeat": any(m.get("is_open") for m in matches),
        "matches": matches,
    }
