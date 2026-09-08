"""Self-check: signup confirmation email template + register uses generate_link then Postmark."""
import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.auth_email_templates import build_signup_confirmation_email
from app import password_reset_email as pre
from app.password_reset_email import (
    _confirm_url_from_response,
    delete_auth_user,
    _extract_action_link,
    frontend_recovery_url,
    frontend_verify_url,
    send_signup_confirmation_email,
    signup_create_user_and_confirm_url,
)

url = "https://example.com/auth/v1/verify?token=abc&type=signup"
subj, html, plain = build_signup_confirmation_email(
    recipient_email="user@example.com",
    confirm_url=url,
)
assert "confirm" in subj.lower()
assert "token=abc" in html and url in plain
assert "user@example.com" in html


class _Props:
    action_link = "https://ok.example/link"


class _Resp:
    properties = _Props()


assert _extract_action_link(_Resp()) == "https://ok.example/link"


class _HashProps:
    hashed_token = "tok_hash"
    verification_type = "signup"


class _HashResp:
    properties = _HashProps()


assert "token=tok_hash" in _confirm_url_from_response(
    _HashResp(), "https://www.industryprime.dpdns.org/confirmation-success", "signup"
)
assert "send_signup_mail" in inspect.getsource(send_signup_confirmation_email)
assert "auth.resend" not in inspect.getsource(send_signup_confirmation_email)

reset = frontend_recovery_url("https://www.industryprime.dpdns.org/reset-password", "tok_abc")
assert "token=tok_abc" in reset
assert "type=recovery" in reset
assert "auth/v1/verify" not in reset

confirm = frontend_verify_url(
    "https://www.industryprime.dpdns.org/confirmation-success", "tok_sig", "signup"
)
assert "token=tok_sig" in confirm
assert "type=signup" in confirm
assert "auth/v1/verify" not in confirm

create_src = inspect.getsource(signup_create_user_and_confirm_url)
assert '"type": "signup"' in create_src
assert "SignupEmailTaken" in create_src
# Every path that creates the user then raises must delete it first, or the account
# is stranded in auth.users and every retry hits "already registered".
assert "delete_auth_user" in inspect.getsource(pre._signup_via_create_user)


def _fake_supabase(deleted, confirmed_at=None):
    """generate_link creates the user but returns no confirm link."""
    resp = type("Resp", (), {
        "user": type("U", (), {"id": "uid-1"})(),
        "properties": type("P", (), {})(),
    })()
    admin = type("Admin", (), {
        "generate_link": lambda self, opts: resp,
        "get_user_by_id": lambda self, uid: type("R", (), {
            "user": type("U", (), {"email_confirmed_at": confirmed_at})()
        })(),
        "delete_user": lambda self, uid: deleted.append(uid),
    })()
    return type("Sb", (), {"auth": type("A", (), {"admin": admin})()})()


def _signup_rollback(confirmed_at=None):
    deleted = []
    real = pre.supabase
    pre.supabase = _fake_supabase(deleted, confirmed_at)
    try:
        pre.signup_create_user_and_confirm_url(
            email="x@y.z", password="p", full_name="X",
            redirect_to="https://f.example/confirmation-success",
        )
        raise AssertionError("expected RuntimeError when no confirm url")
    except RuntimeError:
        pass
    finally:
        pre.supabase = real
    return deleted


assert _signup_rollback() == ["uid-1"], "unconfirmed user was not rolled back"
assert _signup_rollback("2026-09-08T00:00:00Z") == [], "confirmed user must never be deleted"

root = os.path.join(os.path.dirname(__file__), "..", "app", "main.py")
main_src = open(root, encoding="utf-8").read()
assert "signup_create_user_and_confirm_url" in main_src
assert "send_signup_mail" in main_src
assert 'supabase_auth.auth.resend({"type": "signup"' not in main_src
assert '"token_hash": token' in main_src
assert "verify_type" in main_src
# Unmailable signups must be rolled back, else generate_link signup returns
# "already registered" forever and the user can never sign up again.
reg = main_src.split("def _do_register")[1].split("@api_router")[0]
assert "REGISTER ROLLBACK" in reg
assert "delete_auth_user" in reg
assert reg.index("if not confirmation_sent") < reg.index("REGISTER SUCCESS")
del_src = inspect.getsource(delete_auth_user)
assert "email_confirmed_at" in del_src  # never roll back a confirmed account

print("OK: signup confirmation email self-check passed")
