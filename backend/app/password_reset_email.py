"""Send password reset via Postmark + Supabase admin generate_link (better deliverability)."""
from __future__ import annotations

import asyncio
import os
from typing import Any

from app.auth_email_templates import build_password_reset_email
from app.supabase_client import SUPABASE_SERVICE_ROLE_KEY, supabase, supabase_auth
from app.utils.email import get_email_delivery_status, send_email_detail


def _log(msg: str) -> None:
    import sys

    print(f"[password-reset] {msg}", file=sys.stderr, flush=True)


def _extract_action_link(response: Any) -> str | None:
    props = getattr(response, "properties", None)
    if props is not None:
        link = getattr(props, "action_link", None)
        if isinstance(link, str) and link.strip():
            return link.strip()
        if isinstance(props, dict):
            raw = props.get("action_link")
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    for key in ("action_link",):
        direct = getattr(response, key, None)
        if isinstance(direct, str) and direct.strip():
            return direct.strip()
    if isinstance(response, dict):
        nested = response.get("properties") or {}
        if isinstance(nested, dict):
            raw = nested.get("action_link")
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    return None


def _custom_reset_enabled() -> bool:
    flag = (os.getenv("PASSWORD_RESET_CUSTOM_EMAIL") or "1").strip().lower()
    if flag in ("0", "false", "no"):
        return False
    if not (SUPABASE_SERVICE_ROLE_KEY or "").strip():
        return False
    delivery = get_email_delivery_status()
    if delivery.get("mode") == "log":
        return False
    if not delivery.get("from_email"):
        return False
    return bool(delivery.get("credentials_loaded"))


def send_password_reset_email(email: str, redirect_to: str) -> bool:
    """
    Request password reset delivery.
    Prefers branded Postmark email; falls back to Supabase default mail.
    Returns True if a reset was queued/sent without transport failure.
  """
    email = email.strip().lower()
    redirect_to = (redirect_to or "").strip()

    if _custom_reset_enabled():
        try:
            resp = supabase.auth.admin.generate_link(
                {
                    "type": "recovery",
                    "email": email,
                    "options": {"redirect_to": redirect_to},
                }
            )
            action_link = _extract_action_link(resp)
            if action_link:
                subject, html_body, plain = build_password_reset_email(
                    recipient_email=email,
                    reset_url=action_link,
                )
                ok, err = asyncio.run(
                    send_email_detail(email, subject, html_body, plain_fallback=plain)
                )
                if ok:
                    _log(f"custom reset email sent redirect_to={redirect_to}")
                    return True
                _log(f"custom email failed ({err}); using Supabase mail fallback")
        except Exception as ex:
            _log(f"custom reset path failed ({type(ex).__name__}); using Supabase mail fallback")

    supabase_auth.auth.reset_password_for_email(email, {"redirect_to": redirect_to})
    _log(f"Supabase reset_password_for_email redirect_to={redirect_to}")
    return True
