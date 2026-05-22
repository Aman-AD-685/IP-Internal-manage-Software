"""Email submitter when I-1 board marks an improvement suggestion Done."""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from app.checklist_delegation_email_templates import build_improvement_done_html
from app.supabase_client import supabase
from app.utils.email import send_email_detail

_log = logging.getLogger("improvement_done_notify")


def _resolve_creator_email(user_id: str, display_fallback: str | None = None) -> tuple[str | None, str]:
    """Return (email, display_name) for the user who submitted the suggestion."""
    display = (display_fallback or "").strip() or "User"
    if not user_id:
        return None, display
    try:
        pr = (
            supabase.table("user_profiles")
            .select("email, full_name")
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        )
        if pr.data:
            row = pr.data[0]
            em = (row.get("email") or "").strip().lower()
            name = (row.get("full_name") or "").strip() or display
            if em:
                return em, name
            display = name or display
    except Exception as e:
        _log.warning("improvement done profile lookup %s: %s", user_id, e)

    try:
        auth_r = supabase.auth.admin.list_users(per_page=1000)
        auth_users = getattr(auth_r, "users", []) or []
        for u in auth_users:
            uid = str(getattr(u, "id", "") or (u.get("id") if isinstance(u, dict) else ""))
            if uid != str(user_id):
                continue
            em = (
                getattr(u, "email", None)
                or (u.get("email") if isinstance(u, dict) else None)
                or ""
            ).strip().lower()
            if em:
                return em, display
    except Exception as e2:
        _log.warning("improvement done auth fallback %s: %s", user_id, e2)

    return None, display


async def send_improvement_done_notification(row: dict[str, Any]) -> tuple[bool, str | None]:
    """Notify creator when status becomes done. Returns (ok, error_message)."""
    created_by = str(row.get("created_by") or "")
    ref = (row.get("reference_no") or "").strip() or "IM-????"
    suggestion = (row.get("suggestion_text") or "").strip()
    display = (row.get("user_display_name") or "").strip()

    to_email, name = _resolve_creator_email(created_by, display)
    if not to_email:
        _log.info("improvement done %s — no email for user %s", ref, created_by)
        return False, "No email on file for this user"

    html_body, plain = build_improvement_done_html(name, ref, suggestion)
    subject = f"Improvement {ref}: Marked Done"
    ok, err = await send_email_detail(to_email, subject, html_body, plain_fallback=plain)
    if ok:
        _log.info("improvement done notify %s -> %s", ref, to_email)
    else:
        _log.warning("improvement done notify failed %s -> %s: %s", ref, to_email, err)
    return ok, err


def fire_improvement_done_notification(row: dict[str, Any]) -> None:
    """Fire-and-forget from sync PATCH handler."""

    def _run() -> None:
        try:
            asyncio.run(send_improvement_done_notification(row))
        except Exception as e:
            _log.warning("improvement done notify thread: %s", e)

    threading.Thread(target=_run, daemon=True).start()
