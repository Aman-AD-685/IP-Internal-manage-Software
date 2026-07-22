"""API-key auth for machine/integration callers (Claude, scripts). No user login."""
from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, Request

INTEGRATION_KEY_HEADER = "X-FMS-Integration-Key"


def integration_api_key() -> str:
    return (os.getenv("DELEGATION_INTEGRATION_API_KEY") or "").strip()


def require_integration_key(
    request: Request,
    x_fms_integration_key: str | None = Header(None, alias=INTEGRATION_KEY_HEADER),
) -> None:
    """Reject unless X-FMS-Integration-Key matches DELEGATION_INTEGRATION_API_KEY."""
    expected = integration_api_key()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Integration API is not configured. Set DELEGATION_INTEGRATION_API_KEY.",
        )
    got = (x_fms_integration_key or "").strip()
    if not got:
        # Also accept Authorization: Bearer <key>
        auth = (request.headers.get("authorization") or "").strip()
        if auth.lower().startswith("bearer "):
            got = auth[7:].strip()
    if not got or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing integration API key.")
