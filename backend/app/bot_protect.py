"""Bot / 3rd-party agent protection helpers (env-configurable).

Layers:
  - OpenAPI/docs off in production
  - Optional Cloudflare Turnstile on auth routes
  - X-FMS-Client header binding for browser API calls
  - Suspicious User-Agent throttling / reject on auth + sensitive writes
  - In-app honeypot + form timing (login, support, delegation)
  - Bot-strike counter → deactivate account after N failures (default 3)
  - Public registration gate (invite-only)

Cloudflare edge Bot Fight / WAF is configured in the Cloudflare dashboard (not code).
"""

from __future__ import annotations

import os
import re
import threading
import time
import uuid
from collections import deque
from typing import Any, Optional

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
    "/integrations/",  # Claude/script API key auth (no SPA header)
    "/api/integrations/",
)


def _normalize_path(path: str) -> str:
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    if p.startswith("/api/"):
        p = "/" + p[5:]
    elif p == "/api":
        p = "/"
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

    now_ms = int(time.time() * 1000)
    elapsed = now_ms - opened
    if elapsed < min_ms or elapsed > max_ms:
        raise HTTPException(status_code=403, detail="Request rejected.")


# ---------------------------------------------------------------------------
# Bot strikes → deactivate account after N failures (login / form abuse)
# ---------------------------------------------------------------------------

def _bot_strike_limit() -> int:
    try:
        return max(1, int(os.getenv("BOT_STRIKE_LIMIT", "3")))
    except ValueError:
        return 3


def _bot_strike_forget_sec() -> float:
    try:
        return max(60.0, float(os.getenv("BOT_STRIKE_FORGET_SEC", str(24 * 3600))))
    except ValueError:
        return float(24 * 3600)


_bot_strikes: dict[str, tuple[int, float]] = {}  # key -> (count, last_ts)
_bot_strikes_lock = threading.Lock()

# In-memory ring (works before SQL migration / if insert fails). Newest last.
_EVENT_RING_MAX = 500
_event_ring: deque[dict[str, Any]] = deque(maxlen=_EVENT_RING_MAX)
_event_ring_lock = threading.Lock()


def log_bot_event(
    *,
    event_type: str,
    page: str | None = None,
    email: str | None = None,
    user_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    strike_count: int | None = None,
    account_deactivated: bool = False,
    detail: str | None = None,
) -> None:
    """Record a bot block/strike for Master Admin Settings. Never raises."""
    uid_raw = (user_id or "").strip() or None
    # PostgREST rejects non-UUID for uuid columns — keep fake test ids in memory only.
    uid_db = uid_raw if uid_raw and re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        uid_raw,
    ) else None
    row: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event_type": (event_type or "block")[:64],
        "page": (page or "")[:120] or None,
        "email": (email or "").strip().lower()[:320] or None,
        "user_id": uid_raw,
        "client_ip": (client_ip or "")[:64] or None,
        "user_agent": ((user_agent or "").strip()[:300] or None),
        "strike_count": strike_count,
        "account_deactivated": bool(account_deactivated),
        "detail": (detail or "")[:500] or None,
    }
    with _event_ring_lock:
        _event_ring.append(row)
    try:
        from app.supabase_client import supabase

        supabase.table("bot_protect_events").insert(
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "event_type": row["event_type"],
                "page": row["page"],
                "email": row["email"],
                "user_id": uid_db,
                "client_ip": row["client_ip"],
                "user_agent": row["user_agent"],
                "strike_count": row["strike_count"],
                "account_deactivated": row["account_deactivated"],
                "detail": row["detail"],
            }
        ).execute()
    except Exception:
        pass


def list_bot_events(*, limit: int = 100) -> list[dict[str, Any]]:
    """Newest first. Merge DB + in-memory so Settings never misses recent hits."""
    lim = max(1, min(int(limit or 100), 500))
    by_id: dict[str, dict[str, Any]] = {}

    try:
        from app.supabase_client import supabase

        r = (
            supabase.table("bot_protect_events")
            .select(
                "id, created_at, event_type, page, email, user_id, client_ip, "
                "user_agent, strike_count, account_deactivated, detail"
            )
            .order("created_at", desc=True)
            .limit(lim)
            .execute()
        )
        for row in r.data or []:
            rid = str(row.get("id") or "")
            if rid:
                by_id[rid] = row
    except Exception:
        pass

    with _event_ring_lock:
        mem = list(_event_ring)
    for row in mem:
        rid = str(row.get("id") or "")
        if rid:
            by_id[rid] = row

    items = list(by_id.values())
    items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return items[:lim]


def list_open_bot_strikes() -> list[dict[str, Any]]:
    """Current in-memory strike counters (not yet forgotten)."""
    now = time.time()
    forget = _bot_strike_forget_sec()
    out: list[dict[str, Any]] = []
    with _bot_strikes_lock:
        for key, (count, last) in list(_bot_strikes.items()):
            if now - last > forget:
                continue
            kind, _, ident = key.partition(":")
            out.append(
                {
                    "key": key,
                    "kind": kind,
                    "identity": ident,
                    "strike_count": count,
                    "last_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last)),
                    "limit": _bot_strike_limit(),
                }
            )
    out.sort(key=lambda x: (-int(x["strike_count"]), str(x.get("last_at") or "")))
    return out


def _strike_storage_key(*, user_id: str | None = None, email: str | None = None) -> str | None:
    if user_id and str(user_id).strip():
        return f"uid:{str(user_id).strip().lower()}"
    if email and str(email).strip():
        return f"email:{str(email).strip().lower()}"
    return None


def get_bot_strike_count(*, user_id: str | None = None, email: str | None = None) -> int:
    key = _strike_storage_key(user_id=user_id, email=email)
    if not key:
        return 0
    now = time.time()
    with _bot_strikes_lock:
        item = _bot_strikes.get(key)
        if not item:
            return 0
        count, last = item
        if now - last > _bot_strike_forget_sec():
            del _bot_strikes[key]
            return 0
        return count


def clear_bot_strikes(*, user_id: str | None = None, email: str | None = None) -> None:
    key = _strike_storage_key(user_id=user_id, email=email)
    if not key:
        return
    with _bot_strikes_lock:
        _bot_strikes.pop(key, None)
        # Also clear the alternate key shape when both known
        if user_id and email:
            _bot_strikes.pop(f"email:{str(email).strip().lower()}", None)


def _resolve_user_id_by_email(email: str) -> str | None:
    em = (email or "").strip().lower()
    if not em:
        return None
    try:
        from app.supabase_client import supabase

        r = (
            supabase.table("user_profiles")
            .select("id")
            .eq("email", em)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        return None
    return None


def deactivate_user_for_bot_abuse(user_id: str) -> bool:
    """Set is_active=False. Returns True on success."""
    uid = (user_id or "").strip()
    if not uid:
        return False
    try:
        from datetime import datetime, timezone

        from app.supabase_client import supabase

        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        supabase.table("user_profiles").update(
            {"is_active": False, "deactivated_at": now}
        ).eq("id", uid).execute()
        return True
    except Exception:
        return False


def apply_bot_strike(
    *,
    user_id: str | None = None,
    email: str | None = None,
    page: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    event_type: str = "form_bot_check",
    detail: str | None = None,
) -> bool:
    """
    Count a failed bot check against this account.
    After BOT_STRIKE_LIMIT (default 3), deactivate the user profile.
    Returns True if the account was deactivated on this strike.
    """
    if not _truthy("BOT_STRIKE_ENABLED", "1"):
        return False

    uid = (user_id or "").strip() or None
    em = (email or "").strip().lower() or None
    if not uid and em:
        uid = _resolve_user_id_by_email(em)

    key = _strike_storage_key(user_id=uid, email=em)
    if not key:
        log_bot_event(
            event_type=event_type,
            page=page,
            email=em,
            user_id=uid,
            client_ip=client_ip,
            user_agent=user_agent,
            strike_count=None,
            detail=detail or "blocked (no account key)",
        )
        return False

    now = time.time()
    with _bot_strikes_lock:
        count, last = _bot_strikes.get(key, (0, 0.0))
        if now - last > _bot_strike_forget_sec():
            count = 0
        count += 1
        _bot_strikes[key] = (count, now)
        # Mirror count onto email key when we also have uid (login path)
        if uid and em:
            _bot_strikes[f"email:{em}"] = (count, now)
        if len(_bot_strikes) > 10_000:
            cutoff = now - _bot_strike_forget_sec()
            for stale in [k for k, (_, ts) in _bot_strikes.items() if ts < cutoff]:
                del _bot_strikes[stale]

    deactivated = False
    if count >= _bot_strike_limit() and uid:
        deactivated = deactivate_user_for_bot_abuse(uid)

    log_bot_event(
        event_type="account_deactivated" if deactivated else event_type,
        page=page,
        email=em,
        user_id=uid,
        client_ip=client_ip,
        user_agent=user_agent,
        strike_count=count,
        account_deactivated=deactivated,
        detail=detail
        or (
            f"Account deactivated after {count} bot checks"
            if deactivated
            else f"Bot check blocked (strike {count}/{_bot_strike_limit()})"
        ),
    )
    return deactivated


def enforce_form_bot_checks_with_strike(
    *,
    website: str | None = None,
    form_opened_ms: int | None = None,
    user_id: str | None = None,
    email: str | None = None,
    page: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Run honeypot/timing checks; on failure record strike and maybe deactivate."""
    try:
        enforce_auth_form_bot_checks(website=website, form_opened_ms=form_opened_ms)
    except HTTPException:
        reason = "honeypot" if (website or "").strip() else "timing_or_missing"
        deactivated = apply_bot_strike(
            user_id=user_id,
            email=email,
            page=page,
            client_ip=client_ip,
            user_agent=user_agent,
            event_type=reason,
            detail=f"Form bot check failed ({reason}) on {page or 'unknown'}",
        )
        if deactivated:
            raise HTTPException(
                status_code=403,
                detail="Your account is inactive. Contact your administrator.",
            )
        raise


def require_active_user_profile(user_id: str) -> None:
    """Block API use when the profile was deactivated (incl. bot lockout)."""
    uid = (user_id or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    try:
        from app.supabase_client import supabase

        r = (
            supabase.table("user_profiles")
            .select("is_active")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if rows and rows[0].get("is_active") is False:
            raise HTTPException(
                status_code=403,
                detail="Your account is inactive. Contact your administrator.",
            )
    except HTTPException:
        raise
    except Exception:
        # Fail open on transient DB errors so legitimate traffic is not bricked.
        return


# ---------------------------------------------------------------------------
# Middleware checks (return JSONResponse or None)
# ---------------------------------------------------------------------------

# Sensitive writes: scripts/bots must use the official web client (UA + X-FMS-Client).
_WRITE_BOT_UA_PATHS = frozenset({
    "/tickets",
    "/delegation/tasks",
    "/auth/login",
    "/auth/register",
    "/auth/resend-confirmation",
    "/auth/forgot-password/lookup",
    "/auth/forgot-password/complete",
    "/auth/recovery-password",
    "/auth/recovery-password/reset",
    "/auth/recovery-password/session",
    "/auth/recovery-password/validate",
})


def bot_protect_response(request: Request) -> Optional[JSONResponse]:
    """Extra bot/agent gates after rate limiting. Returns 403 response or None."""
    if request.method == "OPTIONS":
        return None
    if _is_local(request) and not _truthy("BOT_PROTECT_FORCE", "0"):
        return None

    path = _normalize_path(request.url.path)
    ua = (request.headers.get("user-agent") or "").strip()
    method = (request.method or "GET").upper()
    ip = _client_ip(request)

    # Auth + sensitive writes: reject obvious bot / agent UAs when enabled (default on in prod)
    block_bot_ua = _truthy("BOT_UA_BLOCK", "1" if is_production() else "0")
    if block_bot_ua:
        protect = path in _AUTH_PROTECT_PATHS or (
            method in ("POST", "PUT", "PATCH") and path in _WRITE_BOT_UA_PATHS
        )
        if protect and (not ua or _BOT_UA_RE.search(ua)):
            log_bot_event(
                event_type="bad_ua",
                page=f"{method} {path}",
                client_ip=ip,
                user_agent=ua or "(empty)",
                detail="Blocked automated User-Agent",
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Automated clients are not allowed on this endpoint. Use the official API via the web app."},
                headers={"Cache-Control": "no-store"},
            )

    # Browser client binding — forces official SPA (X-FMS-Client) for API calls
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
                log_bot_event(
                    event_type="bad_client",
                    page=f"{method} {path}",
                    client_ip=ip,
                    user_agent=ua or None,
                    detail=f"Invalid or missing {FMS_CLIENT_HEADER}",
                )
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Invalid client. Use the official web app."},
                    headers={"Cache-Control": "no-store"},
                )

    return None
