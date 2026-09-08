"""Send auth links via Postmark + Supabase admin generate_link (better deliverability)."""
from __future__ import annotations

import asyncio
import os
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.auth_email_templates import build_password_reset_email, build_signup_confirmation_email
from app.supabase_client import SUPABASE_SERVICE_ROLE_KEY, supabase, supabase_auth
from app.utils.email import get_email_delivery_status, send_email_detail


def _log(msg: str) -> None:
    import sys

    print(f"[password-reset] {msg}", file=sys.stderr, flush=True)


def _extract_action_link(response: Any) -> str | None:
    props = _link_fields(response)
    raw = props.get("action_link")
    return raw.strip() if isinstance(raw, str) and raw.strip() else None


def _link_fields(response: Any) -> dict[str, Any]:
    props = getattr(response, "properties", None)
    if props is None and isinstance(response, dict):
        props = response.get("properties")
    if props is None:
        return {}
    if isinstance(props, dict):
        return props
    out: dict[str, Any] = {}
    for key in ("action_link", "hashed_token", "redirect_to", "verification_type"):
        val = getattr(props, key, None)
        if val is not None:
            out[key] = val
    return out


def frontend_recovery_url(redirect_to: str, hashed_token: str) -> str:
    return frontend_verify_url(redirect_to, hashed_token, "recovery")


def frontend_verify_url(redirect_to: str, hashed_token: str, verify_type: str) -> str:
    """SPA URL so mail scanners do not GET-consume GoTrue /verify."""
    parts = urlsplit((redirect_to or "").strip())
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    q["token"] = (hashed_token or "").strip()
    q["type"] = (verify_type or "signup").strip() or "signup"
    path = parts.path or "/"
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode(q), parts.fragment))


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
            fields = _link_fields(resp)
            hashed = fields.get("hashed_token")
            hashed = hashed.strip() if isinstance(hashed, str) else ""
            # Prefer our /reset-password?token=&type=recovery — GoTrue action_link is
            # consumed on GET (Gmail/Outlook safe-link prefetch → "expired" for the user).
            if hashed:
                reset_url = frontend_recovery_url(redirect_to, hashed)
            else:
                reset_url = _extract_action_link(resp)
            if reset_url:
                subject, html_body, plain = build_password_reset_email(
                    recipient_email=email,
                    reset_url=reset_url,
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


def _user_id_from_link_response(response: Any) -> str | None:
    user = getattr(response, "user", None)
    if user is None and isinstance(response, dict):
        user = response.get("user")
    if user is None:
        return None
    uid = getattr(user, "id", None) if not isinstance(user, dict) else user.get("id")
    return str(uid).strip() if uid else None


def _email_taken_error(err: str) -> bool:
    return "already" in err or "exists" in err or "registered" in err


def _confirm_url_from_response(response: Any, redirect_to: str, verify_type: str) -> str | None:
    fields = _link_fields(response)
    hashed = fields.get("hashed_token")
    hashed = hashed.strip() if isinstance(hashed, str) else ""
    vtype = fields.get("verification_type")
    if isinstance(vtype, str) and vtype.strip():
        verify_type = vtype.strip()
    if hashed:
        return frontend_verify_url(redirect_to, hashed, verify_type)
    return _extract_action_link(response)


class SignupEmailTaken(Exception):
    """generate_link/create_user: email already in Auth."""


def send_signup_mail(email: str, confirm_url: str) -> bool:
    """Postmark only. False if credentials missing or send failed — do not treat GoTrue SMTP as sent."""
    email = email.strip().lower()
    confirm_url = (confirm_url or "").strip()
    if not confirm_url:
        return False
    if not _custom_reset_enabled():
        _log("signup mail skipped: Postmark/custom email not enabled")
        return False
    subject, html_body, plain = build_signup_confirmation_email(
        recipient_email=email,
        confirm_url=confirm_url,
    )
    ok, err = asyncio.run(send_email_detail(email, subject, html_body, plain_fallback=plain))
    if ok:
        _log("custom signup confirm email sent")
        return True
    _log(f"custom signup email failed ({err})")
    return False


def _signup_via_create_user(
    email: str, password: str, full_name: str, redirect_to: str
) -> tuple[str, str, str]:
    try:
        result = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": False,
                "user_metadata": {"full_name": (full_name or "").strip()},
            }
        )
    except Exception as e1:
        err = str(e1).lower()
        _log(f"create_user failed ({type(e1).__name__}: {err[:180]})")
        if _email_taken_error(err):
            raise SignupEmailTaken() from e1
        raise
    user = getattr(result, "user", None)
    uid = getattr(user, "id", None) if user is not None else None
    if not uid:
        raise RuntimeError("create_user returned no user id")
    confirm_url = _generate_signup_action_link(email, redirect_to)
    if not confirm_url:
        # Created but unusable: no link means no mail, and the next attempt would
        # hit "already registered". Never strand it.
        delete_auth_user(str(uid))
        raise RuntimeError("could not generate confirmation url after create_user")
    return str(uid), email, confirm_url


def signup_create_user_and_confirm_url(
    *,
    email: str,
    password: str,
    full_name: str,
    redirect_to: str,
) -> tuple[str, str, str]:
    """
    Create unconfirmed user and return (user_id, email, confirm_url).

    Must use generate_link type=signup (not create_user then generate_link):
    generate_link signup fails with 'already registered' if the user already exists,
    which was why Postmark never ran and we fell through to Supabase SMTP (no inbox).
    """
    email = email.strip().lower()
    try:
        resp = supabase.auth.admin.generate_link(
            {
                "type": "signup",
                "email": email,
                "password": password,
                "options": {
                    "redirect_to": redirect_to,
                    "data": {"full_name": (full_name or "").strip()},
                },
            }
        )
    except Exception as e:
        err = str(e).lower()
        if _email_taken_error(err):
            raise SignupEmailTaken() from e
        _log(
            f"generate_link signup failed ({type(e).__name__}: {err[:180]}); "
            "falling back to create_user + magiclink"
        )
        return _signup_via_create_user(email, password, full_name, redirect_to)

    user_id = _user_id_from_link_response(resp)
    confirm_url = _confirm_url_from_response(resp, redirect_to, "signup")
    if user_id and confirm_url:
        return user_id, email, confirm_url
    if not user_id:
        raise RuntimeError("generate_link signup returned no user id")
    delete_auth_user(user_id)
    raise RuntimeError("generate_link signup returned no confirm url")


def _generate_signup_action_link(email: str, redirect_to: str) -> str | None:
    """Resend path: user already exists — signup generate_link cannot be used."""
    try:
        resp = supabase.auth.admin.generate_link(
            {
                "type": "magiclink",
                "email": email,
                "options": {"redirect_to": redirect_to},
            }
        )
        return _confirm_url_from_response(resp, redirect_to, "magiclink")
    except Exception as ex:
        err = str(ex).lower()
        _log(f"generate_link type=magiclink failed ({type(ex).__name__}: {err[:180]})")
        return None


def send_signup_confirmation_email(email: str, redirect_to: str) -> bool:
    """Resend confirmation for an existing unconfirmed user. Postmark + magiclink only."""
    email = email.strip().lower()
    redirect_to = (redirect_to or "").strip()
    try:
        action_link = _generate_signup_action_link(email, redirect_to)
        if action_link and send_signup_mail(email, action_link):
            return True
    except Exception as ex:
        _log(f"custom signup path failed ({type(ex).__name__}: {str(ex)[:180]})")
    return False


def delete_auth_user(user_id: str) -> bool:
    """Roll back an auth user we created but could not email. Never deletes a confirmed one."""
    try:
        existing = supabase.auth.admin.get_user_by_id(user_id)
        user = getattr(existing, "user", None)
        if getattr(user, "email_confirmed_at", None):
            _log(f"refusing to delete confirmed user {user_id}")
            return False
    except Exception as ex:
        _log(f"rollback lookup {user_id} failed ({type(ex).__name__}); not deleting")
        return False
    try:
        supabase.auth.admin.delete_user(user_id)
        _log(f"deleted unmailable auth user {user_id}")
        return True
    except Exception as ex:
        _log(f"delete_user {user_id} failed ({type(ex).__name__}: {str(ex)[:180]})")
        return False
