"""Self-check for Support Claude Review integration routes.

Run: cd backend && python scripts/check_support_claude_review_api.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["DELEGATION_INTEGRATION_API_KEY"] = "test-integration-key-abc"

from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app.integration_auth import require_integration_key  # noqa: E402
from app.integrations_support_routes import ClaudeReviewDoneRequest  # noqa: E402
from app.bot_protect import _CLIENT_HEADER_EXEMPT_PREFIXES, _normalize_path  # noqa: E402


def _req(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/integrations/support/claude-review",
        "raw_path": b"/api/integrations/support/claude-review",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8020),
    }
    return Request(scope)


require_integration_key(
    _req({"X-FMS-Integration-Key": "test-integration-key-abc"}),
    "test-integration-key-abc",
)

try:
    require_integration_key(_req({}), None)
    raise SystemExit("missing key should 401")
except HTTPException as e:
    assert e.status_code == 401

norm = _normalize_path("/api/integrations/support/claude-review")
assert any(
    norm == p.rstrip("/") or norm.startswith(p) for p in _CLIENT_HEADER_EXEMPT_PREFIXES
), f"integrations path not exempt: {norm}"

parsed = ClaudeReviewDoneRequest.model_validate({"referenceNo": "CH-0001", "externalRef": "run-1"})
assert parsed.reference_no == "CH-0001"
assert parsed.note == "run-1"

nested = ClaudeReviewDoneRequest.model_validate({"ticket": {"ticket_id": "abc-uuid"}})
assert nested.ticket_id == "abc-uuid"

# 24 weekday hours: Fri 10:00 IST → Mon 10:00 IST = 24h (weekend excluded)
from datetime import datetime
from zoneinfo import ZoneInfo

from app.integrations_support_routes import weekday_hours_between  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
fri = datetime(2026, 8, 7, 10, 0, tzinfo=IST)  # Friday
mon = datetime(2026, 8, 10, 10, 0, tzinfo=IST)  # Monday
assert abs(weekday_hours_between(fri, mon) - 24.0) < 0.01, weekday_hours_between(fri, mon)
sat = datetime(2026, 8, 8, 10, 0, tzinfo=IST)
assert weekday_hours_between(fri, sat) < 15  # only Fri afternoon hours

print("check_support_claude_review_api: OK")
