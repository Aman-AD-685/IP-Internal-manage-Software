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
os.environ["BOT_STRIKE_ENABLED"] = "1"
os.environ["BOT_STRIKE_LIMIT"] = "3"

from fastapi import HTTPException  # noqa: E402
from app import bot_protect as bp  # noqa: E402

assert bp.openapi_disabled() is True
assert bp.public_register_allowed() is False
assert bp.turnstile_required() is False
assert bp.client_header_required() is True

# cron-job.org reminder paths must not require X-FMS-Client (secret auth is on the route)
os.environ["BOT_PROTECT_FORCE"] = "1"
from starlette.requests import Request  # noqa: E402


def _http(path: str, headers: dict[str, str] | None = None) -> Request:
    hdrs = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": hdrs,
            "client": ("23.88.105.37", 443),
            "server": ("example.com", 443),
        }
    )


# Normal API without client header → blocked
blocked = bp.bot_protect_response(_http("/tickets"))
assert blocked is not None and blocked.status_code == 403

# Checklist / Delegation cron paths without client header → allowed through
for cron_path in (
    "/checklist/send-daily-reminders",
    "/api/checklist/send-daily-reminders",
    "/delegation/send-daily-reminders",
    "/api/delegation/send-daily-reminders",
    "/reminders/send-pending-digest",
):
    assert bp.bot_protect_response(_http(cron_path)) is None, cron_path

os.environ.pop("BOT_PROTECT_FORCE", None)

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

# Client clock slightly ahead (negative elapsed within skew) → ok
bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now + 30_000)

# Client clock way ahead (beyond skew) → reject
try:
    bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now + 10 * 60 * 1000)
    raise SystemExit("extreme clock skew should reject")
except HTTPException as e:
    assert e.status_code == 403

# Too old (> max) → reject
try:
    bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now - (3 * 60 * 60 * 1000))
    raise SystemExit("stale form_opened_ms should reject")
except HTTPException as e:
    assert e.status_code == 403

# Strikes: 3 bot fails → deactivate callback path (mock — no supabase user)
# Without user_id resolution, strikes still count by email key
bp.clear_bot_strikes(email="bot-test@example.com")
assert bp.get_bot_strike_count(email="bot-test@example.com") == 0

for i in range(2):
    try:
        bp.enforce_form_bot_checks_with_strike(
            website="http://evil",
            form_opened_ms=now - 2000,
            email="bot-test@example.com",
        )
        raise SystemExit("strike path should reject")
    except HTTPException as e:
        assert e.status_code == 403
        assert "inactive" not in (e.detail or "").lower()

assert bp.get_bot_strike_count(email="bot-test@example.com") == 2

# 3rd strike without resolvable user_id still rejects (cannot deactivate)
try:
    bp.enforce_form_bot_checks_with_strike(
        website="http://evil",
        form_opened_ms=now - 2000,
        email="bot-test@example.com",
    )
    raise SystemExit("3rd strike should reject")
except HTTPException as e:
    assert e.status_code == 403

assert bp.get_bot_strike_count(email="bot-test@example.com") == 3

# With explicit user_id: stub deactivate
_orig = bp.deactivate_user_for_bot_abuse
_calls: list[str] = []


def _fake_deact(uid: str) -> bool:
    _calls.append(uid)
    return True


bp.deactivate_user_for_bot_abuse = _fake_deact  # type: ignore[assignment]
bp.clear_bot_strikes(user_id="u-bot-1", email="u-bot-1@example.com")
for _ in range(3):
    try:
        bp.enforce_form_bot_checks_with_strike(
            website="x",
            form_opened_ms=now - 2000,
            user_id="u-bot-1",
            email="u-bot-1@example.com",
            page="Support ticket create",
        )
    except HTTPException:
        pass
assert _calls == ["u-bot-1"]
bp.deactivate_user_for_bot_abuse = _orig  # type: ignore[assignment]

events = bp.list_bot_events(limit=20)
assert any(e.get("page") == "Support ticket create" for e in events)
assert any(e.get("account_deactivated") for e in events)

print("OK: bot_protect self-check passed")
