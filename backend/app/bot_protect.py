"""Bot / 3rd-party agent protection helpers (env-configurable).

Layers:
  - OpenAPI/docs off in production
  - Optional Cloudflare Turnstile on auth routes
  - X-FMS-Client header binding for browser API calls
  - Suspicious User-Agent throttling / reject on auth
  - Public registration gate (invite-only)

Cloudflare edge Bot Fight / WAF is configured in the Cloudflare dashboard (not code).
"""

from __future__ import annotations

import os
import re
from typing import Optional

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Env helpers
# ---------------------------------------------------------------------------

def _truthy(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


def is_production() -> bool:
    env = (os.getenv("ENV") or os.getenv("ENVIRONMENT") or os.getenv("APP_ENV") or "").strip().lower()
    if env in ("prod", "production"):
        return True
    # Render sets these
    if (os.getenv("RENDER") or "").strip() or (os.getenv("RENDER_EXTERNAL_URL") or "").strip():
        return True
    return _truthy("PRODUCTION", "0")


def openapi_disabled() -> bool:
    """Disable /docs /redoc /openapi.json unless explicitly enabled."""
    if _truthy("ENABLE_OPENAPI", "0"):
        return False
    if _truthy("DISABLE_OPENAPI", "0"):
        return True
    return is_production()


def public_register_allowed() -> bool:
    """Invite-only by default in production; allow locally unless locked down."""
    raw = os.getenv("ALLOW_PUBLIC_REGISTER", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return not is_production()


def turnstile_required() -> bool:
    secret = (os.getenv("TURNSTILE_SECRET_KEY") or "").strip()
    if not secret:
        return False
    # When secret is set, require unless explicitly disabled
    return not _truthy("TURNSTILE_DISABLED", "0")


def client_header_required() -> bool:
    """Require X-FMS-Client on API calls (browser binding). Off locally by default."""
    raw = os.getenv("FMS_CLIENT_HEADER_REQUIRED", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return is_production()


FMS_CLIENT_HEADER = "x-fms-client"
FMS_CLIENT_VALUE = (os.getenv("FMS_CLIENT_HEADER_VALUE") or "web").strip() or "web"

_BOT_UA_RE = re.compile(
    r"(?:curl|wget|python-requests|python-urllib|httpx|aiohttp|scrapy|go-http-client|"
    r"java/|okhttp|postman|insomnia|headless|phantomjs|selenium|puppeteer|"
    r"playwright|gptbot|claudebot|anthropic|bytespider|ccbot|gpt-bot|"
    r"chatgpt|openai|barkrowler|dataforseo|semrush|ahrefs|mj12bot)",
    re.I,
)

_AUTH_PROTECT_PATHS = frozenset({
    "/auth/login",
    "/auth/register",
    "/auth/resend-confirmation",
    "/auth/forgot-password/lookup",
    "/auth/forgot-password/complete",
    "/auth/recovery-password",
    "/auth/recovery-password/reset",
    "/auth/recovery-password/session",
    "/auth/recovery-password/validate",
    "/auth/refresh",
})

_CLIENT_HEADER_EXEMPT_PREFIXES = (
    "/health",
    "/api/health",
    "/ws",
    "/api/ws",
    "/app/release",
    "/api/app/release",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/approval/",  # email token links (no SPA header)
    "/api/approval/",
    "/cron/",
    "/api/cron/",
    "/feature-approval-reminders/run",
    "/api/feature-approval-reminders/run",
    "/escalation/send-",
    "/api/escalation/send-",
    "/reminders/",
    "/api/reminders/",
)


def _normalize_path(path: str) -> str:
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    if p.startswith("/api/"):
        p = "/" + p[4:]
    return p


def _client_ip(request: Request) -> str:
    # Prefer Cloudflare's real client IP when proxied
    cf = (request.headers.get("cf-connecting-ip") or "").strip()
    if cf:
        return cf
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return (request.client.host if request.client else "unknown").strip() or "unknown"


def _is_local(request: Request) -> bool:
    if _truthy("BOT_PROTECT_DEV_BYPASS", "0"):
        return True
    ip = _client_ip(request)
    return ip in ("127.0.0.1", "::1", "localhost")


# ---------------------------------------------------------------------------
# Turnstile
# ---------------------------------------------------------------------------

def verify_turnstile_token(token: str | None, remote_ip: str | None = None) -> None:
    """Raise 403 if Turnstile is required and token is missing/invalid."""
    if not turnstile_required():
        return
    secret = (os.getenv("TURNSTILE_SECRET_KEY") or "").strip()
    tok = (token or "").strip()
    if not tok:
        raise HTTPException(status_code=403, detail="Bot check required. Refresh the page and try again.")
    try:
        data = {"secret": secret, "response": tok}
        if remote_ip and remote_ip not in ("unknown",):
            data["remoteip"] = remote_ip
        with httpx.Client(timeout=10.0) as client:
            r = client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data=data)
            body = r.json() if r.content else {}
    except Exception:
        raise HTTPException(status_code=503, detail="Bot check unavailable. Try again shortly.")
    if not body.get("success"):
        raise HTTPException(status_code=403, detail="Bot check failed. Refresh the page and try again.")


def require_public_register() -> None:
    if not public_register_allowed():
        raise HTTPException(
            status_code=403,
            detail="Public registration is disabled. Contact your administrator for an account.",
        )


# ---------------------------------------------------------------------------
# In-app honeypot + form timing (no Google / Cloudflare required)
# ---------------------------------------------------------------------------

def _auth_form_min_ms() -> int:
    try:
        return max(0, int(os.getenv("AUTH_FORM_MIN_MS", "800")))
    except ValueError:
        return 800


def _auth_form_max_ms() -> int:
    try:
        return max(60_000, int(os.getenv("AUTH_FORM_MAX_MS", str(2 * 60 * 60 * 1000))))
    except ValueError:
        return 2 * 60 * 60 * 1000


def enforce_auth_form_bot_checks(
    *,
    website: str | None = None,
    form_opened_ms: int | None = None,
) -> None:
    """
    Reject obvious bots without 3rd-party captcha:
      - honeypot `website` must be empty (humans never see/fill it)
      - form must stay open AUTH_FORM_MIN_MS..AUTH_FORM_MAX_MS before submit
    Generic 403 — do not tell bots which check failed.
    """
    if not _truthy("AUTH_FORM_BOT_CHECKS", "1"):
        return

    # Honeypot: any non-empty value → bot
    if (website or "").strip():
        raise HTTPException(status_code=403, detail="Request rejected.")

    min_ms = _auth_form_min_ms()
    max_ms = _auth_form_max_ms()
    require_timing = _truthy("AUTH_FORM_TIMING_REQUIRED", "1" if is_production() else "0")

    if form_opened_ms is None:
        if require_timing:
            raise HTTPException(status_code=403, detail="Request rejected.")
        return

    try:
        opened = int(form_opened_ms)
    except (TypeError, ValueError):
        raise HTTPException(status_code=403, detail="Request rejected.")

    import time as _time

    now_ms = int(_time.time() * 1000)
    elapsed = now_ms - opened
    if elapsed < min_ms or elapsed > max_ms:
        raise HTTPException(status_code=403, detail="Request rejected.")


# ---------------------------------------------------------------------------
# Middleware checks (return JSONResponse or None)
# ---------------------------------------------------------------------------

def bot_protect_response(request: Request) -> Optional[JSONResponse]:
    """Extra bot/agent gates after rate limiting. Returns 403 response or None."""
    if request.method == "OPTIONS":
        return None
    if _is_local(request) and not _truthy("BOT_PROTECT_FORCE", "0"):
        return None

    path = _normalize_path(request.url.path)
    ua = (request.headers.get("user-agent") or "").strip()

    # Auth routes: reject obvious bot / agent UAs when enabled (default on in prod)
    block_bot_ua = _truthy("BOT_UA_BLOCK", "1" if is_production() else "0")
    if block_bot_ua and path in _AUTH_PROTECT_PATHS:
        if not ua or _BOT_UA_RE.search(ua):
            return JSONResponse(
                status_code=403,
                content={"detail": "Automated clients are not allowed on this endpoint."},
                headers={"Cache-Control": "no-store"},
            )

    # Browser client binding
    if client_header_required():
        exempt = path in ("/",) or any(
            path == p.rstrip("/") or path.startswith(p) for p in _CLIENT_HEADER_EXEMPT_PREFIXES
        )
        # Also exempt bare health aliases
        if path.startswith("/health"):
            exempt = True
        if not exempt:
            got = (request.headers.get(FMS_CLIENT_HEADER) or "").strip()
            if got != FMS_CLIENT_VALUE:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Invalid client. Use the official web app."},
                    headers={"Cache-Control": "no-store"},
                )

    return None
