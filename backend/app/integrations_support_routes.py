"""Machine/integration API: one URL for Stage 2 pending GET + Claude Review POST.

Auth: X-FMS-Integration-Key (DELEGATION_INTEGRATION_API_KEY).
Does not change status_2 — only sets claude_reviewed_at for UI (C.R) badge.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

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

# Single production path — GET list, POST mark done
CLAUDE_REVIEW_PATH = "/claude-review"

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
) -> dict:
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
    }


@integrations_support_router.get(
    CLAUDE_REVIEW_PATH,
    dependencies=[Depends(require_integration_key)],
)
def get_claude_review(
    unreviewed_only: bool = Query(True),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """GET: Stage 2 pending Support tickets."""
    return _list_stage2_pending(
        unreviewed_only=unreviewed_only,
        page=page,
        page_size=page_size,
    )


@integrations_support_router.post(
    CLAUDE_REVIEW_PATH,
    dependencies=[Depends(require_integration_key)],
)
def post_claude_review(payload: ClaudeReviewDoneRequest):
    """POST: mark Claude Review done → UI (C.R) / Claude Review."""
    return _mark_claude_review_done(payload)
