"""One-time email approval tokens — no login required."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.supabase_client import supabase

_APPROVAL_STATUS_ALLOWED = frozenset({"approved", "unapproved", "rejected", "hold"})


def _friendly_db_error(exc: Exception) -> str | None:
    """Map Postgres check violations to actionable messages for approvers."""
    raw = str(exc)
    if "tickets_approval_status_check" in raw or (
        "23514" in raw and "approval_status" in raw.lower()
    ):
        return (
            "Could not save: the database does not allow this approval status yet. "
            "Ask your admin to run database/FEATURE_APPROVAL_HOLD_STATUS.sql in Supabase, then try again."
        )
    if "approval_tokens_action_check" in raw:
        return (
            "Hold link is not enabled in the database yet. "
            "Ask your admin to run database/FEATURE_APPROVAL_HOLD_STATUS.sql in Supabase."
        )
    return None


def execute_approval_by_token(token: str, action: str, remarks: str | None = None) -> dict[str, Any]:
    """
    Validate token and approve / reject / hold a feature ticket.
    Reject and hold require non-empty remarks (stored on tickets.remarks).
    """
    try:
        token_uuid = uuid.UUID((token or "").strip())
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid token")
    action = (action or "").strip().lower()
    if action not in ("approve", "reject", "hold"):
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
    # Action comes from the email link (?action=approve|reject|hold). One token row may
    # authorize any of those actions for the same pending ticket (reminder email uses one token).

    exp = row.get("expires_at")
    try:
        exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00")) if isinstance(exp, str) else exp
        if exp_dt and datetime.now(timezone.utc) > exp_dt:
            raise HTTPException(status_code=400, detail="This approval link has expired.")
    except (TypeError, ValueError):
        pass

    ticket_id = row["ticket_id"]

    tck = (
        supabase.table("tickets")
        .select("approval_status, reference_no")
        .eq("id", ticket_id)
        .limit(1)
        .execute()
    )
    if not tck.data:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    current_status = tck.data[0].get("approval_status")
    if current_status not in (None, ""):
        ref = (tck.data[0].get("reference_no") or "") or str(ticket_id)[:8]
        raise HTTPException(
            status_code=400,
            detail=(
                f"Feature request {ref} is no longer pending approval "
                f"(current status: {current_status}). This {action} link cannot be used."
            ),
        )

    remarks_clean = (remarks or "").strip()
    if action in ("reject", "hold") and not remarks_clean:
        label = "rejecting" if action == "reject" else "placing on hold"
        raise HTTPException(
            status_code=400,
            detail=f"Remarks are required when {label} a feature request.",
        )

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
    elif action == "hold":
        status = "hold"
        update_data = {
            "approval_status": status,
            "approval_source": "email",
            "approved_by": None,
            "approval_actual_at": None,
            "unapproval_actual_at": now,
            "remarks": remarks_clean,
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
    log_status = "approved" if status == "approved" else status
    try:
        supabase.table("approval_logs").insert(
            {
                "ticket_id": ticket_id,
                "approved_by": None,
                "approved_at": now,
                "status": log_status,
                "source": "email",
                "remarks": update_data.get("remarks"),
            }
        ).execute()
    except Exception:
        pass

    tr = (
        supabase.table("tickets")
        .select("reference_no, title, remarks")
        .eq("id", ticket_id)
        .limit(1)
        .execute()
    )
    ref = (tr.data[0].get("reference_no") if tr.data else None) or str(ticket_id)[:8]
    title = tr.data[0].get("title") if tr.data else None
    saved_remarks = update_data.get("remarks") or (tr.data[0].get("remarks") if tr.data else None)
    try:
        from app.feature_approval_submitter_notify import fire_submitter_approval_notification

        fire_submitter_approval_notification(
            str(ticket_id),
            status=status,
            reference_no=ref,
            title=title,
            remarks=saved_remarks,
            source="email",
        )
    except Exception:
        pass
    try:
        from app.main import invalidate_dashboard_read_caches, _invalidate_ttl_cache_key_prefix
        from app.ws_hub import broadcast_ticket_changed

        invalidate_dashboard_read_caches()
        _invalidate_ttl_cache_key_prefix("tickets:list:")
        broadcast_ticket_changed(str(ticket_id), "approval")
    except Exception:
        pass
    if status == "approved":
        msg = f"Feature request {ref} has been approved. Thank you, Approver."
    elif status == "hold":
        msg = (
            f"Feature request {ref} is on hold. Your remarks were saved and appear in "
            "Approval Status. You can return it to pending approval from the app."
        )
    else:
        msg = f"Feature request {ref} has been rejected. Your remarks were saved and appear in Approval Status."
    return {
        "success": True,
        "status": status,
        "ticket_id": ticket_id,
        "reference_no": ref,
        "message": msg,
    }
