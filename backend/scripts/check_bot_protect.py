"""Self-check for bot_protect helpers. Run: cd backend && python scripts/check_bot_protect.py"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.pop("TURNSTILE_SECRET_KEY", None)
os.environ["ALLOW_PUBLIC_REGISTER"] = "0"
os.environ["ENV"] = "production"
os.environ["FMS_CLIENT_HEADER_REQUIRED"] = "1"
os.environ["BOT_UA_BLOCK"] = "1"
os.environ["AUTH_FORM_BOT_CHECKS"] = "1"
os.environ["AUTH_FORM_TIMING_REQUIRED"] = "1"
os.environ["AUTH_FORM_MIN_MS"] = "800"

from fastapi import HTTPException  # noqa: E402
from app import bot_protect as bp  # noqa: E402

assert bp.openapi_disabled() is True
assert bp.public_register_allowed() is False
assert bp.turnstile_required() is False
assert bp.client_header_required() is True

# Honeypot: filled website → reject
try:
    bp.enforce_auth_form_bot_checks(
        website="http://spam.example",
        form_opened_ms=int(time.time() * 1000) - 2000,
    )
    raise SystemExit("honeypot should reject")
except HTTPException as e:
    assert e.status_code == 403

# Too fast → reject
now = int(time.time() * 1000)
try:
    bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now - 100)
    raise SystemExit("timing should reject fast submit")
except HTTPException as e:
    assert e.status_code == 403

# Normal human timing → ok
bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now - 2000)

print("OK: bot_protect self-check passed")
