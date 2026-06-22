"""
JWT auth middleware for protected routes.
Validates Bearer token and returns current user info.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import threading
import time
import httpx
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.supabase_client import SUPABASE_URL, SUPABASE_ANON_KEY

security = HTTPBearer(auto_error=False)
AUTH_HTTP_TIMEOUT = httpx.Timeout(5.0, connect=2.0)
_TOKEN_CACHE_TTL_SEC = float(os.getenv("AUTH_TOKEN_CACHE_TTL_SEC", "300"))
_TOKEN_CACHE_MAX = int(os.getenv("AUTH_TOKEN_CACHE_MAX", "2048"))
_token_cache: dict[str, tuple[dict, float]] = {}
_token_cache_lock = threading.Lock()


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_token_user(token: str) -> dict | None:
    key = _token_cache_key(token)
    now = time.monotonic()
    with _token_cache_lock:
        hit = _token_cache.get(key)
        if not hit:
            return None
        user, expires = hit
        if now >= expires:
            _token_cache.pop(key, None)
            return None
        return dict(user)


def _store_token_user(token: str, user: dict) -> None:
    key = _token_cache_key(token)
    with _token_cache_lock:
        if len(_token_cache) >= _TOKEN_CACHE_MAX:
            # Simple bounded cache: drop the oldest expiring entries first.
            for old_key, _ in sorted(_token_cache.items(), key=lambda item: item[1][1])[: max(1, _TOKEN_CACHE_MAX // 10)]:
                _token_cache.pop(old_key, None)
        _token_cache[key] = (dict(user), time.monotonic() + _TOKEN_CACHE_TTL_SEC)


def validate_access_token(token: str) -> dict:
    """
    Validate a Supabase user JWT via GoTrue /auth/v1/user.
    Must use the anon apikey (service_role returns 403 for user tokens).
    """
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    cached = _cached_token_user(token)
    if cached:
        return cached

    apikey = (SUPABASE_ANON_KEY or "").strip()
    if not apikey:
        raise HTTPException(status_code=503, detail="Server configuration error: missing SUPABASE_ANON_KEY")

    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    try:
        r = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}", "apikey": apikey},
            timeout=AUTH_HTTP_TIMEOUT,
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

    user = {"id": str(user_id), "email": str(email) if email else ""}
    _store_token_user(token, user)
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Validate JWT and return {id, email} for current user."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return await asyncio.to_thread(validate_access_token, credentials.credentials)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict | None:
    """Return current user if token present, else None."""
    if not credentials:
        return None
    try:
        return await asyncio.to_thread(validate_access_token, credentials.credentials)
    except HTTPException:
        return None
