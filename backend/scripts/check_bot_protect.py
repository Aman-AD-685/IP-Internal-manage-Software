"""Self-check for bot_protect helpers. Run: cd backend && python scripts/check_bot_protect.py"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.pop("TURNSTILE_SECRET_KEY", None)
os.environ["ALLOW_PUBLIC_REGISTER"] = "0"
os.environ["ENV"] = "production"
os.environ["FMS_CLIENT_HEADER_REQUIRED"] = "1"
os.environ["BOT_UA_BLOCK"] = "1"

from app import bot_protect as bp  # noqa: E402

assert bp.openapi_disabled() is True
assert bp.public_register_allowed() is False
assert bp.turnstile_required() is False  # no secret
assert bp.client_header_required() is True

os.environ["TURNSTILE_SECRET_KEY"] = "test-secret"
# reload flags that read env at call time
assert bp.turnstile_required() is True
bp.verify_turnstile_token  # callable
print("OK: bot_protect self-check passed")
