"""Self-check for delegation integration API auth + helpers.

Run: cd backend && python scripts/check_delegation_integration_api.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["DELEGATION_INTEGRATION_API_KEY"] = "test-integration-key-abc"

from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app.integration_auth import require_integration_key  # noqa: E402
from app.bot_protect import _CLIENT_HEADER_EXEMPT_PREFIXES, _normalize_path  # noqa: E402


def _req(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/integrations/delegation/tasks",
        "raw_path": b"/api/integrations/delegation/tasks",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8020),
    }
    return Request(scope)


# Missing key → 401
try:
    require_integration_key(_req({}), None)
    raise SystemExit("missing key should 401")
except HTTPException as e:
    assert e.status_code == 401

# Wrong key → 401
try:
    require_integration_key(_req({"X-FMS-Integration-Key": "wrong"}), "wrong")
    raise SystemExit("wrong key should 401")
except HTTPException as e:
    assert e.status_code == 401

# Correct key → ok
require_integration_key(
    _req({"X-FMS-Integration-Key": "test-integration-key-abc"}),
    "test-integration-key-abc",
)

# Bearer alias → ok
require_integration_key(
    _req({"Authorization": "Bearer test-integration-key-abc"}),
    None,
)

# Bot client-header exempt for /integrations/
norm = _normalize_path("/api/integrations/delegation/tasks")
assert any(
    norm == p.rstrip("/") or norm.startswith(p)
    for p in _CLIENT_HEADER_EXEMPT_PREFIXES
), f"integrations path not exempt: {norm}"

# SPA write path still listed for UA block (not exempt from write list)
from app.bot_protect import _WRITE_BOT_UA_PATHS  # noqa: E402

assert "/delegation/tasks" in _WRITE_BOT_UA_PATHS
assert "/integrations/delegation/tasks" not in _WRITE_BOT_UA_PATHS

print("check_delegation_integration_api: OK")
