"""
JWT auth middleware for protected routes.
Validates Bearer token and returns current user info.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.supabase_client import SUPABASE_URL, SUPABASE_ANON_KEY

security = HTTPBearer(auto_error=False)


def validate_access_token(token: str) -> dict:
    """
    Validate a Supabase user JWT via GoTrue /auth/v1/user.
    Must use the anon apikey (service_role returns 403 for user tokens).
    """
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    apikey = (SUPABASE_ANON_KEY or "").strip()
    if not apikey:
        raise HTTPException(status_code=503, detail="Server configuration error: missing SUPABASE_ANON_KEY")

    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    try:
        r = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}", "apikey": apikey},
            timeout=30.0,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if r.status_code >= 400:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        data = r.json()
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not isinstance(data, dict):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = data.get("id")
    if not user_id:
        nested = data.get("user")
        if isinstance(nested, dict):
            user_id = nested.get("id")
            email = nested.get("email") or ""
        else:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
    else:
        email = data.get("email") or ""

    return {"id": str(user_id), "email": str(email) if email else ""}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Validate JWT and return {id, email} for current user."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return validate_access_token(credentials.credentials)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    """Return current user if token present, else None."""
    if not credentials:
        return None
    try:
        return validate_access_token(credentials.credentials)
    except HTTPException:
        return None
