"""Self-check: signup confirmation email template + register uses generate_link then Postmark."""
import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.auth_email_templates import build_signup_confirmation_email
from app.password_reset_email import (
    _confirm_url_from_response,
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

root = os.path.join(os.path.dirname(__file__), "..", "app", "main.py")
main_src = open(root, encoding="utf-8").read()
assert "signup_create_user_and_confirm_url" in main_src
assert "send_signup_mail" in main_src
assert 'supabase_auth.auth.resend({"type": "signup"' not in main_src
assert '"token_hash": token' in main_src
assert "verify_type" in main_src

print("OK: signup confirmation email self-check passed")
