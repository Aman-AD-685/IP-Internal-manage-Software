"""Self-check: signup confirmation email template + register/resend call Postmark path."""
import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.auth_email_templates import build_signup_confirmation_email
from app.password_reset_email import _extract_action_link, send_signup_confirmation_email

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
assert "email_redirect_to" in inspect.getsource(send_signup_confirmation_email)

root = os.path.join(os.path.dirname(__file__), "..", "app", "main.py")
main_src = open(root, encoding="utf-8").read()
assert "send_signup_confirmation_email" in main_src
assert 'supabase_auth.auth.resend({"type": "signup"' not in main_src

print("OK: signup confirmation email self-check passed")
