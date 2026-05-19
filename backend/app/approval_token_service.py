"""One-time email approval tokens — no login required."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.supabase_client import supabase

_APPROVAL_STATUS_ALLOWED = frozenset({"approved", "unapproved", "rejected"})


def _friendly_db_error(exc: Exception) -> str | None:
    """Map Postgres check violations to actionable messages for approvers."""
    raw = str(exc)
    if "tickets_approval_status_check" in raw or (
        "23514" in raw and "approval_status" in raw.lower()
    ):
        return (
            "Reject could not be saved: the database does not allow status 'rejected' yet. "
            "Ask your admin to run database/FIX_TICKETS_APPROVAL_STATUS_CHECK.sql in Supabase, then try again."
        )
    return None


def execute_approval_by_token(token: str, action: str, remarks: str | None = None) -> dict[str, Any]:
    """
    Validate token and approve/reject feature ticket.
    Reject requires non-empty remarks (stored on tickets.remarks).
    """
    try:
        token_uuid = uuid.UUID((token or "").strip())
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid token")
    action = (action or "").strip().lower()
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid action")

    r = (
        supabase.table("approval_tokens")
        .select("id, ticket_id, action, expires_at")
        .eq("token", str(token_uuid))
        .is_("used_at", "null")
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=400, detail="This link was already used or is invalid.")
    row = r.data[0]
    if row["action"] != action:
        raise HTTPException(status_code=400, detail="Token action mismatch")

    exp = row.get("expires_at")
    try:
        exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00")) if isinstance(exp, str) else exp
        if exp_dt and datetime.now(timezone.utc) > exp_dt:
            raise HTTPException(status_code=400, detail="This approval link has expired.")
    except (TypeError, ValueError):
        pass

    ticket_id = row["ticket_id"]
    remarks_clean = (remarks or "").strip()
    if action == "reject" and not remarks_clean:
        raise HTTPException(status_code=400, detail="Remarks are required when rejecting a feature request.")

    now = datetime.utcnow().isoformat()
    if action == "approve":
        status = "approved"
        update_data = {
            "approval_status": status,
            "approval_source": "email",
            "approved_by": None,
            "approval_actual_at": now,
            "unapproval_actual_at": None,
        }
    else:
        status = "rejected"
        if status not in _APPROVAL_STATUS_ALLOWED:
            raise HTTPException(status_code=400, detail="Invalid rejection status.")
        update_data = {
            "approval_status": status,
            "approval_source": "email",
            "approved_by": None,
            "approval_actual_at": None,
            "unapproval_actual_at": now,
            "remarks": remarks_clean,
        }

    try:
        ur = supabase.table("tickets").update(update_data).eq("id", ticket_id).execute()
    except Exception as e:
        hint = _friendly_db_error(e)
        if hint:
            raise HTTPException(status_code=400, detail=hint) from e
        raise HTTPException(status_code=500, detail="Could not update ticket. Please try again or use the app.") from e
    if not ur.data:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    supabase.table("approval_tokens").update({"used_at": now}).eq("id", row["id"]).execute()
    try:
        supabase.table("approval_logs").insert(
            {
                "ticket_id": ticket_id,
                "approved_by": None,
                "approved_at": now,
                "status": "approved" if status == "approved" else "rejected",
                "source": "email",
                "remarks": update_data.get("remarks"),
            }
        ).execute()
    except Exception:
        pass

    tr = supabase.table("tickets").select("reference_no").eq("id", ticket_id).limit(1).execute()
    ref = (tr.data[0].get("reference_no") if tr.data else None) or str(ticket_id)[:8]
    if status == "approved":
        msg = f"Feature request {ref} has been approved. Thank you, Approver."
    else:
        msg = f"Feature request {ref} has been rejected. Your remarks were saved and appear in Approval Status."
    return {
        "success": True,
        "status": status,
        "ticket_id": ticket_id,
        "reference_no": ref,
        "message": msg,
    }
