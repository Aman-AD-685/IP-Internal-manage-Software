"""In-memory per-IP rate limiting for FastAPI (single Render instance).

Tiers:
  - auth: login/register/forgot-password (strict)
  - expensive: heavy aggregates (dashboard KPI, payment-summary, large lists)
  - global: all other /api routes

Set RATE_LIMIT_ENABLED=0 to disable. For multi-instance deploys, move counters to Redis.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse

RateTier = Literal["auth", "expensive", "global"]

_RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "1").strip().lower() not in (
    "0",
    "false",
    "no",
)

_RATE_LIMIT_AUTH_WINDOW = int(os.getenv("RATE_LIMIT_AUTH_WINDOW_SEC", "60"))
_RATE_LIMIT_AUTH_MAX = int(os.getenv("RATE_LIMIT_AUTH_MAX_REQUESTS", "20"))

_RATE_LIMIT_EXPENSIVE_WINDOW = int(os.getenv("RATE_LIMIT_EXPENSIVE_WINDOW_SEC", "60"))
_RATE_LIMIT_EXPENSIVE_MAX = int(os.getenv("RATE_LIMIT_EXPENSIVE_MAX_REQUESTS", "30"))

_RATE_LIMIT_GLOBAL_WINDOW = int(os.getenv("RATE_LIMIT_GLOBAL_WINDOW_SEC", "60"))
_RATE_LIMIT_GLOBAL_MAX = int(os.getenv("RATE_LIMIT_GLOBAL_MAX_REQUESTS", "150"))

# Legacy env names (pre-push / docs) map to auth tier
if os.getenv("RATE_LIMIT_WINDOW_SEC"):
    _RATE_LIMIT_AUTH_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60"))
if os.getenv("RATE_LIMIT_MAX_REQUESTS"):
    _RATE_LIMIT_AUTH_MAX = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "20"))

_EXEMPT_PATHS = {
    "/",
    "/health",
    "/api/health",
    "/health/db",
    "/api/health/db",
    "/health/supabase",
    "/api/health/supabase",
    "/docs",
    "/openapi.json",
    "/redoc",
}

_AUTH_PATHS = {
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/resend-confirmation",
    "/auth/forgot-password/lookup",
    "/auth/forgot-password/complete",
    "/auth/recovery-password",
    "/approval/execute-by-token",
}

# Prefixes — heaviest endpoints only (full-table scans / KPI builds).
# Do NOT include /tickets — paginated list is called often (prefetch + scroll); use global tier.
_EXPENSIVE_PREFIXES = (
    "/onboarding/client-payment/payment-summary",
    "/dashboard/detail",
    "/success/performance/list",
)

_hits: dict[tuple[str, str, str], deque[float]] = defaultdict(deque)
_lock = Lock()


def _normalize_path(path: str) -> str:
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    if p.startswith("/api/"):
        p = p[4:]  # store without /api for matching both mounts
        p = "/" + p if p else "/"
    return p


def _is_exempt(path: str) -> bool:
    if path in _EXEMPT_PATHS:
        return True
    return path.startswith("/docs/") or path.startswith("/static/")


def _tier_for_path(path: str) -> RateTier | None:
    if _is_exempt(path):
        return None
    bare = path
    api_path = f"/api{path}" if not path.startswith("/api") else path
    for auth_path in _AUTH_PATHS:
        if bare == auth_path or api_path.rstrip("/") == f"/api{auth_path}":
            return "auth"
    for prefix in _EXPENSIVE_PREFIXES:
        if bare.startswith(prefix) or bare.startswith(f"/api{prefix}"):
            return "expensive"
    if bare.startswith("/api/") or path.startswith("/api/"):
        return "global"
    # App routes mounted at root (api_router paths without /api in URL)
    if bare.startswith("/"):
        return "global"
    return None


def _tier_limits(tier: RateTier) -> tuple[int, int]:
    if tier == "auth":
        return _RATE_LIMIT_AUTH_WINDOW, _RATE_LIMIT_AUTH_MAX
    if tier == "expensive":
        return _RATE_LIMIT_EXPENSIVE_WINDOW, _RATE_LIMIT_EXPENSIVE_MAX
    return _RATE_LIMIT_GLOBAL_WINDOW, _RATE_LIMIT_GLOBAL_MAX


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return (request.client.host if request.client else "unknown").strip() or "unknown"


def _is_local_dev_request(request: Request) -> bool:
    """Skip rate limits for local uvicorn + Vite proxy (avoids 429 during dev/prefetch)."""
    if os.getenv("RATE_LIMIT_DEV_BYPASS", "").strip().lower() in ("1", "true", "yes"):
        return True
    ip = _client_ip(request)
    return ip in ("127.0.0.1", "::1", "localhost")


def rate_limit_response(request: Request) -> JSONResponse | None:
    """Return 429 response if limited, else None."""
    if not _RATE_LIMIT_ENABLED:
        return None
    if _is_local_dev_request(request):
        return None
    if request.method == "OPTIONS":
        return None

    path = _normalize_path(request.url.path)
    tier = _tier_for_path(path)
    if tier is None:
        return None

    window_sec, max_requests = _tier_limits(tier)
    now = time.time()
    ip = _client_ip(request)
    bucket_path = path
    if tier == "expensive":
        for prefix in _EXPENSIVE_PREFIXES:
            if path.startswith(prefix):
                bucket_path = prefix
                break
    key = (tier, ip, bucket_path)

    with _lock:
        bucket = _hits[key]
        while bucket and now - bucket[0] > window_sec:
            bucket.popleft()
        if len(bucket) >= max_requests:
            retry_after = max(1, int(window_sec - (now - bucket[0])) if bucket else window_sec)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please wait and try again.",
                    "retry_after_sec": retry_after,
                },
                headers={
                    "Cache-Control": "no-store",
                    "Retry-After": str(retry_after),
                },
            )
        bucket.append(now)
    return None
