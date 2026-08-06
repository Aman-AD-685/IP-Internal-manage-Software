"""Machine/integration API: one URL for Stage 2 pending GET + Claude Review POST.

Auth: X-FMS-Integration-Key (DELEGATION_INTEGRATION_API_KEY).
Does not change status_2 — only sets/clears claude_reviewed_at for UI (C.R) badge.

Stale reset: if still Stage 2 pending after 24 weekday hours (Sat/Sun excluded, IST),
clear claude_reviewed_at so Claude can pull it again. Runs on each GET.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AliasChoices, BaseModel, Field, model_validator

from app.integration_auth import require_integration_key
from app.supabase_client import supabase
from app.ticket_na import apply_exclude_ticket_na

integrations_support_router = APIRouter(
    prefix="/integrations/support",
    tags=["integrations-support"],
)
_log = logging.getLogger("integrations_support")

CLAUDE_REVIEW_PATH = "/claude-review"
_IST = ZoneInfo("Asia/Kolkata")
_STALE_WEEKDAY_HOURS = 24
_STALE_SCAN_LIMIT = 500

_STAGE2_PENDING_SELECT = (
    "id,reference_no,title,description,type,priority,status,status_1,status_2,"
    "company_name,page,division,user_name,created_at,updated_at,attachment_url,"
    "customer_questions,remarks,assignee_id,claude_reviewed_at"
)


def _bust_ticket_list_cache() -> None:
    try:
        from app.main import _invalidate_ttl_cache_key_prefix

        _invalidate_ttl_cache_key_prefix("tickets:list:")
    except Exception as e:
        _log.warning("ticket list cache bust failed: %s", e)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def weekday_hours_between(start: datetime, end: datetime) -> float:
    """Elapsed hours counting only Mon–Fri (IST). Sat/Sun contribute 0."""
    start_ist = start.astimezone(_IST)
    end_ist = end.astimezone(_IST)
    if end_ist <= start_ist:
        return 0.0
    hours = 0.0
    cur = start_ist
    # Cap walk: ~14 days max for safety
    hard_end = min(end_ist, start_ist + timedelta(days=14))
    while cur < hard_end:
        nxt = min(cur + timedelta(hours=1), hard_end)
        if cur.weekday() < 5:  # Mon=0 .. Fri=4
            hours += (nxt - cur).total_seconds() / 3600.0
        cur = nxt
        if hours >= _STALE_WEEKDAY_HOURS:
            break
    return hours


def _missing_column_http(e: Exception) -> HTTPException | None:
    err = str(e).lower()
    if "claude_reviewed_at" in err and any(
        tok in err for tok in ("does not exist", "42703", "pgrst204", "could not find", "schema cache")
    ):
        return HTTPException(
            503,
            "claude_reviewed_at column missing. Run database/TICKETS_CLAUDE_REVIEWED_AT.sql",
        )
    return None


def _stage2_pending_query(*, unreviewed_only: bool):
    q = (
        supabase.table("tickets")
        .select(_STAGE2_PENDING_SELECT, count="exact")
        .in_("type", ["chore", "bug"])
        .is_("quality_solution", "null")
        .eq("status_2", "pending")
        .or_("staging_planned.is.null,live_review_status.eq.completed")
    )
    q = apply_exclude_ticket_na(q)
    q = q.is_("repeat_of_ticket_id", "null")
    if unreviewed_only:
        q = q.is_("claude_reviewed_at", "null")
    return q


def _reset_stale_claude_reviews(*, now: datetime | None = None) -> dict:
    """Clear Claude Review when Stage 2 still pending after 24 weekday hours (no Sat/Sun)."""
    now = now or datetime.now(timezone.utc)
    try:
        r = (
            supabase.table("tickets")
            .select(
                "id,reference_no,claude_reviewed_at,status_2,quality_solution,"
                "staging_planned,live_review_status,repeat_of_ticket_id,type"
            )
            .in_("type", ["chore", "bug"])
            .eq("status_2", "pending")
            .is_("quality_solution", "null")
            .not_.is_("claude_reviewed_at", "null")
            .is_("repeat_of_ticket_id", "null")
            .or_("staging_planned.is.null,live_review_status.eq.completed")
            .order("claude_reviewed_at")
            .limit(_STALE_SCAN_LIMIT)
            .execute()
        )
    except Exception as e:
        col = _missing_column_http(e)
        if col:
            raise col from e
        _log.exception("claude-review stale scan failed: %s", e)
        return {"reset_count": 0, "reset_refs": [], "error": str(e)}

    due_ids: list[str] = []
    due_refs: list[str] = []
    for row in r.data or []:
        marked = _parse_ts(row.get("claude_reviewed_at"))
        if not marked:
            continue
        if weekday_hours_between(marked, now) < _STALE_WEEKDAY_HOURS:
            continue
        tid = str(row.get("id") or "")
        if not tid:
            continue
        due_ids.append(tid)
        ref = (row.get("reference_no") or "").strip()
        if ref:
            due_refs.append(ref)

    if not due_ids:
        return {"reset_count": 0, "reset_refs": []}

    stamp = now.isoformat()
    try:
        supabase.table("tickets").update(
            {"claude_reviewed_at": None, "updated_at": stamp}
        ).in_("id", due_ids).eq("status_2", "pending").execute()
    except Exception as e:
        _log.exception("claude-review stale reset failed: %s", e)
        return {"reset_count": 0, "reset_refs": [], "error": str(e)}

    _bust_ticket_list_cache()
    _log.info("claude review stale reset count=%s refs=%s", len(due_ids), due_refs[:20])
    return {"reset_count": len(due_ids), "reset_refs": due_refs}


def _ticket_public(row: dict) -> dict:
    return {
        "id": str(row.get("id") or ""),
        "reference_no": (row.get("reference_no") or "").strip(),
        "title": (row.get("title") or "").strip(),
        "description": row.get("description"),
        "type": row.get("type"),
        "priority": row.get("priority"),
        "status": row.get("status"),
        "status_1": row.get("status_1"),
        "status_2": row.get("status_2"),
        "company_name": row.get("company_name"),
        "page": row.get("page"),
        "division": row.get("division"),
        "user_name": row.get("user_name"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "attachment_url": row.get("attachment_url"),
        "customer_questions": row.get("customer_questions"),
        "remarks": row.get("remarks"),
        "assignee_id": row.get("assignee_id"),
        "claude_reviewed_at": row.get("claude_reviewed_at"),
        "claude_reviewed": bool(row.get("claude_reviewed_at")),
    }


class ClaudeReviewDoneRequest(BaseModel):
    reference_no: str | None = Field(
        None,
        validation_alias=AliasChoices("reference_no", "referenceNo", "ref"),
    )
    ticket_id: str | None = Field(
        None,
        validation_alias=AliasChoices("ticket_id", "ticketId", "id"),
    )
    note: str | None = Field(
        None,
        max_length=2000,
        validation_alias=AliasChoices("note", "remark", "external_ref", "externalRef"),
    )

    @model_validator(mode="before")
    @classmethod
    def _flatten_nested(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        for nest in ("ticket", "data", "payload", "body"):
            inner = data.get(nest)
            if isinstance(inner, dict):
                return {**inner, **{k: v for k, v in data.items() if k != nest}}
        return data


def _list_stage2_pending(
    *,
    unreviewed_only: bool,
    page: int,
    page_size: int,
    reset_stale: bool,
) -> dict:
    stale_info = {"reset_count": 0, "reset_refs": []}
    if reset_stale:
        stale_info = _reset_stale_claude_reviews()

    try:
        offset = (page - 1) * page_size
        r = (
            _stage2_pending_query(unreviewed_only=unreviewed_only)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
    except Exception as e:
        col = _missing_column_http(e)
        if col:
            raise col from e
        _log.exception("claude-review GET failed: %s", e)
        raise HTTPException(503, "Could not list Stage 2 pending tickets.") from e

    rows = [_ticket_public(row) for row in (r.data or [])]
    total = int(r.count) if r.count is not None else len(rows)
    return {
        "ok": True,
        "tickets": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "unreviewed_only": unreviewed_only,
        "stale_reset": stale_info,
        "stale_rule": {
            "weekday_hours": _STALE_WEEKDAY_HOURS,
            "exclude": ["Saturday", "Sunday"],
            "timezone": "Asia/Kolkata",
            "only_if": "status_2=pending (Stage 2 not completed)",
        },
    }


def _mark_claude_review_done(payload: ClaudeReviewDoneRequest) -> dict:
    ref = (payload.reference_no or "").strip()
    tid = (payload.ticket_id or "").strip()
    if not ref and not tid:
        raise HTTPException(400, "Provide reference_no or ticket_id.")

    try:
        q = supabase.table("tickets").select(
            "id,reference_no,type,status_2,quality_solution,claude_reviewed_at,"
            "staging_planned,live_review_status,repeat_of_ticket_id"
        )
        if tid:
            q = q.eq("id", tid)
        else:
            q = q.eq("reference_no", ref)
        r = q.limit(1).execute()
    except Exception as e:
        col = _missing_column_http(e)
        if col:
            raise col from e
        _log.exception("claude-review POST lookup failed: %s", e)
        raise HTTPException(503, "Could not look up ticket.") from e

    if not r.data:
        raise HTTPException(404, f"Ticket not found for {'id=' + tid if tid else 'ref=' + ref}.")

    row = r.data[0]
    ticket_type = str(row.get("type") or "").strip().lower()
    if ticket_type not in ("chore", "bug"):
        raise HTTPException(400, "Claude Review is only for chore/bug Support tickets.")
    if row.get("quality_solution"):
        raise HTTPException(400, "Ticket already has quality_solution (left open queue).")
    if str(row.get("status_2") or "").strip().lower() != "pending":
        raise HTTPException(
            400,
            f"Ticket status_2 must be pending (got {row.get('status_2')!r}).",
        )
    if row.get("repeat_of_ticket_id"):
        raise HTTPException(400, "Repeat child tickets cannot be Claude-reviewed via this API.")
    staging_planned = row.get("staging_planned")
    live_review = str(row.get("live_review_status") or "").strip().lower()
    if staging_planned is not None and live_review != "completed":
        raise HTTPException(400, "Ticket is in active Staging; not in Stage 2 pending queue.")

    if row.get("claude_reviewed_at"):
        return {
            "ok": True,
            "already_done": True,
            "ticket": {
                "id": str(row["id"]),
                "reference_no": (row.get("reference_no") or "").strip(),
                "claude_reviewed_at": row.get("claude_reviewed_at"),
                "claude_reviewed": True,
            },
            "note": (payload.note or "").strip() or None,
        }

    now = _iso_now()
    try:
        upd = (
            supabase.table("tickets")
            .update({"claude_reviewed_at": now, "updated_at": now})
            .eq("id", row["id"])
            .execute()
        )
    except Exception as e:
        _log.exception("claude-review POST update failed: %s", e)
        raise HTTPException(503, "Could not mark Claude Review done.") from e

    updated = (upd.data or [None])[0] or {**row, "claude_reviewed_at": now}
    _bust_ticket_list_cache()
    _log.info(
        "claude review done ref=%s id=%s note=%s",
        updated.get("reference_no"),
        updated.get("id"),
        (payload.note or "").strip() or None,
    )
    return {
        "ok": True,
        "already_done": False,
        "ticket": {
            "id": str(updated.get("id") or row["id"]),
            "reference_no": (updated.get("reference_no") or row.get("reference_no") or "").strip(),
            "claude_reviewed_at": updated.get("claude_reviewed_at") or now,
            "claude_reviewed": True,
        },
        "note": (payload.note or "").strip() or None,
        "stale_rule": {
            "weekday_hours": _STALE_WEEKDAY_HOURS,
            "exclude": ["Saturday", "Sunday"],
            "timezone": "Asia/Kolkata",
            "only_if": "status_2 still pending after 24 weekday hours → C.R cleared",
        },
    }


@integrations_support_router.get(
    CLAUDE_REVIEW_PATH,
    dependencies=[Depends(require_integration_key)],
)
def get_claude_review(
    unreviewed_only: bool = Query(True),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    reset_stale: bool = Query(
        True,
        description="Clear C.R when Stage 2 still pending after 24 weekday hours (Sat/Sun excluded).",
    ),
):
    """GET: Stage 2 pending Support tickets (auto-resets stale Claude Review first)."""
    return _list_stage2_pending(
        unreviewed_only=unreviewed_only,
        page=page,
        page_size=page_size,
        reset_stale=reset_stale,
    )


@integrations_support_router.post(
    CLAUDE_REVIEW_PATH,
    dependencies=[Depends(require_integration_key)],
)
def post_claude_review(payload: ClaudeReviewDoneRequest):
    """POST: mark Claude Review done → UI (C.R) / Claude Review."""
    return _mark_claude_review_done(payload)
