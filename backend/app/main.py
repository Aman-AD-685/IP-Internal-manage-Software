from dotenv import load_dotenv
from pathlib import Path

# Load .env from backend/ (works even when run from project root)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

import os
import sys
import threading
import time
import asyncio
import json
import hashlib
import inspect
import logging
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict, deque
from functools import wraps
# Fix Windows console encoding for emoji/special chars
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from datetime import datetime, date, timedelta, timezone
from typing import Optional, Any, Callable, Awaitable
from fastapi import FastAPI, HTTPException, Depends, APIRouter, Request, UploadFile, File, Query, BackgroundTasks, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, EmailStr, field_validator, model_validator
import uuid
import re
import html as html_module
import httpx
from cachetools import TTLCache
from app.supabase_client import SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, supabase, supabase_auth
from app.auth_middleware import get_current_user, get_current_user_optional
from app import payment_ageing as _pa
from app.dashboard_kpi_sections import DASHBOARD_KPI_PERMISSION_SECTIONS, merge_section_keys
from app.performance_na import (
    POSTGREST_IN_MAX,
    apply_performance_list_query_filters,
    enrich_performance_rows_na,
    filter_performance_rows,
    invalidate_performance_na_company_ids_cache,
    performance_marked_na_company_ids,
    performance_marked_na_supported,
    reset_performance_marked_na_cache,
)
from app.ticket_na import apply_exclude_ticket_na, filter_out_ticket_na, ticket_marked_na
from app.rate_limit import rate_limit_response
from app.kpi_calendar_week import (
    build_week_merge_meta,
    get_kpi_calendar_week_range,
    kpi_max_week_index_in_month,
    merged_week_key_from_range,
    prior_kpi_calendar_week_range,
    week_of_month_for_date,
)

# Role-based access: master_admin, admin (Super Admin), approver (Approver), user (Operator)
def _normalize_role(name: str | None) -> str:
    """Map DB role name to frontend role (master_admin, admin, approver, user). Handles 'master_ad' etc."""
    if not name:
        return "user"
    n = (name or "").strip().lower()
    if n in ("master_admin", "master_ad", "masteradmin"):
        return "master_admin"
    if n in ("admin", "super_admin", "superadmin"):
        return "admin"
    if n == "approver":
        return "approver"
    if n == "user":
        return "user"
    return "user"


# Role resolution: Admin/Master Admin pages fire many parallel API calls; each used 2 DB round-trips.
# TTL cache + per-user lock (singleflight) keeps ~1s load when opening Checklist/Delegation/Dashboard.
_ROLE_CACHE_TTL_SEC = float(os.getenv("ROLE_CACHE_TTL_SEC", "120"))
_role_cache: dict[str, tuple[str, float]] = {}
_role_cache_lock = threading.Lock()
_role_fetch_locks: dict[str, threading.Lock] = {}
_role_fetch_master = threading.Lock()


def _role_fetch_lock(user_id: str) -> threading.Lock:
    with _role_fetch_master:
        if user_id not in _role_fetch_locks:
            _role_fetch_locks[user_id] = threading.Lock()
        return _role_fetch_locks[user_id]


def _get_role_from_profile(user_id: str) -> str:
    """Resolve frontend role with TTL cache and singleflight; prefer one PostgREST embed when FK exists."""
    now = time.monotonic()
    ttl = _ROLE_CACHE_TTL_SEC
    with _role_cache_lock:
        hit = _role_cache.get(user_id)
        if hit and now < hit[1]:
            return hit[0]

    lock = _role_fetch_lock(user_id)
    with lock:
        now = time.monotonic()
        with _role_cache_lock:
            hit = _role_cache.get(user_id)
            if hit and now < hit[1]:
                return hit[0]

        role = "user"
        try:
            r = supabase.table("user_profiles").select("roles(name)").eq("id", user_id).single().execute()
            if r.data:
                roles_obj = r.data.get("roles")
                role_name = None
                if isinstance(roles_obj, dict):
                    role_name = roles_obj.get("name")
                elif isinstance(roles_obj, list) and roles_obj:
                    role_name = (roles_obj[0] or {}).get("name")
                role = _normalize_role(role_name)
            else:
                role = "user"
        except Exception:
            try:
                profile = supabase.table("user_profiles").select("role_id").eq("id", user_id).single().execute()
                if not profile.data:
                    role = "user"
                else:
                    role_row = supabase.table("roles").select("name").eq("id", profile.data["role_id"]).single().execute()
                    role_name = role_row.data["name"] if role_row.data else "user"
                    role = _normalize_role(role_name)
            except Exception:
                role = "user"

        expires = time.monotonic() + ttl
        with _role_cache_lock:
            _role_cache[user_id] = (role, expires)
        return role


async def get_current_user_with_role(auth: dict = Depends(get_current_user)) -> dict:
    """Current user with role. Use for role checks."""
    role = _get_role_from_profile(auth["id"])
    return {"id": auth["id"], "email": auth["email"], "role": role}


def require_roles(allowed_roles: list[str]):
    """Dependency: allow only given roles (master_admin, admin, approver, user)."""
    async def _check(current: dict = Depends(get_current_user_with_role)) -> dict:
        if current.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current
    return _check


def _redact_secrets(text: str) -> str:
    """
    Best-effort redaction of auth/server secrets that could otherwise leak via logs
    or HTTP error details.
    """
    if not text:
        return text
    # JWTs (Supabase keys/tokens typically start with eyJ... and contain 3 dot-separated parts)
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b",
        "[REDACTED_JWT]",
        text,
    )
    # Supabase "sb_secret_" / "sb_publishable_" style keys
    text = re.sub(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b", "[REDACTED_KEY]", text)
    return text


def _log(msg: str):
    """Force log to terminal and log file - ASCII-safe for Windows"""
    safe_msg = _redact_secrets(msg).encode("ascii", errors="replace").decode("ascii")
    print(safe_msg, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        log_path = os.path.join(base, "..", "backend_errors.log")
        with open(log_path, "a", encoding="utf-8", errors="replace") as f:
            from datetime import datetime as dt
            f.write(f"[{dt.now().isoformat()}] {safe_msg}\n")
            f.flush()
    except Exception:
        pass


def _sanitize_ilike_input(value: str | None, max_len: int = 120) -> str:
    """Sanitize user-controlled text used in ilike/or_ filters to reduce operator injection."""
    if not value:
        return ""
    allowed = []
    for ch in value:
        if ch.isalnum() or ch in (" ", ".", "-", "_", "@"):
            allowed.append(ch)
    return "".join(allowed).strip()[:max_len]


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
request_logger = logging.getLogger("support_fms.request")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*").strip() or "*"

app = FastAPI(title="IP Internal manage Software Backend")
app.add_middleware(GZipMiddleware, minimum_size=500)

# Feature approval reminder routes (cron + settings)
from app.feature_approval_reminder_routes import feature_approval_reminder_router
from app.cron_email_routes import cron_email_router
from app.approval_email_pages import approval_public_router
from app.escalation_email_routes import escalation_email_router
from app.improvement_suggestions_routes import improvement_router
from app.soft_suggestions_routes import soft_suggestions_router

app.include_router(feature_approval_reminder_router)
app.include_router(feature_approval_reminder_router, prefix="/api")
app.include_router(approval_public_router)
app.include_router(approval_public_router, prefix="/api")
app.include_router(escalation_email_router)
app.include_router(escalation_email_router, prefix="/api")
app.include_router(cron_email_router)
app.include_router(cron_email_router, prefix="/api")
app.include_router(improvement_router)
app.include_router(improvement_router, prefix="/api")
app.include_router(soft_suggestions_router)
app.include_router(soft_suggestions_router, prefix="/api")


@app.on_event("startup")
async def _log_email_on_startup():
    from app.utils.email import log_email_smtp_startup
    from app.public_urls import log_public_urls_startup

    log_email_smtp_startup()
    log_public_urls_startup()

_cache_default = TTLCache(maxsize=512, ttl=60)
_cache_by_ttl: dict[int, TTLCache] = {}
_cache_lock = threading.Lock()


def _build_cache_key(args: tuple[Any, ...], kwargs: dict[str, Any], key_prefix: str) -> str:
    payload = {"args": args, "kwargs": kwargs}
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()
    return f"{key_prefix}{digest}"


def _get_cache_for_ttl(ttl: int) -> TTLCache:
    if ttl == 60:
        return _cache_default
    with _cache_lock:
        cache = _cache_by_ttl.get(ttl)
        if cache is None:
            cache = TTLCache(maxsize=512, ttl=ttl)
            _cache_by_ttl[ttl] = cache
        return cache


def _invalidate_ttl_cache_key_prefix(prefix: str) -> None:
    """Remove entries from in-process TTL caches whose key starts with ``prefix`` (e.g. list cache after writes)."""
    buckets: list[TTLCache] = [_cache_default]
    with _cache_lock:
        buckets.extend(list(_cache_by_ttl.values()))
    for c in buckets:
        for k in list(c.keys()):
            if isinstance(k, str) and k.startswith(prefix):
                try:
                    del c[k]
                except KeyError:
                    pass


def cached(ttl: int, key_prefix: str = ""):
    def _decorator(func: Callable[..., Any]):
        cache = _get_cache_for_ttl(ttl)

        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def _async_wrapper(*args: Any, **kwargs: Any) -> Any:
                cache_key = _build_cache_key(args, kwargs, key_prefix)
                try:
                    return cache[cache_key]
                except KeyError:
                    result = await func(*args, **kwargs)
                    cache[cache_key] = result
                    return result

            return _async_wrapper

        @wraps(func)
        def _sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            cache_key = _build_cache_key(args, kwargs, key_prefix)
            try:
                return cache[cache_key]
            except KeyError:
                result = func(*args, **kwargs)
                cache[cache_key] = result
                return result

        return _sync_wrapper

    return _decorator


def _etag_json(payload: Any, max_age: int = 300) -> JSONResponse:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    etag = hashlib.md5(raw.encode("utf-8")).hexdigest()
    response = JSONResponse(content=payload)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = f"public, max-age={max_age}, stale-while-revalidate=600"
    return response

# Request logging + CATCH ALL to prevent 500
@app.middleware("http")
async def log_requests(request: Request, call_next):
    limited = rate_limit_response(request)
    if limited is not None:
        return limited
    _log(f"--> {request.method} {request.url.path}")
    start = time.perf_counter()
    try:
        response = await call_next(request)
        # Authenticated JSON API: never allow shared caches to treat responses as reusable.
        if request.method != "OPTIONS" and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        _log(f"<-- {request.method} {request.url.path} -> {response.status_code}")
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        request_logger.info(
            "%s %s %s %sms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response
    except Exception as ex:
        try:
            _log(f"UNHANDLED ERROR: {ex}")
        except Exception:
            pass
        # Return 500 - keep server failures visible to monitoring/alerts
        err_str = str(ex)
        if "charmap" in err_str or "encode" in err_str.lower() or "unicode" in err_str.lower():
            detail = "Registration failed. Restart backend with: set PYTHONIOENCODING=utf-8"
        else:
            try:
                detail = err_str[:300].encode("ascii", errors="replace").decode("ascii")
            except Exception:
                detail = "Internal server error"
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        request_logger.info("%s %s %s %sms", request.method, request.url.path, 500, duration_ms)
        return JSONResponse(status_code=500, content={"detail": detail})

# Global exception handler - keep 5xx as 5xx for security observability
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        # Preserve HTTPException status code
        if exc.status_code >= 500:
            _log(f"!!! 5xx: {exc.detail}")
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error"},
            )
        raise exc
    _log(f"!!! UNHANDLED: {type(exc).__name__}: {exc}")
    import traceback
    _log(traceback.format_exc())
    # Return proper 500 for non-HTTP errors
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# CORS configuration - allow frontend origin
# Reads: CORS_ORIGINS (comma-separated), CORS_ORIGIN, CORS_ORIGIN_1, CORS_ORIGIN_2, ... CORS_ORIGIN_10
_dev_defaults = "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003,http://127.0.0.1:3004"
_prod_defaults = "https://industryprime.vercel.app,https://ip-internal-manage-software.vercel.app,https://ip-internal-manage-software.onrender.com"
_default = f"{_dev_defaults},{_prod_defaults}"

def _collect_cors_origins() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    # 1) CORS_ORIGINS (comma-separated)
    raw = os.getenv("CORS_ORIGINS", _default)
    for o in raw.split(","):
        o = o.strip()
        if o and o not in seen:
            seen.add(o)
            out.append(o)
    # 2) CORS_ORIGIN, CORS_ORIGIN_1, ... CORS_ORIGIN_10 (Render-style individual vars)
    for key in ["CORS_ORIGIN"] + [f"CORS_ORIGIN_{i}" for i in range(1, 11)]:
        val = (os.getenv(key) or "").strip()
        if val and val not in seen:
            seen.add(val)
            out.append(val)
    return out

_cors_origins_list = _collect_cors_origins()
_cors_allow_origins = _cors_origins_list if _cors_origins_list else ([FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret", "Cache-Control", "Pragma"],
)

# API router - routes work at BOTH / and /api (e.g. /users/me AND /api/users/me)
api_router = APIRouter()

# ---------- Schemas ----------
class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v


class RegisterResponse(BaseModel):
    user_id: str
    email: str
    confirmation_sent: bool
    message: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str | None
    user: dict
    requires_otp: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordLookupRequest(BaseModel):
    email: EmailStr


class ForgotPasswordCompleteRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v


class RecoveryPasswordRequest(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v


class RecoverySessionRequest(BaseModel):
    code: Optional[str] = None
    token: Optional[str] = None


class RecoveryResetRequest(BaseModel):
    access_token: str
    password: str
    refresh_token: Optional[str] = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v


class RecoveryValidateRequest(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None


# ---------- Routes ----------
@app.get("/health")
@app.get("/api/health")
def health():
    """Lightweight health check (no DB). Use for keep-alive pings (e.g. UptimeRobot every 5 min) to prevent Render cold start.
    If DEADMANS_SNITCH_URL is set, pings Snitch so you get alerted when this endpoint stops being hit."""
    try:
        from app.snitch import ping_snitch
        ping_snitch()
    except Exception:
        pass
    return {"ok": True, "ts": int(time.time())}


_APP_RELEASE_CACHE: dict = {"ts": 0.0, "payload": None}
_APP_RELEASE_CACHE_TTL_SEC = 60


def _get_app_release_broadcast() -> dict:
    """Public release key for new-feature refresh prompt (cached)."""
    now = time.time()
    cached = _APP_RELEASE_CACHE.get("payload")
    if cached and now - float(_APP_RELEASE_CACHE.get("ts") or 0) < _APP_RELEASE_CACHE_TTL_SEC:
        return cached

    env_key = (os.getenv("APP_RELEASE_KEY") or "").strip()
    title = (os.getenv("APP_RELEASE_TITLE") or "New features are live").strip()
    message = (
        os.getenv("APP_RELEASE_MESSAGE") or
        "A new version of Industry Prime is available. Refresh to load the latest features."
    ).strip()
    release_key = env_key
    is_active = True

    try:
        r = supabase.table("app_release_broadcast").select(
            "release_key, title, message, is_active"
        ).eq("id", 1).limit(1).execute()
        row = (r.data or [None])[0]
        if row:
            if row.get("release_key"):
                release_key = str(row["release_key"]).strip()
            if row.get("title"):
                title = str(row["title"]).strip()
            if row.get("message"):
                message = str(row["message"]).strip()
            is_active = bool(row.get("is_active", True))
    except Exception as e:
        _log(f"app/release broadcast: {e}")

    if not release_key:
        release_key = "dev-local"

    payload = {
        "release_key": release_key,
        "title": title,
        "message": message,
        "is_active": is_active,
    }
    _APP_RELEASE_CACHE["ts"] = now
    _APP_RELEASE_CACHE["payload"] = payload
    return payload


@app.get("/app/release")
@app.get("/api/app/release")
def app_release_broadcast():
    """Public: current live release key. Frontend compares to embedded build key."""
    data = _get_app_release_broadcast()
    return {"success": True, "data": data}


@app.post("/auth/register-simple")
def register_simple(payload: RegisterRequest):
    """Minimal register - just echoes back. Use to test routing + validation."""
    return {"ok": True, "email": payload.email}


@app.get("/health/db")
@app.get("/api/health/db")
def health_db():
    """Check if database tables exist - run FRESH_SETUP.sql if this fails"""
    try:
        r = supabase.table("roles").select("id").limit(1).execute()
        return {"status": "ok", "database": "ready", "roles": "exists"}
    except Exception as e:
        return {"status": "error", "database": "not ready", "error": str(e)[:200]}


@app.post("/auth/register-test")
def register_test():
    """Minimal test - returns 200. Use to verify proxy/routing works."""
    return {"ok": True, "message": "Backend and proxy work. Real register at POST /auth/register"}


@app.get("/health/supabase")
@app.get("/api/health/supabase")
def health_supabase():
    """Test Supabase connection. Open in browser to see why login fails."""
    url = os.getenv("SUPABASE_URL", "")
    out = {
        "supabase_url_set": bool(url and url.startswith("https://")),
        "anon_key_set": bool(os.getenv("SUPABASE_ANON_KEY", "").strip()),
        "service_role_key_set": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()),
        "reachable": "unknown",
        "auth": "unknown",
        "db": "unknown",
        "hint": None,
    }
    err_str = ""
    if not url or not url.strip().startswith("https://"):
        out["hint"] = "Set SUPABASE_URL in backend/.env (e.g. https://xxxx.supabase.co)"
        return out
    try:
        # Quick HTTPS reachability (no auth)
        r = httpx.get(f"{url.rstrip('/')}/rest/v1/", timeout=25.0)
        out["reachable"] = "ok" if r.status_code in (200, 301, 302, 404, 401) else f"status_{r.status_code}"
    except Exception as e:
        err_str = str(e).lower()
        out["reachable"] = "error"
        if "10060" in str(e) or "timeout" in err_str or "timed out" in err_str:
            out["hint"] = "Connection timeout. Unpause Supabase project or check firewall/network."
        elif "refused" in err_str or "connection" in err_str:
            out["hint"] = "Connection refused or failed. Check SUPABASE_URL and network."
        elif "name or service not known" in err_str or "nodename" in err_str:
            out["hint"] = "DNS failed. Check SUPABASE_URL (e.g. https://xxxx.supabase.co)."
        else:
            out["hint"] = str(e)[:200]
        out["unpause_link"] = _supabase_unpause_link().strip() or None
        return out
    try:
        supabase.auth.admin.list_users(per_page=1)
        out["auth"] = "ok"
    except Exception as e:
        out["auth"] = "error"
        out["hint"] = out["hint"] or str(e)[:200]
    try:
        supabase.table("roles").select("id").limit(1).execute()
        out["db"] = "ok"
    except Exception as e:
        out["db"] = "error"
        out["hint"] = out["hint"] or str(e)[:200]
    return out


@app.get("/check-user")
def check_user(email: str = ""):
    """DIAGNOSTIC: Check if user exists. Use: /check-user?email=test@ip.com"""
    if not email:
        return {"error": "Add ?email=test@ip.com to the URL"}
    try:
        email = email.strip().lower()
        users = supabase.auth.admin.list_users(per_page=1000)
        auth_user = next((u for u in users if getattr(u, "email", "") and getattr(u, "email", "").lower() == email), None)
        if not auth_user:
            return {"exists": False, "error": "User not found", "hint": "Add user in Supabase Auth Users"}
        user_id = str(auth_user.id)
        profile = supabase.table("user_profiles").select("id").eq("id", user_id).execute()
        return {
            "exists": True, "user_id": user_id, "email": getattr(auth_user, "email", ""),
            "email_confirmed": bool(getattr(auth_user, "email_confirmed_at", None)),
            "has_profile": bool(profile.data),
            "hint": "Run FIX_USER_PROFILE.sql" if not profile.data else "OK",
        }
    except Exception as e:
        return {"error": str(e)}


def _find_auth_user_by_email(email: str):
    """Find Supabase Auth user by email (admin API). Requires SUPABASE_SERVICE_ROLE_KEY."""
    email = email.strip().lower()
    if not (SUPABASE_SERVICE_ROLE_KEY or "").strip():
        raise HTTPException(
            status_code=503,
            detail="Password reset is not configured. Set SUPABASE_SERVICE_ROLE_KEY in backend/.env.",
        )
    try:
        resp = supabase.auth.admin.list_users(per_page=1000)
    except Exception as e:
        _log(f"_find_auth_user_by_email list_users: {e}")
        raise HTTPException(
            status_code=503,
            detail="Could not reach Supabase Auth. Check SUPABASE_SERVICE_ROLE_KEY and project status.",
        )
    users_iter = getattr(resp, "users", None)
    if users_iter is None:
        try:
            users_iter = list(resp) if resp is not None else []
        except TypeError:
            users_iter = []
    for u in users_iter:
        em = (getattr(u, "email", None) or "").strip().lower()
        if em == email:
            return u
    return None


@app.get("/", response_class=HTMLResponse)
def root():
    """Root endpoint - HTML page with proper tab title"""
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FMS Backend API</title>
</head>
<body style="font-family:sans-serif;padding:2rem;">
<h1>IP Internal manage Software Backend API</h1>
<p>Backend is running.</p>
<ul>
<li><a href="/docs">API Docs (Swagger)</a></li>
<li><a href="/health">Health Check</a></li>
<li><a href="/check-user?email=test@ip.com">Check User (test@ip.com)</a></li>
<li><strong>API base:</strong> Use <code>http://127.0.0.1:8000</code> or <code>http://127.0.0.1:8000/api</code></li>
<li><a href="/api/users/me">GET /api/users/me</a> (requires token)</li>
</ul>
</body>
</html>"""


@api_router.post("/auth/register")
async def register_user(payload: RegisterRequest):
    """Register a new user via Supabase Auth. Never returns 500 - always 200/400/503.
    Uses run_in_executor so sync Supabase calls don't block; exceptions propagate to us."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _do_register, payload)
    except HTTPException:
        raise  # Let FastAPI handle HTTPException
    except BaseException as e:
        try:
            _log(f"REGISTER OUTER CATCH: {type(e).__name__}: {e}")
            import traceback
            tb = traceback.format_exc().encode("ascii", errors="replace").decode("ascii")
            _log(tb)
            detail = str(e)[:300].encode("ascii", errors="replace").decode("ascii")
        except Exception:
            detail = "Registration failed (encoding error on Windows - try different email)"
        return JSONResponse(status_code=400, content={"detail": detail})


def _do_register(payload: RegisterRequest):
    import time
    # Fix Windows thread encoding
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    try:
        _log(f"REGISTER START: {payload.email}")
        # Pre-check: ensure database tables exist
        try:
            supabase.table("roles").select("id").limit(1).execute()
        except Exception as db_err:
            _log(f"Database check failed: {db_err}")
            raise HTTPException(
                status_code=503,
                detail="Database not set up. Run database/FRESH_SETUP.sql in Supabase SQL Editor.",
            )
        
        result = None
        user_id = None
        user_email = payload.email
        confirmation_sent = False

        try:
            # Security: always create user as unconfirmed so email verification is mandatory.
            _log("Trying create_user (unconfirmed)...")
            result = supabase.auth.admin.create_user({
                "email": payload.email.strip().lower(),
                "password": payload.password,
                "email_confirm": False,
                "user_metadata": {"full_name": payload.full_name},
            })
            if result and getattr(result, "user", None):
                user_id = str(result.user.id)
                user_email = getattr(result.user, "email", None) or payload.email

            # Send confirmation email (requires Supabase email/SMTP configuration).
            supabase_auth.auth.resend({"type": "signup", "email": payload.email.strip().lower()})
            confirmation_sent = True
            _log(f"create_user OK: {user_id}")
        except Exception as e1:
            _log(f"create_user failed: {type(e1).__name__}")
            err = str(e1).lower()
            if "already" in err or "exists" in err or "registered" in err:
                raise HTTPException(400, "This email is already registered. Please log in.")
            raise HTTPException(
                status_code=503,
                detail="Registration failed. Email verification is required; check Supabase Auth email/SMTP configuration and retry.",
            )

        if not user_id:
            raise HTTPException(400, "Registration failed: Could not create user.")

        # Ensure user_profiles exists
        time.sleep(0.4)
        try:
            profile = supabase.table("user_profiles").select("id").eq("id", user_id).execute()
            if not profile.data:
                role_row = supabase.table("roles").select("id").eq("name", "user").limit(1).execute()
                role_id = role_row.data[0]["id"] if role_row.data else None
                if role_id:
                    supabase.table("user_profiles").insert({
                        "id": user_id, "full_name": payload.full_name,
                        "role_id": role_id, "is_active": True,
                        "email": (user_email or payload.email or "").strip()
                    }).execute()
                    _log("Created user_profiles")
        except Exception as pe:
            _log(f"Profile backup: {pe}")

        _log(f"REGISTER SUCCESS: {user_id}")
        if confirmation_sent:
            msg = "Registration successful. Check your email for a confirmation link. Click it to activate your account, then log in."
        else:
            msg = "Registration successful. You can log in now."
        return {
            "user_id": user_id,
            "email": str(user_email or payload.email),
            "confirmation_sent": confirmation_sent,
            "message": msg,
        }

    except HTTPException as he:
        # Re-raise HTTPException so FastAPI handles it
        raise he
    except BaseException as e:
        _log(f"REGISTER ERROR: {type(e).__name__}: {e}")
        import traceback
        tb = traceback.format_exc().encode("ascii", errors="replace").decode("ascii")
        _log(tb)
        sys.stdout.flush()
        err = str(e).lower()
        msg = str(e)[:300]
        if "already" in err or "exists" in err or "registered" in err:
            msg = "This email is already registered. Please log in."
        elif "email" in err and "confirm" in err:
            msg = "Disable Confirm email in Supabase Auth Providers"
        elif "roles" in err or "user_profiles" in err or "relation" in err:
            return JSONResponse(status_code=503, content={"detail": "Run database/FRESH_SETUP.sql in Supabase SQL Editor."})
        # Return 400 directly - ASCII-safe for Windows
        safe_msg = _redact_secrets(msg).encode("ascii", errors="replace").decode("ascii")
        return JSONResponse(status_code=400, content={"detail": safe_msg})


def _is_connection_error(e: Exception) -> bool:
    err = str(e).lower()
    return (
        "10060" in err or "timeout" in err or "timed out" in err
        or "connection" in err and ("refused" in err or "failed" in err or "reset" in err)
        or "cannot connect" in err or "failed to respond" in err
        or "name or service not known" in err or "nodename nor servname" in err
    )


def _is_invalid_credentials_or_auth_reject(e: Exception) -> bool:
    """Never retry these — wrong password, unconfirmed email, etc."""
    err = str(e).lower()
    if "invalid" in err and ("credential" in err or "login" in err or "password" in err):
        return True
    if "email not confirmed" in err or "confirm your email" in err:
        return True
    if "user_banned" in err or "banned" in err and "user" in err:
        return True
    return False


def _supabase_unpause_link() -> str:
    """Direct link to unpause project (free tier pauses after inactivity)."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    if ".supabase.co" in url:
        try:
            ref = url.replace("https://", "").replace("http://", "").split(".supabase.co")[0].strip()
            if ref:
                return f" Unpause: https://supabase.com/dashboard/project/{ref}/settings/general"
        except Exception:
            pass
    return ""


def _connection_error_detail(e: Exception) -> str:
    base = (
        "Cannot reach Supabase. Check: (1) Supabase project is not paused, "
        "(2) SUPABASE_URL and keys in backend/.env are correct, "
        "(3) Firewall/antivirus allows outbound HTTPS. See SUPABASE_SETUP_GUIDE.md. "
    )
    return base + _supabase_unpause_link() + " Tip: Open GET /health/supabase in browser to see the exact error."


def _retry_supabase_call(fn, max_attempts: int = 5, delay_secs: list[float] | None = None):
    """Retry only on transient network/connection failures — not wrong password, not auth errors.

    Previously this retried *every* exception (including invalid credentials), adding ~65s+ of sleeps
    on every failed login. Wrong email/password must fail in about one round-trip to Supabase.
    """
    import time
    if delay_secs is None:
        delay_secs = [2, 5, 10, 15]  # shorter waits; only used when _is_connection_error is true
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if _is_invalid_credentials_or_auth_reject(e):
                raise e
            if not _is_connection_error(e):
                raise e
            if attempt < max_attempts - 1 and attempt < len(delay_secs):
                d = delay_secs[attempt]
                if d > 0:
                    time.sleep(d)
    if last_exc is not None:
        raise last_exc


@api_router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    """
    Sign in with email/password. Returns JWT tokens and user profile.
    """
    email = payload.email.strip().lower()
    password = payload.password
    result = None

    # No slow pre-check or list_users() here — those added tens of seconds on every login (including
    # wrong password). Reachability is handled by sign_in + _retry_supabase_call on real outages.

    try:
        # Try ANON_KEY client first (recommended for sign_in), with retries for connection issues
        result = _retry_supabase_call(
            lambda: supabase_auth.auth.sign_in_with_password({"email": email, "password": password})
        )
    except Exception as e1:
        _log(f"Login (anon) error: {type(e1).__name__}")
        if _is_connection_error(e1):
            raise HTTPException(status_code=503, detail=_connection_error_detail(e1))
        try:
            result = _retry_supabase_call(
                lambda: supabase.auth.sign_in_with_password({"email": email, "password": password})
            )
        except Exception as e2:
            _log(f"Login (service_role) error: {type(e2).__name__}")
            if _is_connection_error(e2):
                raise HTTPException(status_code=503, detail=_connection_error_detail(e2))
            err = str(e2).lower()
            if "invalid" in err or "login" in err or "credentials" in err:
                raise HTTPException(status_code=401, detail="Invalid email or password")
            if "email" in err and "confirm" in err:
                raise HTTPException(
                    status_code=401,
                    detail="Please confirm your email before signing in. Check your inbox or ask an administrator.",
                )
            raise HTTPException(status_code=500, detail="Login failed. Please try again.")

    try:
        if not result.user or not result.session:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        user_id = str(result.user.id)

        def _fetch_profile():
            return supabase.table("user_profiles").select(
                "id, full_name, role_id, is_active, created_at"
            ).eq("id", user_id).single().execute()

        profile = _retry_supabase_call(_fetch_profile)

        if not profile.data:
            raise HTTPException(
                status_code=404,
                detail="User profile not found. Run database/FIX_USER_PROFILE.sql in Supabase SQL Editor.",
            )

        if profile.data.get("is_active") is False:
            raise HTTPException(
                status_code=403,
                detail="Your account is inactive. Contact your administrator.",
            )

        def _fetch_role():
            return supabase.table("roles").select("name").eq(
                "id", profile.data["role_id"]
            ).single().execute()

        role_row = _retry_supabase_call(_fetch_role)
        role_name = role_row.data["name"] if role_row.data else "user"
        frontend_role = _normalize_role(role_name)

        # Load section permissions for sidebar visibility (same rules as /users/me)
        section_permissions: list[dict] = []
        try:
            perm_r = supabase.table("user_section_permissions").select("section_key, can_view, can_edit").eq("user_id", user_id).execute()
            perm_rows = perm_r.data or []
            section_permissions = _build_section_permissions_list(frontend_role, perm_rows)
        except Exception:
            section_permissions = [{"section_key": k, "can_view": False, "can_edit": False} for k in SECTION_KEYS]

        user = {
            "id": user_id,
            "email": result.user.email or payload.email,
            "full_name": profile.data["full_name"],
            "display_name": profile.data.get("display_name") or profile.data["full_name"],
            "role": frontend_role,
            "is_active": profile.data.get("is_active", True),
            "created_at": str(profile.data.get("created_at", "")),
            "section_permissions": section_permissions,
        }

        return LoginResponse(
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            user=user,
            requires_otp=False,
        )
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        _log(f"Login (profile) error: {type(e).__name__}")
        if _is_connection_error(e):
            raise HTTPException(status_code=503, detail=_connection_error_detail(e))
        if "invalid" in err or "login" in err or "credentials" in err:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if "profile" in err or "404" in err:
            raise HTTPException(
                status_code=404,
                detail="User profile not found. Run database/FIX_USER_PROFILE.sql in Supabase.",
            )
        raise HTTPException(status_code=500, detail="Login failed. Please try again.")


@api_router.get("/me")
@api_router.get("/users/me")
def get_me(auth: dict = Depends(get_current_user)):
    """Get current user profile. Requires Bearer token. Both /me and /users/me work."""
    user_id = auth["id"]
    profile = supabase.table("user_profiles").select(
        "id, full_name, display_name, role_id, is_active, created_at"
    ).eq("id", user_id).single().execute()

    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    role_row = supabase.table("roles").select("name").eq(
        "id", profile.data["role_id"]
    ).single().execute()
    role_name = role_row.data["name"] if role_row.data else "user"
    frontend_role = _normalize_role(role_name)

    # Load section permissions for sidebar visibility
    section_permissions: list[dict] = []
    try:
        perm_r = supabase.table("user_section_permissions").select("section_key, can_view, can_edit").eq("user_id", user_id).execute()
        perm_rows = perm_r.data or []
        section_permissions = _build_section_permissions_list(frontend_role, perm_rows)
    except Exception:
        section_permissions = [{"section_key": k, "can_view": False, "can_edit": False} for k in SECTION_KEYS]

    return {
        "id": user_id,
        "email": auth["email"],
        "full_name": profile.data["full_name"],
        "display_name": profile.data.get("display_name") or profile.data["full_name"],
        "role": frontend_role,
        "is_active": profile.data.get("is_active", True),
        "created_at": str(profile.data.get("created_at", "")),
        "section_permissions": section_permissions,
    }


@api_router.post("/auth/logout")
def logout():
    """
    Optional: server-side logout. Client clears token regardless.
    No auth required - user may have expired token.
    """
    return {"message": "Logged out successfully"}


@api_router.post("/auth/forgot-password/lookup")
def forgot_password_lookup(payload: ForgotPasswordLookupRequest, request: Request):
    """
    Request a password reset email.

    Security: do NOT reveal whether an email exists and do NOT update passwords
    without a time-limited recovery token.
    """
    email = payload.email.strip().lower()
    from app.public_urls import get_frontend_base

    redirect_to = f"{get_frontend_base()}/reset-password"
    try:
        # gotrue Python expects snake_case "redirect_to" (not redirectTo).
        supabase_auth.auth.reset_password_for_email(email, {"redirect_to": redirect_to})
        _log(f"forgot-password: reset email requested redirect_to={redirect_to}")
    except Exception as e:
        # Avoid leaking existence via error messages. Retry after transient issues.
        _log(f"forgot-password request failed: {type(e).__name__}")
        if _is_connection_error(e):
            raise HTTPException(503, "Could not send password reset email. Try again later.")
    return {"message": "If the account exists, you will receive an email with a password reset link."}


@api_router.post("/auth/forgot-password/complete")
def forgot_password_complete(payload: ForgotPasswordCompleteRequest, request: Request):
    """
    Deprecated insecure endpoint.

    Security: password must be reset only via time-limited recovery token
    (see POST /auth/recovery-password).
    """
    raise HTTPException(status_code=410, detail="Use the password reset link from your email to set a new password.")


def _recovery_access_token_from_supabase_response(data: dict) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    direct = data.get("access_token")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    session = data.get("session")
    if isinstance(session, dict):
        nested = session.get("access_token")
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
    return None


@api_router.post("/auth/recovery-password/session")
def recovery_password_session(payload: RecoverySessionRequest):
    """Exchange recovery ?code= or ?token= from the email redirect into an access_token."""
    code = (payload.code or "").strip()
    token = (payload.token or "").strip()
    if not code and not token:
        raise HTTPException(400, "Missing recovery code or token. Open the link from your email again.")
    apikey = (SUPABASE_ANON_KEY or "").strip()
    if not apikey:
        raise HTTPException(503, "Server configuration error: missing SUPABASE_ANON_KEY")
    base = SUPABASE_URL.rstrip("/")
    headers = {"apikey": apikey, "Content-Type": "application/json"}
    try:
        if code:
            r = httpx.post(
                f"{base}/auth/v1/token?grant_type=pkce",
                headers=headers,
                json={"auth_code": code},
                timeout=45.0,
            )
            if r.status_code >= 400:
                r = httpx.post(
                    f"{base}/auth/v1/token",
                    headers=headers,
                    json={"grant_type": "authorization_code", "code": code},
                    timeout=45.0,
                )
        else:
            r = httpx.post(
                f"{base}/auth/v1/verify",
                headers=headers,
                json={"type": "recovery", "token": token},
                timeout=45.0,
            )
    except Exception as e:
        _log(f"recovery-password/session httpx error: {type(e).__name__}")
        raise HTTPException(503, "Could not reach authentication service. Try again later.")
    if r.status_code >= 400:
        _log(f"recovery-password/session: {r.status_code} {(r.text or '')[:400]}")
        raise HTTPException(
            400,
            "Invalid or expired reset link. Request a new password reset from the login page.",
        )
    try:
        data = r.json()
    except Exception:
        raise HTTPException(400, "Invalid or expired reset link. Request a new password reset from the login page.")
    access_token = _recovery_access_token_from_supabase_response(data)
    if not access_token:
        raise HTTPException(400, "Invalid or expired reset link. Request a new password reset from the login page.")
    refresh_token = _recovery_refresh_token_from_supabase_response(data)
    return {"access_token": access_token, "refresh_token": refresh_token}


def _recovery_refresh_token_from_supabase_response(data: dict) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    direct = data.get("refresh_token")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    session = data.get("session")
    if isinstance(session, dict):
        nested = session.get("refresh_token")
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
    return None


def _parse_supabase_auth_error(response: httpx.Response) -> str:
    try:
        body = response.json()
    except Exception:
        return "Could not update password. Request a new reset link from the login page."
    if not isinstance(body, dict):
        return "Could not update password. Request a new reset link from the login page."
    msg = body.get("msg") or body.get("message") or body.get("error_description") or body.get("error")
    if isinstance(msg, str) and msg.strip():
        low = msg.lower()
        if "expired" in low or "invalid" in low or "session" in low:
            return "This reset link has expired. Request a new password reset from the login page."
        if "password" in low:
            return msg.strip()
        return msg.strip()
    return "Could not update password. Request a new reset link from the login page."


def _recovery_user_id_from_token(access_token: str) -> Optional[str]:
    apikey = (SUPABASE_ANON_KEY or "").strip()
    if not apikey or not access_token:
        return None
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    try:
        r = httpx.get(
            url,
            headers={"Authorization": f"Bearer {access_token}", "apikey": apikey},
            timeout=45.0,
        )
    except Exception:
        return None
    if r.status_code >= 400:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    user_id = data.get("id") if isinstance(data, dict) else None
    return str(user_id).strip() if user_id else None


def _supabase_update_password_with_recovery_token(
    recovery_token: str,
    password: str,
    refresh_token: Optional[str] = None,
) -> None:
    apikey = (SUPABASE_ANON_KEY or "").strip()
    if not apikey:
        raise HTTPException(503, "Server configuration error: missing SUPABASE_ANON_KEY")
    token = (recovery_token or "").strip()
    if not token:
        raise HTTPException(401, "Missing or invalid reset session. Open the link from your email again.")
    refresh = (refresh_token or "").strip() or None

    # Preferred: establish Supabase session (access + refresh) then update_user (PUT).
    if refresh:
        try:
            supabase_auth.auth.set_session(token, refresh)
            supabase_auth.auth.update_user({"password": password})
            return
        except Exception as e:
            _log(f"recovery-password set_session/update_user: {type(e).__name__}: {str(e)[:200]}")

    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": apikey,
        "Content-Type": "application/json",
    }
    try:
        r = httpx.put(url, headers=headers, json={"password": password}, timeout=45.0)
    except Exception as e:
        _log(f"recovery-password httpx error: {type(e).__name__}")
        raise HTTPException(503, "Could not reach authentication service. Try again later.")
    if r.status_code < 400:
        return

    _log(f"recovery-password PUT: {r.status_code} {(r.text or '')[:400]}")
    detail = _parse_supabase_auth_error(r)

    # Fallback: admin password update after token identifies the user.
    user_id = _recovery_user_id_from_token(token)
    if user_id and SUPABASE_SERVICE_ROLE_KEY:
        try:
            supabase.auth.admin.update_user_by_id(user_id, {"password": password})
            return
        except Exception as e:
            _log(f"recovery-password admin fallback: {type(e).__name__}: {str(e)[:200]}")

    raise HTTPException(status_code=400, detail=detail)


@api_router.post("/auth/recovery-password/validate")
def recovery_password_validate(payload: RecoveryValidateRequest):
    """Check recovery session is still valid before showing the reset form."""
    user_id = _recovery_user_id_from_token(payload.access_token.strip())
    if not user_id:
        raise HTTPException(
            400,
            "This reset link has expired or was already used. Request a new password reset from the login page.",
        )
    return {"valid": True}


@api_router.post("/auth/recovery-password/reset")
def recovery_password_reset(payload: RecoveryResetRequest):
    """Set new password from email link — no login session required (token in body)."""
    _supabase_update_password_with_recovery_token(
        payload.access_token,
        payload.password,
        payload.refresh_token,
    )
    return {"message": "Password updated successfully. You can sign in with your new password."}


@api_router.patch("/auth/recovery-password")
def recovery_password(payload: RecoveryPasswordRequest, request: Request):
    """Set new password using the recovery access_token from the email link (Authorization: Bearer …)."""
    auth_header = (request.headers.get("authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(401, "Missing or invalid reset session. Open the link from your email again.")
    token = auth_header[7:].strip()
    _supabase_update_password_with_recovery_token(token, payload.password)
    return {"message": "Password updated successfully. You can sign in with your new password."}


@api_router.post("/auth/refresh")
def refresh_token(payload: RefreshRequest):
    """
    Exchange refresh_token for new access_token. Use when access_token expires (e.g. after 1 hr).
    Keeps session alive up to refresh token expiry (typically 7+ days) without re-login.
    """
    try:
        result = supabase_auth.auth.refresh_session(payload.refresh_token)
        if not result.session:
            raise HTTPException(401, "Invalid or expired refresh token")
        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
            "expires_in": result.session.expires_in,
        }
    except Exception as e:
        err = str(e).lower()
        if "invalid" in err or "expired" in err or "refresh" in err:
            raise HTTPException(401, "Refresh token invalid or expired. Please log in again.")
        raise HTTPException(401, "Refresh token invalid or expired. Please log in again.")


@api_router.get("/auth/confirm")
def confirm_email(token: str, type: str = "signup"):
    """Handle email confirmation callback from Supabase."""
    return {"success": True, "message": "Email confirmed successfully"}


class ResendConfirmRequest(BaseModel):
    email: str


@api_router.post("/auth/resend-confirmation")
def resend_confirmation(payload: ResendConfirmRequest):
    """Resend confirmation email to user who didn't receive it. Uses Supabase auth.resend."""
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email is required")
    try:
        supabase_auth.auth.resend({"type": "signup", "email": email})
        return {"success": True, "message": "Confirmation email resent. Check your inbox (and spam folder)."}
    except Exception as e:
        err = str(e).lower()
        if "already" in err or "confirmed" in err:
            return {"success": True, "message": "Your email is already confirmed. You can log in."}
        if "rate" in err or "limit" in err:
            raise HTTPException(429, "Please wait a few minutes before requesting another email.")
        raise HTTPException(400, "Could not resend confirmation email. Please try again later.")


# ---------- Tickets ----------
def _ensure_str(v: any) -> str | None:
    """Coerce value to str for API; avoid 'Input should be a valid string' when frontend sends number/object."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if hasattr(v, "__str__"):
        return str(v)
    return None


def _normalize_ticket_priority(priority: str | None) -> str:
    """Map to low | medium | high (legacy critical/urgent → high)."""
    v = (priority or "medium").strip().lower()
    if v in ("critical", "urgent", "high"):
        return "high"
    if v == "low":
        return "low"
    return "medium"


class CreateTicketRequest(BaseModel):
    title: str
    description: str | None = None
    type: str  # bug, feature, chore
    priority: str = "medium"
    assignee_id: str | None = None
    company_id: str | None = None
    page_id: str | None = None
    division_id: str | None = None
    division_other: str | None = None
    user_name: str | None = None
    communicated_through: str | None = None
    submitted_by: str | None = None
    query_arrival_at: str | None = None
    quality_of_response: str | None = None
    customer_questions: str | None = None
    query_response_at: str | None = None
    why_feature: str | None = None
    attachment_url: str | None = None
    repeat_of_ticket_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_string_fields(cls, data: any):
        """Ensure all string fields receive a string or None (fixes 'Input should be a valid string')."""
        if not isinstance(data, dict):
            return data
        out = dict(data)
        string_fields = (
            "title", "description", "type", "priority", "assignee_id", "company_id", "page_id",
            "division_id", "division_other", "user_name", "communicated_through", "submitted_by",
            "query_arrival_at", "quality_of_response", "customer_questions", "query_response_at",
            "why_feature", "attachment_url", "repeat_of_ticket_id",
        )
        for k in string_fields:
            if k not in out:
                continue
            v = out[k]
            if v is None:
                continue
            if k == "title":
                out[k] = _ensure_str(v) or ""
            elif isinstance(v, str):
                continue
            else:
                out[k] = _ensure_str(v)
        return out


class UpdateTicketRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assignee_id: str | None = None
    resolution_notes: str | None = None
    remarks: str | None = None
    approval_status: str | None = None
    approval_actual_at: str | None = None
    unapproval_actual_at: str | None = None
    # SLA stages (Chores & Bugs)
    status_1: str | None = None
    actual_1: str | None = None
    planned_2: str | None = None
    status_2: str | None = None
    actual_2: str | None = None
    planned_3: str | None = None
    status_3: str | None = None
    actual_3: str | None = None
    planned_4: str | None = None
    status_4: str | None = None
    actual_4: str | None = None
    quality_solution: str | None = None
    # Staging workflow (Stage 1–3)
    staging_planned: str | None = None
    staging_review_status: str | None = None
    staging_review_actual: str | None = None
    live_planned: str | None = None
    live_actual: str | None = None
    live_status: str | None = None
    live_review_planned: str | None = None
    live_review_actual: str | None = None
    live_review_status: str | None = None
    repeat_of_ticket_id: str | None = None


class PromoteToFeatureRequest(BaseModel):
    why_feature: str

    @model_validator(mode="after")
    def require_why_feature(self):
        if not (self.why_feature or "").strip():
            raise ValueError("why_feature is required when shifting to Feature")
        return self


class CreateTicketResponseRequest(BaseModel):
    response_text: str


class SupportTicketDraftPayload(BaseModel):
    """Draft form data for Submit Support Ticket (JSON-serializable)."""
    draft_data: dict


class KpiDailyLogUpsertBody(BaseModel):
    """One row of KPI daily work log (yellow cells); grey/score derived on dashboard."""
    work_date: str  # YYYY-MM-DD
    items_cleaned: float | None = None
    errors_found: float | None = None
    accuracy_pct: float | None = None
    videos_created: float | None = None
    video_type: str | None = None
    bulk_upload_tickets: float | None = None
    ai_tasks_used: float | None = None
    process_improved: float | None = None


def _kpi_daily_optional_int(name: str, v: float | int | None) -> int | None:
    """Coerce JSON numbers to int for integer DB columns; reject non-whole values."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {name!r}; expected a number")
    if f != f:  # NaN
        return None
    r = round(f)
    if abs(f - r) > 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"{name} must be a whole number (got {v})",
        )
    return int(r)


def _kpi_daily_optional_float(name: str, v: float | int | None) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {name!r}; expected a number")


class AdrijaSocialKpiDayRowIn(BaseModel):
    work_date: str
    post: int = 0
    reel: int = 0
    linkedin: int = 0
    post_task_name: str | None = None
    reel_task_name: str | None = None
    linkedin_task_name: str | None = None


class AdrijaSocialKpiDayBatchBody(BaseModel):
    rows: list[AdrijaSocialKpiDayRowIn]


class SouvikKpiDailyRowIn(BaseModel):
    work_date: str
    kpi_key: str
    score: float | None = None


class SouvikKpiDailyBatchBody(BaseModel):
    rows: list[SouvikKpiDailyRowIn]


_DRAFT_EXPIRY_HOURS = 24


@api_router.get("/drafts/support-ticket")
def get_support_ticket_draft(auth: dict = Depends(get_current_user)):
    """Get current user's support ticket draft. Returns 404 if none or if draft is older than 24 hours."""
    user_id = auth["id"]
    r = supabase.table("support_ticket_drafts").select("draft_data, updated_at").eq("user_id", user_id).limit(1).execute()
    if not r.data or len(r.data) == 0:
        raise HTTPException(status_code=404, detail="No draft found")
    row = r.data[0]
    updated_at_str = row.get("updated_at")
    if updated_at_str:
        try:
            updated = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            expiry = datetime.now(timezone.utc) - timedelta(hours=_DRAFT_EXPIRY_HOURS)
            if updated < expiry:
                supabase.table("support_ticket_drafts").delete().eq("user_id", user_id).execute()
                raise HTTPException(status_code=404, detail="Draft expired (older than 24 hours)")
        except (ValueError, TypeError):
            pass
    return {"draft_data": row.get("draft_data") or {}}


@api_router.put("/drafts/support-ticket")
def save_support_ticket_draft(payload: SupportTicketDraftPayload, auth: dict = Depends(get_current_user)):
    """Save or update support ticket draft for current user. One draft per user."""
    user_id = auth["id"]
    data = {"user_id": user_id, "draft_data": payload.draft_data or {}}
    try:
        r = supabase.table("support_ticket_drafts").upsert(data, on_conflict="user_id").execute()
        return {"ok": True}
    except Exception as e:
        _log(f"Save draft error: {e}")
        raise HTTPException(status_code=400, detail=str(e)[:200])


@api_router.delete("/drafts/support-ticket")
def delete_support_ticket_draft(auth: dict = Depends(get_current_user)):
    """Delete current user's support ticket draft (e.g. after successful submit)."""
    user_id = auth["id"]
    supabase.table("support_ticket_drafts").delete().eq("user_id", user_id).execute()
    return {"ok": True}


@api_router.post("/tickets")
def create_ticket(payload: CreateTicketRequest, auth: dict = Depends(get_current_user)):
    from app.ticket_similarity import similar_tickets_access_allowed

    data = {
        "title": payload.title,
        "description": payload.description or "",
        "type": payload.type,
        "priority": _normalize_ticket_priority(payload.priority),
        "created_by": auth["id"],
        "assignee_id": payload.assignee_id,
    }
    # Feature requests start as pending approval (show in Approval Status section)
    if payload.type == "feature":
        data["approval_status"] = None
    # Chores & Bugs: default SLA stages when ticket is first created
    if payload.type in ("chore", "bug"):
        # Stage 1: response (Yes/No) – start as "no" until first response is added
        data.setdefault("status_1", "no")
        # Stage 2: development / staging – start as "pending"
        data.setdefault("status_2", "pending")
    extras = ["company_id", "page_id", "division_id", "division_other", "user_name", "communicated_through", "submitted_by", "query_arrival_at", "quality_of_response", "customer_questions", "query_response_at", "why_feature", "attachment_url", "repeat_of_ticket_id"]
    for k in extras:
        v = getattr(payload, k, None)
        if v is None:
            continue
        if k == "repeat_of_ticket_id" and not similar_tickets_access_allowed(auth.get("email")):
            continue
        if k in ("company_id", "page_id", "division_id", "repeat_of_ticket_id") and v == "":
            continue
        if k == "attachment_url":
            if not v or not str(v).strip():
                continue
            _log(f"Create ticket with attachment_url: {str(v)[:80]}...")
        data[k] = v
    if data.get("company_id"):
        try:
            cr = supabase.table("companies").select("name").eq("id", data["company_id"]).single().execute()
            if cr.data and cr.data.get("name"):
                data["company_name"] = str(cr.data.get("name")).strip()
        except Exception:
            pass
    try:
        r = supabase.table("tickets").insert(data).execute()
        global _REF_NO_TO_COMPANY_LOADED, _COMPANIES_BY_NAME_LOADED
        _REF_NO_TO_COMPANY_LOADED = False
        _COMPANIES_BY_NAME_LOADED = False
        invalidate_dashboard_read_caches()
        _invalidate_ttl_cache_key_prefix("tickets:list:")
        return r.data[0] if r.data else {}
    except Exception as e:
        _log(f"Create ticket error: {e}")
        err_msg = str(e).strip()[:400]
        raise HTTPException(
            status_code=400,
            detail=f"Could not create ticket: {err_msg}",
        )


# Generic / test company labels — must not override real names on tickets (bulk import used LIMIT 1 company_id).
_PLACEHOLDER_COMPANY_NAMES = frozenset({
    "company a",
    "company b",
    "company c",
    "demo",
    "demo_c",
    "demo c",
    "demo_c ",
    "unknown",
    "n/a",
    "na",
    "test",
    "sample",
})

# Fallback: reference_no -> company_name when tickets.company_name is null (e.g. production DB not updated).
_REF_NO_TO_COMPANY: dict[str, str] = {}
_REF_NO_TO_COMPANY_LOADED = False


def _is_placeholder_company_name(name: str | None) -> bool:
    if not name:
        return True
    normalized = str(name).strip().lower()
    if not normalized or normalized in ("null", "none", "-"):
        return True
    return normalized in _PLACEHOLDER_COMPANY_NAMES


def _row_needs_ref_no_company_lookup(row: dict) -> bool:
    ref = row.get("reference_no")
    if not ref:
        return False
    cid = row.get("company_id")
    stored = (row.get("company_name") or "").strip()
    if cid:
        return False
    if stored and not _is_placeholder_company_name(stored):
        return False
    return True


def _ref_no_to_company_for_rows(rows: list) -> dict[str, str]:
    """Lookup company names by reference for rows missing company — avoids scanning all tickets."""
    refs: list[str] = []
    seen: set[str] = set()
    for row in rows:
        ref = row.get("reference_no")
        if not ref or not _row_needs_ref_no_company_lookup(row):
            continue
        key = str(ref).strip()
        if key and key not in seen:
            seen.add(key)
            refs.append(key)
    if not refs:
        return {}
    out: dict[str, str] = {}
    chunk_size = 80
    for i in range(0, len(refs), chunk_size):
        chunk = refs[i : i + chunk_size]
        try:
            r = (
                supabase.table("tickets")
                .select("reference_no, company_name")
                .in_("reference_no", chunk)
                .not_.is_("company_name", "null")
                .execute()
            )
            for row in r.data or []:
                ref = row.get("reference_no")
                name = (row.get("company_name") or "").strip()
                if ref and name and not _is_placeholder_company_name(name):
                    out.setdefault(str(ref).strip(), name)
        except Exception as e:
            _log(f"ref_no_to_company chunk: {e}")
    return out


def _build_ref_no_to_company() -> dict[str, str]:
    """Deprecated global scan — kept for callers that pass no row context; returns empty (use _ref_no_to_company_for_rows)."""
    return {}


_COMPANIES_BY_NORMALIZED_NAME: dict[str, str] = {}
_COMPANIES_BY_NAME_LOADED = False


def _companies_by_normalized_name() -> dict[str, str]:
    """Lowercase company name -> canonical name from master table."""
    global _COMPANIES_BY_NORMALIZED_NAME, _COMPANIES_BY_NAME_LOADED
    if _COMPANIES_BY_NAME_LOADED:
        return _COMPANIES_BY_NORMALIZED_NAME
    _COMPANIES_BY_NAME_LOADED = True
    try:
        r = supabase.table("companies").select("name").execute()
        for row in r.data or []:
            name = (row.get("name") or "").strip()
            if name and not _is_placeholder_company_name(name):
                _COMPANIES_BY_NORMALIZED_NAME[name.lower()] = name
    except Exception as e:
        _log(f"companies_by_name: failed to load: {e}")
    return _COMPANIES_BY_NORMALIZED_NAME


def _resolve_ticket_company_name(row: dict, companies_map: dict[str, str], ref_to_company: dict[str, str]) -> str | None:
    """Pick best company display name; ignore placeholder FK targets from legacy bulk imports."""
    cid = row.get("company_id")
    stored = (row.get("company_name") and str(row.get("company_name")).strip()) or ""
    from_id = (companies_map.get(cid) if cid else None) or ""
    from_id = from_id.strip() if from_id else ""
    from_ref = (ref_to_company.get(row.get("reference_no") or "") or "").strip()
    by_name = _companies_by_normalized_name()

    for candidate in (from_id, stored, from_ref):
        if candidate and not _is_placeholder_company_name(candidate):
            return candidate
        if candidate:
            canonical = by_name.get(candidate.lower())
            if canonical:
                return canonical
    return from_id or stored or from_ref or None


_TICKET_LIST_SELECT = (
    "id,reference_no,title,description,type,status,priority,created_by,assignee_id,"
    "created_at,updated_at,resolved_at,company_id,company_name,page_id,page,division_id,division,"
    "user_name,communicated_through,submitted_by,query_arrival_at,query_response_at,"
    "quality_of_response,customer_questions,why_feature,approval_status,approval_actual_at,"
    "unapproval_actual_at,approved_by,remarks,status_1,actual_1,planned_2,status_2,actual_2,"
    "planned_3,status_3,actual_3,planned_4,status_4,actual_4,quality_solution,"
    "quality_solution_submitted_by,quality_solution_submitted_at,staging_planned,"
    "staging_review_actual,staging_review_status,live_planned,live_actual,live_status,"
    "live_review_planned,live_review_actual,live_review_status,attachment_url,repeat_of_ticket_id,"
    "source_reference_no,source_type,promoted_to_feature_at,promoted_by"
)


def _next_ex_ticket_reference_no(ticket_type: str) -> str:
    """Next EX-CH / EX-BU / EX-FE reference (matches generate_ticket_reference trigger)."""
    prefix_map = {"chore": "EX-CH", "bug": "EX-BU", "feature": "EX-FE"}
    prefix = prefix_map.get(ticket_type)
    if not prefix:
        raise ValueError(f"Invalid ticket type for reference: {ticket_type}")
    max_num = 0
    try:
        r = (
            supabase.table("tickets")
            .select("reference_no")
            .eq("type", ticket_type)
            .like("reference_no", f"{prefix}-%")
            .execute()
        )
        for row in r.data or []:
            ref = (row.get("reference_no") or "").strip()
            if not ref.startswith(f"{prefix}-"):
                continue
            suffix = ref[len(prefix) + 1 :]
            if suffix.isdigit():
                max_num = max(max_num, int(suffix))
    except Exception as e:
        _log(f"next_ex_ticket_reference_no: {e}")
    return f"{prefix}-{max_num + 1:04d}"


def _supabase_fetch_all_rows(build_query, *, page_size: int = 1000, max_rows: int = 20000) -> list[dict]:
    """Paginate PostgREST responses (default cap is 1000 rows per request)."""
    out: list[dict] = []
    offset = 0
    while offset < max_rows:
        r = build_query().range(offset, offset + page_size - 1).execute()
        batch = list(r.data or [])
        out.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return out


def _open_queue_ticket_query(types_list: list[str]):
    """Base filters shared by Chores & Bugs open queue and dashboard pending counts."""
    q = supabase.table("tickets").select("id, type, company_name, status_4, quality_solution, staging_planned, live_review_status, status_2, status")
    q = q.in_("type", types_list)
    q = q.is_("quality_solution", "null")
    q = _apply_exclude_active_staging_filter(q)
    q = q.or_("status_2.is.null,status_2.neq.staging")
    q = apply_exclude_ticket_na(q)
    return q


def _fetch_open_queue_ticket_rows(types_list: list[str]) -> list[dict]:
    return _supabase_fetch_all_rows(lambda: _open_queue_ticket_query(types_list), max_rows=15000)


def _apply_open_queue_count_filters(q, *, demo_c_mode: str | None = None):
    """PostgREST count filters aligned with Chores & Bugs open queue + Stage 4 not completed."""
    q = q.is_("quality_solution", "null")
    q = _apply_exclude_active_staging_filter(q)
    q = q.or_("status_2.is.null,status_2.neq.staging")
    q = apply_exclude_ticket_na(q)
    q = q.or_("status_4.is.null,status_4.neq.completed")
    if demo_c_mode == "exclude":
        q = q.not_.or_("company_name.eq.demo_c,company_name.eq.demo c,company_name.eq.Demo C")
    elif demo_c_mode == "include":
        q = q.or_("company_name.eq.demo_c,company_name.eq.demo c,company_name.eq.Demo C")
    elif demo_c_mode == "chore_demo_only":
        q = q.eq("type", "chore")
        q = q.or_("company_name.eq.demo_c,company_name.eq.demo c,company_name.eq.Demo C")
    return q


def _count_open_queue_tickets(
    types_list: list[str],
    *,
    ticket_type: str | None = None,
    demo_c_mode: str | None = None,
) -> int:
    """Fast pending counts for dashboard cards (no full-table scan)."""
    try:
        q = supabase.table("tickets").select("id", count="exact")
        if ticket_type:
            q = q.eq("type", ticket_type)
        else:
            q = q.in_("type", types_list)
        q = _apply_open_queue_count_filters(q, demo_c_mode=demo_c_mode)
        r = q.execute()
        return int(r.count or 0)
    except Exception as e:
        _log(f"count_open_queue: {e}")
        return 0


_KPI_CB_COLS = (
    "id,reference_no,title,description,type,company_id,company_name,created_by,created_at,assignee_id,"
    "status,status_4,quality_solution,actual_4,query_arrival_at,query_response_at,"
    "planned_2,actual_2,actual_1,status_2,resolved_at,staging_planned,live_review_status"
)


def _fetch_kpi_chore_bug_tickets(month_start: date, month_end: date) -> list[dict]:
    """Bounded chore/bug rows for dashboard KPI (not full tickets table)."""
    fetch_from = month_start - timedelta(days=45)
    fetch_to = month_end + timedelta(days=14)
    by_id: dict[str, dict] = {}

    def _ingest(rows: list | None) -> None:
        for t in rows or []:
            tid = t.get("id")
            if tid:
                by_id[str(tid)] = t

    def _base_q():
        return supabase.table("tickets").select(_KPI_CB_COLS).in_("type", ["chore", "bug"])

    try:
        q1 = _base_q().gte("created_at", fetch_from.isoformat()).lte("created_at", fetch_to.isoformat())
        _ingest(_supabase_fetch_all_rows(lambda: q1, max_rows=8000))
        q2 = _base_q().gte("actual_2", month_start.isoformat()).lte("actual_2", fetch_to.isoformat())
        _ingest(_supabase_fetch_all_rows(lambda: q2, max_rows=5000))
    except Exception as e:
        _log(f"kpi ticket fetch: {e}")
        return []
    return list(by_id.values())


def _kpi_akash_ticket_visible(t: dict) -> bool:
    sp = t.get("staging_planned")
    lrs = str(t.get("live_review_status") or "").lower()
    if sp and lrs != "completed":
        return False
    return str(t.get("status_2") or "").lower() != "staging"


def _enrich_kpi_ticket_slices(*slices: list[dict]) -> None:
    """Enrich only tickets shown in KPI tables (skip bulk enrich of full in-memory list)."""
    by_id: dict[str, dict] = {}
    for sl in slices:
        for t in sl:
            tid = t.get("id")
            if tid:
                by_id[str(tid)] = t
    if by_id:
        _enrich_tickets_with_lookups(list(by_id.values()))


def _enrich_tickets_with_lookups(rows: list, *, include_repeat_counts: bool = True) -> list:
    """Add company_name, page_name, division_name from lookup tables."""
    if not rows:
        return rows
    ref_to_company = _ref_no_to_company_for_rows(rows)
    company_ids = {r.get("company_id") for r in rows if r.get("company_id")}
    page_ids = {r.get("page_id") for r in rows if r.get("page_id")}
    division_ids = {r.get("division_id") for r in rows if r.get("division_id")}
    approved_by_ids = {r.get("approved_by") for r in rows if r.get("approved_by")}
    companies_map: dict = {}
    pages_map: dict = {}
    divisions_map: dict = {}
    approvers_map: dict = {}

    def _load_companies() -> dict:
        r = supabase.table("companies").select("id,name").in_("id", list(company_ids)).execute()
        return {c["id"]: c["name"] for c in (r.data or [])}

    def _load_pages() -> dict:
        r = supabase.table("pages").select("id,name").in_("id", list(page_ids)).execute()
        return {p["id"]: p["name"] for p in (r.data or [])}

    def _load_divisions() -> dict:
        r = supabase.table("divisions").select("id,name").in_("id", list(division_ids)).execute()
        return {d["id"]: d["name"] for d in (r.data or [])}

    def _load_approvers() -> dict:
        r = supabase.table("user_profiles").select("id, full_name").in_("id", list(approved_by_ids)).execute()
        return {a["id"]: a.get("full_name") or "Unknown" for a in (r.data or [])}

    from concurrent.futures import ThreadPoolExecutor

    tasks: list[tuple[str, object]] = []
    if company_ids:
        tasks.append(("companies", _load_companies))
    if page_ids:
        tasks.append(("pages", _load_pages))
    if division_ids:
        tasks.append(("divisions", _load_divisions))
    if approved_by_ids:
        tasks.append(("approvers", _load_approvers))
    if tasks:
        with ThreadPoolExecutor(max_workers=min(4, len(tasks))) as pool:
            futures = {name: pool.submit(fn) for name, fn in tasks}
            for name, fut in futures.items():
                try:
                    data = fut.result()
                    if name == "companies":
                        companies_map = data
                    elif name == "pages":
                        pages_map = data
                    elif name == "divisions":
                        divisions_map = data
                    elif name == "approvers":
                        approvers_map = data
                except Exception:
                    pass
    for row in rows:
        row["company_name"] = _resolve_ticket_company_name(row, companies_map, ref_to_company)
        row["page_name"] = (
            (pages_map.get(row.get("page_id")) if row.get("page_id") else None)
            or (str(row.get("page")).strip() if row.get("page") and str(row.get("page")).strip() else None)
        )
        row["division_name"] = (
            (divisions_map.get(row.get("division_id")) if row.get("division_id") else None)
            or (str(row.get("division")).strip() if row.get("division") and str(row.get("division")).strip() else None)
        )
        row["approved_by_name"] = approvers_map.get(row.get("approved_by")) if row.get("approved_by") else None
    if include_repeat_counts:
        try:
            from app.ticket_similarity import attach_repeat_child_counts

            attach_repeat_child_counts(rows)
        except Exception:
            pass
    return rows


def _enrich_tickets_with_lookups_fast(rows: list) -> list:
    """List paint path: skip repeat counts and skip lookups when display fields are already set."""
    if not rows:
        return rows

    def _has_company_name(row: dict) -> bool:
        name = (row.get("company_name") or "").strip()
        return bool(name) and not _is_placeholder_company_name(name)

    all_have_company = all(_has_company_name(r) or not r.get("company_id") for r in rows)
    all_have_page = all((r.get("page") or "").strip() or not r.get("page_id") for r in rows)
    all_have_division = all((r.get("division") or "").strip() or not r.get("division_id") for r in rows)
    if all_have_company and all_have_page and all_have_division and not any(r.get("approved_by") for r in rows):
        return rows
    return _enrich_tickets_with_lookups(rows, include_repeat_counts=False)


def _apply_exclude_active_staging_filter(q):
    """Exclude tickets still in the Staging workflow (they belong under Staging, not Chores & Bugs)."""
    return q.or_("staging_planned.is.null,live_review_status.eq.completed")


def _exclude_repeat_children_from_list(q):
    """Repeat children are only visible under the parent's Repeated tickets modal."""
    return q.is_("repeat_of_ticket_id", "null")


def _apply_chores_bugs_pending_filters(q, type_filter: str | None = None, status_2_filter: str | None = None):
    """Chores & Bugs open queue: chore/bug, solution form not submitted, not in active Staging."""
    types_list = ["chore", "bug"] if type_filter not in ("chore", "bug") else [type_filter]
    q = q.in_("type", types_list)
    q = q.is_("quality_solution", "null")
    status_2_val = (status_2_filter or "").strip().lower()
    if status_2_val in ("pending", "completed", "staging", "hold", "na", "rejected"):
        q = q.eq("status_2", status_2_val)
        if status_2_val != "staging":
            q = _apply_exclude_active_staging_filter(q)
    elif status_2_val:
        q = q.eq("status_2", status_2_val)
        q = _apply_exclude_active_staging_filter(q)
    else:
        q = _apply_exclude_active_staging_filter(q)
        q = q.or_("status_2.is.null,status_2.neq.staging")
        q = apply_exclude_ticket_na(q)
    return q


def _supabase_list_total(r, page: int, page_size: int) -> int:
    """Resolve total row count; Supabase 206 responses may omit count."""
    if r.count is not None:
        return int(r.count)
    n = len(r.data or [])
    offset = (max(1, page) - 1) * page_size
    if n < page_size:
        return offset + n
    return offset + n + 1


@api_router.get("/tickets")
@cached(ttl=90, key_prefix="tickets:list:")
def list_tickets(
    status: str | None = None,
    type: str | None = None,
    types_in: str | None = None,
    company_id: str | None = None,
    company_ids: list[str] | None = Query(None, description="Filter by multiple company IDs"),
    priority: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    search: str | None = None,
    reference_filter: str | None = None,  # Filter by reference_no (partial match)
    sort_by: str = "created_at",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = Query(50, le=200),
    section: str | None = None,
    approval_filter: str | None = None,  # For section=approval-status: pending | unapproved | all
    status_2_filter: str | None = None,  # chores-bugs / feature: pending | completed | staging | hold | na | rejected
    type_filter: str | None = None,  # For section=chores-bugs: chore | bug (Type of Request filter)
    search_all_sections: bool = False,   # When True + search present: ignore section/type, search all tickets
    mine_only: bool = False,  # When True: only tickets created_by current user (export / operator scope)
    export_date_range: bool = False,  # Export: all chore/bug rows in date range (ignore queue/status sub-filters)
    register_status_filter: str | None = Query(
        None,
        description="register-of-tickets: completed | rejected | all (default all with quality_solution)",
    ),
    include_repeat_counts: bool = False,
    auth: dict = Depends(get_current_user),
):
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 50), 200))
    # Approval Status section: only admin, master_admin and approver
    if section == "approval-status":
        role = _get_role_from_profile(auth["id"])
        if role not in ("admin", "master_admin", "approver"):
            raise HTTPException(status_code=403, detail="Approval Status is only available to Admin and Approver roles")
    use_wide_select = bool(search and search.strip()) or bool(reference_filter and reference_filter.strip())
    ticket_cols = "*" if use_wide_select else _TICKET_LIST_SELECT
    q = supabase.table("tickets").select(ticket_cols, count="exact")
    # When global search: bypass section/type filters to search across all tickets
    apply_section_filter = section and not (search_all_sections and search and search.strip())
    # Status filter: use status for non–Chores & Bugs; for Chores & Bugs use status_2_filter (Stage 2) instead
    use_status_2_for_chores = apply_section_filter and section == "chores-bugs" and status_2_filter
    if status and not use_status_2_for_chores:
        q = q.eq("status", status)
    if apply_section_filter and section == "completed-chores-bugs":
        types_list = ["chore", "bug"]
        q = q.in_("type", types_list)
        q = q.or_("quality_solution.not.is.null,live_review_status.eq.completed")
    elif apply_section_filter and section == "rejected-tickets":
        # Rejected tickets that have completed Stage 4 (moved out of Chores & Bugs)
        q = q.in_("type", ["chore", "bug"])
        q = q.eq("status_2", "rejected")
        q = q.eq("status_4", "completed")
    elif apply_section_filter and section == "solutions":
        q = q.not_.is_("quality_solution", "null")
    elif apply_section_filter and section == "completed-feature":
        # Feature: when Stage 2 (live) completed -> auto-move to Completed Feature
        q = q.eq("type", "feature")
        q = q.eq("live_status", "completed")
    elif apply_section_filter and section == "staging":
        # Tickets in Staging: (new workflow: staging_planned set OR old: status_2 = staging) AND not completed Stage 3
        q = q.or_("staging_planned.not.is.null,status_2.eq.staging")
        q = q.or_("live_review_status.is.null,live_review_status.neq.completed")
    elif apply_section_filter and section == "register-of-tickets":
        # Solution form submitted — leaves Chores & Bugs open queue
        if types_in:
            types_list = [t.strip() for t in types_in.split(",") if t.strip()]
        else:
            types_list = ["chore", "bug"]
        if types_list:
            q = q.in_("type", types_list)
        q = q.not_.is_("quality_solution", "null")
        rsf = (register_status_filter or "all").strip().lower()
        if rsf == "completed":
            q = q.eq("status_1", "yes")
            q = q.or_("status_4.eq.completed,status_4.eq.Completed")
        elif rsf == "rejected":
            q = q.or_("status_2.eq.rejected,status.eq.rejected")
    elif apply_section_filter and section == "chores-bugs":
        if export_date_range:
            # Date-range export: every chore/bug with created_at in range (not only open-queue subset)
            q = q.in_("type", ["chore", "bug"])
        else:
            q = _apply_chores_bugs_pending_filters(q, type_filter, status_2_filter)
    elif apply_section_filter and section == "approval-status":
        # Feature requests: only Pending and Unapproved (exclude Approved)
        q = q.eq("type", "feature")
        q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
        if approval_filter == "pending":
            q = q.is_("approval_status", "null")
        elif approval_filter in ("unapproved", "rejected"):
            # Unapprove filter includes legacy "rejected" status (no separate Rejected filter in UI)
            q = q.or_("approval_status.eq.unapproved,approval_status.eq.rejected")
        elif approval_filter == "hold":
            q = q.eq("approval_status", "hold")
        else:
            # all: pending + unapproved + rejected + hold (not approved)
            q = q.or_(
                "approval_status.is.null,approval_status.eq.unapproved,"
                "approval_status.eq.rejected,approval_status.eq.hold"
            )
    elif apply_section_filter and types_in:
        types_list = [t.strip() for t in types_in.split(",") if t.strip()]
        if types_list:
            q = q.in_("type", types_list)
            q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
    elif apply_section_filter and type:
        q = q.eq("type", type)
        if type == "feature":
            if (approval_filter or "").strip().lower() == "hold":
                # Feature → "Hold – Approve" view: features the approver placed on hold
                q = q.eq("approval_status", "hold")
            else:
                # Feature section: only APPROVED features; unapproved/pending stay in Approval Status
                q = q.eq("approval_status", "approved")
                q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
                q = q.or_("live_status.is.null,live_status.neq.completed")
            feat_s2 = (status_2_filter or "").strip().lower()
            if feat_s2:
                q = q.eq("status_2", feat_s2)
    elif type and not apply_section_filter:
        # type=feature when no section (e.g. /tickets?type=feature) - only APPROVED features
        q = q.eq("type", type)
        if type == "feature":
            if (approval_filter or "").strip().lower() == "hold":
                # Feature → "Hold – Approve" view: features the approver placed on hold
                q = q.eq("approval_status", "hold")
            else:
                q = q.eq("approval_status", "approved")
                q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
                q = q.or_("live_status.is.null,live_status.neq.completed")
            feat_s2 = (status_2_filter or "").strip().lower()
            if feat_s2:
                q = q.eq("status_2", feat_s2)
    if company_ids:
        ids = [x.strip() for x in company_ids if x and x.strip()]
        if ids:
            q = q.in_("company_id", ids)
    elif company_id:
        q = q.eq("company_id", company_id)
    if priority:
        q = q.eq("priority", priority)
    if mine_only:
        q = q.eq("created_by", auth["id"])
    if date_from:
        q = q.gte("created_at", date_from)
    if date_to:
        q = q.lte("created_at", date_to)
    if search and search.strip():
        safe = _sanitize_ilike_input(search, max_len=200)
        if safe:
            q = q.or_(
                f"title.ilike.%{safe}%,description.ilike.%{safe}%,user_name.ilike.%{safe}%,"
                f"submitted_by.ilike.%{safe}%,customer_questions.ilike.%{safe}%,reference_no.ilike.%{safe}%,"
                f"company_name.ilike.%{safe}%,quality_of_response.ilike.%{safe}%,quality_solution.ilike.%{safe}%,why_feature.ilike.%{safe}%,"
                f"source_reference_no.ilike.%{safe}%"
            )
    if reference_filter and reference_filter.strip():
        safe_ref = _sanitize_ilike_input(reference_filter, max_len=80)
        if safe_ref:
            q = q.or_(f"reference_no.ilike.%{safe_ref}%,source_reference_no.ilike.%{safe_ref}%")
    order_col = sort_by if sort_by in (
        "created_at",
        "updated_at",
        "query_arrival_at",
        "query_response_at",
        "title",
        "status",
        "priority",
        "reference_no",
    ) else "created_at"
    q = q.order(order_col, desc=(sort_order.lower() == "desc"))
    if (status_2_filter or "").strip().lower() != "na":
        q = apply_exclude_ticket_na(q)
    q = _exclude_repeat_children_from_list(q)
    q = q.range((page - 1) * page_size, page * page_size - 1)
    r = q.execute()
    raw_rows = r.data or []
    if include_repeat_counts:
        rows = _enrich_tickets_with_lookups(raw_rows, include_repeat_counts=True)
    else:
        rows = _enrich_tickets_with_lookups_fast(raw_rows)
    return {"data": rows, "total": _supabase_list_total(r, page, page_size), "page": page, "page_size": page_size}


@api_router.get("/tickets/repeat-counts")
def get_ticket_repeat_counts(
    ticket_ids: list[str] = Query(default=[]),
    auth: dict = Depends(get_current_user),
):
    """Batch repeat-child counts for list Rep column (deferred from main list for speed)."""
    from app.ticket_similarity import fetch_repeat_child_counts

    ids = [str(i).strip() for i in (ticket_ids or []) if i][:100]
    return {"counts": fetch_repeat_child_counts(ids)}


def _level3_used_for_ticket(ticket_id: str, user_id: str) -> bool:
    """True if this Level 3 user has already used their one-time edit on this ticket."""
    try:
        r = supabase.table("ticket_level3_edit_used").select("ticket_id").eq("ticket_id", ticket_id).eq("user_id", user_id).limit(1).execute()
        return bool(r.data and len(r.data) > 0)
    except Exception:
        return False


def _mark_level3_edit_used(ticket_id: str, user_id: str) -> None:
    """Record that this Level 3 user has used their one-time edit on this ticket (idempotent)."""
    try:
        supabase.table("ticket_level3_edit_used").insert(
            {"ticket_id": ticket_id, "user_id": user_id}
        ).execute()
    except Exception:
        pass  # ignore duplicate (already used)


@api_router.get("/tickets/similar")
def list_similar_tickets(
    title: str = Query(..., min_length=3, max_length=500),
    limit: int = Query(10, ge=1, le=20),
    auth: dict = Depends(get_current_user),
):
    """Support form: similar titles across all companies (global search)."""
    from app.ticket_similarity import find_similar_tickets, similar_tickets_access_allowed

    if not similar_tickets_access_allowed(auth.get("email")):
        title_clean = title.strip()
        response = JSONResponse(
            content={
                "similar": [],
                "nearSimilar": [],
                "repeat_count": 0,
                "normalized_title": title_clean.lower(),
                "has_open_repeat": False,
                "scope": "global",
                "matches": [],
            }
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    payload = find_similar_tickets(title=title.strip(), limit=limit)
    response = JSONResponse(content=payload)
    response.headers["Cache-Control"] = "no-store"
    return response


@api_router.get("/tickets/{ticket_id}/repeats")
def get_ticket_repeats(
    ticket_id: str,
    auth: dict = Depends(get_current_user),
):
    """Cross-company repeated issues for Chores / Bugs / Features (open Pending/Hold)."""
    from app.ticket_similarity import find_repeats_for_ticket

    payload = find_repeats_for_ticket(ticket_id)
    response = JSONResponse(content=payload)
    response.headers["Cache-Control"] = "no-store"
    return response


@api_router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, auth: dict = Depends(get_current_user)):
    r = supabase.table("tickets").select(_TICKET_LIST_SELECT).eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    rows = _enrich_tickets_with_lookups([r.data])
    out = rows[0] if rows else r.data
    role = _get_role_from_profile(auth["id"])
    if role == "user":
        out["level3_used_by_current_user"] = _level3_used_for_ticket(ticket_id, auth["id"])
    else:
        out["level3_used_by_current_user"] = False
    return out


def _apply_staging_cascade(data: dict, ticket_id: str) -> dict:
    """Apply staging workflow cascade: set actual/planned when status changes to completed."""
    now = datetime.utcnow().isoformat()
    if data.get("staging_review_status") == "completed":
        data["staging_review_actual"] = now
        data["live_planned"] = now
    if data.get("live_status") == "completed":
        data["live_actual"] = now
        data["live_review_planned"] = now
    if data.get("live_review_status") == "completed":
        data["live_review_actual"] = now
        data["status"] = "resolved"
        data["resolved_at"] = now
    return data


def _apply_approval_actual_times(data: dict) -> dict:
    """Set approval_actual_at / unapproval_actual_at when approval_status is set."""
    now = datetime.utcnow().isoformat()
    if data.get("approval_status") == "approved" and "approval_actual_at" not in data:
        data["approval_actual_at"] = now
    if data.get("approval_status") in ("unapproved", "rejected", "hold") and "unapproval_actual_at" not in data:
        data["unapproval_actual_at"] = now
    return data


# Stage keys for Level 3 one-time edit tracking. Stage 2 is excluded so Users can edit it multiple times.
_STAGE_1_EDIT_KEYS = {"status_1", "actual_1"}
_STAGE_2_EDIT_KEYS = {"status_2", "actual_2"}
_STAGE_3_EDIT_KEYS = {"status_3", "actual_3"}
_STAGE_4_EDIT_KEYS = {"status_4", "actual_4"}
_FEATURE_STAGE_2_KEYS = {"live_status", "live_actual", "live_planned"}


@api_router.put("/tickets/{ticket_id}")
def update_ticket(ticket_id: str, payload: UpdateTicketRequest, auth: dict = Depends(get_current_user)):
    from app.ticket_similarity import similar_tickets_access_allowed

    raw = payload.model_dump(exclude_unset=True)
    data: dict = {}
    for k, v in raw.items():
        if k == "repeat_of_ticket_id":
            if not similar_tickets_access_allowed(auth.get("email")):
                continue
            if v in ("", None):
                data["repeat_of_ticket_id"] = None
            else:
                data["repeat_of_ticket_id"] = v
            continue
        if k == "approval_status" and v in ("", None):
            data["approval_status"] = None
        elif v is not None:
            data[k] = v
    if "priority" in data:
        data["priority"] = _normalize_ticket_priority(data.get("priority"))
    # Keep denormalized display columns in sync when IDs are edited from ticket modal.
    try:
        if data.get("company_id"):
            cr = supabase.table("companies").select("name").eq("id", data["company_id"]).single().execute()
            if cr.data and cr.data.get("name"):
                data["company_name"] = str(cr.data.get("name")).strip()
        if data.get("page_id"):
            pr = supabase.table("pages").select("name").eq("id", data["page_id"]).single().execute()
            if pr.data and pr.data.get("name"):
                data["page"] = str(pr.data.get("name")).strip()
        if data.get("division_id"):
            dr = supabase.table("divisions").select("name").eq("id", data["division_id"]).single().execute()
            if dr.data and dr.data.get("name"):
                data["division"] = str(dr.data.get("name")).strip()
    except Exception:
        pass
    role = _get_role_from_profile(auth["id"])
    # Approve / reject / hold / return to pending: only admin, master_admin and approver
    if "approval_status" in data:
        if role not in ("admin", "master_admin", "approver"):
            raise HTTPException(status_code=403, detail="Only Admin or Approver can approve or unapprove tickets")
        if data.get("approval_status") == "hold":
            hold_remarks = (data.get("remarks") or "").strip()
            if not hold_remarks:
                raise HTTPException(
                    status_code=400,
                    detail="Hold remarks are required when placing a feature request on hold.",
                )
        if data.get("approval_status") == "rejected":
            reject_remarks = (data.get("remarks") or "").strip()
            if not reject_remarks:
                raise HTTPException(
                    status_code=400,
                    detail="Remarks are required when rejecting a feature request.",
                )
        if data.get("approval_status") is None:
            data["unapproval_actual_at"] = None
            data["approval_actual_at"] = None
        now = datetime.utcnow().isoformat()
        data["approved_by"] = auth["id"]
        data["approval_source"] = "ui"
    if data.get("status") == "resolved" and "resolved_at" not in data:
        data["resolved_at"] = datetime.utcnow().isoformat()
    data = _apply_approval_actual_times(data)
    data = _apply_staging_cascade(data, ticket_id)
    r = supabase.table("tickets").update(data).eq("id", ticket_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Enrichment uses cached company-name maps; reset on writes so list/drawer stays fresh.
    global _REF_NO_TO_COMPANY_LOADED, _COMPANIES_BY_NAME_LOADED
    _REF_NO_TO_COMPANY_LOADED = False
    _COMPANIES_BY_NAME_LOADED = False
    invalidate_dashboard_read_caches()
    _invalidate_ttl_cache_key_prefix("tickets:list:")
    from app.ticket_similarity import cascade_repeat_children_stage_updates

    cascade_repeat_children_stage_updates(ticket_id, data)
    # Log approval/rejection for audit
    if "approval_status" in data:
        try:
            st = data.get("approval_status")
            status_log = (
                "approved"
                if st == "approved"
                else st
                if st in ("rejected", "unapproved", "hold")
                else "pending"
            )
            supabase.table("approval_logs").insert({
                "ticket_id": ticket_id,
                "approved_by": auth["id"],
                "approved_at": data.get("approval_actual_at") or data.get("unapproval_actual_at") or datetime.utcnow().isoformat(),
                "status": status_log,
                "source": "ui",
                "remarks": data.get("remarks"),
            }).execute()
        except Exception:
            pass
        st_notify = data.get("approval_status")
        if st_notify in ("approved", "rejected", "hold"):
            try:
                from app.feature_approval_submitter_notify import fire_submitter_approval_notification

                trn = (
                    supabase.table("tickets")
                    .select("reference_no, title, type")
                    .eq("id", ticket_id)
                    .limit(1)
                    .execute()
                )
                if trn.data and trn.data[0].get("type") == "feature":
                    fire_submitter_approval_notification(
                        ticket_id,
                        status=st_notify,
                        reference_no=trn.data[0].get("reference_no"),
                        title=trn.data[0].get("title"),
                        remarks=data.get("remarks"),
                        source="ui",
                    )
            except Exception:
                pass
    # Level 3 (user): one-time edit for Stage 1, 3, 4. Stage 2 stays editable multiple times for all users.
    if role == "user":
        updated = r.data[0]
        ticket_type = updated.get("type") or (supabase.table("tickets").select("type").eq("id", ticket_id).single().execute().data or {}).get("type")
        if ticket_type in ("chore", "bug") and (data.keys() & (_STAGE_1_EDIT_KEYS | _STAGE_3_EDIT_KEYS | _STAGE_4_EDIT_KEYS)):
            _mark_level3_edit_used(ticket_id, auth["id"])
        if ticket_type == "feature" and (data.keys() & _FEATURE_STAGE_2_KEYS):
            _mark_level3_edit_used(ticket_id, auth["id"])
    return r.data[0]


@api_router.post("/tickets/{ticket_id}/mark-staging")
def mark_ticket_staging(ticket_id: str, auth: dict = Depends(get_current_user)):
    """Mark a ticket as Staging: set Stage 1 planned and status. Ticket will appear only in Staging section."""
    r = supabase.table("tickets").select("id, staging_planned").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if r.data.get("staging_planned"):
        raise HTTPException(status_code=400, detail="Ticket is already in Staging")
    role = _get_role_from_profile(auth["id"])
    now = datetime.utcnow().isoformat()
    data = {"staging_planned": now, "staging_review_status": "pending"}
    out = supabase.table("tickets").update(data).eq("id", ticket_id).execute()
    if out.data and role == "user":
        _mark_level3_edit_used(ticket_id, auth["id"])
    from app.ticket_similarity import cascade_repeat_children_stage_updates

    cascade_repeat_children_stage_updates(ticket_id, data)
    _invalidate_ttl_cache_key_prefix("tickets:list:")
    invalidate_dashboard_read_caches()
    return out.data[0] if out.data else {}


@api_router.post("/tickets/{ticket_id}/promote-to-feature")
def promote_ticket_to_feature(
    ticket_id: str,
    payload: PromoteToFeatureRequest,
    auth: dict = Depends(get_current_user),
):
    """Shift a Chores/Bug ticket to Feature: new EX-FE ref, store original CH/BU ref. All users allowed."""
    r = (
        supabase.table("tickets")
        .select("id, type, reference_no, staging_planned, status_2, source_reference_no")
        .eq("id", ticket_id)
        .single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    row = r.data
    ticket_type = (row.get("type") or "").strip().lower()
    if ticket_type not in ("chore", "bug"):
        raise HTTPException(status_code=400, detail="Only Chores or Bug tickets can be shifted to Feature")
    if row.get("source_reference_no"):
        raise HTTPException(status_code=400, detail="This ticket was already shifted to Feature")
    if row.get("staging_planned") or (row.get("status_2") or "").strip().lower() == "staging":
        raise HTTPException(
            status_code=400,
            detail="Tickets in Staging cannot be shifted to Feature. Move back to Chores & Bugs first.",
        )

    old_ref = (row.get("reference_no") or "").strip()
    if not old_ref:
        raise HTTPException(status_code=400, detail="Ticket has no reference number")

    new_ref = _next_ex_ticket_reference_no("feature")
    now = datetime.utcnow().isoformat()
    why = payload.why_feature.strip()
    patch = {
        "source_reference_no": old_ref,
        "source_type": ticket_type,
        "promoted_to_feature_at": now,
        "promoted_by": auth["id"],
        "reference_no": new_ref,
        "type": "feature",
        "approval_status": None,
        "approval_actual_at": None,
        "unapproval_actual_at": None,
        "approved_by": None,
        "approval_source": None,
        "why_feature": why,
        "updated_at": now,
    }
    out = supabase.table("tickets").update(patch).eq("id", ticket_id).execute()
    if not out.data:
        raise HTTPException(status_code=500, detail="Could not shift ticket to Feature")

    try:
        supabase.table("ticket_history").insert({
            "ticket_id": ticket_id,
            "changed_by": auth["id"],
            "field_name": "promoted_to_feature",
            "old_value": f"{ticket_type}:{old_ref}",
            "new_value": f"feature:{new_ref}",
            "change_type": "promoted_to_feature",
        }).execute()
    except Exception:
        pass

    global _REF_NO_TO_COMPANY_LOADED, _COMPANIES_BY_NAME_LOADED
    _REF_NO_TO_COMPANY_LOADED = False
    _COMPANIES_BY_NAME_LOADED = False
    invalidate_dashboard_read_caches()
    _invalidate_ttl_cache_key_prefix("tickets:list:")
    rows = _enrich_tickets_with_lookups([out.data[0]])
    return rows[0] if rows else out.data[0]


@api_router.post("/tickets/{ticket_id}/staging-back")
def staging_back(ticket_id: str, auth: dict = Depends(get_current_user)):
    """Move ticket back from Staging to Chores & Bugs: clear all staging fields and set status_2 = pending."""
    r = supabase.table("tickets").select("id").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    data = {
        "staging_planned": None,
        "staging_review_actual": None,
        "staging_review_status": None,
        "live_planned": None,
        "live_actual": None,
        "live_status": None,
        "live_review_planned": None,
        "live_review_actual": None,
        "live_review_status": None,
        "status_2": "pending",
    }
    out = supabase.table("tickets").update(data).eq("id", ticket_id).execute()
    from app.ticket_similarity import cascade_repeat_children_stage_updates

    cascade_repeat_children_stage_updates(ticket_id, data)
    _invalidate_ttl_cache_key_prefix("tickets:list:")
    invalidate_dashboard_read_caches()
    return out.data[0] if out.data else {}


# ---------- (legacy approval_settings removed — use feature_approval_email_settings + /feature-approval-reminders/*) ----------
# ---------- Email-based approval (tokenized, one-time) ----------
class ApprovalByTokenRequest(BaseModel):
    token: str
    action: str  # approve | reject | hold
    remarks: str | None = None


class CreateApprovalTokensRequest(BaseModel):
    ticket_id: str


def _frontend_base_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3001").rstrip("/")


@api_router.get("/approval/public-url-config")
def approval_public_url_config(auth: dict = Depends(get_current_user)):
    """Admin: show which base URL is used for email approve/reject links."""
    role = _get_role_from_profile(auth["id"])
    if role not in ("admin", "master_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    from app.public_urls import (
        get_frontend_base,
        get_public_api_base,
        running_on_render,
        is_loopback_url,
    )

    api = get_public_api_base()
    return {
        "public_api_base": api,
        "frontend_base": get_frontend_base(),
        "on_render": running_on_render(),
        "email_links_ok": not is_loopback_url(api),
        "hint": (
            None
            if not is_loopback_url(api)
            else "Set PUBLIC_API_URL to your Render URL on the backend service, then redeploy."
        ),
    }


@api_router.post("/approval/create-tokens")
def create_approval_tokens(
    payload: CreateApprovalTokensRequest,
    auth: dict = Depends(require_roles(["admin", "master_admin", "approver"])),
):
    """
    Create one-time approve/reject tokens for a ticket (e.g. to send approval emails).
    Returns the approval and reject URLs. Tokens expire in 7 days.
    """
    from datetime import timedelta
    ticket_id = payload.ticket_id
    r = supabase.table("tickets").select("id, type, approval_status").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if r.data.get("type") != "feature":
        raise HTTPException(status_code=400, detail="Only feature tickets require approval tokens")
    if r.data.get("approval_status") not in (None, ""):
        raise HTTPException(status_code=400, detail="Ticket is not pending approval")
    expires = (datetime.utcnow() + timedelta(days=7)).isoformat()
    base = _frontend_base_url()
    tokens_out = []
    from app.public_urls import build_approval_email_action_url

    token_str: str | None = None
    for action in ("approve", "reject", "hold"):
        if token_str:
            tokens_out.append({
                "action": action,
                "url": build_approval_email_action_url(token_str, action),
            })
            continue
        try:
            row = supabase.table("approval_tokens").insert({
                "ticket_id": ticket_id,
                "action": action,
                "expires_at": expires,
            }).execute()
            if row.data and len(row.data) > 0:
                token = row.data[0].get("token")
                if token:
                    token_str = str(token)
                    tokens_out.append({
                        "action": action,
                        "url": build_approval_email_action_url(token_str, action),
                    })
        except Exception:
            continue
    if token_str:
        for action in ("approve", "reject", "hold"):
            if not any(t.get("action") == action for t in tokens_out):
                tokens_out.append({
                    "action": action,
                    "url": build_approval_email_action_url(token_str, action),
                })
    return {"ticket_id": ticket_id, "links": tokens_out, "expires_in_days": 7}


@api_router.post("/approval/execute-by-token")
def approval_execute_by_token(payload: ApprovalByTokenRequest):
    """Execute approve/reject from email link. No auth required; token is one-time and time-limited."""
    from app.approval_token_service import execute_approval_by_token

    return execute_approval_by_token(payload.token, payload.action, payload.remarks)


@api_router.get("/tickets/{ticket_id}/responses")
def list_ticket_responses(ticket_id: str, auth: dict = Depends(get_current_user)):
    try:
        r = supabase.table("ticket_responses").select("*").eq("ticket_id", ticket_id).order("created_at", desc=False).execute()
        rows = r.data or []
    except Exception:
        rows = []
    user_ids = {row.get("responded_by") for row in rows if row.get("responded_by")}
    names_map = {}
    if user_ids:
        try:
            up_r = supabase.table("user_profiles").select("id,full_name").in_("id", list(user_ids)).execute()
            names_map = {u["id"]: u.get("full_name", "") for u in (up_r.data or [])}
        except Exception:
            pass
    for row in rows:
        row["responded_by_name"] = names_map.get(row.get("responded_by"), "")
    return {"data": rows}


class SubmitQualitySolutionRequest(BaseModel):
    quality_solution: str


@api_router.post("/tickets/{ticket_id}/quality-solution")
def submit_quality_solution(ticket_id: str, payload: SubmitQualitySolutionRequest, auth: dict = Depends(get_current_user)):
    """Submit Quality of Solution (Chores & Bugs). Links by Reference No, sets submitted_by and submitted_at."""
    r = supabase.table("tickets").select("id, quality_solution").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if r.data.get("quality_solution"):
        raise HTTPException(status_code=400, detail="Quality solution already submitted")
    profile = supabase.table("user_profiles").select("full_name").eq("id", auth["id"]).single().execute()
    submitted_by = profile.data.get("full_name", auth.get("email", "Unknown")) if profile.data else "Unknown"
    data = {
        "quality_solution": payload.quality_solution.strip(),
        "quality_solution_submitted_by": submitted_by,
        "quality_solution_submitted_at": datetime.utcnow().isoformat(),
    }
    up = supabase.table("tickets").update(data).eq("id", ticket_id).execute()
    return up.data[0] if up.data else {}


# ---------- Stage 2 Remarks (Chores & Bugs) ----------
@api_router.get("/tickets/{ticket_id}/stage2-remarks")
def list_stage2_remarks(ticket_id: str, auth: dict = Depends(get_current_user)):
    """List Stage 2 remarks. All users with ticket access can view."""
    try:
        r = supabase.table("ticket_stage2_remarks").select("*").eq("ticket_id", ticket_id).order("added_at", desc=False).execute()
        rows = r.data or []
    except Exception:
        rows = []
    user_ids = {row.get("added_by") for row in rows if row.get("added_by")}
    names_map = {}
    if user_ids:
        try:
            up_r = supabase.table("user_profiles").select("id, full_name").in_("id", list(user_ids)).execute()
            names_map = {u["id"]: u.get("full_name", "") for u in (up_r.data or [])}
        except Exception:
            pass
    for row in rows:
        row["added_by_name"] = names_map.get(row.get("added_by"), "")
    return {"data": rows}


class Stage2RemarkRequest(BaseModel):
    remark_text: str


@api_router.post("/tickets/{ticket_id}/stage2-remarks")
def create_stage2_remark(ticket_id: str, payload: Stage2RemarkRequest, auth: dict = Depends(get_current_user)):
    """Add Stage 2 remark. All users can add (3-4 per ticket recommended)."""
    r = supabase.table("tickets").select("id").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    text = (payload.remark_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Remark text is required")
    try:
        ins = supabase.table("ticket_stage2_remarks").insert({
            "ticket_id": ticket_id,
            "remark_text": text,
            "added_by": auth["id"],
        }).execute()
        row = ins.data[0] if ins.data else {}
        if row:
            profile = supabase.table("user_profiles").select("full_name").eq("id", auth["id"]).single().execute()
            row["added_by_name"] = profile.data.get("full_name", "") if profile.data else ""
        return row
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)[:100])


@api_router.put("/tickets/{ticket_id}/stage2-remarks/{remark_id}")
def update_stage2_remark(
    ticket_id: str, remark_id: str, payload: Stage2RemarkRequest,
    auth: dict = Depends(get_current_user), current: dict = Depends(get_current_user_with_role),
):
    """Update Stage 2 remark. Only Master Admin or the remark author can edit."""
    try:
        r = supabase.table("ticket_stage2_remarks").select("id, added_by").eq("id", remark_id).eq("ticket_id", ticket_id).single().execute()
    except Exception:
        r = type("R", (), {"data": None})()
        r.data = None
    if not r.data:
        raise HTTPException(status_code=404, detail="Remark not found")
    role = current.get("role", "user")
    added_by = r.data.get("added_by")
    if role != "master_admin" and str(added_by) != str(auth["id"]):
        raise HTTPException(status_code=403, detail="Only Master Admin or the remark author can edit")
    text = (payload.remark_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Remark text is required")
    now = datetime.utcnow().isoformat()
    supabase.table("ticket_stage2_remarks").update({"remark_text": text, "updated_at": now}).eq("id", remark_id).execute()
    up = supabase.table("ticket_stage2_remarks").select("*").eq("id", remark_id).single().execute()
    row = up.data or {}
    if row.get("added_by"):
        try:
            pr = supabase.table("user_profiles").select("full_name").eq("id", row["added_by"]).single().execute()
            row["added_by_name"] = pr.data.get("full_name", "") if pr.data else ""
        except Exception:
            row["added_by_name"] = ""
    return row


@api_router.post("/tickets/{ticket_id}/responses")
def create_ticket_response(ticket_id: str, payload: CreateTicketResponseRequest, auth: dict = Depends(get_current_user)):
    r = supabase.table("tickets").select("id").eq("id", ticket_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    try:
        ins = supabase.table("ticket_responses").insert({
            "ticket_id": ticket_id,
            "response_text": payload.response_text,
            "responded_by": auth["id"],
        }).execute()
        return ins.data[0] if ins.data else {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to add response: {str(e)[:100]}")


@api_router.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: str, auth: dict = Depends(get_current_user)):
    supabase.table("tickets").delete().eq("id", ticket_id).execute()
    return {"message": "Deleted"}


# ---------- Activity / Stage 2 remark notifications (header bell) ----------
STAGE2_REMARK_NOTIFY_HOURS = 24
_STAGE2_SEEN_SUPPORTED: bool | None = None


def _stage2_seen_supported() -> bool:
    global _STAGE2_SEEN_SUPPORTED
    if _STAGE2_SEEN_SUPPORTED is True:
        return True
    try:
        supabase.table("stage2_remark_notification_seen").select("user_id").limit(1).execute()
        _STAGE2_SEEN_SUPPORTED = True
        return True
    except Exception:
        return False


def _fetch_stage2_seen_remark_ids(user_id: str, remark_ids: list[str]) -> set[str]:
    if not remark_ids or not _stage2_seen_supported():
        return set()
    try:
        r = (
            supabase.table("stage2_remark_notification_seen")
            .select("remark_id")
            .eq("user_id", user_id)
            .in_("remark_id", remark_ids)
            .execute()
        )
        return {str(row["remark_id"]) for row in (r.data or []) if row.get("remark_id")}
    except Exception:
        return set()


def _mark_stage2_remarks_seen(user_id: str, remark_ids: list[str]) -> int:
    if not remark_ids or not _stage2_seen_supported():
        return 0
    now = datetime.utcnow().isoformat()
    rows = [{"user_id": user_id, "remark_id": rid, "seen_at": now} for rid in remark_ids if rid]
    if not rows:
        return 0
    try:
        supabase.table("stage2_remark_notification_seen").upsert(rows, on_conflict="user_id,remark_id").execute()
        return len(rows)
    except Exception as e:
        _log(f"stage2 mark seen: {e}")
        return 0


def _stage2_remark_notifications_payload(user_id: str | None = None) -> dict:
    """Chores & Bugs Stage 2 remarks in last 24h; badge count = unread for this user."""
    from datetime import timedelta

    since = (datetime.utcnow() - timedelta(hours=STAGE2_REMARK_NOTIFY_HOURS)).isoformat()
    rows: list = []
    try:
        r = (
            supabase.table("ticket_stage2_remarks")
            .select("id, ticket_id, remark_text, added_at, added_by")
            .gte("added_at", since)
            .order("added_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = r.data or []
    except Exception:
        rows = []

    remark_ids = [str(row.get("id")) for row in rows if row.get("id")]
    seen_ids: set[str] = set()
    if user_id and remark_ids:
        seen_ids = _fetch_stage2_seen_remark_ids(str(user_id), remark_ids)

    ticket_ids = list({str(row.get("ticket_id")) for row in rows if row.get("ticket_id")})
    ticket_map: dict = {}
    if ticket_ids:
        try:
            for i in range(0, len(ticket_ids), 80):
                chunk = ticket_ids[i : i + 80]
                tr = (
                    supabase.table("tickets")
                    .select("id, reference_no, type")
                    .in_("id", chunk)
                    .in_("type", ["chore", "bug"])
                    .execute()
                )
                for t in tr.data or []:
                    ticket_map[str(t["id"])] = t
        except Exception:
            pass

    user_ids = {row.get("added_by") for row in rows if row.get("added_by")}
    names_map: dict = {}
    if user_ids:
        try:
            up_r = supabase.table("user_profiles").select("id, full_name").in_("id", list(user_ids)).execute()
            names_map = {u["id"]: u.get("full_name", "") for u in (up_r.data or [])}
        except Exception:
            pass

    items = []
    unread_count = 0
    for row in rows:
        tid = str(row.get("ticket_id") or "")
        ticket = ticket_map.get(tid)
        if not ticket:
            continue
        rid = str(row.get("id") or "")
        seen = rid in seen_ids
        if not seen:
            unread_count += 1
        text = (row.get("remark_text") or "").strip()
        if len(text) > 120:
            text = text[:117] + "..."
        items.append({
            "id": rid,
            "ticket_id": tid,
            "reference_no": ticket.get("reference_no") or "",
            "ticket_type": ticket.get("type") or "chore",
            "remark_text": text,
            "added_at": row.get("added_at"),
            "added_by_name": names_map.get(row.get("added_by"), ""),
            "seen": seen,
        })

    return {
        "count": unread_count,
        "unread_count": unread_count,
        "items": items,
        "expires_hours": STAGE2_REMARK_NOTIFY_HOURS,
    }


class MarkStage2RemarksSeenRequest(BaseModel):
    remark_ids: list[str] = []


@api_router.get("/activity/stage2-remark-notifications")
def stage2_remark_notifications(auth: dict = Depends(get_current_user)):
    """Header bell: Stage 2 remarks (24h). Badge count = unread for logged-in user."""
    return _stage2_remark_notifications_payload(auth.get("id"))


@api_router.post("/activity/stage2-remark-notifications/mark-seen")
def mark_stage2_remark_notifications_seen(
    payload: MarkStage2RemarksSeenRequest,
    auth: dict = Depends(get_current_user),
):
    """Mark remarks as seen when user opens the bell dropdown — clears badge count for that user."""
    user_id = str(auth["id"])
    remark_ids = [str(r) for r in (payload.remark_ids or []) if r]
    if not remark_ids:
        data = _stage2_remark_notifications_payload(user_id)
        remark_ids = [str(i["id"]) for i in (data.get("items") or []) if i.get("id") and not i.get("seen")]
    marked = _mark_stage2_remarks_seen(user_id, remark_ids)
    if marked == 0 and remark_ids and not _stage2_seen_supported():
        raise HTTPException(
            400,
            "Notification seen-tracking is not enabled. Run database/STAGE2_REMARK_NOTIFICATION_SEEN.sql in Supabase.",
        )
    refreshed = _stage2_remark_notifications_payload(user_id)
    return {
        "success": True,
        "marked": marked,
        "unread_count": refreshed.get("unread_count", 0),
        "count": refreshed.get("unread_count", 0),
    }


@api_router.get("/activity/count")
def activity_count(auth: dict = Depends(get_current_user)):
    """Bell badge count — unread Stage 2 remarks (24h) for logged-in user."""
    payload = _stage2_remark_notifications_payload(auth.get("id"))
    return {"count": payload.get("unread_count", 0)}


# ---------- Dashboard Metrics (in-process cache per user email) ----------
_DASH_METRICS_CACHE: TTLCache = TTLCache(maxsize=256, ttl=180)
_DASH_TRENDS_CACHE: TTLCache = TTLCache(maxsize=8, ttl=300)
_DASH_BOOTSTRAP_CACHE: TTLCache = TTLCache(maxsize=256, ttl=120)
_SUPPORT_DASH_CACHE: TTLCache = TTLCache(maxsize=64, ttl=120)


def invalidate_dashboard_read_caches() -> None:
    _DASH_METRICS_CACHE.clear()
    _DASH_TRENDS_CACHE.clear()
    _DASH_BOOTSTRAP_CACHE.clear()
    _SUPPORT_DASH_CACHE.clear()
    _invalidate_ttl_cache_key_prefix("dash:")
    _invalidate_ttl_cache_key_prefix("dash:soumya:")


@api_router.get("/dashboard/metrics")
def dashboard_metrics(auth: dict = Depends(get_current_user)):
    """Live Supabase-powered dashboard metrics. Support Overview = Chores & Bug only."""
    auth_email = (auth.get("email") or "").strip().lower() or "anon"
    try:
        return _DASH_METRICS_CACHE[auth_email]
    except KeyError:
        pass
    from datetime import timedelta
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    week_start = week_ago.replace(hour=0, minute=0, second=0, microsecond=0)

    # Chores & Bug only for Support Overview
    types_chores_bugs = ["chore", "bug"]
    types_feature = ["feature"]

    # Current month: total Chores & Bug tickets created this month
    try:
        q = supabase.table("tickets").select("id", count="exact").in_("type", types_chores_bugs).gte("created_at", month_start.isoformat())
        r = q.execute()
        all_tickets = r.count or 0
    except Exception:
        all_tickets = 0

    pending_statuses = ["open", "in_progress", "on_hold"]

    def _stage4_completed(t: dict) -> bool:
        return str(t.get("status_4") or "").lower() == "completed"

    def _in_staging(t: dict) -> bool:
        if t.get("staging_planned"):
            return str(t.get("live_review_status") or "").lower() != "completed"
        return False

    def _has_quality_solution(t: dict) -> bool:
        qs = t.get("quality_solution")
        return qs is not None and qs != "" and str(qs).lower() not in ("null", "none")

    # Pending till date: count queries only (target &lt;1s vs loading all tickets).
    pending_till_date = _count_open_queue_tickets(types_chores_bugs)
    total_pending_bug_till_date = _count_open_queue_tickets(types_chores_bugs, ticket_type="bug")
    pending_till_date_exclude_demo_c = _count_open_queue_tickets(types_chores_bugs, demo_c_mode="exclude")
    pending_chores_include_demo_c = _count_open_queue_tickets(types_chores_bugs, demo_c_mode="chore_demo_only")

    # Last week Chores & Bug tickets (for response_delay / completion_delay)
    try:
        q = (
            supabase.table("tickets")
            .select("id, assignee_id, created_at, status_4, actual_4, status, type")
            .in_("type", types_chores_bugs)
            .gte("created_at", week_start.isoformat())
        )
        r = q.execute()
        week_tickets = r.data or []
    except Exception:
        week_tickets = []

    total_last_week = len(week_tickets)
    pending_last_week = sum(1 for t in week_tickets if t.get("status") in pending_statuses)

    # Response delay: Chores & Bug from last week with no assignee (proxy for SLA breach)
    response_delay = sum(1 for t in week_tickets if not t.get("assignee_id"))

    # Completion delay: only when ticket timestamp + 1 day crossed AND Stage 4 completed (took >1 day to complete)
    def _completion_delay_ticket(t: dict) -> bool:
        if not _stage4_completed(t):
            return False
        created = t.get("created_at") or ""
        actual4 = t.get("actual_4") or ""
        if not created or not actual4:
            return False
        try:
            c = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            a = datetime.fromisoformat(str(actual4).replace("Z", "+00:00"))
            if c.tzinfo is None:
                c = c.replace(tzinfo=timezone.utc)
            if a.tzinfo is None:
                a = a.replace(tzinfo=timezone.utc)
            delta_days = (a - c).total_seconds() / 86400
            return delta_days > 1
        except Exception:
            return False
    completion_delay = sum(1 for t in week_tickets if _completion_delay_ticket(t))

    # In Staging: same rules as Support → Staging (GET /tickets?section=staging), not staging_deployments.
    staging_pending_feature = 0
    staging_pending_chores_bugs = 0
    try:

        def _staging_metrics_base():
            b = supabase.table("tickets").select("id", count="exact")
            b = b.or_("staging_planned.not.is.null,status_2.eq.staging")
            b = b.or_("live_review_status.is.null,live_review_status.neq.completed")
            return b

        rf = _staging_metrics_base().eq("type", "feature").execute()
        staging_pending_feature = int(rf.count) if rf.count is not None else len(rf.data or [])
        rcb = _staging_metrics_base().in_("type", ["chore", "bug"]).execute()
        staging_pending_chores_bugs = int(rcb.count) if rcb.count is not None else len(rcb.data or [])
    except Exception:
        pass

    # Feature pending split by Demo C / non Demo C (count queries).
    feature_excluding_demo_c = _count_open_queue_tickets(types_feature, demo_c_mode="exclude")
    feature_with_demo_c = _count_open_queue_tickets(types_feature, demo_c_mode="include")

    # -----------------------------------------------------------------------
    # Custom dashboard fields for specific emails
    # -----------------------------------------------------------------------
    custom_received_monthly = 0
    custom_received_quarterly = 0
    custom_received_half_yearly = 0
    custom_received_yearly = 0
    custom_total_due = 0
    custom_total_due_quarter = 0
    custom_raised_quarter = 0
    custom_raised_all = 0  # Gross raised (all invoices, incl. paid), excludes NA — pairs with Payment card Total Due
    custom_received_in_fy_quarter = 0  # Cash received in current India FY quarter (any invoice)
    custom_pending_delegation = 0

    custom_full_emails = {"ad@ip.com", "ayush@industryprime.com"}
    custom_payment_only_emails = {"ea@industryprime.com"}
    custom_emails = custom_full_emails | custom_payment_only_emails
    if auth_email in custom_emails:
        try:
            from datetime import date as date_cls
            from datetime import timedelta

            today = date_cls.today()
            fy, q = _pa.fy_quarter_key(today)
            q_start, q_end = _pa.quarter_date_bounds(fy, q)
            recv_window_start = today - timedelta(days=365)

            custom_total_due = _sum_unpaid_client_payment_excluding_na()
            pay_rows = _fetch_client_payment_rows_for_metrics()

            receive_by_cp_id: dict[str, dict] = {}
            try:
                rr = (
                    supabase.table("onboarding_client_payment_receive")
                    .select("client_payment_id,amount,payment_date")
                    .limit(5000)
                    .execute()
                )
                for rec in rr.data or []:
                    cid = str(rec.get("client_payment_id") or "").strip()
                    if cid:
                        receive_by_cp_id[cid] = rec
            except Exception as e:
                _log(f"dashboard payment receive rows: {e}")

            for row in pay_rows:
                amt = _parse_invoice_amount(row.get("invoice_amount"))
                is_paid = not _client_payment_row_unpaid(row)
                inv_d = _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))
                is_na = _client_payment_row_marked_na(row)
                if not is_na:
                    custom_raised_all += amt

                if inv_d and q_start <= inv_d <= q_end and not is_na:
                    custom_raised_quarter += amt
                    if not is_paid:
                        custom_total_due_quarter += amt

                if is_paid or is_na:
                    continue

                anchor_d = _client_payment_received_quarter_anchor(row)
                if not anchor_d or not (recv_window_start <= anchor_d <= today):
                    continue

                g = _normalize_client_payment_genre(row.get("genre"))
                if g == "M":
                    custom_received_monthly += amt
                elif g == "Q":
                    custom_received_quarterly += amt
                elif g == "HY":
                    custom_received_half_yearly += amt
                elif g == "Y":
                    custom_received_yearly += amt

            # Align dashboard Payment card totals with Client Payment Overall card (carry-forward logic).
            kpis = _compute_payment_ageing_kpis(pay_rows, None, receive_by_cp_id)
            custom_raised_quarter = int((kpis.get("overall_in_quarter") or {}).get("raised") or custom_raised_quarter)
            custom_received_in_fy_quarter = int((kpis.get("overall_in_quarter") or {}).get("received") or 0)
        except Exception as e:
            _log(f"dashboard payment metrics: {e}")

        if auth_email in custom_full_emails:
            try:
                rdel = (
                    supabase.table("delegation_tasks")
                    .select("id", count="exact")
                    .in_("status", ["pending", "in_progress"])
                    .execute()
                )
                custom_pending_delegation = rdel.count or len(rdel.data or [])
            except Exception:
                custom_pending_delegation = 0

    payload = {
        "all_tickets": all_tickets,
        "pending_till_date": pending_till_date,
        "total_pending_bug_till_date": total_pending_bug_till_date,
        "pending_till_date_exclude_demo_c": pending_till_date_exclude_demo_c,
        "pending_chores_include_demo_c": pending_chores_include_demo_c,
        "feature_excluding_demo_c": feature_excluding_demo_c,
        "feature_with_demo_c": feature_with_demo_c,
        # Custom dashboard (email-specific)
        "custom_received_monthly": custom_received_monthly,
        "custom_received_quarterly": custom_received_quarterly,
        "custom_received_half_yearly": custom_received_half_yearly,
        "custom_received_yearly": custom_received_yearly,
        "custom_total_due": custom_total_due,
        "custom_total_due_quarter": custom_total_due_quarter,
        "custom_raised_quarter": custom_raised_quarter,
        "custom_raised_all": custom_raised_all,
        "custom_received_in_fy_quarter": custom_received_in_fy_quarter,
        "custom_pending_delegation": custom_pending_delegation,
        "response_delay": response_delay,
        "completion_delay": completion_delay,
        "total_last_week": total_last_week,
        "pending_last_week": pending_last_week,
        "staging_pending_feature": staging_pending_feature,
        "staging_pending_chores_bugs": staging_pending_chores_bugs,
    }
    _DASH_METRICS_CACHE[auth_email] = payload
    return payload


@api_router.get("/dashboard/detail")
def dashboard_detail(
    metric: str = Query(
        ...,
        description="total_pending_bug, response_delay, completion_delay, total_last_week, pending_exclude_demo_c, pending_chores_demo_c, feature_exclude_demo_c, feature_with_demo_c, custom_total_rec_amount, custom_total_due, custom_pending_delegation, staging_feature, staging_chores_bugs",
    ),
    auth: dict = Depends(get_current_user),
):
    """Return ticket list for a dashboard metric (clickable card). Same logic as dashboard metrics."""
    auth_email_detail = (auth.get("email") or "").strip().lower()
    custom_full_dashboard_emails = {"ad@ip.com", "ayush@industryprime.com"}
    from datetime import timedelta
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    week_start = week_ago.replace(hour=0, minute=0, second=0, microsecond=0)
    types_cb = ["chore", "bug"]
    types_feature = ["feature"]
    cols = "id, reference_no, title, description, type, status, company_name, company_id, assignee_id, created_at, query_arrival_at, query_response_at, status_4, quality_solution, staging_planned, live_review_status, actual_4"
    result = []
    try:
        q = supabase.table("tickets").select(cols).in_("type", types_cb)
        r = q.execute()
        all_cb = r.data or []
    except Exception:
        all_cb = []
    try:
        qf = supabase.table("tickets").select(cols).in_("type", types_feature)
        rf = qf.execute()
        all_feature = rf.data or []
    except Exception:
        all_feature = []
    try:
        qw = supabase.table("tickets").select(cols).in_("type", types_cb).gte("created_at", week_start.isoformat())
        rw = qw.execute()
        week_tickets = rw.data or []
    except Exception:
        week_tickets = []

    # Resolve company names when company_name is empty (e.g. BU/CH tickets)
    company_ids = {t.get("company_id") for t in all_cb + week_tickets if t.get("company_id")}
    companies_map = {}
    if company_ids:
        try:
            cr = supabase.table("companies").select("id,name").in_("id", list(company_ids)).execute()
            companies_map = {r["id"]: (r.get("name") or "").strip() for r in (cr.data or []) if r.get("id")}
        except Exception:
            pass

    def _stage4_done(t):
        return str(t.get("status_4") or "").lower() == "completed"
    def _in_staging(t):
        if t.get("staging_planned"):
            return str(t.get("live_review_status") or "").lower() != "completed"
        return False
    def _has_quality(t):
        qs = t.get("quality_solution")
        return qs is not None and qs != "" and str(qs).lower() not in ("null", "none")
    def _is_pending_ticket(t):
        return not _in_staging(t) and not _stage4_done(t) and not _has_quality(t)
    def _company_demo_c_t(t):
        cn = (t.get("company_name") or "").strip().lower()
        return cn == "demo_c" or cn == "demo c"
    def _completion_delay_ticket(t):
        if not _stage4_done(t):
            return False
        created = t.get("created_at") or ""
        actual4 = t.get("actual_4") or ""
        if not created or not actual4:
            return False
        try:
            c = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            a = datetime.fromisoformat(str(actual4).replace("Z", "+00:00"))
            if c.tzinfo is None:
                c = c.replace(tzinfo=timezone.utc)
            if a.tzinfo is None:
                a = a.replace(tzinfo=timezone.utc)
            return (a - c).total_seconds() / 86400 > 1
        except Exception:
            return False

    def row(t):
        cn = (t.get("company_name") or "").strip()
        if not cn and t.get("company_id"):
            cn = companies_map.get(t.get("company_id"), "")
        return {
            "id": t.get("id"),
            "referenceNo": (t.get("reference_no") or "").strip() or "N/A",
            "title": (t.get("title") or "").strip(),
            "description": (t.get("description") or "").strip(),
            "type": t.get("type"),
            "company": cn or "Unknown",
            "status": t.get("status") or "",
        }

    if metric == "total_pending_bug":
        result = [row(t) for t in all_cb if _is_pending_ticket(t) and t.get("type") == "bug"]
    elif metric == "response_delay":
        result = [row(t) for t in week_tickets if not t.get("assignee_id")]
    elif metric == "completion_delay":
        result = [row(t) for t in week_tickets if _completion_delay_ticket(t)]
    elif metric == "total_last_week":
        result = [row(t) for t in week_tickets]
    elif metric == "pending_exclude_demo_c":
        result = [row(t) for t in all_cb if _is_pending_ticket(t) and not _company_demo_c_t(t)]
    elif metric == "pending_chores_demo_c":
        result = [row(t) for t in all_cb if _is_pending_ticket(t) and t.get("type") == "chore" and _company_demo_c_t(t)]
    elif metric == "feature_exclude_demo_c":
        result = [row(t) for t in all_feature if _is_pending_ticket(t) and not _company_demo_c_t(t)]
    elif metric == "feature_with_demo_c":
        result = [row(t) for t in all_feature if _is_pending_ticket(t) and _company_demo_c_t(t)]
    elif metric in ("custom_total_rec_amount", "custom_total_due"):
        # Total Due: unpaid open invoices (excl. NA). Received detail: payments with payment date in current India FY quarter.
        from datetime import date as date_cls
        from datetime import timedelta

        today = date_cls.today()
        recv_window_start = today - timedelta(days=365)

        if metric == "custom_total_due":
            try:
                due_q = (
                    supabase.table("onboarding_client_payment")
                    .select(_ocp_list_select_columns())
                    .is_("payment_received_date", "null")
                    .order("timestamp", desc=True)
                    .limit(_LIST_CLIENT_PAYMENT_LIMIT)
                )
                due_q = _ocp_query_exclude_marked_na(due_q)
                pr = due_q.execute()
                pay_rows = pr.data or []
            except Exception:
                pay_rows = []
            _enrich_client_payment_list_items(pay_rows)
            for rowp in pay_rows:
                if not _client_payment_row_unpaid(rowp):
                    continue
                if _client_payment_row_marked_na(rowp):
                    continue
                amt = _parse_invoice_amount(rowp.get("invoice_amount"))
                inv_d = _pa._parse_date(rowp.get("invoice_date")) or _pa._parse_date(rowp.get("timestamp"))
                g = (rowp.get("genre") or "").strip().upper()
                genre_label = {"M": "Monthly", "Q": "Quarterly", "HY": "Half-Yearly", "Y": "Yearly"}.get(g, g or "—")
                company_name = (rowp.get("company_name") or "").strip() or "Unknown"
                reference_no = (rowp.get("reference_no") or "").strip() or str(rowp.get("id") or "N/A")
                result.append(
                    {
                        "id": str(rowp.get("id") or ""),
                        "referenceNo": reference_no,
                        "title": company_name,
                        "description": "",
                        "type": "payment",
                        "company": company_name,
                        "status": rowp.get("status") or "Pending",
                        "invoiceAmount": amt,
                        "invoiceDate": inv_d.isoformat() if inv_d else "",
                        "invoiceNumber": (rowp.get("invoice_number") or "").strip(),
                        "stage": (rowp.get("stage") or "").strip() or "—",
                        "genre": genre_label,
                        "agingDays": int(rowp.get("aging_days") or 0),
                    }
                )
        else:
            fyq, qq = _pa.fy_quarter_key(today)
            qr_start, qr_end = _pa.quarter_date_bounds(fyq, qq)
            recv_by: dict[str, dict] = {}
            pay_rows_recv: list = []
            try:
                rrecv = (
                    supabase.table("onboarding_client_payment_receive")
                    .select("client_payment_id,amount,payment_date")
                    .limit(8000)
                    .execute()
                )
                for xr in rrecv.data or []:
                    xid = str(xr.get("client_payment_id") or "").strip()
                    if xid:
                        recv_by[xid] = xr
                rec_q = (
                    supabase.table("onboarding_client_payment")
                    .select(_ocp_list_select_columns())
                    .not_.is_("payment_received_date", "null")
                    .limit(8000)
                )
                rec_q = _ocp_query_exclude_marked_na(rec_q)
                pr = rec_q.execute()
                pay_rows_recv = pr.data or []
            except Exception as ex:
                _log(f"dashboard_detail custom_total_rec_amount: {ex}")
            for rowp in pay_rows_recv:
                if _client_payment_row_unpaid(rowp):
                    continue
                if _client_payment_row_marked_na(rowp):
                    continue
                cpid = str(rowp.get("id") or "").strip()
                rrow = recv_by.get(cpid) if cpid else None
                pay_d = _pa._parse_date((rrow or {}).get("payment_date")) or _pa._parse_date(
                    rowp.get("payment_received_date")
                )
                if not pay_d or pay_d < qr_start or pay_d > qr_end:
                    continue
                amt = _parse_invoice_amount(rowp.get("invoice_amount"))
                g_raw = _normalize_client_payment_genre(rowp.get("genre"))
                genre_label = (
                    {"M": "Monthly", "Q": "Quarterly", "HY": "Half-Yearly", "Y": "Yearly"}.get(
                        g_raw, (rowp.get("genre") or "—").strip() or "—"
                    )
                )
                inv_d = _pa._parse_date(rowp.get("invoice_date")) or _pa._parse_date(rowp.get("timestamp"))
                company_name = (rowp.get("company_name") or "").strip() or "Unknown"
                reference_no = (rowp.get("reference_no") or "").strip() or str(rowp.get("id") or "N/A")
                result.append(
                    {
                        "id": str(rowp.get("id") or ""),
                        "referenceNo": reference_no,
                        "title": company_name,
                        "description": f"Genre: {genre_label} | Amount: ₹{amt} | Payment date: {pay_d.isoformat()}",
                        "type": "payment",
                        "company": company_name,
                        "status": "Received",
                        "invoiceAmount": amt,
                        "invoiceDate": inv_d.isoformat() if inv_d else "",
                        "invoiceNumber": (rowp.get("invoice_number") or "").strip(),
                        "stage": (rowp.get("stage") or "—").strip() or "—",
                        "genre": str(genre_label),
                        "agingDays": None,
                    }
                )
    elif metric in ("staging_feature", "staging_chores_bugs"):
        try:
            stq = supabase.table("tickets").select(cols)
            stq = stq.or_("staging_planned.not.is.null,status_2.eq.staging")
            stq = stq.or_("live_review_status.is.null,live_review_status.neq.completed")
            stq = stq.limit(500)
            r2 = stq.execute()
            staging_tickets = r2.data or []
            extra_cids = {
                t.get("company_id") for t in staging_tickets if t.get("company_id") and t.get("company_id") not in companies_map
            }
            if extra_cids:
                try:
                    cr2 = supabase.table("companies").select("id,name").in_("id", list(extra_cids)).execute()
                    for rc in cr2.data or []:
                        if rc.get("id"):
                            companies_map[rc["id"]] = (rc.get("name") or "").strip()
                except Exception:
                    pass
            if metric == "staging_feature":
                result = [row(t) for t in staging_tickets if t.get("type") == "feature"]
            else:
                result = [row(t) for t in staging_tickets if t.get("type") in ("chore", "bug")]
        except Exception:
            pass
    elif metric == "custom_pending_delegation":
        if auth_email_detail not in custom_full_dashboard_emails:
            raise HTTPException(403, "Not available for this user")
        # Delegation pending tasks (all users)
        try:
            r = (
                supabase.table("delegation_tasks")
                .select("id, reference_no, title, status, due_date, delegation_on")
                .in_("status", ["pending", "in_progress"])
                .order("delegation_on", desc=True)
                .limit(200)
                .execute()
            )
            rows = r.data or []
        except Exception:
            rows = []

        for t in rows:
            reference_no = (t.get("reference_no") or "").strip() or str(t.get("id") or "N/A")
            due = t.get("due_date") or t.get("delegation_on") or ""
            delegation_on = t.get("delegation_on") or ""
            due_str = str(due).split("T")[0] if due else ""
            title = (t.get("title") or "").strip() or "Delegation Task"
            result.append(
                {
                    "id": str(t.get("id") or ""),
                    "referenceNo": reference_no,
                    "title": title,
                    "description": f"Due: {due_str or '—'}",
                    "type": "delegation",
                    "company": "—",
                    "status": t.get("status") or "",
                    "delegationOn": delegation_on,
                }
            )
    return {"success": True, "metric": metric, "tickets": result, "total": len(result)}


# ---------- Dashboard KPI (Shreyasi / Rimpa – Checklist, Delegation, Support FMS from DB) ----------
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _dashboard_kpi_resolve_user_id(name: str) -> str | None:
    """Resolve display name (e.g. Shreyasi, Rimpa) to user_profiles.id. Case-insensitive partial match on full_name."""
    if not name or not name.strip():
        return None
    try:
        safe_name = _sanitize_ilike_input(name, max_len=80)
        if not safe_name:
            return None
        r = supabase.table("user_profiles").select("id").ilike("full_name", f"%{safe_name}%").limit(1).execute()
        if r.data and len(r.data) > 0:
            return r.data[0].get("id")
    except Exception as e:
        _log(f"dashboard/kpi resolve user: {e}")
    return None


def _delegation_task_done(t: dict) -> bool:
    """True if delegation task counts as completed for KPI %."""
    st = str(t.get("status") or "").lower().strip()
    if st in ("completed", "complete"):
        return True
    return bool(t.get("completed_at"))


def _delegation_task_cancelled(t: dict) -> bool:
    """Cancelled tasks are excluded from KPI dashboard lists and %."""
    st = str(t.get("status") or "").lower().strip()
    return st in ("cancelled", "cancel", "canceled")


def _parse_kpi_week_num(week_str: str | None, default: int = 2) -> int:
    week_num = default
    if week_str and "week" in week_str.lower():
        m = re.search(r"(\d+)", week_str)
        if m:
            try:
                week_num = int(m.group(1))
            except Exception:
                week_num = default
    return max(1, min(8, week_num))


def _week_of_month(dt: datetime) -> int:
    """Week of calendar month bucket (Monday–Sunday merge across boundaries). Matches KPI Dashboard."""
    return _week_of_month_kpi_date(dt.date())


def _week_of_month_kpi_date(d: date) -> int:
    """KPI week index (Monday–Sunday slot) relative to calendar month boundary merge rules."""
    return week_of_month_for_date(d)


def _dashboard_kpi_week_range(year: int, month_num: int, week_str: str) -> tuple[date, date] | None:
    """Full Monday–Sunday KPI week range; same range for bridged adjacent-month week slots."""
    try:
        wn = max(
            1,
            min(
                _parse_kpi_week_num(week_str, default=2),
                kpi_max_week_index_in_month(year, month_num),
            ),
        )
        return get_kpi_calendar_week_range(year, month_num, wn)
    except Exception:
        return None


def _normalize_query_arrival_iso(ts) -> str:
    """Return ISO timestamp for Query Arrival display; preserve timezone (e.g. Z) so frontend shows correct local time."""
    if ts is None or ts == "":
        return ""
    s = str(ts).strip()
    if not s:
        return ""
    return s


def _parse_iso_to_date(value) -> date | None:
    try:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, str):
            if "T" in value or " " in value:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
            return date.fromisoformat(value[:10])
    except Exception:
        return None


def _dashboard_kpi_is_akash(name: str | None) -> bool:
    return "akash" in (name or "").strip().lower()


def _dashboard_kpi_has_success_kpi(name: str | None) -> bool:
    """Rimpa dashboard: Success / Performance Monitoring KPI module (global counts)."""
    return (name or "").strip().lower() == "rimpa"


_ADRIJA_SOCIAL_KPI_EDITOR_EMAILS = frozenset({"adrija@industryprime.com", "aman@industryprime.com"})


def _adrija_social_kpi_editor(email: str | None) -> bool:
    return (email or "").strip().lower() in _ADRIJA_SOCIAL_KPI_EDITOR_EMAILS


def _adrija_social_kpi_bit(v: int) -> int:
    return 1 if int(v) != 0 else 0


def _fetch_adrija_social_kpi_day_map(d_start: date, d_end: date) -> dict[date, dict]:
    """work_date -> {post,reel,linkedin,post_task_name,reel_task_name,linkedin_task_name}."""
    out: dict[date, dict] = {}
    try:
        sr = (
            supabase.table("onboarding_adrija_social_kpi_day")
            .select("work_date,post,reel,linkedin,post_task_name,reel_task_name,linkedin_task_name")
            .gte("work_date", d_start.isoformat())
            .lte("work_date", d_end.isoformat())
            .execute()
        )
        for r in sr.data or []:
            raw = r.get("work_date")
            if not raw:
                continue
            wd = date.fromisoformat(str(raw)[:10])
            out[wd] = {
                "post": _adrija_social_kpi_bit(r.get("post")),
                "reel": _adrija_social_kpi_bit(r.get("reel")),
                "linkedin": _adrija_social_kpi_bit(r.get("linkedin")),
                "post_task_name": (r.get("post_task_name") or "").strip(),
                "reel_task_name": (r.get("reel_task_name") or "").strip(),
                "linkedin_task_name": (r.get("linkedin_task_name") or "").strip(),
            }
    except Exception as e:
        _log(f"_fetch_adrija_social_kpi_day_map: {e}")
    return out


def _tickets_arrival_within_range(tickets: list, rs: date, re: date) -> list:
    """Tickets whose query_arrival (or created_at) date falls in ``[rs, re]`` (inclusive)."""
    out: list = []
    for t in tickets:
        da = _parse_iso_to_date(t.get("query_arrival_at") or t.get("created_at"))
        if da is not None and rs <= da <= re:
            out.append(t)
    return out


def _akash_stage4_or_quality_done(t: dict) -> bool:
    if str(t.get("status_4") or "").lower() == "completed":
        return True
    qs = t.get("quality_solution")
    if qs is None:
        return False
    s = str(qs).strip().lower()
    return s not in ("", "null", "none")


def _akash_avg_response_minutes(tickets: list) -> float | None:
    vals: list[float] = []
    for t in tickets:
        qa = t.get("query_arrival_at") or t.get("created_at")
        qr = t.get("query_response_at")
        if not qa or not qr:
            continue
        try:
            a = datetime.fromisoformat(str(qa).replace("Z", "+00:00"))
            r = datetime.fromisoformat(str(qr).replace("Z", "+00:00"))
            if a.tzinfo is None:
                a = a.replace(tzinfo=timezone.utc)
            if r.tzinfo is None:
                r = r.replace(tzinfo=timezone.utc)
            vals.append((r - a).total_seconds() / 60.0)
        except Exception:
            continue
    if not vals:
        return None
    return sum(vals) / len(vals)


def _akash_support_detail_row(ticket: dict, month_display: str, delay_note: str | None = None) -> dict:
    """Row shape compatible with KPI detail modal; includes ticket_status for Support-style list."""
    created = ticket.get("created_at") or ""
    ref = (ticket.get("reference_no") or "").strip() or "N/A"
    company_val = (ticket.get("company_name") or "").strip() or "—"
    q_arr = ticket.get("query_arrival_at") or created
    has_resp, resp_text = _has_response_delay(q_arr, ticket.get("query_response_at"))
    st = (ticket.get("status") or "").strip() or "—"
    if delay_note is not None:
        note = delay_note
    else:
        note = resp_text if has_resp else "—"
    return {
        "type": (ticket.get("type") or "Chore").title(),
        "company": company_val,
        "requested_person": "",
        "submitted_by": (ticket.get("user_name") or "").strip() or "—",
        "title": (ticket.get("title") or "").strip() or "—",
        "description": (ticket.get("description") or "").strip() or "",
        "reference_no": ref,
        "query_arrival": _normalize_query_arrival_iso(q_arr),
        "month": month_display,
        "delay_time": note or "—",
        "ticket_status": st,
    }


_AKASH_KPI_DAILY_LOG_EMAILS = frozenset({"akash@industryprime.com", "aman@industryprime.com"})


def _kpi_daily_log_email_allowed(email: str | None) -> bool:
    return (email or "").strip().lower() in _AKASH_KPI_DAILY_LOG_EMAILS


def _kpi_daily_work_log_owner_user_id() -> str | None:
    """Profile id that owns `kpi_daily_work_log` rows — same as dashboard KPI for name=Akash.

    Bulk SQL and the Akash dashboard aggregate use this user_id. Editors (akash@ / aman@) share one log.
    """
    return _dashboard_kpi_resolve_user_id("Akash")


# Akash KPI weekly targets (fixed counts — not tied to support ticket volume)
_AKASH_KPI_TARGET_BULK_UPLOAD = 5
_AKASH_KPI_TARGET_VIDEO = 1
_AKASH_KPI_TARGET_ITEM_CLEANING_DAYS = 1
_AKASH_KPI_TARGET_AI_DAYS = 1


def _akash_kpi_weekly_count_score(count: int, target: int) -> int:
    """Map weekly count to 0–100; at or above target → 100%."""
    t = max(1, int(target))
    c = max(0, int(count or 0))
    if c <= 0:
        return 0
    return max(0, min(100, round(100.0 * c / float(t))))


def _count_weekdays_in_kpi_range(a: date, b: date) -> int:
    n = 0
    d = a
    while d <= b:
        if d.weekday() != 6:
            n += 1
        d += timedelta(days=1)
    return max(1, n)


def _aggregate_kpi_daily_log_for_week(rows: list, range_start: date, range_end: date) -> dict:
    """Aggregate `kpi_daily_work_log` rows whose work_date falls in [range_start, range_end]."""
    empty: dict = {
        "has_rows": False,
        "has_item_cleaning": False,
        "items_cleaned": 0,
        "errors_found": 0.0,
        "accuracy_values": [],
        "videos_created": 0,
        "video_types": [],
        "bulk_upload_tickets": 0,
        "ai_tasks_used": 0,
        "process_improved": 0,
        "cleaning_score": 0,
        "video_score": 0,
        "bulk_upload_score": 0,
        "ai_score": 0,
    }
    if not rows:
        return empty
    in_week: list = []
    for r in rows:
        wd_raw = r.get("work_date")
        if not wd_raw:
            continue
        try:
            d = date.fromisoformat(str(wd_raw)[:10])
        except Exception:
            continue
        if range_start <= d <= range_end:
            in_week.append(r)
    if not in_week:
        return empty
    out = {**empty, "has_rows": True}
    acc_vals: list[float] = []
    vtypes: list[str] = []
    item_cleaning_days = 0
    ai_learning_days = 0
    for r in in_week:
        row_item = False
        if r.get("items_cleaned") is not None:
            out["items_cleaned"] += int(r.get("items_cleaned") or 0)
            out["has_item_cleaning"] = True
            row_item = True
        if r.get("errors_found") is not None and str(r.get("errors_found")).strip() != "":
            try:
                out["errors_found"] += float(r.get("errors_found"))
            except (TypeError, ValueError):
                pass
            out["has_item_cleaning"] = True
            row_item = True
        ap = r.get("accuracy_pct")
        if ap is not None and str(ap).strip() != "":
            try:
                acc_vals.append(float(ap))
            except (TypeError, ValueError):
                pass
            out["has_item_cleaning"] = True
            row_item = True
        if row_item:
            item_cleaning_days += 1
        if r.get("videos_created") is not None:
            out["videos_created"] += int(r.get("videos_created") or 0)
        if r.get("bulk_upload_tickets") is not None:
            out["bulk_upload_tickets"] += int(r.get("bulk_upload_tickets") or 0)
        vt = (r.get("video_type") or "").strip()
        if vt:
            vtypes.append(vt)
        row_ai = False
        if r.get("ai_tasks_used") is not None:
            out["ai_tasks_used"] += int(r.get("ai_tasks_used") or 0)
            if int(r.get("ai_tasks_used") or 0) > 0:
                row_ai = True
        if r.get("process_improved") is not None:
            out["process_improved"] += int(r.get("process_improved") or 0)
            if int(r.get("process_improved") or 0) > 0:
                row_ai = True
        if row_ai:
            ai_learning_days += 1
    out["accuracy_values"] = acc_vals
    out["video_types"] = vtypes
    out["item_cleaning_days"] = item_cleaning_days
    out["ai_learning_days"] = ai_learning_days
    if out["has_item_cleaning"]:
        out["cleaning_score"] = _akash_kpi_weekly_count_score(
            item_cleaning_days, _AKASH_KPI_TARGET_ITEM_CLEANING_DAYS
        )
    video_count = int(out["videos_created"] or 0)
    if video_count <= 0 and vtypes:
        video_count = 1
    if video_count > 0:
        out["video_score"] = _akash_kpi_weekly_count_score(
            video_count, _AKASH_KPI_TARGET_VIDEO
        )
    if out["bulk_upload_tickets"] > 0:
        out["bulk_upload_score"] = _akash_kpi_weekly_count_score(
            out["bulk_upload_tickets"], _AKASH_KPI_TARGET_BULK_UPLOAD
        )
    if ai_learning_days > 0:
        out["ai_score"] = _akash_kpi_weekly_count_score(
            ai_learning_days, _AKASH_KPI_TARGET_AI_DAYS
        )
    return out


def _build_akash_kpi_payload(
    checklist_weekly_pct: int,
    checklist_done: int,
    checklist_pending: int,
    customer_support_bundle: dict,
    daily_week: dict | None,
) -> dict:
    """Akash Dashboard — five KPI pillars at 20% each (100% total)."""
    raw_weights = {
        "item_cleaning": 20,
        "customer_support": 20,
        "bulk_upload": 20,
        "video_content": 20,
        "ai_learning": 20,
    }
    wsum = sum(raw_weights.values()) or 1
    norm = {k: round(100 * v / wsum) for k, v in raw_weights.items()}
    cs = customer_support_bundle or {}
    cs_score = int(cs.get("score_percent") or 0)
    cs_score_filter_week = int(cs.get("score_percent_filter_week", cs_score))
    total_issues = int(cs.get("total_issues") or 0)
    rd_ct = int(cs.get("response_delay_count") or 0)
    cd_ct = int(cs.get("completion_delay_count") or 0)
    pend_ct = int(cs.get("pending_count") or 0)
    resp_line = str(cs.get("response_time_display") or "—")
    dw = daily_week or {}
    has_daily = bool(dw.get("has_rows"))
    has_item = bool(dw.get("has_item_cleaning"))
    item_score_daily = int(dw.get("cleaning_score") or 0)
    video_pct = int(dw.get("video_score") or 0)
    bulk_sum = int(dw.get("bulk_upload_tickets") or 0)
    bulk_pct = int(dw.get("bulk_upload_score") or 0)
    if bulk_sum > 0 and bulk_pct <= 0:
        bulk_pct = _akash_kpi_weekly_count_score(bulk_sum, _AKASH_KPI_TARGET_BULK_UPLOAD)
    bulk_target = _AKASH_KPI_TARGET_BULK_UPLOAD
    ai_pct = int(dw.get("ai_score") or 0)
    item_for_overall = item_score_daily if has_item else checklist_weekly_pct
    overall = round(
        (
            item_for_overall * raw_weights["item_cleaning"]
            + cs_score_filter_week * raw_weights["customer_support"]
            + bulk_pct * raw_weights["bulk_upload"]
            + video_pct * raw_weights["video_content"]
            + ai_pct * raw_weights["ai_learning"]
        )
        / wsum
    )
    if has_item:
        acc_vals = dw.get("accuracy_values") or []
        if acc_vals:
            accuracy_line = f"{round(sum(acc_vals) / len(acc_vals), 1)}%"
        elif dw.get("items_cleaned", 0) > 0:
            er = float(dw.get("errors_found") or 0)
            ic = float(dw.get("items_cleaned") or 1)
            accuracy_line = f"{round(100.0 * max(0.0, 1.0 - min(1.0, er / ic)), 1)}%"
        else:
            accuracy_line = f"{checklist_weekly_pct}%"
        item_metrics = [
            {"label": "Items Cleaned (daily log)", "value": str(int(dw.get("items_cleaned") or 0))},
            {"label": "Errors Found (daily log)", "value": str(dw.get("errors_found") or 0)},
            {"label": "Accuracy % ≥ 98%", "value": accuracy_line},
            {"label": "Weekly target (days logged)", "value": str(_AKASH_KPI_TARGET_ITEM_CLEANING_DAYS)},
        ]
        item_score_show = item_score_daily
    else:
        accuracy_line = f"{checklist_weekly_pct}%"
        item_metrics = [
            {"label": "Items Cleaned", "value": str(checklist_done)},
            {"label": "Errors Found", "value": str(checklist_pending)},
            {"label": "Accuracy % ≥ 98%", "value": accuracy_line},
        ]
        item_score_show = checklist_weekly_pct
    vtypes = dw.get("video_types") or []
    vt_display = ", ".join(vtypes) if vtypes else "—"
    video_metrics = [
        {"label": "Videos Created", "value": str(int(dw.get("videos_created") or 0))},
        {"label": "Video Type", "value": vt_display},
        {"label": "Weekly target", "value": str(_AKASH_KPI_TARGET_VIDEO)},
    ]
    bulk_metrics = [
        {"label": "Bulk upload tickets", "value": str(bulk_sum)},
        {"label": "Weekly target", "value": str(bulk_target)},
    ]
    ai_metrics = [
        {"label": "AI Tasks Used", "value": str(int(dw.get("ai_tasks_used") or 0))},
        {"label": "Process Improved", "value": str(int(dw.get("process_improved") or 0))},
        {"label": "Weekly target (days logged)", "value": str(_AKASH_KPI_TARGET_AI_DAYS)},
    ]
    pillars = [
        {
            "key": "item_cleaning",
            "title": "ITEM CLEANING",
            "weight": raw_weights["item_cleaning"],
            "weight_percent_display": norm["item_cleaning"],
            "score_percent": item_score_show,
            "metrics": item_metrics,
        },
        {
            "key": "customer_support",
            "title": "CUSTOMER SUPPORT",
            "weight": raw_weights["customer_support"],
            "weight_percent_display": norm["customer_support"],
            "score_percent": cs_score,
            "metrics": [
                {"label": "Response delays", "value": str(rd_ct)},
                {"label": "Completion delays", "value": str(cd_ct)},
                {"label": "Pending", "value": str(pend_ct)},
                {"label": "Avg response (min)", "value": resp_line},
            ],
        },
        {
            "key": "bulk_upload",
            "title": "BULK UPLOAD",
            "weight": raw_weights["bulk_upload"],
            "weight_percent_display": norm["bulk_upload"],
            "score_percent": bulk_pct,
            "metrics": bulk_metrics,
        },
        {
            "key": "video_content",
            "title": "VIDEO CONTENT",
            "weight": raw_weights["video_content"],
            "weight_percent_display": norm["video_content"],
            "score_percent": video_pct,
            "metrics": video_metrics,
        },
        {
            "key": "ai_learning",
            "title": "AI LEARNING",
            "weight": raw_weights["ai_learning"],
            "weight_percent_display": norm["ai_learning"],
            "score_percent": ai_pct,
            "metrics": ai_metrics,
        },
    ]
    out = {
        "weights_raw": raw_weights,
        "weights_normalized_100": norm,
        "weight_sum_raw": wsum,
        "overall_score_percent": overall,
        "pillars": pillars,
        "dailyLogWeekApplied": has_daily,
        "bulkUpload": {
            "ticketsLogged": bulk_sum,
            "weeklyTarget": bulk_target,
            "scorePercent": bulk_pct,
        },
    }
    if cs:
        out["customerSupport"] = {
            "scorePercent": cs.get("score_percent", 0),
            "scorePercentFilterWeek": cs.get("score_percent_filter_week", 0),
            "totalIssues": cs.get("total_issues", 0),
            "responseDelayCount": cs.get("response_delay_count", 0),
            "completionDelayCount": cs.get("completion_delay_count", 0),
            "pendingCount": cs.get("pending_count", 0),
            "responseTimeDisplay": cs.get("response_time_display", "—"),
            "meta": cs.get("meta") or {},
            "detailsResponseDelay": cs.get("details_response_delay") or [],
            "detailsCompletionDelay": cs.get("details_completion_delay") or [],
            "detailsPending": cs.get("details_pending") or [],
        }
    return out


@api_router.get("/dashboard/soumya-kpi")
def dashboard_soumya_kpi(
    month: str = Query("Feb", description="Month: Jan..Dec"),
    year: str = Query("2026", description="Year"),
    week: str = Query("week 1", description="KPI week 1..5"),
    ranked_offset: int = Query(0, ge=0),
    ranked_limit: int = Query(25, ge=1, le=100),
    leaderboard_scope: str = Query(
        "week",
        description="Delay leaderboard: week = Stage 2 completed in selected KPI week; all = all Stage 2 completed (excl. Demo C)",
    ),
    auth: dict = Depends(get_current_user),
):
    """Soumya Dashboard — week-based KPI (Support chores/bugs, excludes Demo C)."""
    from app.section_permissions_util import require_dashboard_kpi_person

    require_dashboard_kpi_person(auth["id"], "Soumya")
    return _dashboard_soumya_kpi_data(
        month=month,
        year=year,
        week=week,
        ranked_offset=ranked_offset,
        ranked_limit=ranked_limit,
        leaderboard_scope=leaderboard_scope,
    )


@cached(ttl=300, key_prefix="dash:soumya:")
def _dashboard_soumya_kpi_data(
    month: str,
    year: str,
    week: str,
    ranked_offset: int,
    ranked_limit: int,
    leaderboard_scope: str,
):
    from app.soumya_dashboard_kpi import compute_soumya_dashboard

    return compute_soumya_dashboard(
        month,
        year,
        week,
        leaderboard_scope=leaderboard_scope,
        ranked_offset=ranked_offset,
        ranked_limit=ranked_limit,
    )


@api_router.api_route("/cron/soumya-sla-scan", methods=["GET", "POST"])
async def cron_soumya_sla_scan(
    request: Request,
    auth: dict | None = Depends(get_current_user_optional),
):
    """Hourly cron: refresh Soumya SLA weekly snapshot and list 72hr+ breaches."""
    from app.cron_email_routes import _cron_authorized
    from app.soumya_dashboard_kpi import run_soumya_sla_hourly_scan

    is_cron = _cron_authorized(request)
    is_admin = bool(auth and _get_role_from_profile(auth["id"]) in ("admin", "master_admin"))
    if not is_cron and not is_admin:
        raise HTTPException(status_code=401, detail="Use X-Cron-Secret or Admin login.")
    return run_soumya_sla_hourly_scan()


def _souvik_kpi_can_edit(user_id: str, email: str | None) -> bool:
    """Edit gate for Souvik daily entry: master_admin/admin or explicit can_edit grant."""
    try:
        if _get_role_from_profile(user_id) in ("admin", "master_admin"):
            return True
    except Exception:
        pass
    from app.section_permissions_util import can_view_section

    try:
        return can_view_section(user_id, "dashboard_kpi_person_souvik", need_edit=True)
    except Exception:
        return False


@api_router.get("/dashboard/souvik-kpi")
def dashboard_souvik_kpi(
    week_start: str | None = Query(None, description="Monday of the week (YYYY-MM-DD)."),
    auth: dict = Depends(get_current_user),
):
    """Souvik EA KPI — Daily Entry for one week (Mon–Sat) + composite score."""
    from app.section_permissions_util import require_dashboard_kpi_person
    from app.souvik_dashboard_kpi import compute_souvik_week, parse_week_start

    require_dashboard_kpi_person(auth["id"], "Souvik")
    ws = parse_week_start(week_start)
    data = compute_souvik_week(ws)
    data["can_edit"] = _souvik_kpi_can_edit(auth["id"], auth.get("email"))
    return data


@api_router.get("/dashboard/souvik-kpi/weekly-log")
def dashboard_souvik_kpi_weekly_log(
    start: str | None = Query(None, description="First Monday (YYYY-MM-DD)."),
    weeks: int = Query(52, ge=1, le=104),
    auth: dict = Depends(get_current_user),
):
    """Souvik EA KPI — Weekly Log (composite history)."""
    from app.section_permissions_util import require_dashboard_kpi_person
    from app.souvik_dashboard_kpi import get_souvik_weekly_log, parse_week_start

    require_dashboard_kpi_person(auth["id"], "Souvik")
    first_monday = parse_week_start(start)
    return get_souvik_weekly_log(first_monday, weeks)


@api_router.get("/dashboard/souvik-kpi/reference")
def dashboard_souvik_kpi_reference(auth: dict = Depends(get_current_user)):
    """Souvik EA KPI — KPI Reference (scoring criteria & data sources)."""
    from app.section_permissions_util import require_dashboard_kpi_person
    from app.souvik_dashboard_kpi import get_souvik_reference

    require_dashboard_kpi_person(auth["id"], "Souvik")
    return get_souvik_reference()


@api_router.put("/dashboard/souvik-kpi/daily")
def put_dashboard_souvik_kpi_daily(
    body: SouvikKpiDailyBatchBody,
    auth: dict = Depends(get_current_user),
):
    """Upsert Souvik daily KPI scores. Requires can_edit on the Souvik dashboard."""
    from app.section_permissions_util import require_dashboard_kpi_person
    from app.souvik_dashboard_kpi import upsert_souvik_daily

    require_dashboard_kpi_person(auth["id"], "Souvik")
    if not _souvik_kpi_can_edit(auth["id"], auth.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed to edit Souvik KPI")
    if len(body.rows) > 100:
        raise HTTPException(status_code=400, detail="Too many rows in one batch")
    try:
        saved = upsert_souvik_daily(
            [r.model_dump() for r in body.rows], created_by=auth["id"]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _log(f"put_dashboard_souvik_kpi_daily: {e}")
        raise HTTPException(status_code=502, detail=str(e)[:400])
    return {"ok": True, "saved": saved}


@api_router.get("/dashboard/kpi")
def dashboard_kpi(
    name: str = Query(..., description="Person name: Shreyasi, Rimpa, Akash, Adrija, Soumya, etc."),
    month: str = Query("Feb", description="Month: Jan..Dec"),
    year: str = Query("2026", description="Year"),
    week: str = Query("week 2", description="Week: week 1..week 5"),
    auth: dict = Depends(get_current_user),
):
    """KPI data for Checklist, Delegation, Support FMS from DB. No hardcoded data; no Attendance."""
    from app.section_permissions_util import require_dashboard_kpi_person

    require_dashboard_kpi_person(auth["id"], name)
    viewer_email = (auth.get("email") or "").strip()
    return _dashboard_kpi_data(
        name=name, month=month, year=year, week=week, viewer_email=viewer_email
    )


_SUPPORT_FMS_DETAIL_PILLARS = frozenset({"response_delay", "completion_delay", "pending"})


@api_router.get("/dashboard/kpi/support-fms-details")
def dashboard_kpi_support_fms_details(
    name: str = Query(..., description="Person name (Support FMS: Shreyasi)"),
    month: str = Query("Feb"),
    year: str = Query("2026"),
    week: str = Query("week 2"),
    pillar: str = Query(..., description="response_delay | completion_delay | pending"),
    auth: dict = Depends(get_current_user),
):
    """Lazy-load Support FMS modal rows for one pillar (avoids huge /dashboard/kpi payloads)."""
    from app.section_permissions_util import require_dashboard_kpi_person

    require_dashboard_kpi_person(auth["id"], name)
    pillar_key = (pillar or "").strip().lower()
    if pillar_key not in _SUPPORT_FMS_DETAIL_PILLARS:
        raise HTTPException(
            status_code=400,
            detail="pillar must be response_delay, completion_delay, or pending",
        )
    if _dashboard_kpi_is_akash(name):
        return {"success": True, "pillar": pillar_key, "items": []}
    try:
        month_num = 1
        for i, m in enumerate(_MONTH_NAMES, 1):
            if m.lower() == (month or "").strip().lower():
                month_num = i
                break
        try:
            y = int(year or datetime.now().year)
        except Exception:
            y = datetime.now().year
        range_week = _dashboard_kpi_week_range(y, month_num, week or "week 2")
        if not range_week:
            import calendar

            range_start = date(y, month_num, 1)
            _, last = calendar.monthrange(y, month_num)
            range_end = date(y, month_num, last)
        else:
            range_start, range_end = range_week
        import calendar

        _, last_day = calendar.monthrange(y, month_num)
        month_start = date(y, month_num, 1)
        month_end = date(y, month_num, last_day)
        tickets = _fetch_kpi_chore_bug_tickets(month_start, month_end)
        week_tickets, stage2_completed = _support_fms_week_slices(tickets, range_start, range_end)
        _enrich_kpi_ticket_slices(week_tickets, stage2_completed)
        items = _support_fms_detail_items_for_pillar(
            week_tickets, stage2_completed, pillar_key, month
        )
        return {"success": True, "pillar": pillar_key, "items": items}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"dashboard/kpi support-fms-details: {e}")
        return {"success": False, "pillar": pillar_key, "items": [], "error": str(e)[:200]}


@cached(ttl=300, key_prefix="dash:")
def _dashboard_kpi_data(
    name: str,
    month: str,
    year: str,
    week: str,
    viewer_email: str = "",
):
    """Cached KPI payload (auth enforced on dashboard_kpi wrapper)."""
    try:
        user_id = _dashboard_kpi_resolve_user_id(name)
        if not user_id:
            return {"success": False, "error": f"User not found for name: {name!r}"}

        is_akash = _dashboard_kpi_is_akash(name)

        month_num = 1
        for i, m in enumerate(_MONTH_NAMES, 1):
            if m.lower() == (month or "").strip().lower():
                month_num = i
                break
        try:
            y = int(year or datetime.now().year)
        except Exception:
            y = datetime.now().year

        max_week_index = kpi_max_week_index_in_month(y, month_num)
        range_week = _dashboard_kpi_week_range(y, month_num, week or "week 2")
        if not range_week:
            import calendar

            range_start = date(y, month_num, 1)
            _, last = calendar.monthrange(y, month_num)
            range_end = date(y, month_num, last)
        else:
            range_start, range_end = range_week

        week_calendar_meta = build_week_merge_meta(y, month_num, range_start, range_end)
        merged_week_key = merged_week_key_from_range(range_start, range_end)

        # Month range for monthly percentages
        import calendar
        _, last_day = calendar.monthrange(y, month_num)
        month_start = date(y, month_num, 1)
        month_end = date(y, month_num, last_day)

        adrija_social_kpi = None

        holidays_yr = _get_holidays_for_year(y)
        is_holiday = lambda d, h=holidays_yr: d in h

        # ----- Checklist -----
        checklist_rows = []
        checklist_weekly_pct = 0
        checklist_monthly_pct = 0
        tasks = []
        task_ids: list = []
        comp_month: dict = {}
        try:
            from app.checklist_utils import get_occurrence_dates_in_range
            q = supabase.table("checklist_tasks").select(
                "id,start_date,frequency,task_name,doer_id,na_from_date,marked_na"
            ).eq("doer_id", user_id)
            r = q.execute()
            tasks = r.data or []
            task_ids = [t["id"] for t in tasks]
            comp_week = {}
            comp_month = {}
            na_month: set[tuple[str, str]] = set()
            if task_ids:
                cr2 = supabase.table("checklist_completions").select("task_id, occurrence_date, completed_at")
                cr2 = cr2.gte("occurrence_date", month_start.isoformat()).lte("occurrence_date", month_end.isoformat())
                cr2 = cr2.in_("task_id", task_ids)
                for row in (cr2.execute().data or []):
                    comp_month[(row["task_id"], row["occurrence_date"])] = row.get("completed_at")
                for (tid, od), val in comp_month.items():
                    if range_start.isoformat() <= od <= range_end.isoformat():
                        comp_week[(tid, od)] = val
                na_month = _fetch_checklist_na_pairs(task_ids, month_start, month_end)
            occ_week = []
            occ_month = []
            for task in tasks:
                if _checklist_row_marked_na(task):
                    continue
                t_id = task["id"]
                start = task.get("start_date")
                if isinstance(start, str):
                    start = date.fromisoformat(start)
                freq = task.get("frequency", "D")
                dates_week = get_occurrence_dates_in_range(start, freq, range_start, range_end, is_holiday)
                dates_month = get_occurrence_dates_in_range(start, freq, month_start, month_end, is_holiday)
                for d in dates_week:
                    if (str(t_id), d.isoformat()) not in na_month:
                        occ_week.append((t_id, d, task.get("task_name"), task.get("frequency", "")))
                for d in dates_month:
                    if (str(t_id), d.isoformat()) not in na_month:
                        occ_month.append((t_id, d))
            done_week = sum(1 for (tid, d, _, _) in occ_week if comp_week.get((tid, d.isoformat())))
            total_week = len(occ_week)
            checklist_weekly_pct = round((done_week / total_week) * 100) if total_week else 0
            done_month = sum(1 for (tid, d) in occ_month if comp_month.get((tid, d.isoformat())))
            total_month = len(occ_month)
            checklist_monthly_pct = round((done_month / total_month) * 100) if total_month else 0
            for (t_id, d, tname, freq) in occ_week:
                completed = comp_week.get((t_id, d.isoformat()))
                checklist_rows.append({
                    "task_name": tname,
                    "frequency": freq or "",
                    "status": "Done" if completed else "Pending",
                    "details": "Done" if completed else "Pending",
                })
        except Exception as e:
            _log(f"dashboard/kpi checklist: {e}")

        # ----- Delegation -----
        delegation_rows = []
        delegation_weekly_pct = 0
        delegation_monthly_pct = 0
        all_tasks = []
        try:
            # Show delegation tasks where this user is either the assignee or the submitter
            q = supabase.table("delegation_tasks").select(
                "id,title,status,due_date,delegation_on,document_url,assignee_id,submitted_by"
            )
            q = q.or_(f"assignee_id.eq.{user_id},submitted_by.eq.{user_id}")
            r = q.execute()
            all_tasks = [t for t in (r.data or []) if not _delegation_task_cancelled(t)]
            # Weekly KPI should be scoped by the *due* week.
            # Some pending tasks may have `delegation_on` in the current week but `due_date` in another week;
            # using `delegation_on` here makes them appear in the wrong week.
            week_tasks = [t for t in all_tasks if t.get("due_date")]
            def _in_week(t):
                d = t.get("due_date")
                if not d:
                    return False
                if isinstance(d, str):
                    d = date.fromisoformat(d[:10])
                return range_start <= d <= range_end
            def _in_month(t):
                # Monthly KPI can still consider delegation_on when due_date is missing.
                d = t.get("due_date") or t.get("delegation_on")
                if not d:
                    return False
                if isinstance(d, str):
                    d = date.fromisoformat(d[:10])
                return month_start <= d <= month_end
            week_list = [t for t in week_tasks if _in_week(t)]
            month_list = [t for t in all_tasks if _in_month(t)]
            # Weekly % and table rows both use tasks whose due_date/delegation_on falls in the selected week
            total_w = len(week_list)
            done_w = sum(1 for t in week_list if _delegation_task_done(t))
            delegation_weekly_pct = round((done_w / total_w) * 100) if total_w else 0
            # Monthly percentage is based on all tasks in the selected month
            total_m = len(month_list)
            done_m = sum(1 for t in month_list if _delegation_task_done(t))
            delegation_monthly_pct = round((done_m / total_m) * 100) if total_m else 0
            # KPI table: same scope as weekly % (selected Mon–Sun week), not the whole month
            for t in week_list:
                delegation_rows.append({
                    "task": t.get("title") or t.get("task") or "",
                    "status": (t.get("status") or "pending").replace("_", " ").title(),
                    "shifted_week": t.get("shifted_week") or "",
                    "month": month,
                    "button_url": t.get("document_url") or "-",
                })
        except Exception as e:
            _log(f"dashboard/kpi delegation: {e}")

        # ----- Support FMS (tickets: chore/bug, assignee_id OR created_by = user_id) -----
        response_delay_count = 0
        completion_delay_count = 0
        pending_count = 0
        target_pending = 1
        total_cb = 0
        support_fms_weekly_pct = 0
        support_fms_monthly_pct = 0
        support_fms_resp_health = 100
        support_fms_comp_health = 100
        support_fms_pend_health = 100
        response_delay_details = []
        completion_delay_details = []
        pending_details = []
        tickets: list = []
        stage2_completed_in_week = 0
        if not is_akash:
            try:
                tickets = _fetch_kpi_chore_bug_tickets(month_start, month_end)
                week_metrics = _compute_support_fms_week_metrics(tickets, range_start, range_end)
                response_delay_count = week_metrics["response_delay_count"]
                completion_delay_count = week_metrics["completion_delay_count"]
                pending_count = week_metrics["pending_count"]
                total_cb = week_metrics["total_cb"]
                stage2_completed_in_week = week_metrics["stage2_completed_in_week"]
                target_pending = max(total_cb, 1)
                support_fms_weekly_pct = week_metrics["weekly_pct"]
                support_fms_resp_health = week_metrics["response_health"]
                support_fms_comp_health = week_metrics["completion_health"]
                support_fms_pend_health = week_metrics["pending_health"]
                # Details load on demand via GET /dashboard/kpi/support-fms-details (keeps KPI payload small).
                response_delay_details = []
                completion_delay_details = []
                pending_details = []
            except Exception as e:
                _log(f"dashboard/kpi support FMS: {e}")
                support_fms_weekly_pct = 0
                support_fms_resp_health = 100
                support_fms_comp_health = 100
                support_fms_pend_health = 100

        # ----- Success KPI (Rimpa): ALL Success module data; selected week vs fixed targets 16/1/25/2 -----
        from app.dashboard_success_kpi import compute_success_kpi_for_dashboard

        success_kpi = None
        weekly_success_pct: list[float] = []
        try:
            if _dashboard_kpi_has_success_kpi(name):
                success_kpi, weekly_success_pct = compute_success_kpi_for_dashboard(
                    range_start, range_end, y, month_num
                )
        except Exception as e:
            _log(f"dashboard/kpi success: {e}")

        _empty_details = {
            "referenceNumbers": [],
            "companies": [],
            "messageOwner": [],
            "dates": [],
            "responses": [],
            "contacts": [],
            "callPOC": [],
            "messagePOC": [],
            "trainingDates": [],
            "trainingStatus": [],
            "remarks": [],
            "features": [],
            "followupDates": [],
            "beforePercentages": [],
            "afterPercentages": [],
        }
        if _dashboard_kpi_has_success_kpi(name) and success_kpi is None:
            success_kpi = {
                "pocCollected": {"currentValue": 0, "targetValue": 16, "percentage": "0/16", "details": _empty_details},
                "weeklyTrainingTarget": {"currentValue": 0, "targetValue": 1, "percentage": "0/1", "details": _empty_details},
                "trainingFollowUp": {"currentValue": 0, "targetValue": 25, "percentage": "0/25", "details": _empty_details},
                "successIncrease": {"currentValue": 0, "targetValue": 2, "percentage": "0/2", "details": _empty_details},
                "overallPercentage": 0,
            }

        # ----- Weekly progress (for graph: weekly % per week of month) -----
        weekly_progress_weeks = []
        weekly_progress_checklist = []
        weekly_progress_delegation = []
        weekly_progress_support_fms = []
        try:
            from app.checklist_utils import get_occurrence_dates_in_range
            task_ids = [t["id"] for t in tasks] if tasks else []
            for w in range(1, max_week_index + 1):
                weekly_progress_weeks.append(f"week {w}")
                rng = _dashboard_kpi_week_range(y, month_num, f"week {w}")
                if not rng:
                    weekly_progress_checklist.append(0)
                    weekly_progress_delegation.append(0)
                    weekly_progress_support_fms.append(0)
                    continue
                rs, re = rng
                # Checklist % for this week
                cl_pct = 0
                if task_ids:
                    comp_w = {
                        k: v
                        for k, v in comp_month.items()
                        if rs.isoformat() <= k[1] <= re.isoformat()
                    }
                    occ_w = []
                    for task in (tasks or []):
                        t_id = task["id"]
                        start = task.get("start_date")
                        if isinstance(start, str):
                            start = date.fromisoformat(start)
                        freq = task.get("frequency", "D")
                        dates_w = get_occurrence_dates_in_range(start, freq, rs, re, is_holiday)
                        for d in dates_w:
                            occ_w.append((t_id, d))
                    total_w = len(occ_w)
                    done_w = sum(1 for (tid, d) in occ_w if comp_w.get((tid, d.isoformat())))
                    cl_pct = round((done_w / total_w) * 100) if total_w else 0
                weekly_progress_checklist.append(cl_pct)
                # Delegation % for this week
                def _in_week_del(t, rs_=rs, re_=re):
                    # Weekly progress should also be scoped by due_date only.
                    d = t.get("due_date")
                    if not d:
                        return False
                    if isinstance(d, str):
                        d = date.fromisoformat(d[:10])
                    return rs_ <= d <= re_
                week_list_w = [t for t in all_tasks if _in_week_del(t)]
                total_d = len(week_list_w)
                done_d = sum(1 for t in week_list_w if _delegation_task_done(t))
                del_pct = round((done_d / total_d) * 100) if total_d else 0
                weekly_progress_delegation.append(del_pct)
                # Support FMS % = average of response, completion, and pending pillar health %
                sup_pct = _compute_support_fms_week_metrics(tickets, rs, re)["weekly_pct"]
                weekly_progress_support_fms.append(sup_pct)
        except Exception as e:
            _log(f"dashboard/kpi weeklyProgress: {e}")

        support_fms_monthly_pct = (
            round(sum(weekly_progress_support_fms) / len(weekly_progress_support_fms))
            if weekly_progress_support_fms
            else 0
        )
        if is_akash:
            support_fms_monthly_pct = 0

        ch_done = sum(1 for r in checklist_rows if (r.get("status") or "").lower() == "done")
        ch_pending = sum(1 for r in checklist_rows if (r.get("status") or "").lower() != "done")
        akash_kpi = None
        if is_akash:
            customer_support_bundle: dict = {}
            try:
                ak_tickets = [
                    t for t in _fetch_kpi_chore_bug_tickets(month_start, month_end) if _kpi_akash_ticket_visible(t)
                ]
            except Exception as e:
                _log(f"dashboard/kpi akash support tickets: {e}")
                ak_tickets = []
            sel_w = max(1, min(_parse_kpi_week_num(week, default=2), max_week_index))
            filt = get_kpi_calendar_week_range(y, month_num, sel_w)
            filter_rs, filter_re = filt if filt else (range_start, range_end)
            filter_range_lbl = f"{filter_rs.strftime('%d %b %Y')} – {filter_re.strftime('%d %b %Y')}"
            data_month_label = (
                _MONTH_NAMES[filter_rs.month - 1]
                if filter_rs.month == filter_re.month and filter_rs.year == filter_re.year
                else f"{_MONTH_NAMES[filter_rs.month - 1]}-{_MONTH_NAMES[filter_re.month - 1]}"
            )
            week_slice = _tickets_arrival_within_range(ak_tickets, filter_rs, filter_re)
            _enrich_kpi_ticket_slices(week_slice, week_slice)
            total_w = len(week_slice)
            pending_w = sum(
                1
                for t in week_slice
                if _is_pending(t.get("status") or "") and not _is_resolved(t.get("status"), t.get("status_4"))
            )
            cs_score_w = round(((total_w - pending_w) / total_w) * 100) if total_w else 0
            avg_m = _akash_avg_response_minutes(week_slice)
            if avg_m is None:
                resp_disp = "—"
            else:
                resp_disp = str(round(avg_m))
            help_note = (
                f"Customer support % uses chores/bugs with query arrival in the selected week ({filter_range_lbl}). "
                f"Bulk upload target is 5 per week (fixed), not tied to ticket count."
            )
            details_resp: list = []
            details_comp: list = []
            details_pend: list = []
            for t in week_slice:
                qa = t.get("query_arrival_at") or t.get("created_at")
                has_rd, rd_txt = _has_response_delay(qa, t.get("query_response_at"))
                if has_rd:
                    details_resp.append(_akash_support_detail_row(t, data_month_label, rd_txt or "Response SLA issue"))
                has_cd, cd_txt = _has_completion_delay(
                    resolved_at=t.get("actual_4"),
                    created_at=t.get("created_at"),
                    ticket_type=t.get("type"),
                    planned_2=t.get("planned_2"),
                    actual_2=t.get("actual_2"),
                    status_2=t.get("status_2"),
                    actual_1=t.get("actual_1"),
                )
                if has_cd:
                    details_comp.append(_akash_support_detail_row(t, data_month_label, cd_txt or "Stage 2 TAT crossed"))
                if _is_pending(t.get("status") or "") and not _is_resolved(t.get("status"), t.get("status_4")):
                    details_pend.append(
                        _akash_support_detail_row(t, data_month_label, _stage2_delay_text_for_ticket(t))
                    )
            customer_support_bundle = {
                "score_percent": cs_score_w,
                "score_percent_filter_week": cs_score_w,
                "total_issues": total_w,
                "response_delay_count": len(details_resp),
                "completion_delay_count": len(details_comp),
                "pending_count": len(details_pend),
                "response_time_display": resp_disp,
                "meta": {
                    "selectedWeekNum": sel_w,
                    "dataWeekNum": sel_w,
                    "dataMonth": data_month_label,
                    "dataYear": str(filter_rs.year),
                    "dataRangeLabel": filter_range_lbl,
                    "selectedWeekRangeLabel": filter_range_lbl,
                    "helpNote": help_note,
                },
                "details_response_delay": details_resp,
                "details_completion_delay": details_comp,
                "details_pending": details_pend,
            }
            daily_rows_week: list = []
            try:
                qlog = (
                    supabase.table("kpi_daily_work_log")
                    .select("*")
                    .eq("user_id", user_id)
                    .gte("work_date", range_start.isoformat())
                    .lte("work_date", range_end.isoformat())
                )
                daily_rows_week = (qlog.execute().data or [])
            except Exception as e:
                _log(f"dashboard/kpi kpi_daily_work_log: {e}")
                daily_rows_week = []
            daily_agg = _aggregate_kpi_daily_log_for_week(daily_rows_week, range_start, range_end)
            akash_kpi = _build_akash_kpi_payload(
                checklist_weekly_pct,
                ch_done,
                ch_pending,
                customer_support_bundle,
                daily_agg,
            )
            # Full-calendar-month headline + pillar % (same weight blend as weekly; CS = all chores/bugs with arrival in month)
            daily_rows_month: list = []
            try:
                qm = (
                    supabase.table("kpi_daily_work_log")
                    .select("*")
                    .eq("user_id", user_id)
                    .gte("work_date", month_start.isoformat())
                    .lte("work_date", month_end.isoformat())
                )
                daily_rows_month = (qm.execute().data or [])
            except Exception as e:
                _log(f"dashboard/kpi kpi_daily_work_log month: {e}")
                daily_rows_month = []
            daily_agg_month = _aggregate_kpi_daily_log_for_week(daily_rows_month, month_start, month_end)
            month_support_slice: list = []
            for t in ak_tickets:
                da = _parse_iso_to_date(t.get("query_arrival_at") or t.get("created_at"))
                if da and month_start <= da <= month_end:
                    month_support_slice.append(t)
            total_m = len(month_support_slice)
            pending_m = sum(
                1
                for t in month_support_slice
                if _is_pending(t.get("status") or "") and not _is_resolved(t.get("status"), t.get("status_4"))
            )
            cs_monthly = round(((total_m - pending_m) / total_m) * 100) if total_m else 0
            month_cs_bundle = {
                "score_percent": cs_monthly,
                "score_percent_filter_week": cs_monthly,
                "total_issues": total_m,
                "response_delay_count": 0,
                "completion_delay_count": 0,
                "pending_count": pending_m,
                "response_time_display": "—",
                "meta": {
                    "dataRangeLabel": f"{month_start.isoformat()} – {month_end.isoformat()}",
                    "helpNote": "Monthly support % = chores & bugs with query arrival (or created) in this calendar month.",
                },
                "details_response_delay": [],
                "details_completion_delay": [],
                "details_pending": [],
            }
            akash_monthly = _build_akash_kpi_payload(
                checklist_monthly_pct,
                0,
                0,
                month_cs_bundle,
                daily_agg_month,
            )
            akash_kpi["overall_score_monthly_percent"] = akash_monthly["overall_score_percent"]
            akash_kpi["monthly"] = {
                "overall_score_percent": akash_monthly["overall_score_percent"],
                "pillars": akash_monthly["pillars"],
                "dailyLogMonthApplied": bool(daily_agg_month.get("has_rows")),
            }
            akash_kpi["kpiDailyLogEditor"] = _kpi_daily_log_email_allowed(viewer_email)

        if (name or "").strip().lower() == "adrija":
            from app.dashboard_success_kpi import _format_dashboard_week_label

            lo = min(month_start, range_start)
            hi = max(month_end, range_end)
            day_map = _fetch_adrija_social_kpi_day_map(lo, hi)

            # Count completions in the selected week (one row per day per pillar max in DB).
            # Do not use |= across days — that collapses "2 days done" into a single 1 for the card.
            post_w = reel_w = li_w = 0
            d = range_start
            while d <= range_end:
                prl = day_map.get(d, {})
                post_w += int(prl.get("post", 0))
                reel_w += int(prl.get("reel", 0))
                li_w += int(prl.get("linkedin", 0))
                d += timedelta(days=1)

            days_in_month = (month_end - month_start).days + 1
            month_num_total = 0
            d = month_start
            post_dates: list[str] = []
            reel_dates: list[str] = []
            linkedin_dates: list[str] = []
            post_details: list[dict] = []
            reel_details: list[dict] = []
            linkedin_details: list[dict] = []
            while d <= month_end:
                prl = day_map.get(d, {})
                pv = int(prl.get("post", 0))
                rv = int(prl.get("reel", 0))
                lv = int(prl.get("linkedin", 0))
                month_num_total += pv + rv + lv
                if pv:
                    post_dates.append(d.isoformat())
                    post_details.append({"date": d.isoformat(), "taskName": prl.get("post_task_name") or "—"})
                if rv:
                    reel_dates.append(d.isoformat())
                    reel_details.append({"date": d.isoformat(), "taskName": prl.get("reel_task_name") or "—"})
                if lv:
                    linkedin_dates.append(d.isoformat())
                    linkedin_details.append({"date": d.isoformat(), "taskName": prl.get("linkedin_task_name") or "—"})
                d += timedelta(days=1)
            monthly_pct = round(100 * month_num_total / (3 * days_in_month)) if days_in_month else 0
            # Week % = share of pillars that have at least one completion in the week (targets stay 1 each).
            weekly_tasks_done = int(post_w >= 1) + int(reel_w >= 1) + int(li_w >= 1)
            weekly_pct = round(100 * weekly_tasks_done / 3)

            adrija_social_kpi = {
                "weekStart": range_start.isoformat(),
                "weekEnd": range_end.isoformat(),
                "weekLabel": _format_dashboard_week_label(range_start, range_end),
                "postWeek": post_w,
                "reelWeek": reel_w,
                "linkedinWeek": li_w,
                "weeklyPercent": weekly_pct,
                "monthlyPercent": monthly_pct,
                "postCompletionDates": post_dates,
                "reelCompletionDates": reel_dates,
                "linkedinCompletionDates": linkedin_dates,
                "postCompletionDetails": post_details,
                "reelCompletionDetails": reel_details,
                "linkedinCompletionDetails": linkedin_details,
                "editor": _adrija_social_kpi_editor(viewer_email),
            }

        applied = {"name": name, "month": month, "year": year, "week": week}
        return {
            "success": True,
            "meta": {
                "applied": applied,
                "availableMonths": list(_MONTH_NAMES),
                "availableWeeks": [f"week {i}" for i in range(1, max_week_index + 1)],
                "availableYears": ["2024", "2025", "2026", "2027"],
                "maxWeekIndex": max_week_index,
                "mergedWeekKey": merged_week_key,
                "weekCalendar": week_calendar_meta,
            },
            "checklist": {
                "rows": checklist_rows,
                "totals": {"done": sum(1 for r in checklist_rows if (r.get("status") or "").lower() == "done"), "pending": sum(1 for r in checklist_rows if (r.get("status") or "").lower() != "done")},
                "weeklyPercentage": checklist_weekly_pct,
            },
            "delegation": {
                "rows": delegation_rows,
                "weeklyPercentage": delegation_weekly_pct,
            },
            "supportFMS": {
                "responseDelay": {
                    "value": response_delay_count,
                    "target": total_cb,
                    "percentage": f"{response_delay_count}/{total_cb or 0}",
                    "healthPercent": support_fms_resp_health,
                    "status": _support_fms_pillar_status(response_delay_count),
                    "details": response_delay_details,
                },
                "completionDelay": {
                    "value": completion_delay_count,
                    "target": stage2_completed_in_week,
                    "percentage": f"{completion_delay_count}/{stage2_completed_in_week}",
                    "healthPercent": support_fms_comp_health,
                    "status": _support_fms_pillar_status(completion_delay_count),
                    "details": completion_delay_details,
                },
                "pendingChores": {
                    "value": pending_count,
                    "target": total_cb,
                    "percentage": f"{pending_count}/{total_cb or 0}",
                    "healthPercent": support_fms_pend_health,
                    "status": _support_fms_pillar_status(pending_count),
                    "details": pending_details,
                },
                "weeklyPercentage": support_fms_weekly_pct,
                "monthlyPercentage": support_fms_monthly_pct,
            },
            "successKpi": success_kpi,
            "akashKpi": akash_kpi,
            "adrijaSocialKpi": adrija_social_kpi,
            "monthlyPercentages": {
                "checklist": checklist_monthly_pct,
                "delegation": delegation_monthly_pct,
                "supportFMS": support_fms_monthly_pct,
            },
            "weeklyProgress": {
                "weeks": weekly_progress_weeks,
                "checklist": weekly_progress_checklist,
                "delegation": weekly_progress_delegation,
                "supportFMS": weekly_progress_support_fms,
                "successKpi": weekly_success_pct,
            },
        }
    except Exception as e:
        _log(f"dashboard/kpi: {e}")
        return {"success": False, "error": str(e)}


@api_router.get("/dashboard/success-kpi-till-date")
def dashboard_success_kpi_till_date(
    auth: dict = Depends(get_current_user),
):
    """Rimpa Success KPI source, computed from start (all-time) till date."""
    from app.section_permissions_util import require_dashboard_kpi_person

    require_dashboard_kpi_person(auth["id"], "Rimpa")
    try:
        from app.dashboard_success_kpi import compute_success_kpi_for_dashboard

        now_utc = datetime.now(timezone.utc).date()
        # Remove monthly restriction: compute from historical start to today.
        range_start = date(2000, 1, 1)
        till_date_end = now_utc
        y = now_utc.year
        month_num = now_utc.month

        success_kpi, _ = compute_success_kpi_for_dashboard(
            range_start,
            till_date_end,
            y,
            month_num,
        )
        if success_kpi is None:
            empty_details = {
                "companies": [],
                "dates": [],
                "remarks": [],
                "features": [],
            }
            success_kpi = {
                "pocCollected": {"currentValue": 0, "targetValue": 16, "percentage": "0/16", "details": empty_details},
                "weeklyTrainingTarget": {"currentValue": 0, "targetValue": 1, "percentage": "0/1", "details": empty_details},
                "trainingFollowUp": {"currentValue": 0, "targetValue": 25, "percentage": "0/25", "details": empty_details},
                "successIncrease": {"currentValue": 0, "targetValue": 2, "percentage": "0/2", "details": empty_details},
                "overallPercentage": 0,
                "meta": {"weekLabel": f"{range_start.isoformat()} to {till_date_end.isoformat()}"},
            }

        return {
            "success": True,
            "rangeStart": range_start.isoformat(),
            "tillDate": till_date_end.isoformat(),
            "successKpi": success_kpi,
        }
    except Exception as e:
        _log(f"dashboard/success-kpi-till-date: {e}")
        return {"success": False, "error": str(e), "successKpi": None}


# ---------- Support Dashboard Stats (FMS-style: weekly, pending grouped, top companies, features) ----------
def _days_pending(created_iso: str | None, resolved_iso: str | None) -> int:
    """Days from created (or query_arrival) to now if pending, else 0.
    Uses timezone-aware UTC for comparisons (Supabase returns aware datetimes)."""
    start = created_iso or ""
    if not start:
        return 0
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return 0
    if resolved_iso:
        try:
            end_dt = datetime.fromisoformat(resolved_iso.replace("Z", "+00:00"))
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
        except Exception:
            end_dt = datetime.now(timezone.utc)
    else:
        end_dt = datetime.now(timezone.utc)
    delta = end_dt - start_dt
    return max(0, delta.days)


def _is_resolved(status: str | None, completed: str | None) -> bool:
    resolved_statuses = ("completed", "complete", "resolved", "closed", "done", "fixed", "cancelled", "na", "n/a", "rejected")
    s = (status or "").lower().strip()
    c = (completed or "").lower().strip()
    if any(x in s for x in resolved_statuses):
        return True
    if any(x in c for x in resolved_statuses):
        return True
    return False


def _is_on_hold(status: str | None) -> bool:
    h = ("on hold", "on-hold", "hold", "paused", "waiting", "pending more info")
    s = (status or "").lower()
    return any(x in s for x in h)


def _company_demo_c(t: dict) -> bool:
    """True if ticket company is Demo C (exclude from PENDING CHORES)."""
    cn = (t.get("company_name") or "").strip().lower()
    return cn == "demo_c" or cn == "demo c"


def _is_pending(status: str | None) -> bool:
    if _is_resolved(status, None):
        return False
    p = ("pending", "open", "in progress", "in-progress", "assigned", "active", "new", "received")
    s = (status or "").lower()
    return any(x in s for x in p)


SLA_RESPONSE_MINUTES = 30


def _has_response_delay(query_arrival: str | None, query_response: str | None) -> tuple[bool, str]:
    """Returns (has_delay, delay_time_text). Response SLA = 30 min."""
    if not query_arrival:
        return False, ""
    try:
        arr = datetime.fromisoformat(str(query_arrival).replace("Z", "+00:00"))
        if query_response:
            resp = datetime.fromisoformat(str(query_response).replace("Z", "+00:00"))
            if arr.tzinfo is None:
                arr = arr.replace(tzinfo=timezone.utc)
            if resp.tzinfo is None:
                resp = resp.replace(tzinfo=timezone.utc)
            delta_min = (resp - arr).total_seconds() / 60
            if delta_min <= SLA_RESPONSE_MINUTES:
                return False, ""
            h, m = int(delta_min // 60), int(delta_min % 60)
            d = h // 24
            hr = h % 24
            if d > 0:
                text = f"Delay: {d}d {hr}h {m}m"
            elif h > 0:
                text = f"Delay: {h}h {m}m"
            else:
                text = f"Delay: {m}m"
            return True, text
        return True, "Awaiting response"
    except Exception:
        return False, ""


SLA_STAGE2_DAYS = 1  # Chores & Bugs Stage 2 TAT: 1 day from planned


def _has_completion_delay(
    resolved_at: str | None,
    created_at: str | None,
    ticket_type: str | None = None,
    planned_2: str | None = None,
    actual_2: str | None = None,
    status_2: str | None = None,
    actual_1: str | None = None,
) -> tuple[bool, str]:
    """Returns (has_delay, delay_time_text).
    Completion delay = Chores & Bugs where Stage 2 is completed AND
    elapsed time from planned_2 (or actual_1) to actual_2 exceeds SLA_STAGE2_DAYS (1 calendar day = 86400s).
    Uses wall-clock duration, not only .days, so delays >24h across two calendar days count correctly."""
    if ticket_type not in ("chore", "bug"):
        return False, ""
    if not _stage2_marked_completed(status_2):
        return False, ""
    p2 = planned_2 or actual_1
    if not p2 or not actual_2:
        return False, ""
    try:
        planned = datetime.fromisoformat(str(p2).replace("Z", "+00:00"))
        actual = datetime.fromisoformat(str(actual_2).replace("Z", "+00:00"))
        if planned.tzinfo is None:
            planned = planned.replace(tzinfo=timezone.utc)
        if actual.tzinfo is None:
            actual = actual.replace(tzinfo=timezone.utc)
        delta_sec = (actual - planned).total_seconds()
        sla_sec = float(SLA_STAGE2_DAYS) * 86400.0
        if delta_sec > sla_sec:
            delta_days = delta_sec / 86400.0
            return True, f"TAT crossed: {delta_days:.1f}d"
        return False, ""
    except Exception:
        return False, ""


def _support_fms_pillar_health(bad_count: int, total: int) -> int:
    """On-time / healthy % for one Support FMS pillar (0–100). Empty denominator => 100%."""
    if total <= 0:
        return 100
    return round(((total - bad_count) / total) * 100)


def _support_fms_pillar_status(bad_count: int) -> str | None:
    """Show Good when there are zero delays/pending items in the pillar."""
    return "Good" if bad_count == 0 else None


def _support_fms_row_item(ticket: dict, month_label: str) -> dict:
    created = ticket.get("created_at") or ""
    ref = (ticket.get("reference_no") or "").strip() or "N/A"
    company_val = (ticket.get("company_name") or "").strip() or "—"
    return {
        "type": (ticket.get("type") or "Chore").title(),
        "company": company_val,
        "requested_person": "",
        "submitted_by": "",
        "title": (ticket.get("title") or "").strip() or "—",
        "description": (ticket.get("description") or "").strip() or "",
        "reference_no": ref,
        "query_arrival": _normalize_query_arrival_iso(ticket.get("query_arrival_at") or created),
        "month": month_label,
    }


def _support_fms_week_slices(
    tickets: list,
    range_start: date,
    range_end: date,
) -> tuple[list, list]:
    week_tickets: list = []
    for t in tickets:
        d_arrival = _parse_iso_to_date(t.get("query_arrival_at") or t.get("created_at"))
        if d_arrival is not None and range_start <= d_arrival <= range_end:
            week_tickets.append(t)
    stage2_completed_tickets: list = []
    for t in tickets:
        if not _stage2_marked_completed(t.get("status_2")):
            continue
        if not (str(t.get("actual_2") or "").strip()):
            continue
        d2 = _parse_iso_to_date(t.get("actual_2"))
        if d2 is not None and range_start <= d2 <= range_end:
            stage2_completed_tickets.append(t)
    return week_tickets, stage2_completed_tickets


def _support_fms_detail_items_for_pillar(
    week_tickets: list,
    stage2_completed_tickets: list,
    pillar: str,
    month_label: str,
) -> list[dict]:
    """Build modal row list for one Support FMS pillar (response_delay | completion_delay | pending)."""
    p = (pillar or "").strip().lower()
    items: list[dict] = []
    if p == "response_delay":
        for t in week_tickets:
            has_resp, resp_text = _has_response_delay(
                t.get("query_arrival_at") or t.get("created_at"),
                t.get("query_response_at"),
            )
            if has_resp:
                items.append(
                    {**_support_fms_row_item(t, month_label), "delay_time": resp_text or "Delay"}
                )
        return items
    if p == "pending":
        for t in week_tickets:
            status = t.get("status") or ""
            if _is_pending(status) and not _is_resolved(status, t.get("status_4")):
                items.append(
                    {
                        **_support_fms_row_item(t, month_label),
                        "delay_time": _stage2_delay_text_for_ticket(t),
                    }
                )
        return items
    if p == "completion_delay":
        for t in stage2_completed_tickets:
            has_comp, comp_text = _has_completion_delay(
                resolved_at=t.get("actual_4"),
                created_at=t.get("created_at"),
                ticket_type=t.get("type"),
                planned_2=t.get("planned_2"),
                actual_2=t.get("actual_2"),
                status_2=t.get("status_2"),
                actual_1=t.get("actual_1"),
            )
            if has_comp:
                items.append(
                    {**_support_fms_row_item(t, month_label), "delay_time": comp_text or "TAT crossed"}
                )
    return items


def _compute_support_fms_week_metrics(
    tickets: list,
    range_start: date,
    range_end: date,
) -> dict:
    """Aggregate Support FMS counts and blended weekly % for a Mon–Sun KPI week."""
    week_tickets: list = []
    for t in tickets:
        d_arrival = _parse_iso_to_date(t.get("query_arrival_at") or t.get("created_at"))
        if d_arrival is not None and range_start <= d_arrival <= range_end:
            week_tickets.append(t)

    response_delay_count = 0
    pending_count = 0
    for t in week_tickets:
        has_resp, _ = _has_response_delay(
            t.get("query_arrival_at") or t.get("created_at"),
            t.get("query_response_at"),
        )
        if has_resp:
            response_delay_count += 1
        status = t.get("status") or ""
        if _is_pending(status) and not _is_resolved(status, t.get("status_4")):
            pending_count += 1

    stage2_completed_tickets: list = []
    for t in tickets:
        if not _stage2_marked_completed(t.get("status_2")):
            continue
        if not (str(t.get("actual_2") or "").strip()):
            continue
        d2 = _parse_iso_to_date(t.get("actual_2"))
        if d2 is not None and range_start <= d2 <= range_end:
            stage2_completed_tickets.append(t)

    completion_delay_count = 0
    for t in stage2_completed_tickets:
        has_comp, _ = _has_completion_delay(
            resolved_at=t.get("actual_4"),
            created_at=t.get("created_at"),
            ticket_type=t.get("type"),
            planned_2=t.get("planned_2"),
            actual_2=t.get("actual_2"),
            status_2=t.get("status_2"),
            actual_1=t.get("actual_1"),
        )
        if has_comp:
            completion_delay_count += 1

    total_cb = len(week_tickets)
    stage2_n = len(stage2_completed_tickets)
    resp_h = _support_fms_pillar_health(response_delay_count, total_cb)
    comp_h = _support_fms_pillar_health(completion_delay_count, stage2_n)
    pend_h = _support_fms_pillar_health(pending_count, total_cb)
    weekly_pct = round((resp_h + comp_h + pend_h) / 3)

    return {
        "response_delay_count": response_delay_count,
        "completion_delay_count": completion_delay_count,
        "pending_count": pending_count,
        "total_cb": total_cb,
        "stage2_completed_in_week": stage2_n,
        "weekly_pct": weekly_pct,
        "response_health": resp_h,
        "completion_health": comp_h,
        "pending_health": pend_h,
    }


def _format_seconds_duration(sec: float) -> str:
    """Human-readable overdue duration (similar style to frontend formatDelay)."""
    s = int(max(0, sec))
    d = s // 86400
    h = (s % 86400) // 3600
    m = (s % 3600) // 60
    parts: list[str] = []
    if d:
        parts.append(f"{d} day{'s' if d != 1 else ''}")
    if h:
        parts.append(f"{h} hr")
    if m and d == 0:
        parts.append(f"{m} min")
    return " ".join(parts) if parts else "< 1 min"


def _stage2_delay_text_for_ticket(ticket: dict) -> str:
    """Pending Chores/Bugs delay = now - submit timestamp with 24h SLA.
    Submit timestamp preference: query_arrival_at, then created_at.
    """
    if str(ticket.get("type") or "").lower() not in ("chore", "bug"):
        return "—"
    submitted_at = ticket.get("query_arrival_at") or ticket.get("created_at")
    if not submitted_at:
        return "—"
    try:
        submitted = datetime.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
        if submitted.tzinfo is None:
            submitted = submitted.replace(tzinfo=timezone.utc)
    except Exception:
        return "—"
    sla_sec = 24.0 * 3600.0  # 1 day
    now = datetime.now(timezone.utc)
    over = (now - submitted).total_seconds() - sla_sec
    if over > 0:
        return f"Delay: {_format_seconds_duration(over)}"
    return "Within 1 day"


def _has_completion_delay_stage4(ticket: dict) -> tuple[bool, str]:
    """Returns (has_delay, delay_time_text).
    Completion delay = ticket creation timestamp + 1 day crossed, AND Stage 4 completed."""
    if ticket.get("type") not in ("chore", "bug"):
        return False, ""
    status4 = str(ticket.get("status_4") or "").lower()
    if status4 != "completed":
        return False, ""
    created = ticket.get("created_at") or ""
    actual4 = ticket.get("actual_4") or ""
    if not created or not actual4:
        return False, ""
    try:
        c = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
        a = datetime.fromisoformat(str(actual4).replace("Z", "+00:00"))
        if c.tzinfo is None:
            c = c.replace(tzinfo=timezone.utc)
        if a.tzinfo is None:
            a = a.replace(tzinfo=timezone.utc)
        delta_days = (a - c).total_seconds() / 86400
        if delta_days > 1:
            return True, f"TAT crossed: {int(delta_days)}d"
        return False, ""
    except Exception:
        return False, ""


@api_router.get("/dashboard/kpi-daily-log")
def get_kpi_daily_log(
    year: int,
    month: int,
    auth: dict = Depends(get_current_user),
):
    """List KPI daily work log rows for a calendar month (Akash/Aman editor only)."""
    if not _kpi_daily_log_email_allowed(auth.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    owner_id = _kpi_daily_work_log_owner_user_id()
    if not owner_id:
        raise HTTPException(
            status_code=503,
            detail="KPI daily log owner not found: add an Akash user profile (full_name) in user_profiles.",
        )
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    start_s = start.isoformat()
    end_s = end.isoformat()
    try:
        r = (
            supabase.table("kpi_daily_work_log")
            .select(
                "work_date, items_cleaned, errors_found, accuracy_pct, videos_created, video_type, bulk_upload_tickets, ai_tasks_used, process_improved"
            )
            .eq("user_id", owner_id)
            .gte("work_date", start_s)
            .lte("work_date", end_s)
            .order("work_date", desc=False)
            .execute()
        )
    except Exception as e:
        _log(f"get_kpi_daily_log: {e}")
        raise HTTPException(status_code=502, detail=f"kpi_daily_work_log read failed: {str(e)[:400]}")
    return {"rows": r.data or []}


@api_router.put("/dashboard/kpi-daily-log")
def upsert_kpi_daily_log(
    body: KpiDailyLogUpsertBody,
    auth: dict = Depends(get_current_user),
):
    """Create or update one KPI daily work log row (Akash/Aman editor only)."""
    if not _kpi_daily_log_email_allowed(auth.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed")
    owner_id = _kpi_daily_work_log_owner_user_id()
    if not owner_id:
        raise HTTPException(
            status_code=503,
            detail="KPI daily log owner not found: add an Akash user profile (full_name) in user_profiles.",
        )
    try:
        wd = date.fromisoformat(body.work_date.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid work_date; use YYYY-MM-DD")
    row = {
        "user_id": owner_id,
        "work_date": wd.isoformat(),
        "items_cleaned": _kpi_daily_optional_int("items_cleaned", body.items_cleaned),
        "errors_found": _kpi_daily_optional_float("errors_found", body.errors_found),
        "accuracy_pct": _kpi_daily_optional_float("accuracy_pct", body.accuracy_pct),
        "videos_created": _kpi_daily_optional_int("videos_created", body.videos_created),
        "video_type": (body.video_type or "").strip() or None,
        "bulk_upload_tickets": _kpi_daily_optional_int("bulk_upload_tickets", body.bulk_upload_tickets),
        "ai_tasks_used": _kpi_daily_optional_int("ai_tasks_used", body.ai_tasks_used),
        "process_improved": _kpi_daily_optional_int("process_improved", body.process_improved),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase.table("kpi_daily_work_log").upsert(row, on_conflict="user_id,work_date").execute()
    except Exception as e:
        msg = str(e)
        _log(f"upsert_kpi_daily_log: {msg}")
        raise HTTPException(
            status_code=502,
            detail=(
                f"kpi_daily_work_log upsert failed: {msg[:350]}. "
                "If you see RLS or permission errors, set SUPABASE_SERVICE_ROLE_KEY on the API server "
                "(Supabase → Settings → API → service_role) and redeploy; see docs/SUPABASE_KPI_DAILY_WORK_LOG_RLS_DELEGATES.sql."
            ),
        )
    return {"ok": True, "work_date": wd.isoformat()}


@api_router.get("/dashboard/adrija-social-kpi-daily")
def get_adrija_social_kpi_daily(
    year: int = Query(..., description="Calendar year"),
    month: int = Query(..., ge=1, le=12, description="Month 1–12"),
    auth: dict = Depends(get_current_user),
):
    """Adrija social KPI: all calendar days in a month with Post/Reel/LinkedIn flags."""
    _ = auth
    try:
        import calendar

        _, last = calendar.monthrange(year, month)
        m_start = date(year, month, 1)
        m_end = date(year, month, last)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid year/month")
    day_map = _fetch_adrija_social_kpi_day_map(m_start, m_end)
    rows: list[dict] = []
    d = m_start
    while d <= m_end:
        prl = day_map.get(d, {})
        rows.append(
            {
                "work_date": d.isoformat(),
                "dayName": d.strftime("%A"),
                "post": int(prl.get("post", 0)),
                "reel": int(prl.get("reel", 0)),
                "linkedin": int(prl.get("linkedin", 0)),
                "post_task_name": prl.get("post_task_name") or "",
                "reel_task_name": prl.get("reel_task_name") or "",
                "linkedin_task_name": prl.get("linkedin_task_name") or "",
            }
        )
        d += timedelta(days=1)
    return {"rows": rows}


@api_router.put("/dashboard/adrija-social-kpi-daily")
def put_adrija_social_kpi_daily(body: AdrijaSocialKpiDayBatchBody, auth: dict = Depends(get_current_user)):
    """Upsert Adrija social KPI day rows. Editors: adrija@ & aman@ only."""
    if not _adrija_social_kpi_editor(auth.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not body.rows:
        return {"ok": True, "saved": 0}
    if len(body.rows) > 40:
        raise HTTPException(status_code=400, detail="Too many rows in one batch")
    batch: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    def _task_name_or_none(v: str | None) -> str | None:
        s = (v or "").strip()
        return s[:200] if s else None

    for row in body.rows:
        try:
            wd = date.fromisoformat((row.work_date or "").strip()[:10])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid work_date: {row.work_date!r}")
        p = _adrija_social_kpi_bit(row.post)
        r = _adrija_social_kpi_bit(row.reel)
        l = _adrija_social_kpi_bit(row.linkedin)
        p_name = _task_name_or_none(row.post_task_name)
        r_name = _task_name_or_none(row.reel_task_name)
        l_name = _task_name_or_none(row.linkedin_task_name)
        if p and not p_name:
            raise HTTPException(status_code=400, detail=f"post_task_name required when Post is checked ({wd.isoformat()})")
        if r and not r_name:
            raise HTTPException(status_code=400, detail=f"reel_task_name required when Reel is checked ({wd.isoformat()})")
        if l and not l_name:
            raise HTTPException(status_code=400, detail=f"linkedin_task_name required when LinkedIn is checked ({wd.isoformat()})")
        batch.append(
            {
                "work_date": wd.isoformat(),
                "post": p,
                "reel": r,
                "linkedin": l,
                "post_task_name": p_name,
                "reel_task_name": r_name,
                "linkedin_task_name": l_name,
                "updated_at": now_iso,
            }
        )
    try:
        supabase.table("onboarding_adrija_social_kpi_day").upsert(batch, on_conflict="work_date").execute()
    except Exception as e:
        _log(f"put_adrija_social_kpi_daily: {e}")
        raise HTTPException(
            status_code=502,
            detail=str(e)[:400],
        )
    return {"ok": True, "saved": len(batch)}


@api_router.get("/support-dashboard/stats")
def support_dashboard_stats(auth: dict = Depends(get_current_user)):
    """Support Dashboard: weekly stats, pending grouped by 1-2/2-7/7+/hold, top companies, feature metrics."""
    auth_email = (auth.get("email") or "").strip().lower() or "anon"
    try:
        return _SUPPORT_DASH_CACHE[auth_email]
    except KeyError:
        pass
    now = datetime.utcnow()
    current_month = now.month
    current_year = now.year
    prev_month = current_month - 1 if current_month > 1 else 12
    prev_year = current_year if current_month > 1 else current_year - 1

    # Chores & bugs for weekly stats — last ~6 months only (avoids full-table scan in production).
    stats_cutoff = (now - timedelta(days=186)).isoformat()

    def _support_stats_cb_query():
        qq = supabase.table("tickets").select(
            "id, type, status, company_name, created_at, resolved_at, assignee_id, query_arrival_at, query_response_at, quality_solution, planned_2, actual_2, actual_1, status_2, status_4, actual_4"
        ).in_("type", ["chore", "bug"])
        qq = qq.gte("created_at", stats_cutoff)
        qq = qq.or_("staging_planned.is.null,live_review_status.eq.completed")
        qq = qq.or_("status_2.is.null,status_2.neq.staging")
        return apply_exclude_ticket_na(qq)

    try:
        all_tickets = _supabase_fetch_all_rows(_support_stats_cb_query, max_rows=25000)
        # Tickets for pending items: only those still in Chores & Bugs (quality_solution null)
        def _in_chores_bugs_section(ticket: dict) -> bool:
            qs = ticket.get("quality_solution")
            return qs is None or qs == "" or (isinstance(qs, str) and qs.lower() in ("null", "none"))
        tickets_for_pending = [t for t in all_tickets if _in_chores_bugs_section(t)]
    except Exception as e:
        return {"success": False, "message": str(e)[:200]}

    # Feature tickets for feature metrics (recent rows only).
    def _support_stats_feature_query():
        return apply_exclude_ticket_na(
            supabase.table("tickets")
            .select("id, type, status, status_2")
            .eq("type", "feature")
            .gte("created_at", stats_cutoff)
        )

    try:
        feature_tickets = _supabase_fetch_all_rows(_support_stats_feature_query, max_rows=10000)
    except Exception:
        feature_tickets = []

    pending_statuses = ("open", "in_progress", "on_hold", "pending")
    month_names = ["January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]

    # Weekly stats (4 weeks: current + 3 previous)
    weeks_data = []
    current_week = _week_of_month(now)
    for i in range(4):
        w = current_week - i
        month, year = current_month, current_year
        if w < 1:
            w = 4 + w
            month, year = prev_month, prev_year
        week_label = f"Week {w}"
        week_tickets = [t for t in all_tickets if _get_ticket_week(t) == (w, month, year)]
        total = len(week_tickets)
        chores = sum(1 for t in week_tickets if t.get("type") == "chore")
        bugs = sum(1 for t in week_tickets if t.get("type") == "bug")
        def _stage4_done(t: dict) -> bool:
            return str(t.get("status_4") or "").lower() == "completed"
        completed = sum(1 for t in week_tickets if _stage4_done(t))
        response_delay = sum(1 for t in week_tickets if _has_response_delay(t.get("query_arrival_at") or t.get("created_at"), t.get("query_response_at"))[0])
        completion_delay = sum(1 for t in week_tickets if _has_completion_delay_stage4(t)[0])
        weeks_data.append({
            "weekNumber": w,
            "months": [month_names[month - 1]],
            "years": [str(year)],
            "weekDateRange": _week_date_range(w, month, year),
            "success": True,
            "stats": {
                "totalTickets": total,
                "totalChores": chores,
                "totalBugs": bugs,
                "completed": completed,
                "pendingBugs": sum(1 for t in week_tickets if t.get("type") == "bug" and not _stage4_done(t)),
                "pendingChores": sum(1 for t in week_tickets if t.get("type") == "chore" and not _stage4_done(t)),
                "responseDelay": response_delay,
                "completionDelay": completion_delay,
            },
        })

    # Pending chores & bugs grouped (only from tickets still in Chores & Bugs section)
    pending_chores = []
    pending_bugs = []
    prev_month_chores = {}
    prev_month_bugs = {}

    for t in tickets_for_pending:
        if ticket_marked_na(t):
            continue
        if str(t.get("status_4") or "").lower() == "completed":
            continue
        status = t.get("status") or ""
        if _is_resolved(status, None) or t.get("resolved_at"):
            continue
        if not _is_pending(status) and status not in pending_statuses:
            continue
        created = t.get("query_arrival_at") or t.get("created_at")
        days = _days_pending(created, t.get("resolved_at"))
        if days == 0:
            days = 1
        company = (t.get("company_name") or "").strip() or "Unknown"
        item = {"company": company, "daysPending": days, "status": status, "isOnHold": _is_on_hold(status), "type": t.get("type")}
        if t.get("type") == "chore":
            if not _company_demo_c(t):
                pending_chores.append(item)
        elif t.get("type") == "bug":
            pending_bugs.append(item)
    for t in all_tickets:
        created_at = t.get("created_at") or ""
        if not created_at:
            continue
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if dt.month == prev_month and dt.year == prev_year:
                company = (t.get("company_name") or "").strip() or "Unknown"
                if t.get("type") == "chore":
                    prev_month_chores[company] = prev_month_chores.get(company, 0) + 1
                elif t.get("type") == "bug":
                    prev_month_bugs[company] = prev_month_bugs.get(company, 0) + 1
        except Exception:
            pass

    def group_items(items):
        g = {"1-2": [], "2-7": [], "7+": [], "hold": []}
        for it in items:
            if it.get("isOnHold"):
                g["hold"].append(it)
            elif 1 <= it["daysPending"] <= 2:
                g["1-2"].append(it)
            elif 3 <= it["daysPending"] <= 7:
                g["2-7"].append(it)
            else:
                g["7+"].append(it)
        return g

    grouped_chores = group_items(pending_chores)
    grouped_bugs = group_items(pending_bugs)

    # Explicit counts for frontend display (same as grouped array lengths)
    counts = {
        "chores": {"1-2": len(grouped_chores["1-2"]), "2-7": len(grouped_chores["2-7"]), "7+": len(grouped_chores["7+"]), "hold": len(grouped_chores["hold"])},
        "bugs": {"1-2": len(grouped_bugs["1-2"]), "2-7": len(grouped_bugs["2-7"]), "7+": len(grouped_bugs["7+"]), "hold": len(grouped_bugs["hold"])},
    }

    def top_companies(m, limit=5):
        pairs = sorted(m.items(), key=lambda x: -x[1])[:limit]
        return [{"company": k, "requests": v} for k, v in pairs]

    # Feature metrics
    feature_pending = sum(1 for t in feature_tickets if t.get("status") in ("open", "in_progress", "on_hold", "pending"))
    feature_total = len(feature_tickets)

    payload = {
        "success": True,
        "weeksData": weeks_data,
        "pendingItems": {"grouped": {"chores": grouped_chores, "bugs": grouped_bugs}},
        "counts": counts,
        "monthlyTopCompanies": {
            "chores": top_companies(prev_month_chores),
            "bugs": top_companies(prev_month_bugs),
            "period": f"{month_names[prev_month - 1]} {prev_year}",
        },
        "statistics": {
            "totalChores": len(pending_chores),
            "totalBugs": len(pending_bugs),
            "onHoldChores": len([x for x in pending_chores if x.get("isOnHold")]),
            "onHoldBugs": len([x for x in pending_bugs if x.get("isOnHold")]),
        },
        "featureMetrics": {
            "total": feature_total,
            "pending": feature_pending,
        },
        "summary": {
            "period": f"{month_names[current_month - 1]} {current_year}",
            "lastUpdated": now.strftime("%Y-%m-%d %H:%M:%S"),
        },
    }
    _SUPPORT_DASH_CACHE[auth_email] = payload
    return payload


def _get_ticket_week(t: dict) -> tuple[int, int, int]:
    """Return (week_num, month, year) for ticket based on query_arrival_at (or created_at)."""
    ts = t.get("query_arrival_at") or t.get("created_at") or ""
    if not ts:
        return 0, 0, 0
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return _week_of_month(dt), dt.month, dt.year
    except Exception:
        return 0, 0, 0


def _get_ticket_week_from_iso(ts: str | None) -> tuple[int, int, int]:
    """Return (week_num, month, year) for an ISO timestamp (e.g. Stage 2 actual_2)."""
    if not ts:
        return 0, 0, 0
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return _week_of_month(dt), dt.month, dt.year
    except Exception:
        return 0, 0, 0


def _stage2_marked_completed(status_2: str | None) -> bool:
    """True when Stage 2 is recorded as completed (handles Completed / complete / done)."""
    if not status_2:
        return False
    s = str(status_2).lower().strip()
    if s in ("completed", "complete", "done", "closed"):
        return True
    return "complet" in s and "incomplet" not in s


def _week_date_range(week_num: int, month: int, year: int) -> str:
    """Human-readable KPI range (Monday–Sunday, capped at month end)."""
    rng = _dashboard_kpi_week_range(year, month, f"week {week_num}")
    if not rng:
        return f"Week {week_num}"
    start, end = rng
    names = _MONTH_NAMES
    if start.month == end.month:
        return f"{start.day} {names[start.month - 1]} – {end.day} {names[end.month - 1]}"
    return f"{start.day} {names[start.month - 1]} – {end.day} {names[end.month - 1]}"


@api_router.get("/support-dashboard/filtered")
def support_dashboard_filtered(
    filter_type: str = Query(..., description="1-2, 2-7, 7+, hold"),
    category: str = Query(..., description="chores or bugs"),
    auth: dict = Depends(get_current_user),
):
    """Filtered tickets for Support Dashboard modal (chores/bugs by days or hold)."""
    try:
        q = supabase.table("tickets").select(
            "id, reference_no, title, description, type, status, company_name, company_id, user_name, created_at, resolved_at, query_arrival_at"
        ).in_("type", ["chore", "bug"])
        q = q.is_("quality_solution", "null")
        q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
        q = q.or_("status_2.is.null,status_2.neq.staging")
        q = apply_exclude_ticket_na(q)
        r = q.execute()
        tickets = r.data or []
        _enrich_tickets_with_lookups(tickets)
    except Exception as e:
        return {"success": False, "message": str(e)[:200], "data": [], "totalRecords": 0}

    pending_statuses = ("open", "in_progress", "on_hold", "pending")
    result = []
    for t in tickets:
        status = t.get("status") or ""
        if _is_resolved(status, None) or t.get("resolved_at"):
            continue
        if status not in pending_statuses and not _is_pending(status):
            continue
        ttype = t.get("type")
        if category == "chores" and ttype != "chore":
            continue
        if category == "chores" and _company_demo_c(t):
            continue
        if category == "bugs" and ttype != "bug":
            continue
        days = _days_pending(t.get("query_arrival_at") or t.get("created_at"), t.get("resolved_at"))
        if days == 0:
            days = 1
        on_hold = _is_on_hold(status)
        match = False
        if filter_type == "hold" and on_hold:
            match = True
        elif filter_type == "1-2" and not on_hold and 1 <= days <= 2:
            match = True
        elif filter_type == "2-7" and not on_hold and 3 <= days <= 7:
            match = True
        elif filter_type == "7+" and not on_hold and days > 7:
            match = True
        if match:
            result.append({
                "id": t.get("id"),
                "type": ttype,
                "company": (t.get("company_name") or "").strip() or "Unknown",
                "requestedPerson": (t.get("user_name") or "").strip() or "Not specified",
                "status": status,
                "pendingDays": days,
                "referenceNo": (t.get("reference_no") or "").strip() or "N/A",
                "title": (t.get("title") or "").strip(),
                "description": (t.get("description") or "").strip() or "",
                "queryArrival": t.get("query_arrival_at") or t.get("created_at") or "",
                "rowNumber": 0,
            })
    return {"success": True, "data": result, "totalRecords": len(result), "filterType": filter_type, "category": category}


@api_router.get("/support-dashboard/weekly-details")
def support_dashboard_weekly_details(
    week_number: int = Query(...),
    months: str = Query("", description="comma-separated months"),
    years: str = Query("", description="comma-separated years"),
    ticket_type: str = Query("total", description="total, pending, or completed"),
    auth: dict = Depends(get_current_user),
):
    """Weekly ticket details for Support Dashboard modal.
    ticket_type: total, pending, completed, response_delay, completion_delay.
    Pending = Upto Stage 4 not done. Completed = Stage 4 completed. Completion delay = 1d crossed + Stage 4 done."""
    try:
        q = supabase.table("tickets").select(
            "id, reference_no, title, description, type, status, company_name, company_id, user_name, assignee_id, created_at, query_arrival_at, query_response_at, resolved_at, planned_2, actual_2, actual_1, status_2, status_4, actual_4, quality_solution"
        ).in_("type", ["chore", "bug"])
        q = q.or_("staging_planned.is.null,live_review_status.eq.completed")
        q = q.or_("status_2.is.null,status_2.neq.staging")
        r = q.execute()
        tickets = r.data or []
        _enrich_tickets_with_lookups(tickets)
    except Exception as e:
        return {"success": False, "message": str(e)[:200], "tickets": []}

    month_list = [m.strip() for m in months.split(",") if m.strip()]
    year_list = [y.strip() for y in years.split(",") if y.strip()]
    result = []
    for t in tickets:
        w, m, y = _get_ticket_week(t)
        if w != week_number:
            continue
        month_name = datetime(2000, m, 1).strftime("%B") if 1 <= m <= 12 else ""
        if month_list and month_name not in month_list:
            continue
        if year_list and str(y) not in year_list:
            continue
        stage4_done = str(t.get("status_4") or "").lower() == "completed"
        has_quality = t.get("quality_solution") is not None and str(t.get("quality_solution")).strip().lower() not in ("", "null", "none")
        if ticket_type == "pending" and (stage4_done or has_quality):
            continue
        if ticket_type == "completed" and not stage4_done:
            continue
        q_arrival = t.get("query_arrival_at") or t.get("created_at")
        q_response = t.get("query_response_at")
        has_resp_delay, resp_delay_text = _has_response_delay(q_arrival, q_response)
        has_comp_delay, comp_delay_text = _has_completion_delay_stage4(t)
        if ticket_type == "response_delay" and not has_resp_delay:
            continue
        if ticket_type == "completion_delay" and not has_comp_delay:
            continue
        result.append({
            "id": t.get("id"),
            "type": "Bug" if t.get("type") == "bug" else "Chore",
            "company": (t.get("company_name") or "").strip() or "Unknown",
            "requestedPerson": (t.get("user_name") or "").strip() or "Not specified",
            "submittedBy": (t.get("user_name") or "").strip() or "Not specified",
            "title": (t.get("title") or "").strip(),
            "description": (t.get("description") or "").strip() or "",
            "referenceNo": (t.get("reference_no") or "").strip() or "N/A",
            "week": f"Week {week_number}",
            "month": month_name,
            "year": str(y),
            "status": t.get("status") or "",
            "completed": "completed" if stage4_done else "",
            "queryArrival": q_arrival or "",
            "responseDelayTime": resp_delay_text if has_resp_delay else "",
            "completionDelayTime": comp_delay_text if has_comp_delay else "",
        })
    return {"success": True, "tickets": result, "ticketType": ticket_type, "weekNumber": week_number, "totalTickets": len(result)}


@api_router.get("/support-dashboard/feature-tickets")
def support_dashboard_feature_tickets(
    filter_type: str = Query("all", description="all or pending"),
    auth: dict = Depends(get_current_user),
):
    """Feature tickets for Support Dashboard modal (all or pending only). Sorted by priority: red (high/critical/urgent) first, then yellow (medium), then green (low), then no priority."""
    try:
        q = apply_exclude_ticket_na(
            supabase.table("tickets").select(
                "id, reference_no, title, description, type, status, priority, company_name, user_name, created_at, query_arrival_at, resolved_at, status_2"
            ).eq("type", "feature")
        )
        r = q.execute()
        tickets = r.data or []
    except Exception as e:
        return {"success": False, "message": str(e)[:200], "data": [], "totalRecords": 0}
    pending_statuses = ("open", "in_progress", "on_hold", "pending")
    result = []
    for t in tickets:
        if ticket_marked_na(t):
            continue
        status = t.get("status") or ""
        resolved = _is_resolved(status, None) or bool(t.get("resolved_at"))
        if filter_type == "pending" and resolved:
            continue
        if filter_type == "pending" and status not in pending_statuses and not _is_pending(status):
            continue
        result.append({
            "id": t.get("id"),
            "company": (t.get("company_name") or "").strip() or "Unknown",
            "requestedPerson": (t.get("user_name") or "").strip() or "Not specified",
            "status": status,
            "priority": (t.get("priority") or "").strip().lower() or None,
            "referenceNo": (t.get("reference_no") or "").strip() or "N/A",
            "title": (t.get("title") or "").strip(),
            "description": (t.get("description") or "").strip() or "",
            "queryArrival": t.get("query_arrival_at") or t.get("created_at") or "",
        })
    # Sort by priority: red (critical, urgent, high) first, then yellow (medium), then green (low), then no priority
    _priority_order = {"critical": 0, "urgent": 0, "high": 0, "medium": 1, "low": 2}
    result.sort(key=lambda x: _priority_order.get(x.get("priority") or "", 3))
    return {"success": True, "data": result, "totalRecords": len(result), "filterType": filter_type}


@api_router.get("/dashboard/trends")
def dashboard_trends(auth: dict = Depends(get_current_user)):
    """Weekly trend data for charts (Chores & Bug only).

    - response_delay: tickets with no assignee (same as dashboard cards).
    - completion_delay: Stage 2 TAT breach — ``_has_completion_delay`` (planned/actual vs SLA), not Stage 4.
    """
    try:
        return _DASH_TRENDS_CACHE["global"]
    except KeyError:
        pass
    now = datetime.utcnow()
    # Week windows are Monday 00:00:00 -> Sunday 23:59:59 (UTC), last 7 weeks including current week.
    current_week_start = now - timedelta(days=now.weekday())
    current_week_start = datetime(
        current_week_start.year,
        current_week_start.month,
        current_week_start.day,
        0,
        0,
        0,
    )
    data = []
    for i in range(6, -1, -1):
        week_start = current_week_start - timedelta(weeks=i)
        week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
        label = f"{week_start.strftime('%d %b')} - {week_end.strftime('%d %b')}"
        try:
            q = (
                supabase.table("tickets")
                .select(
                    "id, assignee_id, created_at, type, resolved_at, planned_2, actual_2, actual_1, status_2"
                )
                .in_("type", ["chore", "bug"])
                .gte("created_at", week_start.isoformat())
                .lte("created_at", week_end.isoformat())
            )
            r = q.execute()
            tickets = r.data or []
            response_delay = sum(1 for t in tickets if not t.get("assignee_id"))
            completion_delay = sum(
                1
                for t in tickets
                if _has_completion_delay(
                    t.get("resolved_at"),
                    t.get("created_at"),
                    t.get("type"),
                    t.get("planned_2"),
                    t.get("actual_2"),
                    t.get("status_2"),
                    t.get("actual_1"),
                )[0]
            )
            data.append(
                {
                    "month": label,
                    "response_delay": response_delay,
                    "completion_delay": completion_delay,
                }
            )
        except Exception:
            data.append({"month": label, "response_delay": 0, "completion_delay": 0})
    out = {"data": data}
    _DASH_TRENDS_CACHE["global"] = out
    return out


@api_router.get("/dashboard/bootstrap")
def dashboard_bootstrap(auth: dict = Depends(get_current_user)):
    """One round-trip for main dashboard paint: metrics + trends (cached, parallel compute)."""
    email = (auth.get("email") or "").strip().lower() or "anon"
    try:
        return _etag_json(_DASH_BOOTSTRAP_CACHE[email], max_age=45)
    except KeyError:
        pass
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_metrics = pool.submit(dashboard_metrics, auth)
        f_trends = pool.submit(dashboard_trends, auth)
        metrics = f_metrics.result()
        trends = f_trends.result()
    payload = {"metrics": metrics, "trends": trends.get("data") if isinstance(trends, dict) else []}
    _DASH_BOOTSTRAP_CACHE[email] = payload
    return _etag_json(payload, max_age=45)


# ---------- Support Form Lookups ----------
@api_router.get("/companies")
@cached(ttl=30, key_prefix="companies:")
def list_companies(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("companies")
            .select("id, name", count="exact")
            .order("name")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        payload = {"data": r.data or [], "total": r.count or 0, "page": page, "page_size": page_size}
        return _etag_json(payload)
    except Exception:
        payload = {
            "data": [{"id": "1", "name": "Company A"}, {"id": "2", "name": "Company B"}],
            "total": 2,
            "page": 1,
            "page_size": 50,
        }
        return _etag_json(payload)


@api_router.get("/companies/for-invoice")
@cached(ttl=60, key_prefix="companies:invoice:")
def list_invoice_companies(auth: dict = Depends(get_current_user)):
    """Companies allowed in Add / Edit Invoice (canonical master list, ordered)."""
    from app import invoice_companies as ic

    try:
        r = supabase.table("companies").select("id, name").order("name").execute()
        rows = r.data or []
    except Exception as e:
        _log(f"companies/for-invoice: {e}")
        rows = []
    data = ic.build_invoice_company_options(rows)
    payload = {"data": data, "total": len(data)}
    return _etag_json(payload)


@api_router.get("/pages")
@cached(ttl=30, key_prefix="pages:")
def list_pages(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("pages")
            .select("id, name", count="exact")
            .order("name")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        payload = {"data": r.data or [], "total": r.count or 0, "page": page, "page_size": page_size}
        return _etag_json(payload)
    except Exception:
        payload = {
            "data": [{"id": "1", "name": "Dashboard"}, {"id": "2", "name": "Support"}],
            "total": 2,
            "page": 1,
            "page_size": 50,
        }
        return _etag_json(payload)


def _divisions_lookup_response(payload: dict[str, Any]) -> JSONResponse:
    """Support-form lookups must not be browser-cached (empty lists were sticking intermittently)."""
    response = JSONResponse(content=payload)
    response.headers["Cache-Control"] = "no-store"
    return response


@api_router.get("/divisions")
def list_divisions(
    company_id: str | None = None,
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        q = supabase.table("divisions").select("id, name, company_id", count="exact")
        if company_id:
            from app.company_dedupe import (
                company_ids_for_division_lookup,
                dedupe_division_rows,
                division_names_from_ticket_history,
                ensure_divisions_for_companies,
                fetch_company_by_id,
                is_all_company_placeholder,
            )

            anchor_row = fetch_company_by_id(company_id)
            anchor_name = str(anchor_row.get("name") or "") if anchor_row else ""
            all_ids = company_ids_for_division_lookup(company_id)

            def _query_division_rows() -> list[dict[str, Any]]:
                r_all = (
                    supabase.table("divisions")
                    .select("id, name, company_id")
                    .in_("company_id", all_ids)
                    .order("name")
                    .execute()
                )
                return dedupe_division_rows(list(r_all.data or []))

            merged = _query_division_rows()
            if not merged and anchor_name:
                ensure_divisions_for_companies([company_id], anchor_name)
                merged = _query_division_rows()
            if not merged and anchor_name:
                ticket_names = division_names_from_ticket_history(all_ids)
                if ticket_names:
                    ensure_divisions_for_companies(
                        [company_id],
                        anchor_name,
                        extra_division_names=ticket_names,
                    )
                    merged = _query_division_rows()
            if not merged and is_all_company_placeholder(company_id, anchor_name):
                merged = dedupe_division_rows(
                    ensure_divisions_for_companies([company_id], anchor_name or "All Company")
                )
            total = len(merged)
            page_rows = merged[offset : offset + page_size]
            payload = {"data": page_rows, "total": total, "page": page, "page_size": page_size}
            return _divisions_lookup_response(payload)
        r = q.order("name").range(offset, offset + page_size - 1).execute()
        payload = {"data": r.data or [], "total": r.count or 0, "page": page, "page_size": page_size}
        return _divisions_lookup_response(payload)
    except Exception as e:
        _log(f"divisions lookup error: {type(e).__name__}: {str(e)[:200]}")
        return _divisions_lookup_response({"data": [], "total": 0, "page": 1, "page_size": 50})


# ---------- Onboarding > Payment Status ----------
class OnboardingPaymentStatusCreate(BaseModel):
    company_name: str
    payment_status: str  # Done | Not Done
    payment_received_date: date | None = None
    poc_name: str | None = None
    poc_contact: str | None = None
    accounts_remarks: str | None = None


def _generate_payment_reference(company_name: str) -> str:
    """Reference: first 4 alpha chars of company name (uppercase) + -0001/0002..."""
    prefix = "".join(c for c in (company_name or "").upper() if c.isalpha())[:4] or "XXXX"
    try:
        r = supabase.table("onboarding_payment_status").select("reference_no").execute()
        nums = []
        for row in (r.data or []):
            ref = (row or {}).get("reference_no", "")
            if ref.startswith(prefix + "-") and len(ref) > len(prefix) + 1:
                suffix = ref[len(prefix) + 1:]
                if suffix.isdigit():
                    nums.append(int(suffix))
        next_num = max(nums, default=0) + 1
        return f"{prefix}-{next_num:04d}"
    except Exception as e:
        _log(f"onboarding payment reference: {e}")
        return f"{prefix}-{int(datetime.now(timezone.utc).timestamp()) % 10000:04d}"


# Order of onboarding stages (last completed = highest index that has data). Used for Status column.
_ONBOARDING_STAGE_TABLES = [
    ("Final Setup", "onboarding_final_setup", "submitted_at"),
    ("Item & Stock Checklist", "onboarding_item_stock_checklist", "submitted_at"),
    ("Setup Checklist", "onboarding_setup_checklist", "submitted_at"),
    ("Org & Master Checklist", "onboarding_org_master_checklist", "submitted_at"),
    ("Org & Master ID", "onboarding_org_master_id", "any"),
    ("Item Cleaning Checklist", "onboarding_item_cleaning_checklist", "submitted_at"),
    ("Item Cleaning", "onboarding_item_cleaning", "any"),
    ("Details Collected Checklist", "onboarding_details_collected_checklist", "submitted_at"),
    ("POC Details", "onboarding_poc_details", "any"),
    ("POC Checklist", "onboarding_poc_checklist", "submitted_at"),
    ("Pre-Onboarding Checklist", "onboarding_pre_onboarding_checklist", "submitted_at"),
    ("Pre-Onboarding", "onboarding_pre_onboarding", "submitted_at"),
]


def _get_onboarding_stage_status(payment_status_ids: list) -> dict:
    """Return dict payment_status_id -> last completed stage label (e.g. 'POC Checklist')."""
    if not payment_status_ids:
        return {}
    out = {}
    for label, table, key in _ONBOARDING_STAGE_TABLES:
        try:
            if key == "any":
                r = supabase.table(table).select("payment_status_id").in_("payment_status_id", payment_status_ids).execute()
            else:
                r = supabase.table(table).select("payment_status_id").in_("payment_status_id", payment_status_ids).not_.is_(key, "null").execute()
            for row in (r.data or []):
                pid = row.get("payment_status_id")
                if pid and pid not in out:
                    out[pid] = label
        except Exception:
            continue
    return out


@api_router.get("/onboarding/payment-status")
@cached(ttl=30, key_prefix="onboarding:payment-status:")
def list_onboarding_payment_status(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """List all onboarding payment status records, newest first. Each item includes 'status' = last completed stage and 'fi_do' = Done if Final step submitted else Not Done."""
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("onboarding_payment_status")
            .select(
                "id,timestamp,reference_no,company_name,payment_status,payment_received_date,poc_name,poc_contact,accounts_remarks",
                count="exact",
            )
            .order("timestamp", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = r.data or []
        ids = [row.get("id") for row in rows if row.get("id")]
        status_map = _get_onboarding_stage_status(ids)
        # Fi-DO: Done if Final step (Final Setup) data submitted, else Not Done
        final_setup_ids = set()
        try:
            fs = supabase.table("onboarding_final_setup").select("payment_status_id").execute()
            for x in (fs.data or []):
                pid = x.get("payment_status_id")
                if pid:
                    final_setup_ids.add(pid)
        except Exception:
            pass
        for row in rows:
            row["status"] = status_map.get(row.get("id")) or "—"
            row["fi_do"] = "Done" if row.get("id") in final_setup_ids else "Not Done"
        return {"data": rows, "total": r.count or 0, "page": page, "page_size": page_size}
    except Exception as e:
        _log(f"onboarding payment status list: {e}")
        return {"data": [], "total": 0, "page": 1, "page_size": 50}


@api_router.post("/onboarding/payment-status")
def create_onboarding_payment_status(payload: OnboardingPaymentStatusCreate, auth: dict = Depends(get_current_user)):
    """Create payment status record. Auto-generates timestamp and reference_no."""
    if payload.payment_status not in ("Done", "Not Done"):
        raise HTTPException(400, "payment_status must be 'Done' or 'Not Done'")
    company_name = (payload.company_name or "").strip()
    if not company_name:
        raise HTTPException(400, "company_name is required")
    if not payload.payment_received_date:
        raise HTTPException(400, "payment_received_date is required")
    poc_name = (payload.poc_name or "").strip()
    if not poc_name:
        raise HTTPException(400, "poc_name is required")
    poc_contact = (payload.poc_contact or "").strip()
    if not poc_contact or not (poc_contact.isdigit() and len(poc_contact) == 10):
        raise HTTPException(400, "poc_contact is required and must be 10 digits")
    try:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        ref = _generate_payment_reference(company_name)
        row = {
            "timestamp": now,
            "reference_no": ref,
            "company_name": company_name,
            "payment_status": payload.payment_status,
            "payment_received_date": payload.payment_received_date.isoformat() if payload.payment_received_date else None,
            "poc_name": poc_name,
            "poc_contact": poc_contact,
            "accounts_remarks": (payload.accounts_remarks or "").strip() or None,
        }
        r = supabase.table("onboarding_payment_status").insert(row).execute()
        created = (r.data or [{}])[0]
        created["timestamp"] = now
        return created
    except HTTPException:
        raise
    except Exception as e:
        _log(f"onboarding payment status create: {e}")
        raise HTTPException(400, str(e)[:200])


# ---------- DB Client > Client ONB ----------
def _generate_client_onb_reference() -> str:
    """Sequential reference EX-ONB-IMP-0001, EX-ONB-IMP-0002, …"""
    try:
        r = supabase.table("db_client_client_onb").select("reference_no").execute()
        nums = []
        for row in (r.data or []):
            ref = str((row or {}).get("reference_no") or "")
            ru = ref.upper()
            if ru.startswith("EX-ONB-IMP-") and len(ref) > 11:
                suffix = ref[11:]
                if suffix.isdigit():
                    nums.append(int(suffix))
                    continue
            # Backward compatibility: older records may still be ONB-0001 style.
            if ru.startswith("ONB-") and len(ref) > 4:
                suffix = ref[4:]
                if suffix.isdigit():
                    nums.append(int(suffix))
        next_num = max(nums, default=0) + 1
        return f"EX-ONB-IMP-{next_num:04d}"
    except Exception as e:
        _log(f"client onb reference: {e}")
        return f"EX-ONB-IMP-{int(datetime.now(timezone.utc).timestamp()) % 100000:05d}"


def _format_client_duration_days(since: date | None, till: date | None) -> str | None:
    if not since or not till:
        return None
    try:
        d = (till - since).days
        if d < 0:
            return None
        return f"{d} day{'s' if d != 1 else ''}"
    except Exception:
        return None


class ClientOnbCreate(BaseModel):
    """All fields required on create (validated + non-empty after strip)."""

    organization_name: str
    company_name: str
    contact_person: str
    mobile_no: str
    email_id: str
    paid_divisions: str
    division_abbreviation: str
    name_of_divisions_cost_details: str
    amount_paid_per_division: str
    total_amount_paid_per_month: str
    payment_frequency: str
    client_since: date
    client_till: date
    client_duration: str
    total_amount_paid_till_date: str
    tds_percent: str
    client_location_city: str
    client_location_state: str
    remarks: str
    whatsapp_group_details: str

    @model_validator(mode="after")
    def strip_and_require_nonempty(self):
        str_names = (
            "organization_name",
            "company_name",
            "contact_person",
            "mobile_no",
            "email_id",
            "paid_divisions",
            "division_abbreviation",
            "name_of_divisions_cost_details",
            "amount_paid_per_division",
            "total_amount_paid_per_month",
            "payment_frequency",
            "client_duration",
            "total_amount_paid_till_date",
            "tds_percent",
            "client_location_city",
            "client_location_state",
            "remarks",
            "whatsapp_group_details",
        )
        for name in str_names:
            raw = getattr(self, name)
            if raw is None:
                raise ValueError(f"{name} is required")
            s = str(raw).strip()
            if not s:
                raise ValueError(f"{name} is required")
            setattr(self, name, s)
        return self


class ClientOnbUpdate(BaseModel):
    organization_name: str | None = None
    company_name: str | None = None
    contact_person: str | None = None
    mobile_no: str | None = None
    email_id: str | None = None
    paid_divisions: str | None = None
    division_abbreviation: str | None = None
    name_of_divisions_cost_details: str | None = None
    amount_paid_per_division: str | None = None
    total_amount_paid_per_month: str | None = None
    payment_frequency: str | None = None
    client_since: date | None = None
    client_till: date | None = None
    client_duration: str | None = None
    total_amount_paid_till_date: str | None = None
    tds_percent: str | None = None
    client_location_city: str | None = None
    client_location_state: str | None = None
    remarks: str | None = None
    whatsapp_group_details: str | None = None
    last_contacted_on: date | None = None
    remarks_2: str | None = None
    follow_up_needed: str | None = None


class ClientOnbFollowUpPayload(BaseModel):
    last_contacted_on: date | None = None
    remarks_2: str | None = None
    follow_up_needed: str | None = None

    @field_validator("follow_up_needed")
    @classmethod
    def normalize_follow_up(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        low = s.lower()
        if low in ("yes", "y"):
            return "Yes"
        if low in ("no", "n"):
            return "No"
        return s


class ClientOnbStatusPayload(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        x = (v or "").strip().lower()
        if x not in ("active", "inactive"):
            raise ValueError("status must be 'active' or 'inactive'")
        return x


def _client_onb_strip(s: str | None) -> str | None:
    t = (s or "").strip()
    return t if t else None


@api_router.get("/db-client/client-onb")
@cached(ttl=30, key_prefix="db-client:onb:")
def list_db_client_client_onb(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """List Client ONB rows, newest first."""
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("db_client_client_onb")
            .select(
                "id,timestamp,reference_no,organization_name,company_name,contact_person,mobile_no,email_id,client_since,client_till,client_duration,status,last_contacted_on,remarks_2,follow_up_needed",
                count="exact",
            )
            .order("timestamp", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = r.data or []
        for row in rows:
            st = row.get("status")
            if not st or str(st).strip().lower() not in ("active", "inactive"):
                row["status"] = "active"
            else:
                row["status"] = str(st).strip().lower()
            if not row.get("client_duration"):
                cs, ct = row.get("client_since"), row.get("client_till")
                if cs and ct:
                    try:
                        d1 = date.fromisoformat(str(cs)[:10])
                        d2 = date.fromisoformat(str(ct)[:10])
                        row["client_duration"] = _format_client_duration_days(d1, d2)
                    except Exception:
                        pass
        return {"data": rows, "total": r.count or 0, "page": page, "page_size": page_size}
    except Exception as e:
        _log(f"db client onb list: {e}")
        return {"data": [], "total": 0, "page": 1, "page_size": 50}


@api_router.get("/db-client/client-onb/status-column-check")
def client_onb_status_column_check(auth: dict = Depends(get_current_user)):
    """Returns ok=true if `db_client_client_onb.status` exists (needed for Active/Inactive)."""
    try:
        supabase.table("db_client_client_onb").select("id, status").limit(1).execute()
        return {"ok": True}
    except Exception as e:
        err = str(e)
        _log(f"db client onb status column check: {e}")
        low = err.lower()
        if "status" in low or "column" in low or "42703" in err or "pgrst" in low:
            return {
                "ok": False,
                "hint": "Run docs/SUPABASE_DB_CLIENT_CLIENT_ONB_ADD_STATUS.sql in the Supabase SQL Editor, then refresh.",
            }
        return {"ok": False, "hint": err[:240]}


@api_router.post("/db-client/client-onb")
def create_db_client_client_onb(payload: ClientOnbCreate, auth: dict = Depends(get_current_user)):
    """Create Client ONB. All fields required. Auto timestamp, reference_no; status active."""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    ref = _generate_client_onb_reference()
    since, till = payload.client_since, payload.client_till
    row = {
        "timestamp": now,
        "reference_no": ref,
        "organization_name": payload.organization_name,
        "company_name": payload.company_name,
        "contact_person": payload.contact_person,
        "mobile_no": payload.mobile_no,
        "email_id": payload.email_id,
        "paid_divisions": payload.paid_divisions,
        "division_abbreviation": payload.division_abbreviation,
        "name_of_divisions_cost_details": payload.name_of_divisions_cost_details,
        "amount_paid_per_division": payload.amount_paid_per_division,
        "total_amount_paid_per_month": payload.total_amount_paid_per_month,
        "payment_frequency": payload.payment_frequency,
        "client_since": since.isoformat(),
        "client_till": till.isoformat(),
        "client_duration": payload.client_duration,
        "total_amount_paid_till_date": payload.total_amount_paid_till_date,
        "tds_percent": payload.tds_percent,
        "client_location_city": payload.client_location_city,
        "client_location_state": payload.client_location_state,
        "remarks": payload.remarks,
        "whatsapp_group_details": payload.whatsapp_group_details,
        "updated_at": now,
        "status": "active",
    }
    try:
        ins = supabase.table("db_client_client_onb").insert(row).execute()
        created = (ins.data or [{}])[0]
        return created
    except Exception as e:
        _log(f"db client onb create: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.patch("/db-client/client-onb/{row_id}/status")
def patch_db_client_client_onb_status(
    row_id: str,
    payload: ClientOnbStatusPayload,
    _auth: dict = Depends(get_current_user),
):
    """Set Active / Inactive. Any authenticated user (same as list access)."""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        ex = supabase.table("db_client_client_onb").select("id").eq("id", row_id).limit(1).execute()
        if not (ex.data or []):
            raise HTTPException(404, "Record not found")
        supabase.table("db_client_client_onb").update({"status": payload.status, "updated_at": now}).eq("id", row_id).execute()
        r2 = supabase.table("db_client_client_onb").select("*").eq("id", row_id).limit(1).execute()
        return (r2.data or [{}])[0]
    except HTTPException:
        raise
    except Exception as e:
        _log(f"db client onb status: {e}")
        err = str(e)
        low = err.lower()
        if "status" in low and ("column" in low or "does not exist" in low or "42703" in err):
            raise HTTPException(
                503,
                "Database column `status` is missing. In Supabase → SQL Editor, run the script in docs/SUPABASE_DB_CLIENT_CLIENT_ONB_ADD_STATUS.sql, then try again.",
            )
        raise HTTPException(400, err[:200])


@api_router.patch("/db-client/client-onb/{row_id}/follow-up")
def patch_db_client_client_onb_follow_up(
    row_id: str,
    payload: ClientOnbFollowUpPayload,
    _auth: dict = Depends(get_current_user),
):
    """Update Last contacted / Remarks2 / Follow-up (Inactive clients workflow)."""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    pdata = payload.model_dump(exclude_unset=True)
    updates: dict = {"updated_at": now}
    if "last_contacted_on" in pdata:
        lc = pdata["last_contacted_on"]
        updates["last_contacted_on"] = lc.isoformat() if isinstance(lc, date) else lc
    if "remarks_2" in pdata:
        updates["remarks_2"] = _client_onb_strip(pdata["remarks_2"]) if pdata["remarks_2"] is not None else None
    if "follow_up_needed" in pdata:
        updates["follow_up_needed"] = pdata["follow_up_needed"]
    try:
        ex = supabase.table("db_client_client_onb").select("id").eq("id", row_id).limit(1).execute()
        if not (ex.data or []):
            raise HTTPException(404, "Record not found")
        if len(updates) == 1:
            r0 = supabase.table("db_client_client_onb").select("*").eq("id", row_id).limit(1).execute()
            return (r0.data or [{}])[0]
        supabase.table("db_client_client_onb").update(updates).eq("id", row_id).execute()
        r2 = supabase.table("db_client_client_onb").select("*").eq("id", row_id).limit(1).execute()
        return (r2.data or [{}])[0]
    except HTTPException:
        raise
    except Exception as e:
        _log(f"db client onb follow-up: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.put("/db-client/client-onb/{row_id}")
def update_db_client_client_onb(
    row_id: str,
    payload: ClientOnbUpdate,
    _master: dict = Depends(require_roles(["master_admin"])),
):
    """Update a Client ONB row. Master Admin only."""
    try:
        ex = supabase.table("db_client_client_onb").select("*").eq("id", row_id).limit(1).execute()
        cur = (ex.data or [None])[0]
        if not cur:
            raise HTTPException(404, "Record not found")
    except HTTPException:
        raise
    except Exception as e:
        _log(f"db client onb fetch: {e}")
        raise HTTPException(400, str(e)[:200])

    updates: dict = {}
    fields = [
        "organization_name",
        "company_name",
        "contact_person",
        "mobile_no",
        "email_id",
        "paid_divisions",
        "division_abbreviation",
        "name_of_divisions_cost_details",
        "amount_paid_per_division",
        "total_amount_paid_per_month",
        "payment_frequency",
        "total_amount_paid_till_date",
        "tds_percent",
        "client_location_city",
        "client_location_state",
        "remarks",
        "whatsapp_group_details",
        "client_duration",
        "remarks_2",
        "follow_up_needed",
    ]
    pdata = payload.model_dump(exclude_unset=True)
    for f in fields:
        if f not in pdata:
            continue
        v = pdata[f]
        if v is None:
            updates[f] = None
        elif isinstance(v, str):
            updates[f] = _client_onb_strip(v)
        else:
            updates[f] = v

    if "client_since" in pdata:
        cs = pdata["client_since"]
        updates["client_since"] = cs.isoformat() if isinstance(cs, date) else cs
    if "client_till" in pdata:
        ct = pdata["client_till"]
        updates["client_till"] = ct.isoformat() if isinstance(ct, date) else ct
    if "last_contacted_on" in pdata:
        lc = pdata["last_contacted_on"]
        updates["last_contacted_on"] = lc.isoformat() if isinstance(lc, date) else lc

    merged_org = updates.get("organization_name", cur.get("organization_name"))
    merged_comp = updates.get("company_name", cur.get("company_name"))
    if not (str(merged_org or "").strip() or str(merged_comp or "").strip()):
        raise HTTPException(400, "organization_name or company_name is required")

    since = updates.get("client_since", cur.get("client_since"))
    till = updates.get("client_till", cur.get("client_till"))
    since_s = str(since)[:10] if since else ""
    till_s = str(till)[:10] if till else ""

    if "client_duration" not in updates and since_s and till_s:
        try:
            d1 = date.fromisoformat(since_s)
            d2 = date.fromisoformat(till_s)
            updates["client_duration"] = _format_client_duration_days(d1, d2)
        except Exception:
            pass

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    updates["updated_at"] = now
    if len(updates) == 1:
        return cur

    try:
        supabase.table("db_client_client_onb").update(updates).eq("id", row_id).execute()
        r2 = supabase.table("db_client_client_onb").select("*").eq("id", row_id).limit(1).execute()
        return (r2.data or [cur])[0]
    except Exception as e:
        _log(f"db client onb update: {e}")
        raise HTTPException(400, str(e)[:200])


# PostgREST URL limits + large IN lists: batch id filters (Raised Invoices list).
_OCP_ID_IN_BATCH = 120


def _chunk_ids(ids: list, batch_size: int):
    for i in range(0, len(ids), batch_size):
        yield ids[i : i + batch_size]


def _get_client_payment_ids_with_sent(client_payment_ids: list) -> set:
    """Return set of client_payment ids that have Invoice Sent details submitted (row in onboarding_client_payment_sent)."""
    if not client_payment_ids:
        return set()
    out = set()
    try:
        for chunk in _chunk_ids(client_payment_ids, _OCP_ID_IN_BATCH):
            r = (
                supabase.table("onboarding_client_payment_sent")
                .select("client_payment_id")
                .in_("client_payment_id", chunk)
                .execute()
            )
            for row in (r.data or []):
                cid = row.get("client_payment_id")
                if cid:
                    out.add(str(cid))
        return out
    except Exception as e:
        _log(f"client payment sent lookup: {e}")
        return set()


def _get_client_payment_ids_with_followup1(client_payment_ids: list) -> set:
    """Return set of client_payment ids that have Follow up 1 submitted (legacy onboarding_client_payment_followup1)."""
    if not client_payment_ids:
        return set()
    out = set()
    try:
        for chunk in _chunk_ids(client_payment_ids, _OCP_ID_IN_BATCH):
            r = (
                supabase.table("onboarding_client_payment_followup1")
                .select("client_payment_id")
                .in_("client_payment_id", chunk)
                .execute()
            )
            for row in (r.data or []):
                cid = row.get("client_payment_id")
                if cid:
                    out.add(str(cid))
        return out
    except Exception as e:
        _log(f"client payment followup1 lookup: {e}")
        return set()


def _get_client_payment_max_followup(client_payment_ids: list) -> dict:
    """Return dict client_payment_id -> max followup_no (1-10) from onboarding_client_payment_followups. Falls back to 1 if only legacy followup1 exists."""
    out = {}
    if not client_payment_ids:
        return out

    def _merge_followup_rows(rows: list) -> None:
        for row in rows:
            cid = str(row.get("client_payment_id")) if row.get("client_payment_id") else None
            if cid:
                no = row.get("followup_no")
                if no is not None:
                    out[cid] = max(out.get(cid, 0), int(no))

    try:
        # Parallel: multi-followup rows vs legacy followup1 (two round-trips at once).
        def load_followups_table():
            acc = []
            for chunk in _chunk_ids(client_payment_ids, _OCP_ID_IN_BATCH):
                r = (
                    supabase.table("onboarding_client_payment_followups")
                    .select("client_payment_id, followup_no")
                    .in_("client_payment_id", chunk)
                    .execute()
                )
                acc.extend(r.data or [])
            return acc

        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_rows = pool.submit(load_followups_table)
            fut_legacy = pool.submit(_get_client_payment_ids_with_followup1, client_payment_ids)
            follow_rows = fut_rows.result()
            legacy_set = fut_legacy.result()

        _merge_followup_rows(follow_rows)
        for cid in legacy_set:
            if cid and out.get(cid, 0) < 1:
                out[cid] = 1
    except Exception as e:
        _log(f"client payment max followup lookup: {e}")
        legacy = _get_client_payment_ids_with_followup1(client_payment_ids)
        for cid in legacy:
            if cid and out.get(cid, 0) < 1:
                out[cid] = 1
    return out


# Columns needed for list (avoid SELECT *)
_OCP_LIST_COLUMNS_BASE = "id,timestamp,reference_no,company_name,invoice_date,invoice_amount,invoice_number,genre,stage,payment_received_date"
_OCP_PAY_ROWS_COLUMNS_BASE = "id,company_name,invoice_amount,invoice_date,timestamp,payment_received_date,genre"
_MARKED_NA_COLUMN_SUPPORTED: bool | None = None


def _client_payment_marked_na_supported() -> bool:
    """True when database/CLIENT_PAYMENT_MARKED_NA.sql has been applied."""
    global _MARKED_NA_COLUMN_SUPPORTED
    if _MARKED_NA_COLUMN_SUPPORTED is True:
        return True
    try:
        supabase.table("onboarding_client_payment").select("marked_na").limit(1).execute()
        _MARKED_NA_COLUMN_SUPPORTED = True
        return True
    except Exception as e:
        err = str(e).lower()
        if "marked_na" not in err or ("does not exist" not in err and "42703" not in err):
            _log(f"marked_na column probe: {e}")
        return False


def _ocp_list_select_columns() -> str:
    """Always request marked_na when present (NA KPIs and list filters depend on it)."""
    return f"{_OCP_LIST_COLUMNS_BASE},marked_na"


def _ocp_pay_rows_select_columns() -> str:
    return f"{_OCP_PAY_ROWS_COLUMNS_BASE},marked_na"


def _ocp_query_exclude_marked_na(q):
    """Drop invoices explicitly marked NA from Payment KPIs and Due.

    Uses (marked_na IS NULL OR marked_na = false) so legacy rows stay visible if the column was backfilled.
    """
    if not _client_payment_marked_na_supported():
        return q
    return q.or_("marked_na.is.null,marked_na.eq.false")


# Safety cap when paginating all invoice rows from Supabase (1000 × 500 = 500k rows max).
_OCP_AGG_PAGE_SIZE = 1000
_OCP_AGG_MAX_PAGES = 500
# Payment-summary must finish within Render's ~30s HTTP limit (local uvicorn has no such cap).
_PAYMENT_SUMMARY_PAY_ROW_LIMIT = 8000
_PAYMENT_SUMMARY_RECEIVE_MAX_PAGES = 10
_PAYMENT_SUMMARY_AGG_MAX_PAGES = 22
_PAYMENT_SUMMARY_CACHE: dict[str, dict] = {}
_PAYMENT_SUMMARY_CACHE_TTL_SEC = 60


def _invalidate_payment_summary_cache() -> None:
    _PAYMENT_SUMMARY_CACHE.clear()


def _sum_payment_invoice_totals_combined(*, max_pages: int = _PAYMENT_SUMMARY_AGG_MAX_PAGES) -> dict[str, int]:
    """One table scan for lifetime raised, unpaid excl. NA, and unpaid NA (faster than 3 separate scans)."""
    cols = (
        "invoice_amount,payment_received_date,marked_na"
        if _client_payment_marked_na_supported()
        else "invoice_amount,payment_received_date"
    )
    out = {"lifetime_raised_excl_na": 0, "total_due": 0, "na_marked_unpaid_invoice_total": 0}
    offset = 0
    pages = 0
    page_cap = max(1, min(_OCP_AGG_MAX_PAGES, int(max_pages or _PAYMENT_SUMMARY_AGG_MAX_PAGES)))
    while pages < page_cap:
        try:
            q = supabase.table("onboarding_client_payment").select(cols).order("id")
            q = q.range(offset, offset + _OCP_AGG_PAGE_SIZE - 1)
            r = q.execute()
        except Exception as e:
            _log(f"payment invoice totals combined page: {e}")
            break
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            is_na = _client_payment_row_marked_na(row)
            unpaid = _client_payment_row_unpaid(row)
            amt = _parse_invoice_amount(row.get("invoice_amount"))
            if not is_na:
                out["lifetime_raised_excl_na"] += amt
            if unpaid and is_na:
                out["na_marked_unpaid_invoice_total"] += amt
            elif unpaid and not is_na:
                out["total_due"] += amt
        if len(rows) < _OCP_AGG_PAGE_SIZE:
            break
        offset += _OCP_AGG_PAGE_SIZE
        pages += 1
    return {k: int(v) for k, v in out.items()}


def _sum_invoice_amount_pages(
    *,
    exclude_na_marked: bool,
    unpaid_only: bool,
    na_marked_only: bool,
    max_pages: int | None = None,
) -> int:
    """Sum invoice_amount with stable pagination by id."""
    total = 0
    offset = 0
    pages = 0
    page_cap = _OCP_AGG_MAX_PAGES if max_pages is None else max(1, min(_OCP_AGG_MAX_PAGES, int(max_pages)))
    while pages < page_cap:
        try:
            q = supabase.table("onboarding_client_payment").select("invoice_amount").order("id")
            if exclude_na_marked:
                q = _ocp_query_exclude_marked_na(q)
            if unpaid_only:
                q = q.is_("payment_received_date", "null")
            if na_marked_only:
                if not _client_payment_marked_na_supported():
                    break
                q = q.eq("marked_na", True)
            q = q.range(offset, offset + _OCP_AGG_PAGE_SIZE - 1)
            r = q.execute()
        except Exception as e:
            err = str(e).lower()
            if na_marked_only and "marked_na" in err and ("does not exist" in err or "42703" in err):
                global _MARKED_NA_COLUMN_SUPPORTED
                _MARKED_NA_COLUMN_SUPPORTED = False
                return 0
            _log(f"invoice amount aggregate page: {e}")
            break
        rows = r.data or []
        if not rows:
            break
        total += sum(_parse_invoice_amount(row.get("invoice_amount")) for row in rows)
        if len(rows) < _OCP_AGG_PAGE_SIZE:
            break
        offset += _OCP_AGG_PAGE_SIZE
        pages += 1
    return int(total)


def _sum_all_raised_invoice_excl_na() -> int:
    """Lifetime gross invoice amounts excluding NA-marked rows (every invoice_date)."""
    if _client_payment_marked_na_supported():
        return _sum_invoice_amount_pages(exclude_na_marked=True, unpaid_only=False, na_marked_only=False)
    return _sum_invoice_amount_pages(exclude_na_marked=False, unpaid_only=False, na_marked_only=False)


def _sum_unpaid_invoice_marked_na() -> int:
    """Sum of unpaid invoice rows explicitly marked NA (excluded from due and lifetime)."""
    if not _client_payment_marked_na_supported():
        return 0
    return _sum_invoice_amount_pages(exclude_na_marked=False, unpaid_only=True, na_marked_only=True)


def _fetch_client_payment_receive_by_cp_id(*, max_pages: int = _PAYMENT_SUMMARY_RECEIVE_MAX_PAGES) -> dict[str, dict]:
    """Payment-receive rows keyed by client_payment_id (paginated; capped for HTTP latency)."""
    by_id: dict[str, dict] = {}
    offset = 0
    pages = 0
    page_cap = max(1, min(_OCP_AGG_MAX_PAGES, int(max_pages or _PAYMENT_SUMMARY_RECEIVE_MAX_PAGES)))
    while pages < page_cap:
        try:
            r = (
                supabase.table("onboarding_client_payment_receive")
                .select("client_payment_id,amount,payment_date")
                .order("client_payment_id")
                .range(offset, offset + _OCP_AGG_PAGE_SIZE - 1)
                .execute()
            )
        except Exception as e:
            _log(f"client payment receive page: {e}")
            break
        rows = r.data or []
        if not rows:
            break
        for rec in rows:
            cid = str(rec.get("client_payment_id") or "").strip()
            if cid:
                by_id[cid] = rec
        if len(rows) < _OCP_AGG_PAGE_SIZE:
            break
        offset += _OCP_AGG_PAGE_SIZE
        pages += 1
    return by_id


def _fetch_client_payment_rows_for_metrics(limit: int = 5000) -> list[dict]:
    """Load payment rows for dashboard KPIs and ageing; includes id/company for receive joins."""
    cols = _ocp_pay_rows_select_columns()
    all_rows: list[dict] = []
    offset = 0
    pages = 0
    if limit and int(limit) > 0:
        max_pages = max(1, min(_OCP_AGG_MAX_PAGES, (int(limit) + _OCP_AGG_PAGE_SIZE - 1) // _OCP_AGG_PAGE_SIZE))
    else:
        max_pages = _OCP_AGG_MAX_PAGES

    use_na_cols = True
    while pages < max_pages:
        try:
            q = supabase.table("onboarding_client_payment").select(cols).order("id")
            if use_na_cols:
                q = _ocp_query_exclude_marked_na(q)
            r = q.range(offset, offset + _OCP_AGG_PAGE_SIZE - 1).execute()
        except Exception as e:
            err = str(e).lower()
            if use_na_cols and "marked_na" in err and ("does not exist" in err or "42703" in err):
                global _MARKED_NA_COLUMN_SUPPORTED
                _MARKED_NA_COLUMN_SUPPORTED = False
                use_na_cols = False
                cols = _OCP_PAY_ROWS_COLUMNS_BASE
                offset = 0
                pages = 0
                all_rows = []
                continue
            _log(f"client payment metrics rows page: {e}")
            break
        rows = r.data or []
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < _OCP_AGG_PAGE_SIZE:
            break
        offset += _OCP_AGG_PAGE_SIZE
        pages += 1
    return all_rows


def _sum_unpaid_client_payment_excluding_na(limit: int = 5000) -> int:
    """Total Due — unpaid invoices excluding NA-marked (exact sum via pagination when NA column exists)."""
    try:
        if _client_payment_marked_na_supported():
            return int(
                _sum_invoice_amount_pages(
                    exclude_na_marked=True,
                    unpaid_only=True,
                    na_marked_only=False,
                )
            )
        r = (
            supabase.table("onboarding_client_payment")
            .select("invoice_amount")
            .is_("payment_received_date", "null")
            .limit(limit)
            .execute()
        )
        return sum(_parse_invoice_amount(row.get("invoice_amount")) for row in (r.data or []))
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("does not exist" in err or "42703" in err):
            global _MARKED_NA_COLUMN_SUPPORTED
            _MARKED_NA_COLUMN_SUPPORTED = False
            try:
                r = (
                    supabase.table("onboarding_client_payment")
                    .select("invoice_amount")
                    .is_("payment_received_date", "null")
                    .limit(limit)
                    .execute()
                )
                return sum(_parse_invoice_amount(row.get("invoice_amount")) for row in (r.data or []))
            except Exception:
                return 0
        _log(f"client payment unpaid sum: {e}")
        return 0


_LIST_CLIENT_PAYMENT_LIMIT = 500


@api_router.get("/onboarding/client-payment/capabilities")
def client_payment_capabilities(auth: dict = Depends(get_current_user)):
    """Feature flags for Payment Management UI (NA filter, mark NA)."""
    return {"marked_na_supported": _client_payment_marked_na_supported()}


@api_router.get("/onboarding/client-payment")
@cached(ttl=30, key_prefix="onboarding:client-payment:")
def list_client_payment(
    auth: dict = Depends(get_current_user),
    status: str = None,
    section: str = None,
    genre: str = None,
    na_view: str = Query("active", description="active = hide NA rows; na = only NA-marked rows"),
    page: int = 1,
    page_size: int = Query(50, le=200),
):
    """List Raised Invoices. status=open (default): Payment Management (no payment received). status=completed&section=Gener|Q-Comp|M-Comp|HF-Comp|Comp-Register: completed by genre. Comp-Register merges Q/M/HY; optional ``genre`` query narrows to one letter."""
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        q = supabase.table("onboarding_client_payment").select(_ocp_list_select_columns(), count="exact").order("timestamp", desc=True)
        if status == "completed" and section:
            q = q.not_.is_("payment_received_date", "null")
            if section == "Comp-Register":
                g = (genre or "").strip().upper()
                if g in ("M", "Q", "HY", "Y"):
                    q = q.eq("genre", g)
                else:
                    q = q.in_("genre", ["Q", "M", "HY"])
            elif section == "Q-Comp":
                q = q.eq("genre", "Q")
            elif section == "M-Comp":
                q = q.eq("genre", "M")
            elif section == "HF-Comp":
                q = q.eq("genre", "HY")
            # Gener = General (Y or not M/Q/HY): filter in Python
        else:
            # Open / Payment Management: unpaid only (payment_received_date IS NULL).
            q = q.is_("payment_received_date", "null")
            if _client_payment_marked_na_supported():
                nv = (na_view or "active").strip().lower()
                if nv == "na":
                    q = q.eq("marked_na", True)
                else:
                    q = _ocp_query_exclude_marked_na(q)
        q = q.range(offset, offset + page_size - 1)
        r = q.execute()
        items = r.data or []
        if status == "completed" and section and section == "Gener":
            items = [x for x in items if (x.get("genre") == "Y" or x.get("genre") not in ("M", "Q", "HY"))]
        _enrich_client_payment_list_items(items)
        return {
            "data": items,
            "total": r.count or 0,
            "page": page,
            "page_size": page_size,
            "marked_na_supported": _client_payment_marked_na_supported(),
        }
    except Exception as e:
        _log(f"client payment list: {e}")
        return {"data": [], "total": 0, "page": 1, "page_size": 50, "marked_na_supported": False}


def _norm_name_company(s: str | None) -> str:
    """Delegate to shared normalizer (see ``app.payment_ageing.normalize_company_name``)."""
    return _pa.normalize_company_name(s)


def _dedupe_ageing_display_rows(rows: list[dict], nq: int) -> list[dict]:
    """Merge rows that differ only by punctuation/spacing (same logical company)."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        k = _norm_name_company(r.get("company_name"))
        if not k:
            continue
        groups.setdefault(k, []).append(r)
    out: list[dict] = []
    for _k, grp in groups.items():
        if len(grp) == 1:
            out.append(grp[0])
            continue
        qd: list[int | None] = [None] * nq
        for r in grp:
            rd = r.get("quarter_days") or []
            for i in range(min(nq, len(rd))):
                if rd[i] is not None:
                    qd[i] = rd[i]
        amt = max(int(x.get("amount_incl_gst") or 0) for x in grp)
        rec = max(int(x.get("received_amount") or 0) for x in grp)
        cid_row = next((x for x in grp if x.get("company_id")), None)
        if cid_row:
            name = (cid_row.get("company_name") or "").strip()
            cid = cid_row.get("company_id")
        else:
            best = max(grp, key=lambda x: int(x.get("amount_incl_gst") or 0))
            name = (best.get("company_name") or "").strip()
            cid = best.get("company_id")
        med = _pa.average_int(qd)
        last_q = qd[-1] if len(qd) == nq else None
        fd_merged: list[date] = []
        for x in grp:
            fd0 = _pa._parse_date(x.get("first_invoice_date"))
            if fd0:
                fd_merged.append(fd0)
        fd_min = min(fd_merged) if fd_merged else None
        out.append(
            {
                "company_id": cid,
                "company_name": name,
                "amount_incl_gst": amt,
                "quarter_days": qd,
                "median_value": med,
                "last_quarter_days": int(last_q) if last_q is not None else None,
                "received_amount": rec,
                "first_invoice_date": fd_min.isoformat() if fd_min else None,
            }
        )
    return out


def _parse_invoice_amount(val) -> int:
    if val is None:
        return 0
    if isinstance(val, bool):
        return 0
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip().replace(",", "")
    if s.isdigit():
        return int(s)
    try:
        return int(float(s))
    except ValueError:
        return 0


def _client_payment_row_unpaid(row: dict) -> bool:
    pr = row.get("payment_received_date")
    return pr is None or (isinstance(pr, str) and not str(pr).strip())


def _client_payment_row_marked_na(row: dict) -> bool:
    v = row.get("marked_na")
    if v is None or v is False:
        return False
    if isinstance(v, str) and v.strip().lower() in ("false", "f", "0", "no", "n", ""):
        return False
    if v is True:
        return True
    if v in (1, 1.0):
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "t", "1", "yes"):
        return True
    return False


def _normalize_client_payment_genre(raw: object) -> str:
    """Map stored / legacy genre labels to M, Q, HY, Y."""
    g = (str(raw or "").strip().upper())
    if not g:
        return ""
    if g in ("M", "MONTHLY"):
        return "M"
    if g in ("Q", "QUARTERLY"):
        return "Q"
    if g in ("HY", "HALF YEARLY", "HALF-YEARLY", "HALF_YEARLY", "HALFYEARLY"):
        return "HY"
    if g in ("Y", "YEARLY", "ANNUAL"):
        return "Y"
    if "QUARTER" in g:
        return "Q"
    if "MONTH" in g:
        return "M"
    if "HALF" in g and "Y" in g:
        return "HY"
    if "YEAR" in g:
        return "Y"
    return g


def _client_payment_received_quarter_anchor(row: dict) -> date | None:
    """Date used to attribute *received* amounts to a fiscal quarter: payment date, else invoice/timestamp."""
    pd = _pa._parse_date(row.get("payment_received_date"))
    if pd:
        return pd
    return _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))


def _enrich_client_payment_list_items(items: list[dict]) -> None:
    """Set status, aging_days, stage on each row (same rules as Payment Management list)."""
    if not items:
        return
    ids = [str(row.get("id")) for row in items if row.get("id")]
    ids_with_sent: set[str] = set()
    max_followup: dict[str, int] = {}
    if ids:
        try:
            with ThreadPoolExecutor(max_workers=2) as _pool:
                _f_sent = _pool.submit(_get_client_payment_ids_with_sent, ids)
                _f_max = _pool.submit(_get_client_payment_max_followup, ids)
                ids_with_sent = _f_sent.result()
                max_followup = _f_max.result()
        except Exception:
            pass
    today = date.today()
    for row in items:
        row["marked_na"] = _client_payment_row_marked_na(row)
        inv_date = row.get("invoice_date")
        _pr = row.get("payment_received_date")
        paid_date = None if _pr is None or (isinstance(_pr, str) and not str(_pr).strip()) else _pr
        row["status"] = "Completed" if paid_date else "Pending"
        aging_days = 0
        try:
            if not paid_date and inv_date:
                inv_d = date.fromisoformat(str(inv_date)[:10]) if isinstance(inv_date, str) else inv_date
                aging_days = max((today - inv_d).days, 0)
            elif paid_date and inv_date:
                inv_d = date.fromisoformat(str(inv_date)[:10]) if isinstance(inv_date, str) else inv_date
                paid_d = date.fromisoformat(str(paid_date)[:10]) if isinstance(paid_date, str) else paid_date
                aging_days = max((paid_d - inv_d).days, 0)
        except Exception:
            aging_days = 0
        row["aging_days"] = aging_days
        cp_id = str(row.get("id")) if row.get("id") else None
        row["invoice_sent_submitted"] = bool(cp_id and cp_id in ids_with_sent)
        if paid_date:
            row["stage"] = "Completed"
        else:
            n = max_followup.get(cp_id, 0)
            if n >= 1:
                row["stage"] = f"Follow up {n}"
            elif cp_id in ids_with_sent:
                row["stage"] = "Invoice Sent details"
            else:
                row["stage"] = "Raised — Invoice Sent not saved"


def _compute_payment_ageing_kpis(
    pay_rows: list,
    allowed: frozenset[str] | None,
    receive_by_cp_id: dict[str, dict] | None = None,
) -> dict:
    """Raised vs received from Payment Management (India FY quarters).

    **Quarterly / Monthly cards:** unchanged — invoice-dated cohort + genre (strict period).

    **overall_in_quarter (Overall card) — carry-forward:**
    - **Raised** = invoices dated in the current FY quarter plus **unpaid** invoices dated **before**
      this quarter starts (still no Payment Received saved). NA rows excluded.
    - **Received** = all payment amounts with **payment date** in the current FY quarter (any invoice
      date), excluding NA. Collecting last quarter’s invoice in this quarter increases Received here.

    ``lifetime_raised_excl_na`` from this loop is capped by ``pay_rows`` length; payment-summary
    replaces it with a paginated DB sum.
    """
    import calendar
    from datetime import date as date_cls

    today = date_cls.today()
    fy, q = _pa.fy_quarter_key(today)
    q_start, q_end = _pa.quarter_date_bounds(fy, q)
    m_start = date_cls(today.year, today.month, 1)
    m_end = date_cls(today.year, today.month, calendar.monthrange(today.year, today.month)[1])

    q_raised = q_received = 0
    m_month_raised = m_month_received = 0
    o_raised_quarter = 0
    o_received_cash_in_fy_quarter = 0  # any invoice; payment date in current FY quarter
    o_carried_unpaid_prior_quarters = 0  # unpaid, invoice dated before q_start (excl NA)
    m_in_q_raised = m_in_q_received = 0
    hy_in_q_raised = hy_in_q_received = 0
    gross_raised_excl_na = 0

    for row in pay_rows or []:
        nm = _norm_name_company(row.get("company_name"))
        if allowed and nm not in allowed:
            continue
        inv_d = _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))
        cp_id = str(row.get("id") or "").strip()
        rec_row = (receive_by_cp_id or {}).get(cp_id) if cp_id else None
        pay_d = _pa._parse_date((rec_row or {}).get("payment_date")) or _pa._parse_date(row.get("payment_received_date"))
        amt = _parse_invoice_amount(row.get("invoice_amount"))
        rec_amt = _parse_invoice_amount((rec_row or {}).get("amount")) if rec_row else (amt if pay_d else 0)
        g = _normalize_client_payment_genre(row.get("genre"))
        is_na = _client_payment_row_marked_na(row)

        if not is_na:
            gross_raised_excl_na += amt

        # Cash received in current FY quarter — any invoice (carry-forward collections).
        if not is_na and pay_d and q_start <= pay_d <= q_end:
            o_received_cash_in_fy_quarter += rec_amt

        # Unpaid backlog from invoices dated before this quarter (carries forward as "raised" lens).
        if inv_d and inv_d < q_start and not is_na and not pay_d:
            o_carried_unpaid_prior_quarters += amt

        # Invoice-dated FY quarter bucket (all genres): cohort for quarter-dated invoices only.
        if inv_d and q_start <= inv_d <= q_end and not is_na:
            o_raised_quarter += amt
            # Genre stripes inside the quarter (still invoice-dated cohort for both sides).
            if g == "Q":
                q_raised += amt
                if pay_d:
                    q_received += rec_amt
            elif g == "M":
                m_in_q_raised += amt
                if pay_d:
                    m_in_q_received += rec_amt
            elif g == "HY":
                hy_in_q_raised += amt
                if pay_d:
                    hy_in_q_received += rec_amt

        if inv_d and m_start <= inv_d <= m_end and g == "M" and not is_na:
            m_month_raised += amt
            if pay_d:
                m_month_received += rec_amt

    o_raised_overall_with_carry = o_raised_quarter + o_carried_unpaid_prior_quarters

    def pair(recv: int, raised: int) -> dict:
        return {"received": int(recv), "raised": int(raised)}

    return {
        "anchor_date": today.isoformat(),
        "quarter_period_label": _pa.quarter_label_from_key(fy, q),
        "month_period_label": today.strftime("%b %Y"),
        "quarterly_genre_q": pair(q_received, q_raised),
        "monthly_genre_m": pair(m_month_received, m_month_raised),
        "overall_in_quarter": pair(o_received_cash_in_fy_quarter, o_raised_overall_with_carry),
        "overall_carried_unpaid_prior_quarters": int(o_carried_unpaid_prior_quarters),
        "monthly_in_quarter": pair(m_in_q_received, m_in_q_raised),
        "half_yearly_in_quarter": pair(hy_in_q_received, hy_in_q_raised),
        "lifetime_raised_excl_na": int(gross_raised_excl_na),
    }


def _payment_ageing_report_payload():
    """Build Payment Ageing Report: companies + amounts from raised invoices + saved quarter days."""
    _nq = _pa.PAYMENT_AGEING_QUARTER_COUNT
    qroll = _pa.payment_ageing_sheet_quarters()
    quarter_labels = [x[2] for x in qroll]
    quarter_keys = [{"fy": x[0], "q": x[1]} for x in qroll]

    companies_rows = []
    try:
        cr = supabase.table("companies").select("id, name").order("name").execute()
        companies_rows = cr.data or []
    except Exception as e:
        _log(f"payment ageing companies: {e}")

    pay_rows: list[dict] = []
    try:
        pr = (
            _ocp_query_exclude_marked_na(supabase.table("onboarding_client_payment").select(_ocp_pay_rows_select_columns()))
            .limit(5000)
            .execute()
        )
        pay_rows = pr.data or []
    except Exception as e:
        _log(f"payment ageing invoices: {e}")

    receive_rows: list[dict] = []
    try:
        rr = (
            supabase.table("onboarding_client_payment_receive")
            .select("client_payment_id,amount,payment_date")
            .limit(5000)
            .execute()
        )
        receive_rows = rr.data or []
    except Exception as e:
        _log(f"payment ageing receive rows: {e}")
    receive_by_cp_id: dict[str, dict] = {}
    for rr in receive_rows:
        cid = str(rr.get("client_payment_id") or "").strip()
        if not cid:
            continue
        receive_by_cp_id[cid] = rr
    # Extra companies to include in Ageing when Paym-Rec was submitted (targeted override).
    auto_include_keys: set[str] = set()
    for row in pay_rows:
        cp_id = str(row.get("id") or "").strip()
        if not cp_id or cp_id not in receive_by_cp_id:
            continue
        nm = _norm_name_company(row.get("company_name"))
        if nm:
            auto_include_keys.add(nm)

    # Aggregate by normalized company name + bucket payment→invoice days per fiscal quarter column
    by_name: dict[str, dict] = {}
    quarter_payment_buckets: dict[tuple[str, int], list[int]] = {}
    fyq_to_quarter_idx: dict[tuple[int, int], int] = {}
    for i, k in enumerate(quarter_keys):
        fyq_to_quarter_idx[(int(k["fy"]), int(k["q"]))] = i
    current_quarter_idx = len(qroll) - 1 if qroll else -1
    for row in pay_rows:
        nm = _norm_name_company(row.get("company_name"))
        if not nm:
            continue
        if nm not in by_name:
            by_name[nm] = {
                "invoice_total": 0,
                "received_total": 0,
                "first_date": None,
                "display_name": (row.get("company_name") or "").strip(),
            }
        cp_id = str(row.get("id") or "").strip()
        rec_row = receive_by_cp_id.get(cp_id) if cp_id else None
        amt = _parse_invoice_amount(row.get("invoice_amount"))
        rec_amt = _parse_invoice_amount((rec_row or {}).get("amount")) if rec_row else (amt if row.get("payment_received_date") else 0)
        if not _client_payment_row_marked_na(row):
            by_name[nm]["invoice_total"] += amt
        if rec_amt > 0 and not _client_payment_row_marked_na(row):
            by_name[nm]["received_total"] += rec_amt
        inv_d = _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))
        fd = by_name[nm]["first_date"]
        if inv_d:
            if fd is None or inv_d < fd:
                by_name[nm]["first_date"] = inv_d
                by_name[nm]["display_name"] = (row.get("company_name") or "").strip()
        pay_d = _pa._parse_date((rec_row or {}).get("payment_date")) or _pa._parse_date(row.get("payment_received_date"))
        if inv_d and pay_d and pay_d >= inv_d and not _client_payment_row_marked_na(row):
            fy0, q0 = _pa.fy_quarter_key(pay_d)
            qi = fyq_to_quarter_idx.get((fy0, q0))
            if qi is None:
                continue
            days_taken = (pay_d - inv_d).days
            quarter_payment_buckets.setdefault((nm, qi), []).append(days_taken)

    ageing_by_name: dict[str, dict] = {}
    ageing_rows_raw: list[dict] = []
    try:
        ar = supabase.table("onboarding_client_payment_ageing").select("*").execute()
        ageing_rows_raw = list(ar.data or [])
        for a in ageing_rows_raw:
            cn = _norm_name_company(a.get("company_name"))
            if not cn:
                continue
            if cn not in ageing_by_name:
                ageing_by_name[cn] = a
                continue
            prev = ageing_by_name[cn]
            rp = _pa.normalize_quarter_days(prev.get("quarter_days"), _nq)
            rn = _pa.normalize_quarter_days(a.get("quarter_days"), _nq)
            merged_days = [rn[i] if rn[i] is not None else rp[i] for i in range(_nq)]
            pick_name = (prev.get("company_name") or "").strip()
            if len((a.get("company_name") or "").strip()) > len(pick_name):
                pick_name = (a.get("company_name") or "").strip()
            ageing_by_name[cn] = {
                **prev,
                "company_name": pick_name,
                "quarter_days": merged_days,
            }
    except Exception as e:
        _log(f"payment ageing load: {e}")

    ageing_by_company_id: dict[str, dict] = {}
    for a in ageing_rows_raw:
        cid_a = a.get("company_id")
        if not cid_a:
            continue
        sk = str(cid_a)
        rn = _pa.normalize_quarter_days(a.get("quarter_days"), _nq)
        if sk not in ageing_by_company_id:
            ageing_by_company_id[sk] = dict(a)
            continue
        prev = ageing_by_company_id[sk]
        rp = _pa.normalize_quarter_days(prev.get("quarter_days"), _nq)
        merged_days = [rn[i] if rn[i] is not None else rp[i] for i in range(_nq)]
        pick_name = (prev.get("company_name") or "").strip()
        if len((a.get("company_name") or "").strip()) > len(pick_name):
            pick_name = (a.get("company_name") or "").strip()
        ageing_by_company_id[sk] = {**prev, "company_name": pick_name, "quarter_days": merged_days}

    company_norm_keys: list[str] = []
    for c in companies_rows:
        nm0 = _norm_name_company((c.get("name") or "").strip())
        if nm0:
            company_norm_keys.append(nm0)
    fuzzy_nm_to_ageing_key = _pa.fuzzy_ageing_assignments(company_norm_keys, ageing_by_name)

    summary_upload: list | None = None
    try:
        sr = supabase.table("onboarding_client_payment_ageing_summary").select("summary_rows").eq("id", 1).limit(1).execute()
        row0 = (sr.data or [None])[0]
        if row0 and isinstance(row0.get("summary_rows"), list):
            summary_upload = row0["summary_rows"]
    except Exception:
        summary_upload = None

    # Build row list: one per company, plus orphan invoice names
    seen: set[str] = set()
    out_rows: list[dict] = []
    auto_updates: list[dict] = []

    def build_row(company_id: str | None, name: str, nm: str):
        agg = by_name.get(nm, {})
        amount_incl_gst = int(agg.get("invoice_total", 0))
        received_amt = int(agg.get("received_total", 0))
        display_name = agg.get("display_name") or name
        first_d = agg.get("first_date")
        # For newly auto-included Paym-Rec companies with empty invoice amount,
        # show submitted payment amount in Amount (Incl GST).
        if nm in auto_include_keys and amount_incl_gst <= 0 and received_amt > 0:
            amount_incl_gst = received_amt

        age = ageing_by_name.get(nm)
        if age is None and company_id:
            age = ageing_by_company_id.get(str(company_id))
        if age is None:
            ak = fuzzy_nm_to_ageing_key.get(nm)
            if ak:
                age = ageing_by_name.get(ak)
        stored_days = _pa.normalize_quarter_days((age or {}).get("quarter_days"), _nq)
        has_stored_days = any(v is not None for v in stored_days)
        seed_recover = False
        if not has_stored_days:
            seed_days = _pa.seed_quarter_days_for_company(nm)
            if seed_days and any(v is not None for v in seed_days):
                stored_days = seed_days
                seed_recover = True
        # Keep DB-stored ageing values visible; override a quarter only when live Paym-Rec data exists for it.
        display_days: list[int | None] = list(stored_days)
        for i in range(_nq):
            live_vals = quarter_payment_buckets.get((nm, i), [])
            live_med = _pa.median_int_or_none(live_vals)
            if live_med is not None:
                display_days[i] = live_med
        # Latest ongoing quarter should appear only after a payment is received in that quarter.
        if current_quarter_idx >= 0:
            latest_live_vals = quarter_payment_buckets.get((nm, current_quarter_idx), [])
            if not latest_live_vals:
                display_days[current_quarter_idx] = None
        persist_days = list(display_days)
        if persist_days != stored_days or seed_recover:
            auto_updates.append(
                {
                    "company_id": company_id,
                    "company_name": (name or display_name or "").strip() or nm,
                    "quarter_days": persist_days,
                    "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
            )

        med = _pa.average_int(display_days)
        last_q = display_days[-1] if len(display_days) == _nq else None
        last_quarter_days = int(last_q) if last_q is not None else None

        out_rows.append(
            {
                "company_id": company_id,
                "company_name": display_name,
                "amount_incl_gst": amount_incl_gst,
                "quarter_days": display_days,
                "median_value": med,
                "last_quarter_days": last_quarter_days,
                "received_amount": received_amt,
                "first_invoice_date": first_d.isoformat() if first_d else None,
            }
        )

    for c in companies_rows:
        cid = str(c.get("id")) if c.get("id") else None
        name = (c.get("name") or "").strip()
        nm = _norm_name_company(name)
        if not nm:
            continue
        seen.add(nm)
        build_row(cid, name, nm)

    # Orphan invoice company names (not in companies master)
    for nm, agg in by_name.items():
        if nm in seen:
            continue
        seen.add(nm)
        build_row(None, agg.get("display_name") or nm, nm)

    # Ageing-sheet rows only: show allowed companies present in onboarding_client_payment_ageing
    # even when missing from companies master and with no onboarding_client_payment invoices yet.
    allowed_keys = _pa.PAYMENT_AGEING_ALLOWED_COMPANY_KEYS
    if allowed_keys:
        for nm, age_row in ageing_by_name.items():
            if nm in seen:
                continue
            if nm not in allowed_keys:
                continue
            seen.add(nm)
            build_row(None, (age_row.get("company_name") or "").strip() or nm, nm)

    out_rows = _dedupe_ageing_display_rows(out_rows, _nq)
    out_rows.sort(key=lambda r: (r.get("company_name") or "").lower())

    if auto_updates:
        _uniq_updates: dict[str, dict] = {}
        for u in auto_updates:
            key = (u.get("company_name") or "").strip()
            if key:
                _uniq_updates[key] = u
        auto_updates = list(_uniq_updates.values())
        try:
            supabase.table("onboarding_client_payment_ageing").upsert(auto_updates, on_conflict="company_name").execute()
        except Exception as e:
            _log(f"payment ageing auto quarter sync: {e}")

    # Keep existing visibility unchanged (static allow-list) + include Paym-Rec submitted companies.
    # Explicit exclude: hide this standalone alias from Ageing row list.
    manual_exclude_keys = {
        "salagram power",
    }
    allowed = _pa.PAYMENT_AGEING_ALLOWED_COMPANY_KEYS
    if allowed:
        out_rows = [
            r
            for r in out_rows
            if (
                (
                    (_norm_name_company(r.get("company_name")) in allowed)
                    or (_norm_name_company(r.get("company_name")) in auto_include_keys)
                )
                and (_norm_name_company(r.get("company_name")) not in manual_exclude_keys)
            )
        ]

    # Bucket summary (SUMIFS-style: sum amount where median falls in day range)
    nb = len(_pa.DAY_BUCKETS)
    bucket_median_sums = [0] * nb
    bucket_received_sums = [0] * nb
    bucket_fy_q4_to_be = [0] * nb
    bucket_fy_q1 = [0] * nb
    bucket_fy_q2 = [0] * nb
    bucket_fy_q3 = [0] * nb
    bucket_fy_q4_received = [0] * nb
    for r in out_rows:
        amt = int(r.get("amount_incl_gst") or 0)
        rec = int(r.get("received_amount") or 0)
        med = int(r.get("median_value") or 0)
        bi = _pa.bucket_for_median_days(med)
        qfull = _pa.normalize_quarter_days(r.get("quarter_days"), _nq)
        fd = _pa._parse_date(r.get("first_invoice_date"))
        si = _pa.first_invoiced_quarter_index(qroll, fd) if fd else 0
        qdays = [None if i < si else qfull[i] for i in range(_nq)]
        bucket_median_sums[bi] += amt
        bucket_received_sums[bi] += rec
        bucket_fy_q4_to_be[bi] += _pa.weighted_fy_amount(amt, qdays, _pa.FY24_25_Q4_IDX)
        bucket_fy_q1[bi] += _pa.weighted_fy_amount(amt, qdays, _pa.FY24_25_Q1_IDX)
        bucket_fy_q2[bi] += _pa.weighted_fy_amount(amt, qdays, _pa.FY24_25_Q2_IDX)
        bucket_fy_q3[bi] += _pa.weighted_fy_amount(amt, qdays, _pa.FY24_25_Q3_IDX)
        bucket_fy_q4_received[bi] += _pa.weighted_fy_amount(rec, qdays, _pa.FY24_25_Q4_IDX)

    total_median = sum(bucket_median_sums)
    total_received = sum(bucket_received_sums)

    summary_rows = []
    for i, (label, lo, hi) in enumerate(_pa.DAY_BUCKETS):
        med_sum = bucket_median_sums[i]
        rec_sum = bucket_received_sums[i]
        due = rec_sum - med_sum
        to_be_pct = round((med_sum / total_median * 100) if total_median > 0 else 0.0, 2)
        received_pct = round((rec_sum / total_received * 100) if total_received > 0 else 0.0, 2)
        summary_rows.append(
            {
                "days": label,
                "median": med_sum,
                "received": rec_sum,
                "due_excs_for_wk": due,
                "fy_24_25_q4_to_be": bucket_fy_q4_to_be[i],
                "to_be_pct": to_be_pct,
                "received_pct": received_pct,
                "fy_24_25_q1": bucket_fy_q1[i],
                "fy_24_25_q2": bucket_fy_q2[i],
                "fy_24_25_q4_received": bucket_fy_q4_received[i],
                "fy_24_25_q3": bucket_fy_q3[i],
            }
        )

    totals_due = sum(r["due_excs_for_wk"] for r in summary_rows)
    totals = {
        "median": total_median,
        "received": total_received,
        "due_excs_for_wk": totals_due,
        "fy_24_25_q4_to_be": sum(bucket_fy_q4_to_be),
        "to_be_pct": round(sum(r["to_be_pct"] for r in summary_rows), 2),
        "received_pct": round(sum(r["received_pct"] for r in summary_rows), 2),
        "fy_24_25_q1": sum(bucket_fy_q1),
        "fy_24_25_q2": sum(bucket_fy_q2),
        "fy_24_25_q4_received": sum(bucket_fy_q4_received),
        "fy_24_25_q3": sum(bucket_fy_q3),
    }

    # KPI cards should reflect all submitted Payment Receive Details, not allowed-list filtered ageing rows.
    kpis = _compute_payment_ageing_kpis(pay_rows, None, receive_by_cp_id)
    current_quarter_received_companies: list[dict] = []
    if current_quarter_idx >= 0:
        # Keep count/list aligned with real payment rows received in current FY quarter.
        cq_by_name: dict[str, dict] = {}
        for row in pay_rows or []:
            if _client_payment_row_marked_na(row):
                continue
            nm = _norm_name_company(row.get("company_name"))
            if not nm:
                continue
            inv_d = _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))
            cp_id = str(row.get("id") or "").strip()
            rec_row = receive_by_cp_id.get(cp_id) if cp_id else None
            pay_d = _pa._parse_date((rec_row or {}).get("payment_date")) or _pa._parse_date(row.get("payment_received_date"))
            if not inv_d or not pay_d or pay_d < inv_d:
                continue
            fy0, q0 = _pa.fy_quarter_key(pay_d)
            if fy0 != qroll[current_quarter_idx][0] or q0 != qroll[current_quarter_idx][1]:
                continue
            days_taken = (pay_d - inv_d).days
            if nm not in cq_by_name:
                cq_by_name[nm] = {
                    "company_name": (row.get("company_name") or "").strip() or nm,
                    "days": [],
                }
            cq_by_name[nm]["days"].append(days_taken)

        for _nm, meta in cq_by_name.items():
            dvals = meta.get("days") or []
            if not dvals:
                continue
            current_quarter_received_companies.append(
                {
                    "company_name": meta.get("company_name") or _nm,
                    "days_to_payment": int(_pa.median_int(dvals)),
                }
            )
        current_quarter_received_companies.sort(key=lambda x: (x.get("company_name") or "").lower())
    kpis["current_quarter_received_company_count"] = len(current_quarter_received_companies)
    kpis["current_quarter_received_companies"] = current_quarter_received_companies

    return {
        "quarter_labels": quarter_labels,
        "quarter_keys": quarter_keys,
        "rows": out_rows,
        "summary": {"rows": summary_rows, "totals": totals},
        "summary_uploaded": summary_upload or [],
        "kpis": kpis,
    }


def _next_fiscal_quarter_key(fy: int, q: int) -> tuple[int, int]:
    if q >= 4:
        return (fy + 1, 1)
    return (fy, q + 1)


def _fiscal_quarter_ordinal(key: tuple[int, int]) -> int:
    return int(key[0]) * 4 + int(key[1])


def _median_value_or_none(values: list[int | float | None], *, min_count: int = 1) -> int | float | None:
    nums = sorted(float(v) for v in values if v is not None)
    if len(nums) < min_count:
        return None
    mid = len(nums) // 2
    if len(nums) % 2 == 1:
        median = nums[mid]
    else:
        median = (nums[mid - 1] + nums[mid]) / 2
    return int(median) if median.is_integer() else median


def _payment_ageing_report_payload():
    """Build Payment Ageing from Add Invoice company names and dynamic invoice quarters."""
    today = date.today()

    pay_rows: list[dict] = []
    try:
        pr = (
            _ocp_query_exclude_marked_na(supabase.table("onboarding_client_payment").select(_ocp_pay_rows_select_columns()))
            .limit(5000)
            .execute()
        )
        pay_rows = pr.data or []
    except Exception as e:
        _log(f"payment ageing invoices: {e}")

    receive_rows: list[dict] = []
    try:
        rr = (
            supabase.table("onboarding_client_payment_receive")
            .select("client_payment_id,amount,payment_date")
            .limit(5000)
            .execute()
        )
        receive_rows = rr.data or []
    except Exception as e:
        _log(f"payment ageing receive rows: {e}")

    receive_by_cp_id: dict[str, dict] = {}
    for rr in receive_rows:
        cid = str(rr.get("client_payment_id") or "").strip()
        if cid:
            receive_by_cp_id[cid] = rr

    payment_quarter_key_set: set[tuple[int, int]] = set()
    invoice_quarter_key_set: set[tuple[int, int]] = set()
    by_name: dict[str, dict] = {}
    for row in pay_rows:
        company_name = (row.get("company_name") or "").strip()
        nm = _norm_name_company(company_name)
        if not nm:
            continue
        inv_d = _pa._parse_date(row.get("invoice_date")) or _pa._parse_date(row.get("timestamp"))
        if not inv_d:
            continue
        invoice_quarter_key_set.add(_pa.fy_quarter_key(inv_d))
        if nm not in by_name:
            by_name[nm] = {
                "display_name": company_name,
                "invoice_total": 0,
                "received_total": 0,
                "first_date": inv_d,
                "quarter_days": defaultdict(list),
            }
        agg = by_name[nm]
        agg["display_name"] = company_name or agg["display_name"]
        if inv_d < agg["first_date"]:
            agg["first_date"] = inv_d
        cp_id = str(row.get("id") or "").strip()
        rec_row = receive_by_cp_id.get(cp_id) if cp_id else None
        amount = _parse_invoice_amount(row.get("invoice_amount"))
        received_amount = _parse_invoice_amount((rec_row or {}).get("amount")) if rec_row else (amount if row.get("payment_received_date") else 0)
        if not _client_payment_row_marked_na(row):
            agg["invoice_total"] += amount
            agg["received_total"] += received_amount
        paid_d = _pa._parse_date((rec_row or {}).get("payment_date")) or _pa._parse_date(row.get("payment_received_date"))
        if paid_d and paid_d >= inv_d and not _client_payment_row_marked_na(row):
            ageing_qkey = _pa.fy_quarter_key(paid_d)
            payment_quarter_key_set.add(ageing_qkey)
            agg["quarter_days"][ageing_qkey].append((paid_d - inv_d).days)

    all_quarter_keys = invoice_quarter_key_set | payment_quarter_key_set
    current_key = _pa.fy_quarter_key(today)
    if all_quarter_keys:
        start_key = min(all_quarter_keys, key=_fiscal_quarter_ordinal)
        end_key = max(max(all_quarter_keys, key=_fiscal_quarter_ordinal), current_key, key=_fiscal_quarter_ordinal)
    else:
        start_key = end_key = current_key

    qroll: list[tuple[int, int, str]] = []
    cursor = start_key
    while _fiscal_quarter_ordinal(cursor) <= _fiscal_quarter_ordinal(end_key):
        qroll.append((cursor[0], cursor[1], _pa.quarter_label_from_key(cursor[0], cursor[1])))
        cursor = _next_fiscal_quarter_key(cursor[0], cursor[1])
    hidden_quarter_labels = {"Q4 FY 25-26"}
    qroll = [q for q in qroll if q[2] not in hidden_quarter_labels]
    quarter_labels = [x[2] for x in qroll]
    quarter_keys = [{"fy": x[0], "q": x[1]} for x in qroll]
    _nq = len(qroll)

    out_rows: list[dict] = []
    for nm, agg in by_name.items():
        qdays: list[int | None] = []
        for fy, q, _label in qroll:
            qdays.append(_pa.median_int_or_none(agg["quarter_days"].get((fy, q), [])))
        day_values = [d for d in qdays if d is not None]
        median_value = _median_value_or_none(day_values, min_count=2)
        out_rows.append(
            {
                "company_id": None,
                "company_name": agg.get("display_name") or nm,
                "amount_incl_gst": int(agg.get("invoice_total") or 0),
                "quarter_days": qdays,
                "median_value": median_value,
                "last_quarter_days": qdays[-1] if qdays else None,
                "received_amount": int(agg.get("received_total") or 0),
                "first_invoice_date": agg["first_date"].isoformat() if agg.get("first_date") else None,
            }
        )
    out_rows = _dedupe_ageing_display_rows(out_rows, _nq)
    out_rows.sort(key=lambda r: (r.get("company_name") or "").lower())

    qkey_to_idx = {(fy, q): i for i, (fy, q, _label) in enumerate(qroll)}

    def weighted_fy24_amount(amount: int, qdays: list[int | None], target_q: int) -> int:
        fy24_indices = [qkey_to_idx.get((2024, q)) for q in (1, 2, 3, 4)]
        present_indices = [i for i in fy24_indices if i is not None and i < len(qdays)]
        total_days = sum(int(qdays[i] or 0) for i in present_indices if qdays[i] is not None)
        target_idx = qkey_to_idx.get((2024, target_q))
        if amount <= 0 or total_days <= 0 or target_idx is None or target_idx >= len(qdays) or qdays[target_idx] is None:
            return 0
        return int(round(amount * int(qdays[target_idx]) / total_days))

    nb = len(_pa.DAY_BUCKETS)
    bucket_median_sums = [0] * nb
    bucket_received_sums = [0] * nb
    bucket_fy_q4_to_be = [0] * nb
    bucket_fy_q1 = [0] * nb
    bucket_fy_q2 = [0] * nb
    bucket_fy_q3 = [0] * nb
    bucket_fy_q4_received = [0] * nb
    for r in out_rows:
        med_raw = r.get("median_value")
        if med_raw is None:
            continue
        amt = int(r.get("amount_incl_gst") or 0)
        rec = int(r.get("received_amount") or 0)
        med = float(med_raw)
        bi = _pa.bucket_for_median_days(med)
        qdays = _pa.normalize_quarter_days(r.get("quarter_days"), _nq)
        bucket_median_sums[bi] += amt
        bucket_received_sums[bi] += rec
        bucket_fy_q4_to_be[bi] += weighted_fy24_amount(amt, qdays, 4)
        bucket_fy_q1[bi] += weighted_fy24_amount(amt, qdays, 1)
        bucket_fy_q2[bi] += weighted_fy24_amount(amt, qdays, 2)
        bucket_fy_q3[bi] += weighted_fy24_amount(amt, qdays, 3)
        bucket_fy_q4_received[bi] += weighted_fy24_amount(rec, qdays, 4)

    total_median = sum(bucket_median_sums)
    total_received = sum(bucket_received_sums)
    summary_rows = []
    for i, (label, _lo, _hi) in enumerate(_pa.DAY_BUCKETS):
        med_sum = bucket_median_sums[i]
        rec_sum = bucket_received_sums[i]
        summary_rows.append(
            {
                "days": label,
                "median": med_sum,
                "received": rec_sum,
                "due_excs_for_wk": rec_sum - med_sum,
                "fy_24_25_q4_to_be": bucket_fy_q4_to_be[i],
                "to_be_pct": round((med_sum / total_median * 100) if total_median > 0 else 0.0, 2),
                "received_pct": round((rec_sum / total_received * 100) if total_received > 0 else 0.0, 2),
                "fy_24_25_q1": bucket_fy_q1[i],
                "fy_24_25_q2": bucket_fy_q2[i],
                "fy_24_25_q4_received": bucket_fy_q4_received[i],
                "fy_24_25_q3": bucket_fy_q3[i],
            }
        )
    totals = {
        "median": total_median,
        "received": total_received,
        "due_excs_for_wk": sum(r["due_excs_for_wk"] for r in summary_rows),
        "fy_24_25_q4_to_be": sum(bucket_fy_q4_to_be),
        "to_be_pct": round(sum(r["to_be_pct"] for r in summary_rows), 2),
        "received_pct": round(sum(r["received_pct"] for r in summary_rows), 2),
        "fy_24_25_q1": sum(bucket_fy_q1),
        "fy_24_25_q2": sum(bucket_fy_q2),
        "fy_24_25_q4_received": sum(bucket_fy_q4_received),
        "fy_24_25_q3": sum(bucket_fy_q3),
    }
    kpis = _compute_payment_ageing_kpis(pay_rows, None, receive_by_cp_id)
    kpis["current_quarter_received_company_count"] = 0
    kpis["current_quarter_received_companies"] = []
    return {
        "quarter_labels": quarter_labels,
        "quarter_keys": quarter_keys,
        "rows": out_rows,
        "summary": {"rows": summary_rows, "totals": totals},
        "summary_uploaded": [],
        "kpis": kpis,
        "marked_na_supported": _client_payment_marked_na_supported(),
    }


@api_router.get("/onboarding/client-payment/payment-ageing-report")
def get_payment_ageing_report(auth: dict = Depends(get_current_user)):
    """Payment Ageing grid + bucket summary; amounts from raised invoices (invoice_amount sum per company)."""
    try:
        return _payment_ageing_report_payload()
    except Exception as e:
        _log(f"payment ageing report: {e}")
        raise HTTPException(500, str(e)[:200])


@api_router.put("/onboarding/client-payment/payment-ageing-report/{company_key}")
def put_payment_ageing_row(company_key: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Save quarter day values (10 quarters). company_key = company UUID or URL-encoded company name."""
    from urllib.parse import unquote

    _nq = _pa.PAYMENT_AGEING_QUARTER_COUNT
    key = unquote(company_key).strip()
    if not key:
        raise HTTPException(400, "company_key required")
    raw_days = payload.get("quarter_days")
    if not isinstance(raw_days, list) or len(raw_days) != _nq:
        raise HTTPException(400, f"quarter_days must be an array of {_nq} numbers or nulls")

    days = _pa.normalize_quarter_days(raw_days, _nq)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    company_id = None
    company_name = key
    # UUID?
    try:
        u = uuid.UUID(key)
        company_id = str(u)
        try:
            cr = supabase.table("companies").select("name").eq("id", company_id).single().execute()
            if cr.data and cr.data.get("name"):
                company_name = (cr.data.get("name") or "").strip()
        except Exception:
            pass
    except ValueError:
        company_name = key

    if not company_name:
        raise HTTPException(400, "Could not resolve company name")

    if _pa.PAYMENT_AGEING_ALLOWED_COMPANY_KEYS and _pa.normalize_company_name(company_name) not in _pa.PAYMENT_AGEING_ALLOWED_COMPANY_KEYS:
        raise HTTPException(403, "Company is not in the payment ageing list for this quarter")

    row = {
        "company_id": company_id,
        "company_name": company_name,
        "quarter_days": days,
        "updated_at": now,
    }
    try:
        supabase.table("onboarding_client_payment_ageing").upsert(
            row, on_conflict="company_name"
        ).execute()
    except Exception as e:
        _log(f"payment ageing upsert: {e}")
        raise HTTPException(400, str(e)[:200])
    return {"ok": True, "company_name": company_name, "quarter_days": days}


@api_router.post("/onboarding/client-payment/payment-ageing-report/summary-upload")
def post_payment_ageing_summary_upload(payload: dict, auth: dict = Depends(get_current_user)):
    """Optional summary grid from spreadsheet (JSON array of rows)."""
    rows = payload.get("summary_rows")
    if not isinstance(rows, list):
        raise HTTPException(400, "summary_rows must be an array")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        supabase.table("onboarding_client_payment_ageing_summary").upsert(
            {"id": 1, "summary_rows": rows, "updated_at": now},
            on_conflict="id",
        ).execute()
    except Exception as e:
        _log(f"payment ageing summary upload: {e}")
        raise HTTPException(400, str(e)[:200])
    return {"ok": True}


@api_router.post("/onboarding/client-payment")
def create_client_payment(payload: dict, auth: dict = Depends(get_current_user)):
    """Create a client payment 'Raised Invoice' entry."""
    from app import invoice_companies as ic

    company_name = (payload.get("company_name") or "").strip()
    if not company_name:
        raise HTTPException(400, "company_name is required")
    try:
        cr = supabase.table("companies").select("id, name").execute()
        company_rows = cr.data or []
    except Exception:
        company_rows = []
    resolved = ic.resolve_invoice_company_name(company_name, company_rows)
    if not resolved:
        raise HTTPException(
            400,
            "company_name must be one of the allowed invoice clients. "
            "Run database/INVOICE_COMPANY_MASTER.sql in Supabase if the list was recently updated.",
        )
    company_name = resolved
    invoice_date = payload.get("invoice_date")
    invoice_amount = (payload.get("invoice_amount") or "").strip()
    invoice_number = (payload.get("invoice_number") or "").strip()
    genre = (payload.get("genre") or "").strip().upper()
    stage = (payload.get("stage") or "").strip()
    payment_received_date = payload.get("payment_received_date")
    if invoice_amount and (not invoice_amount.isdigit() or len(invoice_amount) > 11):
        raise HTTPException(400, "invoice_amount must be digits only, max 11 characters")
    # Invoice numbers can be alphanumeric and may contain special characters (per business usage).
    # Keep a reasonable max length to prevent accidental huge values.
    if invoice_number and len(invoice_number) > 50:
        raise HTTPException(400, "invoice_number max 50 characters")
    if genre not in ("M", "Q", "HY", "Y"):
        raise HTTPException(400, "genre must be one of M, Q, HY, Y")
    try:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        # Generate reference like INV/COMP/0001, 0002, ...
        ref = "INV/COMP/0001"
        try:
            r_existing = supabase.table("onboarding_client_payment").select("reference_no").execute()
            nums: list[int] = []
            for row in (r_existing.data or []):
                ref_val = (row or {}).get("reference_no") or ""
                if ref_val.startswith("INV/COMP/") and len(ref_val) > len("INV/COMP/"):
                    suffix = ref_val.split("INV/COMP/")[-1]
                    if suffix.isdigit():
                        nums.append(int(suffix))
            next_num = max(nums, default=0) + 1
            ref = f"INV/COMP/{next_num:04d}"
        except Exception as e_ref:
            _log(f"client payment reference fallback: {e_ref}")

        row = {
            "timestamp": now,
            "reference_no": ref,
            "company_name": company_name,
            "invoice_date": invoice_date,
            "invoice_amount": invoice_amount or None,
            "invoice_number": invoice_number or None,
            "genre": genre,
            "stage": stage or None,
            "payment_received_date": payment_received_date,
        }
        r = supabase.table("onboarding_client_payment").insert(row).execute()
        created = (r.data or [{}])[0]
        created["timestamp"] = now
        _invalidate_ttl_cache_key_prefix("onboarding:client-payment:")
        return created
    except HTTPException:
        raise
    except Exception as e:
        _log(f"client payment create: {e}")
        raise HTTPException(400, str(e)[:200])


_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS = 150


def _client_payment_parse_utc(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _client_payment_editable_until_dt(submitted_at_iso: str | None) -> datetime | None:
    submitted = _client_payment_parse_utc(submitted_at_iso)
    if not submitted:
        return None
    return submitted + timedelta(days=_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS)


def _client_payment_editable_until_iso(submitted_at_iso: str | None) -> str | None:
    until = _client_payment_editable_until_dt(submitted_at_iso)
    return until.isoformat().replace("+00:00", "Z") if until else None


def _client_payment_response_editable(submitted_at_iso: str | None, is_admin: bool = False) -> bool:
    """Within 150 days of first submit (created_at). Unsubmitted shells remain editable."""
    if is_admin:
        return True
    if not submitted_at_iso:
        return True
    until = _client_payment_editable_until_dt(submitted_at_iso)
    return bool(until and until >= datetime.now(timezone.utc))


@api_router.patch("/onboarding/client-payment/{client_payment_id}/marked-na")
def patch_client_payment_marked_na(
    client_payment_id: str,
    payload: dict,
    auth: dict = Depends(get_current_user),
):
    """Mark or unmark a raised invoice as NA (excluded from default list and Total raised KPIs)."""
    if not _client_payment_marked_na_supported():
        raise HTTPException(
            400,
            "NA marking is not enabled. Run database/CLIENT_PAYMENT_MARKED_NA.sql in Supabase, then retry.",
        )
    marked = payload.get("marked_na")
    if not isinstance(marked, bool):
        raise HTTPException(400, "marked_na must be true or false")
    try:
        r0 = (
            supabase.table("onboarding_client_payment")
            .select("id,payment_received_date")
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        row0 = (r0.data or [None])[0]
        if not row0:
            raise HTTPException(404, "Raised Invoice not found")
        pr = row0.get("payment_received_date")
        if pr is not None and str(pr).strip():
            raise HTTPException(400, "Cannot change NA on a completed (paid) invoice")
        supabase.table("onboarding_client_payment").update({"marked_na": marked}).eq("id", client_payment_id).execute()
        r = (
            supabase.table("onboarding_client_payment")
            .select(_ocp_list_select_columns())
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        updated = (r.data or [None])[0]
        if not updated:
            raise HTTPException(404, "Raised Invoice not found after update")
        _enrich_client_payment_list_items([updated])
        global _MARKED_NA_COLUMN_SUPPORTED
        _MARKED_NA_COLUMN_SUPPORTED = True
        _invalidate_ttl_cache_key_prefix("onboarding:client-payment:")
        _invalidate_payment_summary_cache()
        return updated
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("column" in err or "schema" in err):
            raise HTTPException(
                400,
                "Database column marked_na is missing. Run database/CLIENT_PAYMENT_MARKED_NA.sql in Supabase.",
            )
        _log(f"client payment marked_na: {e}")
        raise HTTPException(400, str(e)[:200])


def _build_payment_summary_payload() -> dict:
    """Payment KPI cards + totals. Capped pagination so production Render stays under HTTP timeout."""
    import time as _time

    cache_key = date.today().isoformat()
    cached = _PAYMENT_SUMMARY_CACHE.get(cache_key)
    if cached and (_time.time() - float(cached.get("ts") or 0)) < _PAYMENT_SUMMARY_CACHE_TTL_SEC:
        return cached["payload"]

    totals = _sum_payment_invoice_totals_combined(max_pages=_PAYMENT_SUMMARY_AGG_MAX_PAGES)
    pay_rows = _fetch_client_payment_rows_for_metrics(limit=_PAYMENT_SUMMARY_PAY_ROW_LIMIT)
    receive_by_cp_id = _fetch_client_payment_receive_by_cp_id(max_pages=_PAYMENT_SUMMARY_RECEIVE_MAX_PAGES)
    kpis = _compute_payment_ageing_kpis(pay_rows, None, receive_by_cp_id)

    lifetime_excl = int(totals["lifetime_raised_excl_na"])
    na_unpaid_total = int(totals["na_marked_unpaid_invoice_total"])
    total_due = int(totals["total_due"])

    kpis["lifetime_raised_excl_na"] = lifetime_excl
    kpis["na_marked_unpaid_invoice_total"] = na_unpaid_total
    kpis["kpi_scope_note"] = (
        "Quarterly & Monthly cards are strict invoice-dated slices. Overall adds unpaid invoices dated "
        "before this FY quarter until Payment Received is saved, and counts all receipts with payment "
        "date in this FY quarter—even for older invoices. India FY quarters (Apr–Mar)."
    )
    payload = {
        "total_due": total_due,
        "raised_quarter": int((kpis.get("overall_in_quarter") or {}).get("raised") or 0),
        "lifetime_raised_excl_na": lifetime_excl,
        "na_marked_unpaid_invoice_total": na_unpaid_total,
        "kpis": kpis,
        "marked_na_supported": _client_payment_marked_na_supported(),
    }
    _PAYMENT_SUMMARY_CACHE[cache_key] = {"ts": _time.time(), "payload": payload}
    return payload


@api_router.get("/onboarding/client-payment/payment-summary")
def client_payment_payment_summary(auth: dict = Depends(get_current_user)):
    """Single source for Payment KPI cards and dashboard Payment totals (NA rows excluded)."""
    try:
        payload = _build_payment_summary_payload()
    except Exception as e:
        _log(f"payment-summary: {e}")
        raise HTTPException(status_code=500, detail=f"payment-summary failed: {str(e)[:200]}")
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "no-store, no-cache, max-age=0, must-revalidate"},
    )


@api_router.put("/onboarding/client-payment/{client_payment_id}")
def update_client_payment(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Update core Raised Invoice fields. Allowed within 150 days of ``timestamp`` and only while unpaid."""
    try:
        r0 = (
            supabase.table("onboarding_client_payment")
            .select("id,timestamp,payment_received_date")
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        row0 = (r0.data or [None])[0]
        if not row0:
            raise HTTPException(404, "Raised Invoice not found")
        pr = row0.get("payment_received_date")
        if pr is not None and str(pr).strip():
            raise HTTPException(400, "Cannot edit: payment already received for this invoice")
        ts = row0.get("timestamp")
        if not ts:
            raise HTTPException(400, "Missing timestamp on record")
        try:
            created = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Invalid timestamp on record")
        if (datetime.now(timezone.utc) - created).days > _CLIENT_PAYMENT_RESPONSE_EDIT_DAYS:
            raise HTTPException(
                400,
                f"Edit window expired: company / invoice fields can only be changed within {_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS} days of creation (Timestamp)",
            )

        from app import invoice_companies as ic

        company_name = (payload.get("company_name") or "").strip()
        if not company_name:
            raise HTTPException(400, "company_name is required")
        try:
            cr = supabase.table("companies").select("id, name").execute()
            company_rows = cr.data or []
        except Exception:
            company_rows = []
        resolved = ic.resolve_invoice_company_name(company_name, company_rows)
        if not resolved:
            raise HTTPException(400, "company_name must be one of the allowed invoice clients")
        company_name = resolved
        invoice_date = payload.get("invoice_date")
        invoice_amount = (payload.get("invoice_amount") or "").strip()
        invoice_number = (payload.get("invoice_number") or "").strip()
        genre = (payload.get("genre") or "").strip().upper()
        if invoice_amount and (not invoice_amount.isdigit() or len(invoice_amount) > 11):
            raise HTTPException(400, "invoice_amount must be digits only, max 11 characters")
        if invoice_number and len(invoice_number) > 50:
            raise HTTPException(400, "invoice_number max 50 characters")
        if genre not in ("M", "Q", "HY", "Y"):
            raise HTTPException(400, "genre must be one of M, Q, HY, Y")

        patch = {
            "company_name": company_name,
            "invoice_date": invoice_date,
            "invoice_amount": invoice_amount or None,
            "invoice_number": invoice_number or None,
            "genre": genre,
        }
        # postgrest-py: .update().eq() returns SyncFilterRequestBuilder — no .select(); fetch row after update.
        supabase.table("onboarding_client_payment").update(patch).eq("id", client_payment_id).execute()
        r = (
            supabase.table("onboarding_client_payment")
            .select(_ocp_list_select_columns())
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        updated = (r.data or [None])[0]
        if not updated:
            raise HTTPException(400, "Raised Invoice not found after update")
        _enrich_client_payment_list_items([updated])
        _invalidate_ttl_cache_key_prefix("onboarding:client-payment:")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        _log(f"client payment update: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/onboarding/client-payment/{client_payment_id}/sent")
def get_client_payment_sent(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Get Invoice Sent details for a Raised Invoice. Creates empty shell on first access."""
    try:
        r = (
            supabase.table("onboarding_client_payment_sent")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        if not row:
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            # Don't insert yet; treat as empty state on UI, create on first save
            return {
                "data": {
                    "email_sent": False,
                    "email": None,
                    "courier_sent": False,
                    "tracking_details": None,
                    "whatsapp_sent": False,
                    "whatsapp_number": None,
                    "invoice_number": None,
                },
                "created_at": now,
                "editable_until": None,
                "editable_24h": True,
                "submitted": False,
            }
        submit_at = row.get("created_at")
        return {
            "data": {
                "email_sent": bool(row.get("email_sent")),
                "email": row.get("email"),
                "courier_sent": bool(row.get("courier_sent")),
                "tracking_details": row.get("tracking_details"),
                "whatsapp_sent": bool(row.get("whatsapp_sent")),
                "whatsapp_number": row.get("whatsapp_number"),
                "invoice_number": row.get("invoice_number"),
            },
            "created_at": submit_at,
            "editable_until": _client_payment_editable_until_iso(submit_at),
            "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin),
            "submitted": True,
        }
    except Exception as e:
        _log(f"get client payment sent: {e}")
        return {
            "data": {},
            "created_at": None,
            "editable_until": None,
            "editable_24h": False,
        }


@api_router.post("/onboarding/client-payment/{client_payment_id}/sent")
def save_client_payment_sent(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Invoice Sent details. 24h edit for creator; Master/Admin always allowed."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")

    email_sent = bool(data.get("email_sent"))
    email = (data.get("email") or "").strip() or None
    courier_sent = bool(data.get("courier_sent"))
    tracking = (data.get("tracking_details") or "").strip() or None
    whatsapp_sent = bool(data.get("whatsapp_sent"))
    whatsapp_number = (data.get("whatsapp_number") or "").strip() or None
    invoice_number = (data.get("invoice_number") or "").strip() or None

    # Basic validations (detail fields optional even when Sent = Yes)
    if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(400, "Enter a valid email")
    if tracking and not re.match(r"^[0-9A-Za-z-]+$", tracking):
        raise HTTPException(400, "Tracking details: use only numbers, letters, and hyphen")
    if whatsapp_number and (not whatsapp_number.isdigit() or len(whatsapp_number) != 10):
        raise HTTPException(400, "WhatsApp Number must be exactly 10 digits when provided")
    if invoice_number and len(invoice_number) > 50:
        raise HTTPException(400, "Invoice Number max 50 characters")

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    editable_until_iso = _client_payment_editable_until_iso(now_iso)

    try:
        existing = (
            supabase.table("onboarding_client_payment_sent")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        row = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None

        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")

        if row:
            created_by = row.get("created_by")
            submit_at = row.get("created_at")
            can_edit = is_admin or (
                created_by == auth["id"] and _client_payment_response_editable(submit_at, is_admin=False)
            )
            if not can_edit:
                raise HTTPException(
                    403,
                    f"Invoice Sent details can only be edited within {_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS} days of submission",
                )

            supabase.table("onboarding_client_payment_sent").update(
                {
                    "email_sent": email_sent,
                    "email": email,
                    "courier_sent": courier_sent,
                    "tracking_details": tracking,
                    "whatsapp_sent": whatsapp_sent,
                    "whatsapp_number": whatsapp_number,
                    "invoice_number": invoice_number,
                    "updated_at": now_iso,
                }
            ).eq("id", row.get("id")).execute()
            return {
                "data": data,
                "created_at": submit_at,
                "editable_until": _client_payment_editable_until_iso(submit_at),
                "editable_24h": True,
            }

        # Create new
        supabase.table("onboarding_client_payment_sent").insert(
            {
                "client_payment_id": client_payment_id,
                "created_by": auth["id"],
                "created_at": now_iso,
                "updated_at": now_iso,
                "editable_until": editable_until_iso,
                "email_sent": email_sent,
                "email": email,
                "courier_sent": courier_sent,
                "tracking_details": tracking,
                "whatsapp_sent": whatsapp_sent,
                "whatsapp_number": whatsapp_number,
                "invoice_number": invoice_number,
            }
        ).execute()
        return {"data": data, "created_at": now_iso, "editable_until": editable_until_iso, "editable_24h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save client payment sent: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/onboarding/client-payment/{client_payment_id}/followup1")
def get_client_payment_followup1(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Get Follow up 1 details for a Raised Invoice. Creates empty shell on first access."""
    try:
        r = (
            supabase.table("onboarding_client_payment_followup1")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        if not row:
            return {
                "data": {
                    "contact_person": None,
                    "remarks": None,
                    "mail_sent": False,
                    "whatsapp_sent": False,
                    "followup_timestamp": None,
                },
                "created_at": now_iso,
                "editable_until": None,
                "editable_24h": True,
                "submitted": False,
            }
        submit_at = row.get("created_at") or now_iso
        return {
            "data": {
                "contact_person": row.get("contact_person"),
                "remarks": row.get("remarks"),
                "mail_sent": bool(row.get("mail_sent")),
                "whatsapp_sent": bool(row.get("whatsapp_sent")),
                "followup_timestamp": row.get("followup_timestamp"),
            },
            "created_at": submit_at,
            "editable_until": _client_payment_editable_until_iso(submit_at),
            "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin),
            "submitted": True,
        }
    except Exception as e:
        _log(f"get client payment followup1: {e}")
        return {
            "data": {},
            "created_at": None,
            "editable_until": None,
            "editable_24h": False,
        }


@api_router.post("/onboarding/client-payment/{client_payment_id}/followup1")
def save_client_payment_followup1(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Follow up 1 details. 24h edit for creator; Master/Admin always allowed."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")

    contact_person = (data.get("contact_person") or "").strip() or None
    remarks = (data.get("remarks") or "").strip() or None
    mail_sent = bool(data.get("mail_sent"))
    whatsapp_sent = bool(data.get("whatsapp_sent"))
    followup_timestamp_iso = _client_payment_followup_timestamp_to_db_iso(data.get("followup_timestamp"))
    if followup_timestamp_iso is None:
        raise HTTPException(400, "followup_timestamp is required")

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    editable_until_iso = _client_payment_editable_until_iso(now_iso)

    try:
        existing = (
            supabase.table("onboarding_client_payment_followup1")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        row = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None

        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")

        if row:
            submit_at = row.get("created_at")
            if not is_admin and not _client_payment_response_editable(submit_at, is_admin=False):
                raise HTTPException(
                    400,
                    f"Follow up 1 can only be edited within {_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS} days of submission",
                )

            update_data = {
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
                "updated_at": now_iso,
            }
            supabase.table("onboarding_client_payment_followup1").update(update_data).eq("client_payment_id", client_payment_id).execute()
        else:
            insert_data = {
                "client_payment_id": client_payment_id,
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
                "created_by": auth.get("id"),
                "created_at": now_iso,
                "editable_until": editable_until_iso,
            }
            supabase.table("onboarding_client_payment_followup1").insert(insert_data).execute()

        return {
            "data": {
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
            },
            "created_at": row.get("created_at") if row else now_iso,
            "editable_until": row.get("editable_until") if row else editable_until_iso,
            "editable_24h": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save client payment followup1: {e}")
        raise HTTPException(400, str(e)[:200])


def _client_payment_followup_timestamp_to_db_iso(raw) -> str | None:
    """Normalize user-supplied follow-up timestamp to UTC ISO Z for timestamptz. None if empty."""
    if raw is None:
        return None
    if isinstance(raw, str) and not str(raw).strip():
        return None
    s = str(raw).strip()
    try:
        if s.endswith("Z"):
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        raise HTTPException(400, "Invalid followup_timestamp; use an ISO date-time string.")


# ---------- Client Payment: Follow-ups 1-10, Intercept, Discontinuation, Payment Receive ----------
@api_router.get("/onboarding/client-payment/{client_payment_id}/followups")
def list_client_payment_followups(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """List submitted follow-ups (1-10) and return next_followup_no (1-10 or 11 if all done)."""
    try:
        r = (
            supabase.table("onboarding_client_payment_followups")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .order("followup_no", desc=False)
            .execute()
        )
        rows = r.data or []
        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        items = []
        for row in rows:
            submit_at = row.get("created_at")
            items.append({
                "followup_no": row.get("followup_no"),
                "contact_person": row.get("contact_person"),
                "remarks": row.get("remarks"),
                "mail_sent": bool(row.get("mail_sent")),
                "whatsapp_sent": bool(row.get("whatsapp_sent")),
                "followup_timestamp": row.get("followup_timestamp"),
                "created_at": submit_at,
                "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin),
            })
        # Legacy: if old followup1 table has a row, treat as followup 1
        try:
            r1 = (
                supabase.table("onboarding_client_payment_followup1")
                .select("created_at, editable_until, followup_timestamp, contact_person, remarks, mail_sent, whatsapp_sent")
                .eq("client_payment_id", client_payment_id)
                .limit(1)
                .execute()
            )
            if r1.data and len(r1.data) > 0 and not any(x.get("followup_no") == 1 for x in rows):
                leg = r1.data[0]
                leg_submit = leg.get("created_at")
                editable_24h = _client_payment_response_editable(leg_submit, is_admin=is_admin)
                items.append(
                    {
                        "followup_no": 1,
                        "contact_person": leg.get("contact_person"),
                        "remarks": leg.get("remarks"),
                        "mail_sent": bool(leg.get("mail_sent")),
                        "whatsapp_sent": bool(leg.get("whatsapp_sent")),
                        "followup_timestamp": leg.get("followup_timestamp"),
                        "created_at": leg.get("created_at"),
                        "editable_24h": editable_24h,
                    }
                )
                items.sort(key=lambda x: x["followup_no"])
        except Exception:
            pass
        max_no = max([x["followup_no"] for x in items], default=0)
        next_followup_no = min(max_no + 1, 11)  # 11 = all done
        return {"items": items, "next_followup_no": next_followup_no}
    except Exception as e:
        _log(f"list client payment followups: {e}")
        return {"items": [], "next_followup_no": 1}


@api_router.get("/onboarding/client-payment/{client_payment_id}/followups/{followup_no}")
def get_client_payment_followup(client_payment_id: str, followup_no: int, auth: dict = Depends(get_current_user)):
    """Get one follow-up (1-10) for edit/view. 24h edit."""
    if followup_no < 1 or followup_no > 10:
        raise HTTPException(400, "followup_no must be 1-10")
    try:
        r = (
            supabase.table("onboarding_client_payment_followups")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .eq("followup_no", followup_no)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            if followup_no == 1:
                r1 = supabase.table("onboarding_client_payment_followup1").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
                row = (r1.data or [None])[0] if (r1.data and len(r1.data) > 0) else None
                if row:
                    row["followup_no"] = 1
            if not row:
                return {
                    "data": {
                        "contact_person": None,
                        "remarks": None,
                        "mail_sent": False,
                        "whatsapp_sent": False,
                        "followup_timestamp": None,
                    },
                    "submitted": False,
                    "editable_24h": True,
                }
        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        submit_at = row.get("created_at") if row else None
        return {
            "data": {
                "contact_person": row.get("contact_person") if row else None,
                "remarks": row.get("remarks") if row else None,
                "mail_sent": bool(row.get("mail_sent")) if row else False,
                "whatsapp_sent": bool(row.get("whatsapp_sent")) if row else False,
                "followup_timestamp": row.get("followup_timestamp") if row else None,
            },
            "submitted": bool(row),
            "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin) if row else True,
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get client payment followup: {e}")
        return {"data": {}, "submitted": False, "editable_24h": True}


@api_router.post("/onboarding/client-payment/{client_payment_id}/followups")
def save_client_payment_followup(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update follow-up N (1-10). 24h edit. Auto timestamp on create."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    followup_no = data.get("followup_no") or payload.get("followup_no")
    if followup_no is None:
        raise HTTPException(400, "followup_no is required")
    followup_no = int(followup_no)
    if followup_no < 1 or followup_no > 10:
        raise HTTPException(400, "followup_no must be 1-10")
    contact_person = (data.get("contact_person") or "").strip() or None
    remarks = (data.get("remarks") or "").strip() or None
    mail_sent = bool(data.get("mail_sent"))
    whatsapp_sent = bool(data.get("whatsapp_sent"))
    followup_timestamp_iso = _client_payment_followup_timestamp_to_db_iso(data.get("followup_timestamp"))
    if followup_timestamp_iso is None:
        raise HTTPException(400, "followup_timestamp is required")
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    editable_until_iso = _client_payment_editable_until_iso(now_iso)
    try:
        existing = (
            supabase.table("onboarding_client_payment_followups")
            .select("*")
            .eq("client_payment_id", client_payment_id)
            .eq("followup_no", followup_no)
            .limit(1)
            .execute()
        )
        row = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        if row:
            if not is_admin and not _client_payment_response_editable(row.get("created_at"), is_admin=False):
                raise HTTPException(
                    400,
                    f"Follow-up can only be edited within {_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS} days of submission",
                )
            supabase.table("onboarding_client_payment_followups").update({
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
                "updated_at": now_iso,
            }).eq("id", row["id"]).execute()
        else:
            supabase.table("onboarding_client_payment_followups").insert({
                "client_payment_id": client_payment_id,
                "followup_no": followup_no,
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
                "created_by": auth.get("id"),
                "created_at": now_iso,
                "editable_until": editable_until_iso,
            }).execute()
        return {
            "data": {
                "followup_no": followup_no,
                "contact_person": contact_person,
                "remarks": remarks,
                "mail_sent": mail_sent,
                "whatsapp_sent": whatsapp_sent,
                "followup_timestamp": followup_timestamp_iso,
            },
            "created_at": now_iso,
            "editable_24h": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save client payment followup: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/onboarding/client-payment/{client_payment_id}/intercept")
def get_client_payment_intercept(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Get Intercept Requirements for this invoice. One record per invoice."""
    try:
        r = supabase.table("onboarding_client_payment_intercept").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {
                "data": {
                    "last_remark_user": None,
                    "usage_last_1_month": None,
                    "contact_person": None,
                    "contact_number": None,
                    "tagged_user_id": None,
                    "tagged_user_name": None,
                    "tagged_user_email": None,
                    "tagged_user_2_id": None,
                    "tagged_user_2_name": None,
                    "tagged_user_2_email": None,
                    "payment_action_person": None,
                    "payment_action_remarks": None,
                    "payment_action_submitted_at": None,
                    "payment_action_2_person": None,
                    "payment_action_2_remarks": None,
                    "payment_action_2_submitted_at": None,
                },
                "submitted": False,
                "editable_24h": True,
            }

        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")
        submit_at = row.get("created_at")
        created_by = row.get("created_by")
        if is_admin:
            editable_24h = True
        elif created_by == auth["id"]:
            editable_24h = _client_payment_response_editable(submit_at, is_admin=False)
        else:
            editable_24h = False
        return {
            "data": {
                "last_remark_user": row.get("last_remark_user"),
                "usage_last_1_month": row.get("usage_last_1_month"),
                "contact_person": row.get("contact_person"),
                "contact_number": row.get("contact_number"),
                "tagged_user_id": row.get("tagged_user_id"),
                "tagged_user_name": row.get("tagged_user_name"),
                "tagged_user_email": row.get("tagged_user_email"),
                "tagged_user_2_id": row.get("tagged_user_2_id"),
                "tagged_user_2_name": row.get("tagged_user_2_name"),
                "tagged_user_2_email": row.get("tagged_user_2_email"),
                "payment_action_person": row.get("payment_action_person"),
                "payment_action_remarks": row.get("payment_action_remarks"),
                "payment_action_submitted_at": row.get("payment_action_submitted_at"),
                "payment_action_2_person": row.get("payment_action_2_person"),
                "payment_action_2_remarks": row.get("payment_action_2_remarks"),
                "payment_action_2_submitted_at": row.get("payment_action_2_submitted_at"),
            },
            "submitted": True,
            "created_at": row.get("created_at"),
            "editable_24h": True if is_admin else editable_24h,
        }
    except Exception as e:
        _log(f"get client payment intercept: {e}")
        return {"data": {}, "submitted": False}


@api_router.post("/onboarding/client-payment/{client_payment_id}/intercept/tag-2")
def save_client_payment_intercept_tag2(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Second tag (T 2) for Client Payment. Any authenticated user may submit. Requires intercept tag + first payment action."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    tagged_uid = (data.get("tagged_user_id") or "").strip() or None
    if not tagged_uid:
        raise HTTPException(400, "tagged_user_id is required")
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        r = supabase.table("onboarding_client_payment_intercept").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            raise HTTPException(400, "Save Intercept Requirements and Tag first")
        if not row.get("tagged_user_id"):
            raise HTTPException(400, "Tag (T 1) required before Tag 2")
        if not row.get("payment_action_submitted_at"):
            raise HTTPException(400, "Client Payment first action must be completed before Tag 2")
        if row.get("tagged_user_2_id"):
            raise HTTPException(400, "Tag 2 is already set")
        u_name = ""
        u_email = ""
        try:
            ur = supabase.table("users_view").select("id, full_name, email").eq("id", tagged_uid).limit(1).execute()
            urow = (ur.data or [None])[0] if ur.data else None
            if urow:
                u_name = (urow.get("full_name") or "").strip() or ""
                u_email = (urow.get("email") or "").strip() or ""
        except Exception:
            pass
        supabase.table("onboarding_client_payment_intercept").update(
            {
                "tagged_user_2_id": tagged_uid,
                "tagged_user_2_name": u_name or None,
                "tagged_user_2_email": u_email or None,
                "updated_at": now_iso,
            }
        ).eq("id", row["id"]).execute()
        return {
            "data": {
                "tagged_user_2_id": tagged_uid,
                "tagged_user_2_name": u_name or None,
                "tagged_user_2_email": u_email or None,
            },
            "created_at": now_iso,
        }
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "column" in err and "tagged_user_2" in err:
            raise HTTPException(
                503,
                "Run docs/CLIENT_PAYMENT_INTERCEPT_TAG2.sql in Supabase to add Tag 2 columns.",
            )
        _log(f"save client payment intercept tag2: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.post("/onboarding/client-payment/{client_payment_id}/intercept")
def save_client_payment_intercept(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Intercept Requirements. Auto timestamp."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    last_remark_user = (data.get("last_remark_user") or "").strip() or None
    usage_last_1_month = (data.get("usage_last_1_month") or "").strip() or None
    contact_person = (data.get("contact_person") or "").strip() or None
    contact_number = (data.get("contact_number") or "").strip() or None
    tagged_user_id = (data.get("tagged_user_id") or "").strip() or None
    tagged_user_name = (data.get("tagged_user_name") or "").strip() or None
    tagged_user_email = (data.get("tagged_user_email") or "").strip() or None

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    editable_until_iso = _client_payment_editable_until_iso(now_iso)
    try:
        r = supabase.table("onboarding_client_payment_intercept").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None

        role = _get_role_from_profile(auth["id"])
        is_admin = role in ("admin", "master_admin")

        if row:
            created_by = row.get("created_by")
            submit_at = row.get("created_at")
            can_edit = is_admin or (
                created_by == auth["id"] and _client_payment_response_editable(submit_at, is_admin=False)
            )
            if not can_edit:
                raise HTTPException(
                    403,
                    f"Intercept Requirements can only be edited within {_CLIENT_PAYMENT_RESPONSE_EDIT_DAYS} days of submission",
                )

            supabase.table("onboarding_client_payment_intercept").update({
                "last_remark_user": last_remark_user, "usage_last_1_month": usage_last_1_month,
                "contact_person": contact_person, "contact_number": contact_number, "updated_at": now_iso,
                "tagged_user_id": tagged_user_id,
                "tagged_user_name": tagged_user_name,
                "tagged_user_email": tagged_user_email,
            }).eq("id", row["id"]).execute()
        else:
            supabase.table("onboarding_client_payment_intercept").insert({
                "client_payment_id": client_payment_id, "last_remark_user": last_remark_user,
                "usage_last_1_month": usage_last_1_month, "contact_person": contact_person, "contact_number": contact_number,
                "created_by": auth.get("id"), "created_at": now_iso,
                "editable_until": editable_until_iso,
                "tagged_user_id": tagged_user_id,
                "tagged_user_name": tagged_user_name,
                "tagged_user_email": tagged_user_email,
            }).execute()
        return {
            "data": {
                "last_remark_user": last_remark_user,
                "usage_last_1_month": usage_last_1_month,
                "contact_person": contact_person,
                "contact_number": contact_number,
                "tagged_user_id": tagged_user_id,
                "tagged_user_name": tagged_user_name,
                "tagged_user_email": tagged_user_email,
            },
            "created_at": now_iso,
            "editable_24h": True if is_admin else True,
        }
    except Exception as e:
        _log(f"save client payment intercept: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/users/options")
@cached(ttl=30, key_prefix="users:options:")
def list_user_options(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """Lightweight list of registered users for dropdowns (id, full_name, email). Any authenticated user."""
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("users_view")
            .select("id, full_name, email, is_active, created_at", count="exact")
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = [x for x in (r.data or []) if x and x.get("id") and x.get("is_active", True)]
        payload = {
            "data": [
                {"id": str(x["id"]), "full_name": x.get("full_name") or "", "email": x.get("email") or ""}
                for x in rows
            ],
            "total": r.count or 0,
            "page": page,
            "page_size": page_size,
        }
        return _etag_json(payload)
    except Exception as e:
        _log(f"list user options: {e}")
        return _etag_json({"data": [], "total": 0, "page": 1, "page_size": 50})


class PaymentActionSubmitRequest(BaseModel):
    client_payment_id: str
    person: str
    remarks: str
    tag: str | None = None  # "t1" | "t2" — which payment action round (default t1)


def _norm_uuid_str(s: str | None) -> str:
    """Compare UUIDs from DB vs JWT regardless of dashes / case."""
    return (str(s or "").replace("-", "").lower())


def _user_matches_tagged_t1(row: dict, uid: str, email: str) -> bool:
    """Match T1 tagger by user id or by stored tagged email (fallback if id missing/mismatch)."""
    tid = row.get("tagged_user_id")
    if tid and uid and _norm_uuid_str(tid) == _norm_uuid_str(uid):
        return True
    te = (str(row.get("tagged_user_email") or "").strip().lower())
    em = (email or "").strip().lower()
    return bool(em and te and te == em)


def _user_matches_tagged_t2(row: dict, uid: str, email: str) -> bool:
    """Match T2 tagger by user id or by stored tagged_2 email."""
    tid = row.get("tagged_user_2_id")
    if tid and uid and _norm_uuid_str(tid) == _norm_uuid_str(uid):
        return True
    te = (str(row.get("tagged_user_2_email") or "").strip().lower())
    em = (email or "").strip().lower()
    return bool(em and te and te == em)


def _can_submit_payment_action(current: dict, row: dict, tag: str) -> bool:
    """Master Admin / SK, or the user tagged for T1 / T2 for this intercept."""
    role = (current.get("role") or "").lower()
    uid = str(current.get("id") or "")
    email = (current.get("email") or "").lower()
    if role in ("master_admin", "admin") or email == "sk@industryprime.com":
        return True
    if tag == "t1":
        return _user_matches_tagged_t1(row, uid, email)
    if tag == "t2":
        return _user_matches_tagged_t2(row, uid, email)
    return False


@api_router.post("/dashboard/payment-actions/submit")
def dashboard_payment_action_submit(payload: PaymentActionSubmitRequest, current: dict = Depends(get_current_user_with_role)):
    """Record Person + Remarks from Payment Action dashboard; T1 or T2 round. Master Admin or tagged user for that round."""
    person = (payload.person or "").strip()
    remarks = (payload.remarks or "").strip()
    if not person:
        raise HTTPException(400, "Person is required")
    if not remarks:
        raise HTTPException(400, "Remarks is required")
    cid = (payload.client_payment_id or "").strip()
    if not cid:
        raise HTTPException(400, "client_payment_id is required")
    tag = (payload.tag or "t1").strip().lower()
    if tag not in ("t1", "t2"):
        raise HTTPException(400, "tag must be t1 or t2")
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        r = supabase.table("onboarding_client_payment_intercept").select("*").eq("client_payment_id", cid).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row or not row.get("tagged_user_id"):
            raise HTTPException(404, "Tagged intercept not found for this invoice")
        if not _can_submit_payment_action(current, row, tag):
            raise HTTPException(403, "Only Master Admin or the tagged user for this step can submit")
        if tag == "t1":
            if row.get("payment_action_submitted_at"):
                raise HTTPException(400, "T1 payment action already submitted")
            supabase.table("onboarding_client_payment_intercept").update({
                "payment_action_person": person,
                "payment_action_remarks": remarks,
                "payment_action_submitted_at": now_iso,
                "payment_action_submitted_by": current.get("id"),
                "updated_at": now_iso,
            }).eq("id", row["id"]).execute()
            return {"success": True, "payment_action_submitted_at": now_iso, "tag": "t1"}
        # T2
        if not row.get("payment_action_submitted_at"):
            raise HTTPException(400, "Complete T1 payment action before T2")
        has_t2 = bool(
            row.get("tagged_user_2_id")
            or (str(row.get("tagged_user_2_name") or "").strip())
            or (str(row.get("tagged_user_2_email") or "").strip())
        )
        if not has_t2:
            raise HTTPException(400, "No Tag 2 user for this invoice")
        if row.get("payment_action_2_submitted_at"):
            raise HTTPException(400, "T2 payment action already submitted")
        supabase.table("onboarding_client_payment_intercept").update({
            "payment_action_2_person": person,
            "payment_action_2_remarks": remarks,
            "payment_action_2_submitted_at": now_iso,
            "payment_action_2_submitted_by": current.get("id"),
            "updated_at": now_iso,
        }).eq("id", row["id"]).execute()
        return {"success": True, "payment_action_2_submitted_at": now_iso, "tag": "t2"}
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "payment_action_2" in err and ("column" in err or "does not exist" in err):
            raise HTTPException(
                503,
                "Run docs/CLIENT_PAYMENT_INTERCEPT_TAG2.sql in Supabase (payment_action_2_* columns).",
            )
        _log(f"dashboard payment action submit: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/dashboard/payment-actions")
@cached(ttl=30, key_prefix="dashboard:payment-actions:")
def dashboard_payment_actions(
    page: int = 1,
    page_size: int = Query(50, le=200),
    current: dict = Depends(get_current_user_with_role),
):
    """Tagged intercept rows with pending Payment Action only (T1 and/or T2).
    Rows disappear after the last required submit (T1 only if no T2; else T1 then T2).
    Master Admin / Admin / SK: all pending rows; others: only where they are tagged for that pending step."""
    try:
        role = (current.get("role") or "").lower()
        uid = str(current.get("id") or "")
        email = (current.get("email") or "").lower()
        # Full list: Master Admin, Admin, or SK — same as other dashboard admin views
        is_full_list = role in ("master_admin", "admin") or email == "sk@industryprime.com"
        # Use select("*") so missing optional columns (e.g. T2 / payment_action_2_*) in DB do not break the query.
        # Naming columns explicitly caused empty dashboard when payment_action_2_* was not migrated yet.
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        r = (
            supabase.table("onboarding_client_payment_intercept")
            .select("*")
            .not_.is_("tagged_user_id", "null")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
        )
        raw_rows = [x for x in (r.data or []) if x.get("tagged_user_id")]

        def _intercept_has_t2_tag(x: dict) -> bool:
            return bool(
                x.get("tagged_user_2_id")
                or (str(x.get("tagged_user_2_name") or "").strip())
                or (str(x.get("tagged_user_2_email") or "").strip())
            )

        # Only pending work items: once T1 (and T2 if applicable) payment actions are submitted, row leaves this list.
        pending_items: list[dict] = []
        for x in raw_rows:
            cid = str(x.get("client_payment_id") or "")
            if not cid:
                continue
            t1_done = bool(x.get("payment_action_submitted_at"))
            t2_tag = _intercept_has_t2_tag(x)
            t2_done = bool(x.get("payment_action_2_submitted_at"))
            if not t1_done:
                pending_items.append(
                    {
                        "client_payment_id": cid,
                        "intercept_row": x,
                        "pending_payment_tag": "t1",
                    }
                )
            elif t2_tag and not t2_done:
                pending_items.append(
                    {
                        "client_payment_id": cid,
                        "intercept_row": x,
                        "pending_payment_tag": "t2",
                    }
                )
            # T1 done and no T2 tag → nothing to do on dashboard. T1+T2 both done → row clears (not listed).

        queue: list[dict] = pending_items

        if not is_full_list:
            filtered_queue: list[dict] = []
            for pitem in queue:
                it = pitem["intercept_row"]
                tag = pitem["pending_payment_tag"]
                if tag == "t1" and _user_matches_tagged_t1(it, uid, email):
                    filtered_queue.append(pitem)
                elif tag == "t2" and _user_matches_tagged_t2(it, uid, email):
                    filtered_queue.append(pitem)
            queue = filtered_queue

        ids = list({p["client_payment_id"] for p in queue})
        if not ids:
            return {"data": [], "total": 0, "page": page, "page_size": page_size}
        p = (
            supabase.table("onboarding_client_payment")
            .select("id, company_name, invoice_number, reference_no, invoice_date, invoice_amount, genre")
            .in_("id", ids)
            .execute()
        )
        by_id = {str(x.get("id")): x for x in (p.data or []) if x and x.get("id")}
        out = []
        for pitem in queue:
            cid = str(pitem["client_payment_id"] or "")
            row = by_id.get(cid)
            if not row:
                for k, v in by_id.items():
                    if _norm_uuid_str(str(k)) == _norm_uuid_str(cid):
                        row = v
                        break
            if not row:
                _log(f"dashboard payment actions: no onboarding_client_payment row for client_payment_id={cid!r}")
                continue
            it = pitem["intercept_row"]
            out.append(
                {
                    "client_payment_id": cid,
                    "company_name": row.get("company_name"),
                    "invoice_number": row.get("invoice_number"),
                    "reference_no": row.get("reference_no"),
                    "invoice_date": row.get("invoice_date"),
                    "invoice_amount": row.get("invoice_amount"),
                    "genre": row.get("genre"),
                    "tagged_user_id": it.get("tagged_user_id"),
                    "tagged_user_name": it.get("tagged_user_name"),
                    "tagged_user_email": it.get("tagged_user_email"),
                    "tagged_user_2_id": it.get("tagged_user_2_id"),
                    "tagged_user_2_name": it.get("tagged_user_2_name"),
                    "tagged_user_2_email": it.get("tagged_user_2_email"),
                    "pending_payment_tag": pitem["pending_payment_tag"],
                }
            )
        total = len(out)
        offset = (page - 1) * page_size
        paged = out[offset: offset + page_size]
        return {"data": paged, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        err = str(e).lower()
        if "payment_action_2" in err and ("column" in err or "does not exist" in err):
            _log(f"dashboard payment actions (missing T2 columns): {e}")
        else:
            _log(f"dashboard payment actions: {e}")
        return {"data": [], "total": 0, "page": 1, "page_size": 50}


@api_router.get("/onboarding/client-payment/{client_payment_id}/discontinuation")
def get_client_payment_discontinuation(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Get Discontinuation Mail for this invoice."""
    try:
        r = supabase.table("onboarding_client_payment_discontinuation").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {"mail_sent_to": None, "mail_sent_on": None, "remarks": None}, "submitted": False}
        return {
            "data": {
                "mail_sent_to": row.get("mail_sent_to"),
                "mail_sent_on": row.get("mail_sent_on"),
                "remarks": row.get("remarks"),
            },
            "submitted": True,
            "created_at": row.get("created_at"),
        }
    except Exception as e:
        _log(f"get client payment discontinuation: {e}")
        return {"data": {}, "submitted": False}


@api_router.get("/onboarding/client-payment/{client_payment_id}/drawer")
def get_client_payment_drawer(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Batch load sent, followups, intercept, discontinuation in one request (reduces 4 round-trips to 1)."""
    now_dt = datetime.now(timezone.utc)
    role = _get_role_from_profile(auth["id"])
    is_admin = role in ("admin", "master_admin")
    out = {"sent": None, "followups": None, "intercept": None, "discontinuation": None}

    # 1) Sent
    try:
        r = supabase.table("onboarding_client_payment_sent").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            now_iso = now_dt.isoformat().replace("+00:00", "Z")
            out["sent"] = {
                "data": {
                    "email_sent": False,
                    "email": None,
                    "courier_sent": False,
                    "tracking_details": None,
                    "whatsapp_sent": False,
                    "whatsapp_number": None,
                    "invoice_number": None,
                },
                "created_at": now_iso,
                "editable_until": None,
                "editable_24h": True,
                "submitted": False,
            }
        else:
            submit_at = row.get("created_at")
            out["sent"] = {
                "data": {
                    "email_sent": bool(row.get("email_sent")),
                    "email": row.get("email"),
                    "courier_sent": bool(row.get("courier_sent")),
                    "tracking_details": row.get("tracking_details"),
                    "whatsapp_sent": bool(row.get("whatsapp_sent")),
                    "whatsapp_number": row.get("whatsapp_number"),
                    "invoice_number": row.get("invoice_number"),
                },
                "created_at": submit_at,
                "editable_until": _client_payment_editable_until_iso(submit_at),
                "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin),
                "submitted": True,
            }
    except Exception as e:
        _log(f"drawer sent: {e}")
        out["sent"] = {"data": {}, "created_at": None, "editable_until": None, "editable_24h": False, "submitted": False}

    # 2) Followups
    try:
        r = supabase.table("onboarding_client_payment_followups").select("*").eq("client_payment_id", client_payment_id).order("followup_no", desc=False).execute()
        rows = r.data or []
        items = []
        for row in rows:
            submit_at = row.get("created_at")
            items.append(
                {
                    "followup_no": row.get("followup_no"),
                    "contact_person": row.get("contact_person"),
                    "remarks": row.get("remarks"),
                    "mail_sent": bool(row.get("mail_sent")),
                    "whatsapp_sent": bool(row.get("whatsapp_sent")),
                    "followup_timestamp": row.get("followup_timestamp"),
                    "created_at": submit_at,
                    "editable_24h": _client_payment_response_editable(submit_at, is_admin=is_admin),
                }
            )
        r1 = (
            supabase.table("onboarding_client_payment_followup1")
            .select("created_at, editable_until, followup_timestamp, contact_person, remarks, mail_sent, whatsapp_sent")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        if r1.data and len(r1.data) > 0 and not any(x.get("followup_no") == 1 for x in rows):
            leg = r1.data[0]
            leg_submit = leg.get("created_at")
            items.append(
                {
                    "followup_no": 1,
                    "contact_person": leg.get("contact_person"),
                    "remarks": leg.get("remarks"),
                    "mail_sent": bool(leg.get("mail_sent")),
                    "whatsapp_sent": bool(leg.get("whatsapp_sent")),
                    "followup_timestamp": leg.get("followup_timestamp"),
                    "created_at": leg_submit,
                    "editable_24h": _client_payment_response_editable(leg_submit, is_admin=is_admin),
                }
            )
            items.sort(key=lambda x: x["followup_no"])
        max_no = max([x["followup_no"] for x in items], default=0)
        out["followups"] = {"items": items, "next_followup_no": min(max_no + 1, 11)}
    except Exception as e:
        _log(f"drawer followups: {e}")
        out["followups"] = {"items": [], "next_followup_no": 1}

    # 3) Intercept
    try:
        r = supabase.table("onboarding_client_payment_intercept").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            out["intercept"] = {
                "data": {
                    "last_remark_user": None,
                    "usage_last_1_month": None,
                    "contact_person": None,
                    "contact_number": None,
                    "tagged_user_id": None,
                    "tagged_user_name": None,
                    "tagged_user_email": None,
                    "tagged_user_2_id": None,
                    "tagged_user_2_name": None,
                    "tagged_user_2_email": None,
                    "payment_action_person": None,
                    "payment_action_remarks": None,
                    "payment_action_submitted_at": None,
                    "payment_action_2_person": None,
                    "payment_action_2_remarks": None,
                    "payment_action_2_submitted_at": None,
                },
                "submitted": False,
                "editable_24h": True,
            }
        else:
            submit_at = row.get("created_at")
            created_by = row.get("created_by")
            if is_admin:
                editable_24h = True
            elif created_by == auth["id"]:
                editable_24h = _client_payment_response_editable(submit_at, is_admin=False)
            else:
                editable_24h = False
            out["intercept"] = {
                "data": {
                    "last_remark_user": row.get("last_remark_user"),
                    "usage_last_1_month": row.get("usage_last_1_month"),
                    "contact_person": row.get("contact_person"),
                    "contact_number": row.get("contact_number"),
                    "tagged_user_id": row.get("tagged_user_id"),
                    "tagged_user_name": row.get("tagged_user_name"),
                    "tagged_user_email": row.get("tagged_user_email"),
                    "tagged_user_2_id": row.get("tagged_user_2_id"),
                    "tagged_user_2_name": row.get("tagged_user_2_name"),
                    "tagged_user_2_email": row.get("tagged_user_2_email"),
                    "payment_action_person": row.get("payment_action_person"),
                    "payment_action_remarks": row.get("payment_action_remarks"),
                    "payment_action_submitted_at": row.get("payment_action_submitted_at"),
                    "payment_action_2_person": row.get("payment_action_2_person"),
                    "payment_action_2_remarks": row.get("payment_action_2_remarks"),
                    "payment_action_2_submitted_at": row.get("payment_action_2_submitted_at"),
                },
                "submitted": True,
                "created_at": submit_at,
                "editable_24h": editable_24h,
            }
    except Exception as e:
        _log(f"drawer intercept: {e}")
        out["intercept"] = {"data": {}, "submitted": False, "editable_24h": True}

    # 4) Discontinuation
    try:
        r = supabase.table("onboarding_client_payment_discontinuation").select("*").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            out["discontinuation"] = {"data": {"mail_sent_to": None, "mail_sent_on": None, "remarks": None}, "submitted": False}
        else:
            out["discontinuation"] = {"data": {"mail_sent_to": row.get("mail_sent_to"), "mail_sent_on": row.get("mail_sent_on"), "remarks": row.get("remarks")}, "submitted": True, "created_at": row.get("created_at")}
    except Exception as e:
        _log(f"drawer discontinuation: {e}")
        out["discontinuation"] = {"data": {}, "submitted": False}

    # 5) Payment receive (Paym-Rec) — completed invoices
    try:
        cp_row = None
        cr = (
            supabase.table("onboarding_client_payment")
            .select(_ocp_list_select_columns())
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        cp_row = (cr.data or [None])[0] if cr.data else None
        out["payment_receive"] = _client_payment_receive_payload(client_payment_id, cp_row)
    except Exception as e:
        _log(f"drawer payment_receive: {e}")
        out["payment_receive"] = {"data": {}, "submitted": False, "created_at": None}

    return out


def _client_payment_receive_payload(client_payment_id: str, cp_row: dict | None = None) -> dict:
    """Load Paym-Rec row; fall back to onboarding_client_payment columns when needed."""
    data = {
        "party_name": None,
        "invoice_number": None,
        "amount": None,
        "payment_date": None,
    }
    submitted = False
    created_at = None
    try:
        r = (
            supabase.table("onboarding_client_payment_receive")
            .select("party_name,invoice_number,amount,payment_date,created_at")
            .eq("client_payment_id", client_payment_id)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0] if r.data else None
        if row:
            submitted = True
            created_at = row.get("created_at")
            data = {
                "party_name": row.get("party_name"),
                "invoice_number": row.get("invoice_number"),
                "amount": row.get("amount"),
                "payment_date": row.get("payment_date"),
            }
    except Exception as e:
        _log(f"payment receive fetch: {e}")
    if cp_row:
        prd = cp_row.get("payment_received_date")
        if prd and not data.get("payment_date"):
            pd = str(prd)[:10] if isinstance(prd, str) else prd
            data["payment_date"] = pd
        if prd:
            submitted = True
        if not data.get("party_name"):
            data["party_name"] = cp_row.get("company_name")
        if not data.get("invoice_number"):
            data["invoice_number"] = cp_row.get("invoice_number")
        if data.get("amount") is None and cp_row.get("invoice_amount") is not None:
            data["amount"] = cp_row.get("invoice_amount")
    return {"data": data, "submitted": submitted, "created_at": created_at}


@api_router.get("/onboarding/client-payment/{client_payment_id}/payment-receive")
def get_client_payment_receive(client_payment_id: str, auth: dict = Depends(get_current_user)):
    """Get Payment Receive Details (Paym-Rec) for a completed invoice."""
    try:
        cr = (
            supabase.table("onboarding_client_payment")
            .select(_ocp_list_select_columns())
            .eq("id", client_payment_id)
            .limit(1)
            .execute()
        )
        cp_row = (cr.data or [None])[0] if cr.data else None
        if not cp_row:
            raise HTTPException(404, "Invoice not found")
        return _client_payment_receive_payload(client_payment_id, cp_row)
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get client payment receive: {e}")
        return {"data": {}, "submitted": False, "created_at": None}


@api_router.post("/onboarding/client-payment/{client_payment_id}/discontinuation")
def save_client_payment_discontinuation(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Discontinuation Mail. Auto timestamp."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    mail_sent_to = (data.get("mail_sent_to") or "").strip() or None
    mail_sent_on = data.get("mail_sent_on")  # date YYYY-MM-DD
    remarks = (data.get("remarks") or "").strip() or None
    if mail_sent_on and isinstance(mail_sent_on, str):
        mail_sent_on = mail_sent_on[:10]
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        r = supabase.table("onboarding_client_payment_discontinuation").select("id").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if row:
            supabase.table("onboarding_client_payment_discontinuation").update({
                "mail_sent_to": mail_sent_to, "mail_sent_on": mail_sent_on, "remarks": remarks, "updated_at": now_iso,
            }).eq("id", row["id"]).execute()
        else:
            supabase.table("onboarding_client_payment_discontinuation").insert({
                "client_payment_id": client_payment_id, "mail_sent_to": mail_sent_to, "mail_sent_on": mail_sent_on, "remarks": remarks,
                "created_by": auth.get("id"), "created_at": now_iso,
            }).execute()
        return {"data": {"mail_sent_to": mail_sent_to, "mail_sent_on": mail_sent_on, "remarks": remarks}, "created_at": now_iso}
    except Exception as e:
        _log(f"save client payment discontinuation: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.post("/onboarding/client-payment/{client_payment_id}/payment-receive")
def save_client_payment_receive(client_payment_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Payment Receive Details (Paym-Rec). Marks invoice completed; no further follow-ups."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    party_name = (data.get("party_name") or "").strip()
    if not party_name:
        raise HTTPException(400, "party_name is required")
    invoice_number = (data.get("invoice_number") or "").strip()
    if not invoice_number:
        raise HTTPException(400, "invoice_number is required")
    if len(invoice_number) > 50:
        raise HTTPException(400, "invoice_number max 50 characters")
    amount = data.get("amount")
    if amount is None or (isinstance(amount, (int, float)) and amount < 0):
        raise HTTPException(400, "amount is required and must be >= 0")
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")
    payment_date = data.get("payment_date")
    if not payment_date:
        raise HTTPException(400, "payment_date is required")
    if isinstance(payment_date, str):
        payment_date = payment_date[:10]
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        r = supabase.table("onboarding_client_payment_receive").select("id").eq("client_payment_id", client_payment_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if row:
            supabase.table("onboarding_client_payment_receive").update({
                "party_name": party_name, "invoice_number": invoice_number, "amount": amount, "payment_date": payment_date, "updated_at": now_iso,
            }).eq("client_payment_id", client_payment_id).execute()
        else:
            supabase.table("onboarding_client_payment_receive").insert({
                "client_payment_id": client_payment_id, "party_name": party_name, "invoice_number": invoice_number,
                "amount": amount, "payment_date": payment_date, "created_by": auth.get("id"), "created_at": now_iso,
            }).execute()
    except Exception as e:
        _log(f"payment receive: {e}")
        raise HTTPException(400, str(e)[:200])
    supabase.table("onboarding_client_payment").update({"payment_received_date": payment_date}).eq("id", client_payment_id).execute()
    _invalidate_payment_summary_cache()
    return {"data": {"party_name": party_name, "invoice_number": invoice_number, "amount": amount, "payment_date": payment_date}, "created_at": now_iso}

# ---------- Training: Expected Day 0 = timestamp + 24h; Status = Pending / Done in X / Done, X delay ----------
def _parse_iso_ts(s) -> Optional[datetime]:
    """Parse ISO timestamp string to timezone-aware datetime."""
    if not s:
        return None
    s = str(s).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _format_duration_short(seconds: float) -> str:
    """Format seconds as 'Xm', 'Xh', 'Xd Xh' for display."""
    if seconds is None or seconds < 0:
        return ""
    s = int(round(seconds))
    if s < 60:
        return f"{s}m"
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        h, r = divmod(s, 3600)
        if r >= 1800:
            h += 1
        return f"{h}h"
    d, r = divmod(s, 86400)
    h = r // 3600
    if h > 0:
        return f"{d}d {h}h"
    return f"{d}d"


# ---------- Training: Clients (only when Payment Status Fi-DO = Done / Final Setup submitted) ----------
@api_router.get("/training/clients")
@cached(ttl=30, key_prefix="training:clients:")
def list_training_clients(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """List clients: only companies where Onboarding > Payment Status has Fi-DO = Done (Final Setup submitted).
    For each such company, Company name, POC, and Old reference number are pulled from Payment Status and shown in Client Training in the relevant columns."""
    try:
        r = supabase.table("onboarding_final_setup").select("payment_status_id, submitted_at").execute()
        rows = r.data or []
        done_ids = []
        submitted_map = {}
        for row in rows:
            pid = row.get("payment_status_id")
            if not pid:
                continue
            pid_str = str(pid)
            done_ids.append(pid_str)
            submitted_map[pid_str] = row.get("submitted_at") or ""
        all_ids = list(done_ids)
        if not all_ids:
            return {"items": []}
        pay = supabase.table("onboarding_payment_status").select("id, company_name, reference_no, timestamp, poc_name").in_("id", all_ids).execute()
        pay_rows = {}
        for p in (pay.data or []):
            kid = p.get("id")
            if kid is not None:
                k = str(kid)
                pay_rows[k] = p
        # Select without expected_day0 if column missing in DB (migration may not have been run)
        assign_r = supabase.table("training_client_assignments").select("payment_status_id, poc_name, poc_user_id, trainer_user_id, created_at").in_("payment_status_id", all_ids).execute()
        assign_map = {}
        trainer_ids: set[str] = set()
        for row in (assign_r.data or []):
            pid = row.get("payment_status_id")
            if pid:
                assign_map[str(pid)] = row
                tid = row.get("trainer_user_id")
                if tid:
                    trainer_ids.add(str(tid))
        # Optional: fetch expected_day0 if column exists (second query to avoid breaking when column missing)
        try:
            assign_day0_r = supabase.table("training_client_assignments").select("payment_status_id, expected_day0").in_("payment_status_id", all_ids).execute()
            for row in (assign_day0_r.data or []):
                pid = row.get("payment_status_id")
                if pid and assign_map.get(str(pid)) is not None:
                    assign_map[str(pid)]["expected_day0"] = row.get("expected_day0")
        except Exception:
            pass
        day0_map: dict[str, str] = {}
        day0_trainer_map: dict[str, str] = {}  # pid -> trainer_user_id from Day 0 checklist
        day0_skipped_map: dict[str, bool] = {}
        try:
            day0_r = supabase.table("training_day0_checklist").select("payment_status_id, submitted_at, data").in_("payment_status_id", all_ids).execute()
            for row in (day0_r.data or []):
                pid = row.get("payment_status_id")
                if pid:
                    pid_str = str(pid)
                    day0_map[pid_str] = row.get("submitted_at") or ""
                    data = row.get("data") or {}
                    if isinstance(data, dict):
                        tid = data.get("trainer_user_id")
                        if tid and str(tid).strip():
                            tid_str = str(tid).strip()
                            day0_trainer_map[pid_str] = tid_str
                            trainer_ids.add(tid_str)
                        if row.get("submitted_at"):
                            all_na = all(str(data.get(k, "")).strip().upper() == "NA" for k in DAY0_CHECKLIST_KEYS)
                            if all_na:
                                day0_skipped_map[pid_str] = True
        except Exception:
            pass
        trainer_map: dict[str, str] = {}
        if trainer_ids:
            try:
                tr = supabase.table("user_profiles").select("id, full_name").in_("id", list(trainer_ids)).execute()
                for u in (tr.data or []):
                    uid = str(u.get("id"))
                    name = (u.get("full_name") or "").strip()
                    if uid:
                        trainer_map[uid] = name
            except Exception:
                trainer_map = {}
        day0_trainer_name_map: dict[str, str] = {}
        for pid, tid in day0_trainer_map.items():
            name = trainer_map.get(tid)
            if name:
                day0_trainer_name_map[pid] = name
        stages_map: dict[str, dict[str, str]] = {}
        skipped_stages_map: dict[str, dict[str, bool]] = {}  # pid -> stage_key -> True if skipped
        try:
            stages_r = supabase.table("training_checklist_stages").select("payment_status_id, stage_key, submitted_at, data").in_("payment_status_id", all_ids).execute()
            for row in (stages_r.data or []):
                pid = str(row.get("payment_status_id"))
                sk = row.get("stage_key") or ""
                if pid not in stages_map:
                    stages_map[pid] = {}
                    skipped_stages_map[pid] = {}
                stages_map[pid][sk] = row.get("submitted_at") or ""
                if row.get("submitted_at"):
                    data = row.get("data") or {}
                    if isinstance(data, dict) and data:
                        all_na = all(str(v).strip().upper() == "NA" for v in data.values())
                        if all_na:
                            skipped_stages_map[pid][sk] = True
        except Exception:
            pass
        ordered = sorted(
            [pid for pid in all_ids if pay_rows.get(pid)],
            key=lambda pid: submitted_map.get(pid) or "",
            reverse=False,
        )
        items = []
        for i, pid in enumerate(ordered, start=1):
            p = pay_rows.get(pid) or {}
            assign = assign_map.get(pid) or {}
            stages = stages_map.get(pid) or {}
            day0_at = day0_map.get(pid) or ""
            ts_raw = submitted_map.get(pid) or p.get("timestamp") or ""
            # Trainer: from assignment first, else from Day 0 Checklist
            assignment_trainer_name = trainer_map.get(str(assign.get("trainer_user_id") or ""))
            day0_trainer_name = day0_trainer_name_map.get(pid)
            display_trainer_name = assignment_trainer_name or day0_trainer_name
            # Expected Day 0 = ticket timestamp + 24 hours
            expected_day0_dt = None
            expected_day0_iso = None
            base_dt = _parse_iso_ts(ts_raw)
            if base_dt is not None:
                expected_day0_dt = base_dt + timedelta(hours=24)
                expected_day0_iso = expected_day0_dt.isoformat()
            # Status Day 0: Pending / Done in X / Done, X delay
            day0_status = "pending"
            day0_completed_in_text = None
            day0_delay_text = None
            if day0_at:
                done_dt = _parse_iso_ts(day0_at)
                if done_dt is not None and base_dt is not None:
                    completed_sec = (done_dt - base_dt).total_seconds()
                    day0_completed_in_text = _format_duration_short(completed_sec)
                    if expected_day0_dt is not None:
                        if done_dt <= expected_day0_dt:
                            day0_status = "on_time"
                        else:
                            delay_sec = (done_dt - expected_day0_dt).total_seconds()
                            day0_delay_text = _format_duration_short(delay_sec) + " delay"
                            day0_status = "delayed"
                    else:
                        day0_status = "on_time"
            # Day '1' Planed = Day '0' Completed; expected Day 1 = Day '1' Planed + 24h; delay if Day 1 done after that
            day1_planed_dt = _parse_iso_ts(day0_at) if day0_at else None
            expected_day1_dt = (day1_planed_dt + timedelta(hours=24)) if day1_planed_dt else None
            day1_delay_text = None
            day1_at = stages.get("day1") or ""
            if day1_at and expected_day1_dt:
                day1_done_dt = _parse_iso_ts(day1_at)
                if day1_done_dt and day1_done_dt > expected_day1_dt:
                    delay_sec = (day1_done_dt - expected_day1_dt).total_seconds()
                    day1_delay_text = _format_duration_short(delay_sec) + " delay"
            # Day '2' Planed = DAY 1 (+1day) Checklist Done date & time (day1_plus1_submitted_at)
            day2_planed_iso = stages.get("day1_plus1") or ""
            expected_day2_dt = None
            if day2_planed_iso:
                day2_planed_dt = _parse_iso_ts(day2_planed_iso)
                if day2_planed_dt:
                    expected_day2_dt = day2_planed_dt + timedelta(hours=24)
            day2_delay_text = None
            day2_at = stages.get("day2") or ""
            if day2_at and expected_day2_dt:
                day2_done_dt = _parse_iso_ts(day2_at)
                if day2_done_dt and day2_done_dt > expected_day2_dt:
                    delay_sec = (day2_done_dt - expected_day2_dt).total_seconds()
                    day2_delay_text = _format_duration_short(delay_sec) + " delay"
            skipped = skipped_stages_map.get(pid) or {}
            items.append({
                "payment_status_id": pid,
                "company_name": p.get("company_name") or "",
                "onboarding_reference_no": p.get("reference_no") or "",
                "timestamp": ts_raw,
                "client_reference_no": f"CLT-{i:04d}",
                "has_assignment": bool(assign),
                "poc_name": assign.get("poc_name") or p.get("poc_name"),
                "trainer_user_id": assign.get("trainer_user_id"),
                "trainer_name": display_trainer_name,
                "assignment_created_at": assign.get("created_at"),
                "expected_day0": expected_day0_iso,
                "day0_status": day0_status,
                "day0_completed_in_text": day0_completed_in_text,
                "day0_delay_text": day0_delay_text,
                "day0_submitted_at": day0_at,
                "day0_skipped": day0_skipped_map.get(pid, False),
                "day1_minus2_submitted_at": stages.get("day1_minus2") or "",
                "day1_submitted_at": stages.get("day1") or "",
                "day1_planed_iso": day0_at,
                "day1_delay_text": day1_delay_text,
                "day1_plus1_submitted_at": stages.get("day1_plus1") or "",
                "day1_minus2_skipped": skipped.get("day1_minus2", False),
                "day1_skipped": skipped.get("day1", False),
                "day1_plus1_skipped": skipped.get("day1_plus1", False),
                "day2_skipped": skipped.get("day2", False),
                "day3_skipped": skipped.get("day3", False),
                "feedback_skipped": skipped.get("feedback", False),
                "day2_planed_iso": day2_planed_iso,
                "day2_delay_text": day2_delay_text,
                "day2_submitted_at": stages.get("day2") or "",
                "day3_planed_iso": stages.get("day2") or "",
                "day3_submitted_at": stages.get("day3") or "",
                "feedback_submitted_at": stages.get("feedback") or "",
            })
        items.reverse()
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        total = len(items)
        offset = (page - 1) * page_size
        return {"data": items[offset: offset + page_size], "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        _log(f"training clients list: {e}")
        import traceback
        _log(traceback.format_exc())
        return {"data": [], "total": 0, "page": 1, "page_size": 50}


@api_router.get("/training/clients/available-for-manual")
@cached(ttl=30, key_prefix="training:available-for-manual:")
def list_available_for_manual(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """List onboarding payment status records that are not yet in the training list (for 'Add client manually' dropdown)."""
    try:
        r = supabase.table("onboarding_final_setup").select("payment_status_id, data").execute()
        done_ids = set()
        for row in (r.data or []):
            data = row.get("data")
            if isinstance(data, dict) and str(data.get("final_status", "")).strip() == "Done":
                done_ids.add(row.get("payment_status_id"))
        try:
            manual_r = supabase.table("training_manual_clients").select("payment_status_id").execute()
            for row in (manual_r.data or []):
                done_ids.add(row.get("payment_status_id"))
        except Exception:
            pass
        pay = supabase.table("onboarding_payment_status").select("id, company_name, reference_no, timestamp").order("timestamp", desc=True).execute()
        out = []
        for p in (pay.data or []):
            pid = p.get("id")
            if pid and pid not in done_ids:
                out.append({
                    "payment_status_id": pid,
                    "company_name": p.get("company_name") or "",
                    "reference_no": p.get("reference_no") or "",
                    "timestamp": p.get("timestamp"),
                })
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        total = len(out)
        offset = (page - 1) * page_size
        return {"data": out[offset: offset + page_size], "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        _log(f"training available-for-manual: {e}")
        return {"data": [], "total": 0, "page": 1, "page_size": 50}


class TrainingManualAddPayload(BaseModel):
    payment_status_id: str


@api_router.post("/training/clients/manual")
def add_training_client_manual(payload: TrainingManualAddPayload, auth: dict = Depends(get_current_user)):
    """Add a client to the training list manually (so they appear and can go through Day 0 → ... sequence)."""
    pid = (payload.payment_status_id or "").strip()
    if not pid:
        raise HTTPException(400, "payment_status_id is required")
    try:
        existing = supabase.table("training_manual_clients").select("payment_status_id").eq("payment_status_id", pid).limit(1).execute()
        if existing.data and len(existing.data) > 0:
            raise HTTPException(400, "This client is already in the training list (added manually)")
        final_r = supabase.table("onboarding_final_setup").select("payment_status_id, data").eq("payment_status_id", pid).limit(1).execute()
        if final_r.data and len(final_r.data) > 0:
            data = final_r.data[0].get("data")
            if isinstance(data, dict) and str(data.get("final_status", "")).strip() == "Done":
                raise HTTPException(400, "This client is already in the training list")
        supabase.table("training_manual_clients").insert({"payment_status_id": pid}).execute()
        return {"message": "Client added to training list", "payment_status_id": pid}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"add_training_client_manual: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/training/users")
@cached(ttl=30, key_prefix="training:users:")
def list_training_users(
    page: int = 1,
    page_size: int = Query(50, le=200),
    auth: dict = Depends(get_current_user),
):
    """List users for Trainer dropdown in Client Training. All users who use the software (from user_profiles)."""
    try:
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 50), 200))
        offset = (page - 1) * page_size
        r = (
            supabase.table("user_profiles")
            .select("id, full_name", count="exact")
            .eq("is_active", True)
            .order("full_name")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        payload = {"data": r.data or [], "total": r.count or 0, "page": page, "page_size": page_size}
        return _etag_json(payload)
    except Exception:
        try:
            page = max(1, int(page or 1))
            page_size = max(1, min(int(page_size or 50), 200))
            offset = (page - 1) * page_size
            r = (
                supabase.table("user_profiles")
                .select("id, full_name", count="exact")
                .order("full_name")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            payload = {"data": r.data or [], "total": r.count or 0, "page": page, "page_size": page_size}
            return _etag_json(payload)
        except Exception:
            return _etag_json({"data": [], "total": 0, "page": 1, "page_size": 50})


class TrainingAssignmentCreate(BaseModel):
    poc_name: str
    trainer_user_id: str
    expected_day0: Optional[str] = None  # YYYY-MM-DD


@api_router.post("/training/clients/{payment_status_id}/assignment")
def create_training_assignment(payment_status_id: str, payload: TrainingAssignmentCreate, auth: dict = Depends(get_current_user)):
    """Assign POC & Trainer for a training client. Only one assignment per payment_status_id is allowed."""
    poc_name = (payload.poc_name or "").strip()
    trainer_user_id = (payload.trainer_user_id or "").strip()
    if not poc_name or not trainer_user_id:
        raise HTTPException(400, "poc_name and trainer_user_id are required")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    expected_day0 = (payload.expected_day0 or "").strip() or None
    try:
        existing = supabase.table("training_client_assignments").select("id").eq("payment_status_id", payment_status_id).limit(1).execute()
        if existing.data and len(existing.data) > 0:
            raise HTTPException(400, "POC & Trainer already submitted for this client")
        row: dict = {
            "payment_status_id": payment_status_id,
            "poc_user_id": None,
            "poc_name": poc_name,
            "trainer_user_id": trainer_user_id,
            "created_at": now,
        }
        if expected_day0:
            row["expected_day0"] = expected_day0
        supabase.table("training_client_assignments").insert(row).execute()
        return {"message": "Assignment saved", "payment_status_id": payment_status_id}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"create_training_assignment: {e}")
        raise HTTPException(400, str(e)[:200])


class TrainingAssignmentUpdate(BaseModel):
    poc_name: Optional[str] = None
    trainer_user_id: Optional[str] = None
    expected_day0: Optional[str] = None  # YYYY-MM-DD or null to clear


@api_router.put("/training/clients/{payment_status_id}/assignment")
def update_training_assignment(payment_status_id: str, payload: TrainingAssignmentUpdate, auth: dict = Depends(get_current_user)):
    """Update POC, Trainer and/or Expected Day 0 for an existing assignment."""
    try:
        existing = supabase.table("training_client_assignments").select("id").eq("payment_status_id", payment_status_id).limit(1).execute()
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(404, "No assignment found for this client")
        updates: dict = {}
        if payload.poc_name is not None:
            updates["poc_name"] = (payload.poc_name or "").strip() or None
        if payload.trainer_user_id is not None:
            updates["trainer_user_id"] = (payload.trainer_user_id or "").strip() or None
        if payload.expected_day0 is not None:
            updates["expected_day0"] = (payload.expected_day0 or "").strip() or None
        if not updates:
            return {"message": "Nothing to update", "payment_status_id": payment_status_id}
        supabase.table("training_client_assignments").update(updates).eq("payment_status_id", payment_status_id).execute()
        return {"message": "Assignment updated", "payment_status_id": payment_status_id}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"update_training_assignment: {e}")
        raise HTTPException(400, str(e)[:200])


# Day 0 Checklist – allowed values Yes/No/NA for each field
DAY0_CHECKLIST_KEYS = [
    "confirm_share_live_credentials",
    "google_meet_test_run",
    "hardware_requirements_ok",
    "network_connection_ok",
    "identify_training_members",
    "check_master_data",
    "final_followup_doubts_documented",
    "tasks_completed_before_day1",
    "min_one_item",
    "min_two_vendors",
    "min_one_indent",
    "min_two_rfq",
    "min_two_qc",
    "meeting_link_day1_created",
    "how_to_videos_shared",
]


@api_router.get("/training/clients/{payment_status_id}/day0-checklist")
def get_training_day0_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Day 0 Checklist for a training client. Returns empty data if not yet filled. Includes editable_48h and resolved trainer_name."""
    try:
        r = supabase.table("training_day0_checklist").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if r.data else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False, "trainer_name": None}
        submitted_at = row.get("submitted_at")
        data = row.get("data") or {}
        trainer_name = None
        trainer_id = data.get("trainer_user_id") if isinstance(data.get("trainer_user_id"), str) else None
        if trainer_id and trainer_id.strip():
            try:
                pr = supabase.table("user_profiles").select("full_name").eq("id", trainer_id.strip()).limit(1).execute()
                if pr.data and len(pr.data) > 0:
                    trainer_name = (pr.data[0].get("full_name") or "").strip() or None
            except Exception:
                pass
            if trainer_name:
                data = {**data, "trainer_name": trainer_name}
        return {
            "data": data,
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
            "trainer_name": trainer_name,
        }
    except Exception as e:
        _log(f"get training day0_checklist: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False, "trainer_name": None}


class TrainingDay0ChecklistPayload(BaseModel):
    data: dict


@api_router.post("/training/clients/{payment_status_id}/day0-checklist")
def save_training_day0_checklist(payment_status_id: str, payload: TrainingDay0ChecklistPayload, auth: dict = Depends(get_current_user)):
    """Create or update Day 0 Checklist. All fields must be Yes / No / NA. Edits allowed only within 48 hours of submit."""
    data = payload.data or {}
    allowed_values = {"Yes", "No", "NA"}
    for key in DAY0_CHECKLIST_KEYS:
        val = str(data.get(key, "")).strip()
        if val not in allowed_values:
            raise HTTPException(400, f"Field {key} must be one of Yes / No / NA")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("training_day0_checklist").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        has_row = bool(existing.data and len(existing.data) > 0)
        if has_row:
            row_data = existing.data[0]
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Edit window (48 hours) has expired. Day 0 Checklist can no longer be changed.")
            supabase.table("training_day0_checklist").update({"data": data, "submitted_at": now, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
        else:
            supabase.table("training_day0_checklist").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
        return {"data": data, "submitted_at": now}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save training day0_checklist: {e}")
        raise HTTPException(400, str(e)[:200])


# Training checklist stages (after Day 0). Order: must complete previous to unlock next.
TRAINING_STAGE_ORDER = [
    "day1_minus2",   # DAY 1(-2 hour) Checklist
    "day1",          # DAY 1 Checklist
    "day1_plus1",    # DAY 1 (+1day)
    "day2",          # DAY 2 Checklist
    "day3",          # DAY 3 Checklist
    "feedback",      # Training Feedback Form
]

# stage_key -> list of (field_key, label) for Yes/No/NA dropdowns
TRAINING_STAGE_FIELDS = {
    "day1_minus2": [
        ("confirm_scheduled_time", "Confirm the scheduled time with customer."),
        ("confirm_tasks_done", "Confirm given tasks has been done."),
        ("confirm_responsible_persons", "Confirm responsible persons for the meeting are present (Store Manager, Indenter, Purchaser, Approver etc.)"),
        ("confirm_meeting_link", "Confirm Meeting Link is working well."),
        ("confirm_noted_doubt", "Confirm to bring noted doubt by client side."),
    ],
    "day1": [
        ("create_indent", "Create Indent"),
        ("create_item", "Create Item"),
        ("create_item_group", "Create Item Group"),
        ("create_brand", "Create Brand"),
        ("create_vendor", "Create Vendor"),
        ("set_reorder_level", "Set Reorder Level"),
        ("create_rfq", "Create RFQ"),
        ("quotation_comparison", "How to do Quotation Comparison"),
        ("negotiate_vendor", "How to Negotiate with Vendor through software"),
        ("create_issue", "Create Issue"),
        ("create_po", "Create PO"),
        ("create_grn", "Create GRN"),
        ("stock_adjustment", "How to Stock Adjustment"),
        ("tag_vendors", "How to tag Vendors (Optional)"),
        ("tasks_for_customer", "Tasks for customer"),
    ],
    "day1_plus1": [
        ("follow_up_tasks_day1", "Follow up for given tasks on day 1."),
        ("follow_up_doubts", "Follow up for any doubts in data updating."),
        ("send_approvals_list", "Send list of 'Approvals' available in the software IndustryPrime."),
        ("collect_approval_data", "Collect data for \"Approval System\" from customer."),
        ("create_schedule_day2_link", "Create & schedule day 2 training link."),
        ("test_day2_link", "Test the training link for day 2 is working well."),
        ("share_link_customer", "Share the training link with customer."),
    ],
    "day2": [
        ("create_returnable_gate_pass", "Create Returnable Gate Pass."),
        ("create_non_returnable_gate_pass", "Create Non-Returnable Gate Pass."),
        ("create_issue_returnable", "Create Issue Items on Returnable Basis."),
        ("create_work_order_indent", "Create Work Order Indent"),
        ("create_work_order_indent_rfq", "Create Work Order Indent RFQ"),
        ("set_monthly_budget", "Set Monthly Budget (Optional)"),
        ("stock_transfer", "How to Stock Transfer (Optional)"),
        ("cost_center_info", "Information on Cost Center & how to create it in the system."),
        ("physical_stock_taking", "Physical Stock Taking"),
        ("stock_summary", "Stock Summary"),
        ("item_summary", "Item Summary"),
        ("item_stock", "Item Stock"),
        ("max_level", "Max Level"),
        ("share_how_to_videos", "Share How To Videos for, RGP, NRGP, Issue item on returnable basis, WO indent, WO indent RFQ, Monthly Budget, Stock Transfer (Optional), Cost Center, Stock Summary, Item Summary, Item Stock, Max Level, Best way to create item name, Cost Center tagging, Primary & Secondary UOM."),
        ("tasks_for_customer_day2", "Tasks for customer"),
    ],
    "day3": [
        ("company_division_stock_movement", "Company Division Wise Stock Movement Summary."),
        ("department_consumption", "Department Wise Consumption Report."),
        ("monthly_purchase_saving", "Monthly Purchase Saving Report."),
        ("vendor_summary", "Vendor Summary Report."),
        ("item_group_consumption", "Item Group Wise Consumption."),
        ("cost_center_consumption", "Cost Center Wise Consumption Report."),
        ("all_history_report", "All History Report (Item Purchase, Vendor GRN, Vendor Purchase, Cost Center)."),
        ("po_audit_report", "PO Audit Report."),
        ("tag_with_bills", "Tag With Bills."),
        ("scrap_management", "Scrap Management."),
        ("send_how_to_videos_reports", "Send How To Videos for above topic (Report Section)."),
        ("reference_number", "Reference number"),
    ],
    "feedback": [
        ("mention_name", "Mention your Name:"),
        ("overall_satisfied", "Overall, how satisfied are you with the IndustryPrime training sessions?"),
        ("rate_pace", "How would you rate the pace of the training?"),
        ("store_mgmt_setup", "Store Management [Managing set up. Create Item, Brand, UOM, Item Group]"),
        ("store_mgmt_indent", "Store Management [Create Indent, check all fields in indent.]"),
        ("store_mgmt_grn", "Store Management [Create Goods Receipt Note (GRN)]"),
        ("store_mgmt_issue", "Store Management [Create Issue, all fields in issue. Scrap Management]"),
        ("store_mgmt_stock_adj", "Store Management [Create Stock Adjustment]"),
        ("store_mgmt_wo_indent", "Store Management [Work Order Indent]"),
        ("store_mgmt_wrn", "Store Management [Create Work order Receipt Note (WRN)]"),
        ("store_mgmt_other", "Are there any other training topics you'd like us to cover? Please specify: (Store)"),
        ("purchase_vendor", "Purchase & Advanced Functions [Vendor Creation, Mail for update, manage vendor.]"),
        ("purchase_rfq", "Purchase & Advanced Functions [Create RFQ, Quotation Comparison, manage pending Indents.]"),
        ("purchase_po", "Purchase & Advanced Functions [Create Purchase Order (PO)]"),
        ("purchase_wo", "Purchase & Advanced Functions [Create Work Order (WO), WO RFQ]"),
        ("purchase_rgp", "Purchase & Advanced Functions [Returnable/Non-Returnable Gate Pass (RGP/NRGP)]"),
        ("purchase_other", "Are there any other training topics you'd like us to cover? Please specify: (Purchase)"),
        ("reporting_stock", "Reporting & Analytics [Stock Summary & Stock Movement]"),
        ("reporting_division", "Reporting & Analytics [Company Division wise Stock Movement Summary]"),
        ("reporting_audit", "Reporting & Analytics [Audit Reports (e.g., PO Audit)]"),
        ("reporting_department", "Reporting & Analytics [Department wise Consumption Report]"),
        ("reporting_item_stock", "Reporting & Analytics [Item Stock, Stock Ledger]"),
        ("reporting_history", "Reporting & Analytics [All History Report]"),
        ("reporting_registers", "Reporting & Analytics [All Registers]"),
        ("reporting_other", "Are there any other training topics you'd like us to cover? Please specify: (Reporting)"),
        ("rate_trainer_knowledge", "How do you rate the trainer's knowledge of the IndustryPrime software?"),
        ("rate_trainer_explain", "How do you rate the trainer's ability to explain concepts clearly?"),
        ("helpful_materials", "Which training materials were most helpful? (Select all that apply)"),
        ("theory_practice_balance", "Was the balance between theory (explanation) and practice (hands-on tasks) right?"),
        ("confident_using", "How confident do you feel in using IndustryPrime independently in your daily work?"),
        ("biggest_challenge", "What has been the biggest challenge in implementing the software so far (Select All that apply)?"),
        ("followup_support", "How helpful has the post-training follow-up support been? (e.g., daily check-ins, doubt clearing)"),
        ("liked_most", "What did you like MOST about the training?"),
        ("needs_improvement", "What aspect of the training needs the MOST improvement?"),
        ("suggestions_improve", "Do you have any specific suggestions to improve the training sessions? (e.g., more time on a specific topic, different training method, etc.)"),
        ("other_feedback", "Is there any other feedback you would like to share about the software or the training?"),
    ],
}


def _training_stage_keys(stage_key: str) -> list[str]:
    return [k for k, _ in TRAINING_STAGE_FIELDS.get(stage_key, [])]


TRAINING_STAGE_TITLES = {
    "day1_minus2": "DAY 1(-2 hour) Checklist",
    "day1": "DAY 1 Checklist",
    "day1_plus1": "DAY 1 (+1day)",
    "day2": "DAY 2 Checklist",
    "day3": "DAY 3 Checklist",
    "feedback": "Training Feedback Form",
}


@api_router.get("/training/stages-config")
def get_training_stages_config(auth: dict = Depends(get_current_user)):
    """Returns stage keys in order with title and fields (key, label) for building forms."""
    return {
        "order": TRAINING_STAGE_ORDER,
        "stages": {
            sk: {"title": TRAINING_STAGE_TITLES.get(sk, sk), "fields": TRAINING_STAGE_FIELDS.get(sk, [])}
            for sk in TRAINING_STAGE_ORDER
        },
    }


@api_router.get("/training/clients/{payment_status_id}/training-status")
def get_training_status(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Returns day0 submitted status, all stages (submitted_at, editable_48h, data), and next_stage key. Used to show which button to display."""
    try:
        result = {"day0_submitted": False, "day0_submitted_at": None, "stages": {}, "next_stage": None}
        r0 = supabase.table("training_day0_checklist").select("submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        if r0.data and len(r0.data) > 0 and r0.data[0].get("submitted_at"):
            result["day0_submitted"] = True
            result["day0_submitted_at"] = r0.data[0].get("submitted_at")
        r_stages = supabase.table("training_checklist_stages").select("stage_key, data, submitted_at").eq("payment_status_id", payment_status_id).execute()
        stages_map = {}
        if r_stages.data:
            for row in r_stages.data:
                sk = row.get("stage_key")
                submitted_at = row.get("submitted_at")
                stages_map[sk] = {
                    "data": row.get("data") or {},
                    "submitted_at": submitted_at,
                    "editable_48h": _is_within_48h_edit(submitted_at),
                    "editable_until": _get_editable_until(submitted_at),
                }
        for sk in TRAINING_STAGE_ORDER:
            default = {"data": {}, "submitted_at": None, "editable_48h": False, "editable_until": None}
            result["stages"][sk] = stages_map.get(sk, default)
        if not result["day0_submitted"]:
            result["next_stage"] = None
        else:
            result["next_stage"] = None
            for sk in TRAINING_STAGE_ORDER:
                st = result["stages"][sk]
                if not st.get("submitted_at"):
                    result["next_stage"] = sk
                    break
        return result
    except Exception as e:
        _log(f"get training-status: {e}")
        return {"day0_submitted": False, "day0_submitted_at": None, "stages": {}, "next_stage": None}


@api_router.get("/training/clients/{payment_status_id}/stages/{stage_key}")
def get_training_stage(payment_status_id: str, stage_key: str, auth: dict = Depends(get_current_user)):
    """Get one training stage checklist. Returns data, submitted_at, editable_48h."""
    if stage_key not in TRAINING_STAGE_ORDER:
        raise HTTPException(404, "Unknown stage")
    try:
        r = supabase.table("training_checklist_stages").select("*").eq("payment_status_id", payment_status_id).eq("stage_key", stage_key).limit(1).execute()
        row = (r.data or [None])[0] if r.data else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get training stage {stage_key}: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


class TrainingStagePayload(BaseModel):
    data: dict


def _training_prev_stage_submitted(payment_status_id: str, stage_key: str) -> bool:
    """Check if the previous stage in order is submitted so this one can be opened."""
    idx = next((i for i, s in enumerate(TRAINING_STAGE_ORDER) if s == stage_key), -1)
    if idx <= 0:
        return True
    prev_key = TRAINING_STAGE_ORDER[idx - 1]
    r = supabase.table("training_checklist_stages").select("submitted_at").eq("payment_status_id", payment_status_id).eq("stage_key", prev_key).limit(1).execute()
    if not r.data or len(r.data) == 0:
        return False
    return bool(r.data[0].get("submitted_at"))


@api_router.post("/training/clients/{payment_status_id}/stages/{stage_key}")
def save_training_stage(payment_status_id: str, stage_key: str, payload: TrainingStagePayload, auth: dict = Depends(get_current_user)):
    """Save a training stage. All fields Yes/No/NA. 48h edit. Previous stage must be submitted."""
    if stage_key not in TRAINING_STAGE_ORDER:
        raise HTTPException(404, "Unknown stage")
    keys = _training_stage_keys(stage_key)
    data = payload.data or {}
    allowed_values = {"Yes", "No", "NA"}
    for key in keys:
        val = str(data.get(key, "")).strip()
        if val not in allowed_values:
            raise HTTPException(400, f"Field {key} must be one of Yes / No / NA")
    if not _training_prev_stage_submitted(payment_status_id, stage_key):
        raise HTTPException(400, "Complete the previous stage first.")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("training_checklist_stages").select("id, submitted_at").eq("payment_status_id", payment_status_id).eq("stage_key", stage_key).limit(1).execute()
        has_row = bool(existing.data and len(existing.data) > 0)
        if has_row:
            row_data = existing.data[0]
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Edit window (48 hours) has expired for this stage.")
            supabase.table("training_checklist_stages").update({"data": data, "submitted_at": now, "updated_at": now}).eq("payment_status_id", payment_status_id).eq("stage_key", stage_key).execute()
        else:
            supabase.table("training_checklist_stages").insert({
                "payment_status_id": payment_status_id,
                "stage_key": stage_key,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
        return {"data": data, "submitted_at": now}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save training stage {stage_key}: {e}")
        raise HTTPException(400, str(e)[:200])


# Pre-Onboarding required keys (all mandatory)
PRE_ONBOARDING_KEYS = [
    "total_users", "end_users_id", "gate_id_needed", "store_users", "purchase_users",
    "training_mode", "computer_literacy", "computer_available", "internet_available",
    "printer_available", "inventory_volume", "purchase_volume", "domain_email_present",
    "domain_vendor_contact_shared", "cost_centre_update", "location_update", "current_purchase_management",
]
# Pre-Onboarding Checklist required keys (all mandatory)
PRE_ONBOARDING_CHECKLIST_KEYS = [
    "poc_collected", "whatsapp_group_created", "owner_added_in_group", "meeting_link_created_shared",
    "no_of_users_store_purchase_others", "no_of_users_will_use_software", "end_users_will_use_software",
    "gate_id_needed_or_not", "exact_store_purchase_persons", "training_flow_or_separately",
    "computer_literacy_level", "computers_in_store", "internet_available_at_store",
    "printer_available_at_store", "inventory_volume_items", "purchase_volume_po_per_day",
    "domain_email_present_or_not", "domain_vendor_contact_shared_if_not",
    "cost_centre_updated_now_or_later", "location_updated_now_or_later",
    "managing_purchase_now", "quotation_comparison",
    "basic_details_org_phone_division_gst_address_master_id_company_mail_item_list",
    "days_required_for_details", "send_basic_details_from_previous_point",
    "company_folder_created_in_drive", "review_meeting_prepare_plan_of_action",
]

# POC Checklist required keys (all mandatory)
POC_CHECKLIST_KEYS = [
    "user_details_format",
    "approver_details_format",
    "approvals_format",
    "approval_levels_format",
    "indenter_details_format",
    "departments_alignment_format",
    "item_stock_format",
    "cost_centre_format",
    "location_format",
]


def _get_editable_until(submitted_at_iso: str | None) -> str | None:
    """Return ISO timestamp until when record is editable (48h after submit)."""
    if not submitted_at_iso:
        return None
    try:
        dt = datetime.fromisoformat(submitted_at_iso.replace("Z", "+00:00"))
        until = dt + timedelta(hours=48)
        return until.isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def _is_within_48h_edit(submitted_at_iso: str | None) -> bool:
    if not submitted_at_iso:
        return True
    until = _get_editable_until(submitted_at_iso)
    if not until:
        return False
    try:
        return datetime.now(timezone.utc) <= datetime.fromisoformat(until.replace("Z", "+00:00"))
    except Exception:
        return False


@api_router.get("/onboarding/payment-status/{payment_status_id}/pre-onboarding")
def get_pre_onboarding(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Pre-Onboarding data for a payment status record. Returns empty data if not yet filled or if table missing."""
    try:
        r = supabase.table("onboarding_pre_onboarding").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"),
            "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get pre_onboarding: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


@api_router.post("/onboarding/payment-status/{payment_status_id}/pre-onboarding")
def save_pre_onboarding(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Pre-Onboarding. All fields mandatory. Editable only within 48h after first submit."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in PRE_ONBOARDING_KEYS:
        if key not in data or data[key] is None or (isinstance(data[key], str) and data[key].strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data["timestamp"] = data.get("timestamp") or now
    try:
        existing = supabase.table("onboarding_pre_onboarding").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Pre-Onboarding is no longer editable (48h passed)")
            supabase.table("onboarding_pre_onboarding").update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_pre_onboarding").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save pre_onboarding: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/onboarding/payment-status/{payment_status_id}/pre-onboarding-checklist")
def get_pre_onboarding_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Pre-Onboarding Checklist for a payment status record. Returns empty data if not yet filled or if table missing."""
    try:
        r = supabase.table("onboarding_pre_onboarding_checklist").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"),
            "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get pre_onboarding_checklist: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


@api_router.post("/onboarding/payment-status/{payment_status_id}/pre-onboarding-checklist")
def save_pre_onboarding_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Pre-Onboarding Checklist. All fields mandatory. Editable only within 48h after first submit."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in PRE_ONBOARDING_CHECKLIST_KEYS:
        if key not in data or data[key] is None or (isinstance(data[key], str) and str(data[key]).strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_pre_onboarding_checklist").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Pre-Onboarding Checklist is no longer editable (48h passed)")
            supabase.table("onboarding_pre_onboarding_checklist").update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_pre_onboarding_checklist").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save pre_onboarding_checklist: {e}")
        raise HTTPException(400, str(e)[:200])


# ---------- Onboarding > POC Checklist ----------
@api_router.get("/onboarding/payment-status/{payment_status_id}/poc-checklist")
def get_poc_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get POC Checklist data for a payment status record. Returns empty data if not yet filled or if table missing."""
    try:
        r = supabase.table("onboarding_poc_checklist").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"),
            "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get poc_checklist: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


@api_router.post("/onboarding/payment-status/{payment_status_id}/poc-checklist")
def save_poc_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update POC Checklist. All fields mandatory. Editable only within 48h after first submit."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in POC_CHECKLIST_KEYS:
        if key not in data or data[key] is None or (isinstance(data[key], str) and str(data[key]).strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_poc_checklist").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "POC Checklist is no longer editable (48h passed)")
            supabase.table("onboarding_poc_checklist").update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_poc_checklist").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save poc_checklist: {e}")
        raise HTTPException(400, str(e)[:200])


# POC Details keys (all optional; stored in JSONB data)
POC_DETAILS_KEYS = [
    "details_sent",
    "details_sent_timestamp",
    "followup1_status",
    "followup1_timestamp",
    "followup2_status",
    "followup2_timestamp",
    "followup3_status",
    "followup3_timestamp",
    "details_collected",
    "details_collected_timestamp",
    "remarks",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/poc-details")
def get_poc_details(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get POC Details for a payment status record. Returns empty data if not yet filled."""
    try:
        r = supabase.table("onboarding_poc_details").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}}
        data = row.get("data") or {}
        return {"id": row.get("id"), "payment_status_id": row.get("payment_status_id"), "data": data}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get poc_details: {e}")
        return {"data": {}}


@api_router.post("/onboarding/payment-status/{payment_status_id}/poc-details")
def save_poc_details(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update POC Details. All fields optional."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    # Restrict to known keys and set missing to None
    out = {}
    for k in POC_DETAILS_KEYS:
        out[k] = data.get(k) if k in data else None
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_poc_details").select("id").eq("payment_status_id", payment_status_id).limit(1).execute()
        has_row = bool(existing.data and len(existing.data) > 0)
        if has_row:
            supabase.table("onboarding_poc_details").update({"data": out, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
        else:
            supabase.table("onboarding_poc_details").insert({
                "payment_status_id": payment_status_id,
                "data": out,
                "updated_at": now,
            }).execute()
        return {"data": out}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save poc_details: {e}")
        raise HTTPException(400, str(e)[:200])


# Details Collected Checklist keys (all required; values must be "Done" or "Not Done"). Editable 48h after submit.
DETAILS_COLLECTED_CHECKLIST_KEYS = [
    "collect_user_details",
    "collect_approver_details",
    "collect_confirmation_approval_system",
    "collect_approval_levels_info",
    "collect_indenter_details",
    "collect_department_details",
    "collect_item_stock_details",
    "collect_cost_center_details",
    "collect_location_details",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/details-collected-checklist")
def get_details_collected_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Details Collected Checklist. Returns empty data if not yet filled. 48h edit rule."""
    try:
        r = supabase.table("onboarding_details_collected_checklist").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"),
            "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get details_collected_checklist: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


@api_router.post("/onboarding/payment-status/{payment_status_id}/details-collected-checklist")
def save_details_collected_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Details Collected Checklist. All fields required: Done or Not Done. Editable only within 48h after first submit."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in DETAILS_COLLECTED_CHECKLIST_KEYS:
        if key not in data or data[key] is None or (isinstance(data[key], str) and str(data[key]).strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
        if str(data[key]).strip() not in ("Done", "Not Done"):
            raise HTTPException(400, f"Field {key} must be Done or Not Done")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_details_collected_checklist").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Details Collected Checklist is no longer editable (48h passed)")
            supabase.table("onboarding_details_collected_checklist").update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_details_collected_checklist").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save details_collected_checklist: {e}")
        raise HTTPException(400, str(e)[:200])


# Item Cleaning keys (all optional; timestamp auto-generated on frontend)
ITEM_CLEANING_KEYS = [
    "timestamp",
    "company_name",
    "raw_item_received",
    "raw_item_uploaded_in_drive",
    "create_sheet_raw_item_duplicate",
    "create_sheet_raw_item_with_code",
    "create_sheet_raw_with_code_duplicate_person_name",
    "item_cleaned_in_excel",
    "item_trimmed_in_excel",
    "proper_casing",
    "formatting",
    "spell_check",
    "upload_items_in_grok",
    "grok_cleaned_item_put_on_raw_with_code_duplicate_person_name",
    "review_on_item_name_check",
    "review_on_items_uom_proper_casing",
    "review_on_item_formatting",
    "pull_all_cleaned_item_by_assigned_item_id_in_raw_with_code",
    "create_sheet_cleaned_unique_items_with_code",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/item-cleaning")
def get_item_cleaning(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Item Cleaning data for a payment status record. Returns empty data if not yet filled."""
    try:
        r = supabase.table("onboarding_item_cleaning").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}}
        data = row.get("data") or {}
        return {"id": row.get("id"), "payment_status_id": row.get("payment_status_id"), "data": data}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get item_cleaning: {e}")
        return {"data": {}}


@api_router.post("/onboarding/payment-status/{payment_status_id}/item-cleaning")
def save_item_cleaning(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Item Cleaning. All fields optional."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    out = {}
    for k in ITEM_CLEANING_KEYS:
        out[k] = data.get(k) if k in data else None
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_item_cleaning").select("id").eq("payment_status_id", payment_status_id).limit(1).execute()
        has_row = bool(existing.data and len(existing.data) > 0)
        if has_row:
            supabase.table("onboarding_item_cleaning").update({"data": out, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
        else:
            supabase.table("onboarding_item_cleaning").insert({
                "payment_status_id": payment_status_id,
                "data": out,
                "updated_at": now,
            }).execute()
        return {"data": out}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save item_cleaning: {e}")
        raise HTTPException(400, str(e)[:200])


# Item Cleaning Checklist keys (all required; values Done or Not Done). Editable 48h after submit.
ITEM_CLEANING_CHECKLIST_KEYS = [
    "raw_item_sent_to_rimpa",
    "raw_item_uploaded_in_drive",
    "create_sheet_raw_item_duplicate",
    "create_sheet_raw_item_with_code",
    "create_sheet_raw_with_code_duplicate_person_name",
    "item_cleaned_in_excel",
    "item_trimmed_in_excel",
    "proper_casing",
    "formatting",
    "spell_check",
    "upload_items_in_grok",
    "grok_cleaned_item_put_on_raw_with_code_duplicate_person_name",
    "review_on_item_name_check",
    "review_on_items_uom_proper_casing",
    "review_on_item_formatting",
    "pull_all_cleaned_item_by_assigned_item_id_in_raw_with_code",
    "create_sheet_cleaned_unique_items_with_code",
    "item_list_sent_to_ayush",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/item-cleaning-checklist")
def get_item_cleaning_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Item Cleaning Checklist. 48h edit rule."""
    try:
        r = supabase.table("onboarding_item_cleaning_checklist").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"),
            "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get item_cleaning_checklist: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


@api_router.post("/onboarding/payment-status/{payment_status_id}/item-cleaning-checklist")
def save_item_cleaning_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Item Cleaning Checklist. All fields required: Done or Not Done. Editable only within 48h after first submit."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in ITEM_CLEANING_CHECKLIST_KEYS:
        if key not in data or data[key] is None or (isinstance(data[key], str) and str(data[key]).strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
        if str(data[key]).strip() not in ("Done", "Not Done"):
            raise HTTPException(400, f"Field {key} must be Done or Not Done")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_item_cleaning_checklist").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Item Cleaning Checklist is no longer editable (48h passed)")
            supabase.table("onboarding_item_cleaning_checklist").update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_item_cleaning_checklist").insert({
                "payment_status_id": payment_status_id,
                "data": data,
                "submitted_at": now,
                "updated_at": now,
            }).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save item_cleaning_checklist: {e}")
        raise HTTPException(400, str(e)[:200])


# Org & Master ID keys (all optional; timestamps auto-generated when Done selected)
ORG_MASTER_ID_KEYS = [
    "data_sent_to_ayush",
    "data_sent_to_ayush_timestamp",
    "organization_created",
    "organization_created_timestamp",
    "master_id_created",
    "master_id_created_timestamp",
    "item_uploaded",
    "item_uploaded_timestamp",
    "stock_uploaded",
    "stock_uploaded_timestamp",
    "status",
    "remarks",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/org-master-id")
def get_org_master_id(payment_status_id: str, auth: dict = Depends(get_current_user)):
    """Get Org & Master ID data. Returns empty data if not yet filled."""
    try:
        r = supabase.table("onboarding_org_master_id").select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        row = (r.data or [None])[0] if (r.data and len(r.data) > 0) else None
        if not row:
            return {"data": {}}
        return {"id": row.get("id"), "payment_status_id": row.get("payment_status_id"), "data": row.get("data") or {}}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get org_master_id: {e}")
        return {"data": {}}


@api_router.post("/onboarding/payment-status/{payment_status_id}/org-master-id")
def save_org_master_id(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    """Create or update Org & Master ID. All fields optional."""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    out = {}
    for k in ORG_MASTER_ID_KEYS:
        out[k] = data.get(k) if k in data else None
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_org_master_id").select("id").eq("payment_status_id", payment_status_id).limit(1).execute()
        has_row = bool(existing.data and len(existing.data) > 0)
        if has_row:
            supabase.table("onboarding_org_master_id").update({"data": out, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
        else:
            supabase.table("onboarding_org_master_id").insert({
                "payment_status_id": payment_status_id,
                "data": out,
                "updated_at": now,
            }).execute()
        return {"data": out}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save org_master_id: {e}")
        raise HTTPException(400, str(e)[:200])


def _checklist_48h_get(table: str, payment_status_id: str, log_name: str):
    """Common GET for 48h checklists. Returns data, submitted_at, editable_48h.
    Uses limit(1) instead of maybe_single() to avoid PostgREST 204 No Content when no row exists."""
    try:
        r = supabase.table(table).select("*").eq("payment_status_id", payment_status_id).limit(1).execute()
        data_list = r.data if isinstance(r.data, list) else []
        row = data_list[0] if data_list else None
        if not row:
            return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}
        submitted_at = row.get("submitted_at")
        return {
            "id": row.get("id"), "payment_status_id": row.get("payment_status_id"),
            "data": row.get("data") or {},
            "submitted_at": submitted_at,
            "editable_until": _get_editable_until(submitted_at),
            "editable_48h": _is_within_48h_edit(submitted_at),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"get {log_name}: {e}")
        return {"data": {}, "submitted_at": None, "editable_until": None, "editable_48h": False}


def _checklist_48h_save(table: str, payment_status_id: str, data: dict, keys: list, log_name: str, allow_remarks: bool = False):
    """Common save for 48h checklists. Validates Done/Not Done for keys (except optional remarks)."""
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    for key in keys:
        if allow_remarks and key == "remarks":
            continue
        if key not in data or data[key] is None or (isinstance(data[key], str) and str(data[key]).strip() == ""):
            raise HTTPException(400, f"Missing or empty required field: {key}")
        if key != "remarks" and str(data[key]).strip() not in ("Done", "Not Done"):
            raise HTTPException(400, f"Field {key} must be Done or Not Done")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        r = supabase.table(table).select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        data_list = r.data if isinstance(r.data, list) else []
        row_data = data_list[0] if data_list else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, f"{log_name} is no longer editable (48h passed)")
            supabase.table(table).update({"data": data, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": data, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table(table).insert({"payment_status_id": payment_status_id, "data": data, "submitted_at": now, "updated_at": now}).execute()
            return {"data": data, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save {log_name}: {e}")
        raise HTTPException(400, str(e)[:200])


# Org & Master Checklist (10 fields, Done/Not Done). 48h.
ORG_MASTER_CHECKLIST_KEYS = [
    "company_name_proper_format", "company_email", "company_phone_number", "gst_number", "company_address",
    "plant_address", "divisions_name", "cleaned_item", "email_for_master_id", "phone_number_for_master_id",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/org-master-checklist")
def get_org_master_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    return _checklist_48h_get("onboarding_org_master_checklist", payment_status_id, "org_master_checklist")


@api_router.post("/onboarding/payment-status/{payment_status_id}/org-master-checklist")
def save_org_master_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    data = payload.get("data") if isinstance(payload, dict) else {}
    return _checklist_48h_save("onboarding_org_master_checklist", payment_status_id, data, ORG_MASTER_CHECKLIST_KEYS, "org_master_checklist")


# Setup Checklist (12 fields, Done/Not Done). 48h.
SETUP_CHECKLIST_KEYS = [
    "create_all_user_with_related_data", "create_all_approvers", "enable_all_required_approvals",
    "enable_all_required_approval_levels", "create_all_indenters", "create_departments_under_required_divisions",
    "sent_item_stock_to_ayush_sir", "upload_stock_as_per_requirement", "clean_cc_format", "clean_location_format",
    "upload_cc", "upload_locations",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/setup-checklist")
def get_setup_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    return _checklist_48h_get("onboarding_setup_checklist", payment_status_id, "setup_checklist")


@api_router.post("/onboarding/payment-status/{payment_status_id}/setup-checklist")
def save_setup_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    data = payload.get("data") if isinstance(payload, dict) else {}
    return _checklist_48h_save("onboarding_setup_checklist", payment_status_id, data, SETUP_CHECKLIST_KEYS, "setup_checklist")


# Item & Stock Checklist (29 fields, Done/Not Done). 48h.
ITEM_STOCK_CHECKLIST_KEYS = [
    "collect_org_id", "collect_item_group_id", "collect_item_uom_id", "create_sheet_ids_from_ip",
    "store_all_ids_exported_in_ids_from_ip", "create_sheet_item_import_company_name",
    "pull_data_from_item_with_stock_cleaned_unique_items", "calculate_item_rate_against_stock_store",
    "collect_warehouse_id_store_in_ids_from_ip", "export_item_with_ids_from_ip_store",
    "assign_item_ids_against_item_names_stock", "export_brands_with_ids_from_ip_store",
    "assign_brand_ids_against_brand_names", "export_location_with_ids_from_ip_store",
    "assign_location_ids_against_location_names", "concatenate_item_and_brand_ids",
    "prepare_make_id_from_concatenation", "create_file_stock_import_div_company_name",
    "update_file_warehouse_item_make_qty_rate_date_location", "check_warehouse_column_contain_blank",
    "check_item_id_contain_na_or_blank", "check_make_id_contain_na_or_blank", "check_no_qty_zero_or_negative",
    "check_all_rates_ge_zero", "check_all_date_cells_date_format", "check_location_id_contain_na_or_blank",
    "check_duplicate_in_item_id", "remove_duplicates", "upload_file_in_ip",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/item-stock-checklist")
def get_item_stock_checklist(payment_status_id: str, auth: dict = Depends(get_current_user)):
    return _checklist_48h_get("onboarding_item_stock_checklist", payment_status_id, "item_stock_checklist")


@api_router.post("/onboarding/payment-status/{payment_status_id}/item-stock-checklist")
def save_item_stock_checklist(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    data = payload.get("data") if isinstance(payload, dict) else {}
    return _checklist_48h_save("onboarding_item_stock_checklist", payment_status_id, data, ITEM_STOCK_CHECKLIST_KEYS, "item_stock_checklist")


# Final Setup (7 Done/Not Done + Remarks). 48h.
FINAL_SETUP_KEYS = [
    "item_uploaded", "stock_uploaded", "master_setup_done", "review_completed",
    "onboarding_setup_done", "handed_to_training", "final_status", "remarks",
]


@api_router.get("/onboarding/payment-status/{payment_status_id}/final-setup")
def get_final_setup(payment_status_id: str, auth: dict = Depends(get_current_user)):
    return _checklist_48h_get("onboarding_final_setup", payment_status_id, "final_setup")


@api_router.post("/onboarding/payment-status/{payment_status_id}/final-setup")
def save_final_setup(payment_status_id: str, payload: dict, auth: dict = Depends(get_current_user)):
    data = payload.get("data") if isinstance(payload, dict) else {}
    # Ensure all keys present; remarks optional (can be empty)
    out = {k: data.get(k) if k in data else ("" if k == "remarks" else None) for k in FINAL_SETUP_KEYS}
    for k in FINAL_SETUP_KEYS:
        if k != "remarks" and (out[k] is None or (isinstance(out[k], str) and str(out[k]).strip() == "")):
            raise HTTPException(400, f"Missing or empty required field: {k}")
        if k != "remarks" and str(out[k]).strip() not in ("Done", "Not Done"):
            raise HTTPException(400, f"Field {k} must be Done or Not Done")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        existing = supabase.table("onboarding_final_setup").select("id, submitted_at").eq("payment_status_id", payment_status_id).limit(1).execute()
        row_data = (existing.data or [None])[0] if (existing.data and len(existing.data) > 0) else None
        if row_data:
            if not _is_within_48h_edit(row_data.get("submitted_at")):
                raise HTTPException(403, "Final Setup is no longer editable (48h passed)")
            supabase.table("onboarding_final_setup").update({"data": out, "updated_at": now}).eq("payment_status_id", payment_status_id).execute()
            return {"data": out, "submitted_at": row_data.get("submitted_at"), "editable_until": _get_editable_until(row_data.get("submitted_at")), "editable_48h": True}
        else:
            supabase.table("onboarding_final_setup").insert({"payment_status_id": payment_status_id, "data": out, "submitted_at": now, "updated_at": now}).execute()
            return {"data": out, "submitted_at": now, "editable_until": _get_editable_until(now), "editable_48h": True}
    except HTTPException:
        raise
    except Exception as e:
        _log(f"save final_setup: {e}")
        raise HTTPException(400, str(e)[:200])


# ---------- Success Module: Performance Monitoring ----------
class POCCreateRequest(BaseModel):
    company_id: str
    message_owner: str  # yes / no
    response: str | None = None  # mandatory in UI
    contact: str | None = None  # mandatory in UI


_SUCC_REF_RE = re.compile(r"(?i)^SUCC-(\d+)$")


def _sort_performance_list_rows(rows: list) -> None:
    """Newest tickets first: SUCC-#### descending (highest ref at top); legacy non-SUCC refs after, by created_at."""
    succ_pairs: list[tuple[int, dict]] = []
    other: list[dict] = []
    for r in rows:
        ref = str((r or {}).get("reference_no") or "").strip()
        m = _SUCC_REF_RE.match(ref)
        if m:
            succ_pairs.append((int(m.group(1)), r))
        else:
            other.append(r)
    succ_pairs.sort(key=lambda x: -x[0])
    other.sort(
        key=lambda row: (str(row.get("created_at") or ""), str(row.get("id") or "")),
        reverse=True,
    )
    rows[:] = [pair[1] for pair in succ_pairs] + other


def _generate_performance_reference(_company_id: str) -> str:
    """Global Success reference: SUCC-0001, SUCC-0002, … (all performance_monitoring rows)."""
    _ = _company_id  # kept for API compatibility; numbering is global
    prefix = "SUCC-"
    try:
        r = supabase.table("performance_monitoring").select("reference_no").execute()
        max_n = 0
        for row in (r.data or []):
            ref = str((row or {}).get("reference_no") or "").strip()
            m = _SUCC_REF_RE.match(ref)
            if m:
                max_n = max(max_n, int(m.group(1)))
        return f"{prefix}{max_n + 1:04d}"
    except Exception as e:
        _log(f"generate_performance_reference fallback: {e}")
        return f"SUCC-{uuid.uuid4().hex[:4].upper()}"


@api_router.post("/success/performance/poc")
def create_poc_details(payload: POCCreateRequest, auth: dict = Depends(get_current_user)):
    """Add POC details. Generates reference_no SUCC-0001, SUCC-0002, … (global). Requires performance_monitoring table."""
    if payload.message_owner not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="message_owner must be yes or no")
    try:
        ref = _generate_performance_reference(payload.company_id)
        row = {
            "company_id": payload.company_id,
            "message_owner": payload.message_owner,
            "response": payload.response or "",
            "contact": payload.contact or "",
            "reference_no": ref,
            "completion_status": "in_progress",
            "created_by": auth.get("id"),
        }
        r = supabase.table("performance_monitoring").insert(row).execute()
        data = (r.data or [{}])[0] if r.data else {}
        # Resolve company name
        try:
            c = supabase.table("companies").select("name").eq("id", payload.company_id).single().execute()
            data["company_name"] = (c.data or {}).get("name", "")
        except Exception:
            data["company_name"] = ""
        _invalidate_success_performance_caches()
        invalidate_dashboard_read_caches()
        return data
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(
                status_code=503,
                detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql in Supabase SQL Editor first.",
            )
        raise HTTPException(status_code=400, detail=str(e)[:200])


def _batch_current_stages_for_performance_rows(rows: list, training_rows: list, tf_rows: list) -> None:
    """Fill current_stage on each row without N+1 Supabase calls (used by list endpoint)."""
    if not rows:
        return
    perf_id_training = {str(t.get("performance_id")): t for t in (training_rows or []) if t.get("performance_id")}
    training_id_to_perf = {str(t.get("id")): str(t.get("performance_id")) for t in (training_rows or []) if t.get("id") and t.get("performance_id")}
    tfs_by_perf: dict[str, list] = defaultdict(list)
    for frow in tf_rows or []:
        tid = frow.get("training_id")
        if tid is None:
            continue
        pid = training_id_to_perf.get(str(tid))
        if pid:
            tfs_by_perf[pid].append(frow)
    all_feature_ids = list({f.get("feature_id") for lst in tfs_by_perf.values() for f in lst if f.get("feature_id")})
    feature_names: dict = {}
    if all_feature_ids:
        try:
            fl = supabase.table("feature_list").select("id, name").in_("id", all_feature_ids).execute()
            feature_names = {x["id"]: x["name"] for x in (fl.data or [])}
        except Exception:
            pass
    all_tf_ids = [f.get("id") for lst in tfs_by_perf.values() for f in lst if f.get("id")]
    completed_tf_ids: set = set()
    if all_tf_ids:
        try:
            fu = supabase.table("feature_followups").select("ticket_feature_id").in_("ticket_feature_id", all_tf_ids).eq("status", "completed").execute()
            completed_tf_ids = {x.get("ticket_feature_id") for x in (fu.data or []) if x.get("ticket_feature_id")}
        except Exception:
            pass
    for row in rows:
        rid = str(row.get("id") or "")
        cs = row.get("completion_status", "in_progress")
        if cs == "completed":
            row["current_stage"] = "Completed"
            continue
        if rid not in perf_id_training:
            row["current_stage"] = "POC Added - Pending: Training"
            continue
        tfs = tfs_by_perf.get(rid, [])
        if not tfs:
            row["current_stage"] = "Training Done - Pending: Add Feature Committed for Use"
            continue
        completed_names = []
        pending_names = []
        for tf in tfs:
            name = feature_names.get(tf.get("feature_id"), "")
            if tf.get("id") in completed_tf_ids:
                completed_names.append(name)
            else:
                pending_names.append(name)
        total = len(tfs)
        done = len(completed_names)
        if pending_names:
            row["current_stage"] = f"Followup: {done}/{total} completed - Pending: {', '.join(pending_names)}"
        else:
            row["current_stage"] = f"Followup: {done}/{total} completed"


@api_router.get("/success/performance/capabilities")
def performance_monitoring_capabilities(auth: dict = Depends(get_current_user)):
    """Fresh probe for marked_na column (use after running PERFORMANCE_MONITORING_MARKED_NA.sql)."""
    reset_performance_marked_na_cache()
    supported = performance_marked_na_supported()
    return {
        "marked_na_supported": supported,
        "hint": None
        if supported
        else "Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase, then NOTIFY pgrst reload schema.",
    }


@api_router.patch("/success/performance/{ticket_id}/marked-na")
def patch_performance_marked_na(
    ticket_id: str,
    payload: dict,
    auth: dict = Depends(get_current_user),
):
    """Mark or unmark a Performance Monitoring response as NA (company hidden from lists & Success KPI)."""
    if not performance_marked_na_supported():
        raise HTTPException(
            400,
            "NA marking is not enabled. Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase, then retry.",
        )
    marked = payload.get("marked_na")
    if not isinstance(marked, bool):
        raise HTTPException(400, "marked_na must be true or false")
    try:
        r0 = (
            supabase.table("performance_monitoring")
            .select("id,company_id,reference_no")
            .eq("id", ticket_id)
            .limit(1)
            .execute()
        )
        row0 = (r0.data or [None])[0]
        if not row0:
            raise HTTPException(404, "Performance response not found")
        supabase.table("performance_monitoring").update({"marked_na": marked}).eq("id", ticket_id).execute()
        r = (
            supabase.table("performance_monitoring")
            .select(
                "id, company_id, message_owner, response, contact, reference_no, completion_status, created_at, marked_na"
            )
            .eq("id", ticket_id)
            .limit(1)
            .execute()
        )
        updated = (r.data or [None])[0]
        if not updated:
            raise HTTPException(404, "Performance response not found after update")
        enrich_performance_rows_na([updated])
        try:
            c = supabase.table("companies").select("name").eq("id", updated.get("company_id")).maybe_single().execute()
            updated["company_name"] = (c.data or {}).get("name", "")
        except Exception:
            updated["company_name"] = ""
        _invalidate_success_performance_caches(ticket_id)
        invalidate_dashboard_read_caches()
        return updated
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("column" in err or "schema" in err or "42703" in err):
            raise HTTPException(
                400,
                "Database column marked_na is missing. Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase.",
            )
        _log(f"performance marked_na: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.patch("/success/performance/company/{company_id}/restore-na")
def restore_performance_company_from_na(
    company_id: str,
    auth: dict = Depends(get_current_user),
):
    """Clear NA on all Performance Monitoring rows for this company (restore visibility & KPI counts)."""
    if not performance_marked_na_supported():
        raise HTTPException(
            400,
            "NA restore is not enabled. Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase, then retry.",
        )
    try:
        chk = (
            supabase.table("performance_monitoring")
            .select("id")
            .eq("company_id", company_id)
            .eq("marked_na", True)
            .execute()
        )
        na_rows = chk.data or []
        if not na_rows:
            raise HTTPException(404, "No NA-marked responses found for this company")
        restored_count = len(na_rows)
        supabase.table("performance_monitoring").update({"marked_na": False}).eq("company_id", company_id).execute()
        r = (
            supabase.table("performance_monitoring")
            .select(
                "id, company_id, message_owner, response, contact, reference_no, completion_status, created_at, marked_na"
            )
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = r.data or []
        enrich_performance_rows_na(rows)
        company_name = ""
        try:
            c = supabase.table("companies").select("name").eq("id", company_id).maybe_single().execute()
            company_name = (c.data or {}).get("name", "")
        except Exception:
            pass
        _invalidate_success_performance_caches()
        invalidate_dashboard_read_caches()
        return {
            "company_id": company_id,
            "company_name": company_name,
            "restored_count": restored_count,
            "items": rows,
        }
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("column" in err or "schema" in err or "42703" in err):
            raise HTTPException(
                400,
                "Database column marked_na is missing. Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase.",
            )
        _log(f"performance restore_na company: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/success/performance/na-company-ids")
@cached(ttl=300, key_prefix="success:perf:na-ids:")
def list_performance_na_company_ids(auth: dict = Depends(get_current_user)):
    """Lightweight NA company list for POC form filters (avoids two full list scans)."""
    if not performance_marked_na_supported():
        return {"company_ids": [], "marked_na_supported": False}
    return {"company_ids": sorted(performance_marked_na_company_ids()), "marked_na_supported": True}


def _chunked_ids(ids: list, size: int = 200) -> list[list]:
    if not ids:
        return []
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def _supabase_select_in_chunks(table: str, columns: str, in_column: str, ids: list, *, chunk_size: int = 200) -> list:
    if not ids:
        return []
    out: list = []
    for chunk in _chunked_ids(ids, chunk_size):
        try:
            r = supabase.table(table).select(columns).in_(in_column, chunk).execute()
            out.extend(r.data or [])
        except Exception:
            continue
    return out


def _company_name_for_id(company_id: str | None) -> str:
    if not company_id:
        return ""
    try:
        r = supabase.table("companies").select("name").eq("id", company_id).limit(1).execute()
        rows = r.data or []
        return str((rows[0] or {}).get("name") or "") if rows else ""
    except Exception:
        return ""


def _fetch_followups_for_tf_ids(tf_ids: list) -> list:
    """Load followup rows for ticket_features (chunked). Never request initial_percentage — that lives on performance_training."""
    if not tf_ids:
        return []
    cols = (
        "id, ticket_feature_id, status, remarks, created_at, "
        "added_percentage, total_percentage, previous_percentage, feature_name"
    )
    rows = _supabase_select_in_chunks("feature_followups", cols, "ticket_feature_id", tf_ids)
    if rows or not tf_ids:
        return rows
    return _supabase_select_in_chunks("feature_followups", "*", "ticket_feature_id", tf_ids)


def _fetch_performance_list_enrichment(ticket_ids: list, company_ids: list) -> tuple[list, list, dict, dict, dict, dict]:
    """Parallel fetch training/ticket_features and company names for list enrichment."""
    from concurrent.futures import ThreadPoolExecutor

    training_map: dict = {}
    training_schedule_map: dict = {}
    feature_count_map: dict = {}
    training_rows: list = []
    tf_rows: list = []
    companies_map: dict = {}

    def _load_training_bundle() -> None:
        nonlocal training_rows, tf_rows
        if not ticket_ids:
            return
        try:
            training_rows = _supabase_select_in_chunks(
                "performance_training",
                "id, performance_id, total_percentage, training_schedule_date",
                "performance_id",
                ticket_ids,
            )
            for t in training_rows:
                pid = t.get("performance_id")
                if pid:
                    training_map[pid] = t.get("total_percentage")
                    if t.get("training_schedule_date"):
                        training_schedule_map[pid] = t.get("training_schedule_date")
            training_ids = [t["id"] for t in training_rows if t.get("id")]
            if training_ids:
                tf_rows = _supabase_select_in_chunks(
                    "ticket_features",
                    "id, feature_id, training_id",
                    "training_id",
                    training_ids,
                )
                training_id_to_perf = {
                    t["id"]: t["performance_id"] for t in training_rows if t.get("id") and t.get("performance_id")
                }
                for f in tf_rows:
                    trnid = f.get("training_id")
                    pid = training_id_to_perf.get(trnid) if trnid else None
                    if pid is not None:
                        feature_count_map[pid] = feature_count_map.get(pid, 0) + 1
        except Exception:
            pass

    def _load_companies() -> None:
        nonlocal companies_map
        if not company_ids:
            return
        try:
            rows = _supabase_select_in_chunks("companies", "id, name", "id", company_ids)
            companies_map = {c["id"]: c["name"] for c in rows if c.get("id")}
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_train = pool.submit(_load_training_bundle)
        f_co = pool.submit(_load_companies)
        f_train.result()
        f_co.result()

    return training_rows, tf_rows, training_map, training_schedule_map, feature_count_map, companies_map


def _list_performance_poc_payload(
    completion_status: str | None,
    na_filter: str,
) -> dict:
    cols = "id, company_id, message_owner, response, contact, reference_no, completion_status, created_at"
    if performance_marked_na_supported():
        cols += ",marked_na"
    q = supabase.table("performance_monitoring").select(cols)
    if completion_status == "in_progress":
        q = q.or_("completion_status.eq.in_progress,completion_status.is.null")
    elif completion_status == "completed":
        q = q.eq("completion_status", "completed")
    na_filter_norm = (na_filter or "exclude_na").strip().lower()
    na_ids = performance_marked_na_company_ids() if performance_marked_na_supported() else set()
    q = apply_performance_list_query_filters(q, na_filter_norm, na_ids)
    r = q.order("created_at", desc=True).limit(10000).execute()
    rows = r.data or []
    if na_filter_norm != "all":
        rows = filter_performance_rows(rows, na_filter=na_filter_norm, na_company_ids=na_ids)
    enrich_performance_rows_na(rows, na_company_ids=na_ids)
    na_supported = performance_marked_na_supported()
    ticket_ids = [row.get("id") for row in rows if row.get("id")]
    company_ids = list({row.get("company_id") for row in rows if row.get("company_id")})
    training_rows, tf_rows, training_map, training_schedule_map, feature_count_map, companies_map = (
        _fetch_performance_list_enrichment(ticket_ids, company_ids)
    )
    _batch_current_stages_for_performance_rows(rows, training_rows, tf_rows)
    for row in rows:
        row["company_name"] = companies_map.get(row.get("company_id"), "")
        row["total_percentage"] = training_map.get(row.get("id"))
        row["has_training"] = row.get("id") in training_map
        row["feature_count"] = feature_count_map.get(row.get("id"), 0)
        row["training_schedule_date"] = training_schedule_map.get(row.get("id"))
    _sort_performance_list_rows(rows)
    return {
        "items": rows,
        "marked_na_supported": na_supported,
        "na_filter": na_filter_norm,
    }


@api_router.get("/success/performance/list")
@cached(ttl=300, key_prefix="success:perf:list:")
def list_performance_poc(
    completion_status: str | None = None,
    na_filter: str = Query("exclude_na", description="exclude_na (default) | only_na | all"),
    auth: dict = Depends(get_current_user),
):
    """List performance monitoring tickets. Filter by completion_status=in_progress|completed. Includes total_percentage, has_training, feature_count."""
    try:
        return _list_performance_poc_payload(completion_status, na_filter or "exclude_na")
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("does not exist" in err or "42703" in err or "pgrst204" in err):
            reset_performance_marked_na_cache()
            raise HTTPException(
                status_code=400,
                detail="Column marked_na missing. Run database/PERFORMANCE_MONITORING_MARKED_NA.sql, then reload Supabase API schema.",
            )
        if "does not exist" in err or "relation" in err:
            raise HTTPException(
                status_code=503,
                detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql in Supabase SQL Editor first.",
            )
        raise HTTPException(status_code=400, detail=str(e)[:200])


def _completed_ticket_feature_ids(tf_ids: list) -> set:
    """Single query: which ticket_features have at least one completed followup."""
    if not tf_ids:
        return set()
    try:
        fu = (
            supabase.table("feature_followups")
            .select("ticket_feature_id")
            .in_("ticket_feature_id", tf_ids)
            .eq("status", "completed")
            .execute()
        )
        return {x.get("ticket_feature_id") for x in (fu.data or []) if x.get("ticket_feature_id")}
    except Exception:
        return set()


def _compute_current_stage_from_training(
    training: dict | None,
    tfs: list,
    completion_status: str,
) -> tuple[str, list[str]]:
    """Return (current_stage_desc, pending_feature_names) without per-feature Supabase calls."""
    if completion_status == "completed":
        return "Completed", []
    if not training:
        return "POC Added - Pending: Training", []
    if not tfs:
        return "Training Done - Pending: Add Feature Committed for Use", []
    fl_ids = list({f["feature_id"] for f in tfs if f.get("feature_id")})
    feature_names: dict = {}
    if fl_ids:
        try:
            fl = supabase.table("feature_list").select("id, name").in_("id", fl_ids).execute()
            feature_names = {x["id"]: x["name"] for x in (fl.data or [])}
        except Exception:
            pass
    tf_ids = [f["id"] for f in tfs if f.get("id")]
    completed_tf_ids = _completed_ticket_feature_ids(tf_ids)
    completed: list[str] = []
    pending: list[str] = []
    for tf in tfs:
        name = feature_names.get(tf.get("feature_id"), "")
        if tf.get("id") in completed_tf_ids:
            completed.append(name)
        else:
            pending.append(name)
    total = len(tfs)
    done = len(completed)
    if pending:
        return f"Followup: {done}/{total} completed - Pending: {', '.join(pending)}", pending
    return f"Followup: {done}/{total} completed", []


def _compute_current_stage(ticket_id: str, completion_status: str) -> tuple[str, list[str]]:
    """Return (current_stage_desc, pending_feature_names)."""
    training, tfs = _get_training_for_ticket(ticket_id)
    return _compute_current_stage_from_training(training, tfs, completion_status)


def _invalidate_success_performance_caches(ticket_id: str | None = None) -> None:
    invalidate_performance_na_company_ids_cache()
    _invalidate_ttl_cache_key_prefix("success:perf:list:")
    _invalidate_ttl_cache_key_prefix("success:perf:detail:")
    _invalidate_ttl_cache_key_prefix("success:perf:na-ids:")


@api_router.get("/success/performance/details")
@cached(ttl=300, key_prefix="success:perf:detail:")
def get_performance_details(
    ticket_id: str,
    auth: dict = Depends(get_current_user),
):
    """Full ticket details with current_stage and pending_features. Use for View Details."""
    try:
        pm_cols = (
            "id, company_id, message_owner, response, contact, reference_no, completion_status, created_at, created_by"
        )
        if performance_marked_na_supported():
            pm_cols += ",marked_na"
        pm = supabase.table("performance_monitoring").select(pm_cols).eq("id", ticket_id).limit(1).execute()
        rows = pm.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Ticket not found")
        row = rows[0]
        na_ids = performance_marked_na_company_ids() if performance_marked_na_supported() else set()
        enrich_performance_rows_na([row], na_company_ids=na_ids)
        row["company_name"] = _company_name_for_id(row.get("company_id"))
        row["marked_na_supported"] = performance_marked_na_supported()
        training, tfs = _get_training_for_ticket(ticket_id)
        current_stage, pending_features = _compute_current_stage_from_training(
            training, tfs, row.get("completion_status", "in_progress")
        )
        row["current_stage"] = current_stage
        row["pending_features"] = pending_features
        row["training"] = training
        if training and training.get("total_percentage") is not None:
            row["total_percentage"] = float(training["total_percentage"])
        row["feature_ids"] = [f["feature_id"] for f in tfs] if tfs else []
        row["features_locked"] = _features_locked(training) if training else False
        tf_ids = [f["id"] for f in tfs if f.get("id")]
        followups = _fetch_followups_for_tf_ids(tf_ids)
        fl_ids = list({f["feature_id"] for f in tfs}) if tfs else []
        feature_names = {}
        if fl_ids:
            fl = supabase.table("feature_list").select("id, name").in_("id", fl_ids).execute()
            feature_names = {x["id"]: x["name"] for x in (fl.data or [])}
        by_tf = {}
        for f in (tfs or []):
            by_tf[f["id"]] = {"ticket_feature_id": f["id"], "feature_name": feature_names.get(f["feature_id"], ""), "status": f.get("status", "Pending"), "followups": []}
        for fu in followups:
            fu["can_revert"] = _followup_can_be_reverted(fu)
            tf_id = fu.get("ticket_feature_id")
            if tf_id in by_tf:
                by_tf[tf_id]["followups"].append(fu)
        row["features_with_followups"] = list(by_tf.values())
        return row
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(status_code=503, detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql first.")
        raise HTTPException(status_code=400, detail=str(e)[:200])


# ---------- Training & Followups (Part 2 & 3) ----------
class TrainingSubmitRequest(BaseModel):
    ticket_id: str  # performance_monitoring.id
    call_poc: str  # yes / no
    message_poc: str  # yes / no
    message_owner: str  # yes / no
    training_schedule_date: str | None = None  # YYYY-MM-DD; mandatory in UI
    training_status: str  # yes / no
    remarks: str | None = None
    feature_ids: list[str] = []  # feature_list ids


class FollowupSubmitRequest(BaseModel):
    ticket_id: str  # performance_monitoring.id
    ticket_feature_id: str  # ticket_features.id
    initial_percentage: float | None = None  # 1st time only: user-entered base %; rest divided equally
    status: str  # completed | pending
    remarks: str | None = None


@api_router.get("/success/performance/features")
@cached(ttl=300, key_prefix="success:perf:features:")
def list_performance_features(auth: dict = Depends(get_current_user)):
    """List feature_list for Training form multi-select."""
    try:
        r = supabase.table("feature_list").select("id, name, display_order").order("display_order").execute()
        return {"items": r.data or []}
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(status_code=503, detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql first.")
        raise HTTPException(status_code=400, detail=str(e)[:200])


def _get_training_for_ticket(ticket_id: str):
    """Return (training_row, ticket_features_list) or (None, [])."""
    try:
        tr = supabase.table("performance_training").select("*").eq("performance_id", ticket_id).limit(2).execute()
        rows = tr.data if tr.data else []
        if not rows:
            return None, []
        # UNIQUE(performance_id) guarantees at most one; take first
        training = rows[0]
        if not training.get("id"):
            return None, []
        tf = supabase.table("ticket_features").select("id, feature_id, status").eq("training_id", training["id"]).execute()
        return training, tf.data or []
    except Exception:
        return None, []


def _features_locked(training: dict | None) -> bool:
    """True if Feature Committed for Use cannot be edited (after 144 hr / 6 days)."""
    if not training:
        return False
    committed_at = training.get("features_committed_at")
    if not committed_at:
        return False
    try:
        dt = datetime.fromisoformat(committed_at.replace("Z", "+00:00")) if isinstance(committed_at, str) else committed_at
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return delta.total_seconds() >= 144 * 3600  # 144 hr = 6 days
    except Exception:
        return False


@api_router.get("/success/performance/training")
def get_performance_training(
    ticket_id: str,
    auth: dict = Depends(get_current_user),
):
    """Get training record and selected feature ids for a ticket. Returns features_locked if Feature Committed cannot be edited."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not training:
        return {"training": None, "feature_ids": [], "features_locked": False}
    feature_ids = [f["feature_id"] for f in tfs]
    return {"training": training, "feature_ids": feature_ids, "features_locked": _features_locked(training)}


@api_router.post("/success/performance/training")
def submit_performance_training(payload: TrainingSubmitRequest, auth: dict = Depends(get_current_user)):
    """Create or update training. Feature Committed locked after 144 hr (6 days)."""
    if payload.call_poc not in ("yes", "no") or payload.message_poc not in ("yes", "no") or payload.message_owner not in ("yes", "no") or payload.training_status not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="call_poc, message_poc, message_owner, training_status must be yes or no")
    try:
        training, existing_tfs = _get_training_for_ticket(payload.ticket_id)
        features_locked = _features_locked(training) if training else False
        feature_ids = list(dict.fromkeys(payload.feature_ids))
        if features_locked:
            feature_ids = [f["feature_id"] for f in existing_tfs]
        training_row = {
            "performance_id": payload.ticket_id,
            "call_poc": payload.call_poc,
            "message_poc": payload.message_poc,
            "message_owner": payload.message_owner,
            "training_schedule_date": payload.training_schedule_date or None,
            "training_status": payload.training_status,
            "remarks": payload.remarks or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "created_by": auth.get("id"),
        }
        r = supabase.table("performance_training").upsert(training_row, on_conflict="performance_id").execute()
        rows = r.data if r.data else []
        training_id = rows[0].get("id") if rows else None
        if not training_id:
            raise HTTPException(status_code=500, detail="Failed to create/update training")
        now_iso = datetime.now(timezone.utc).isoformat()
        if not features_locked and feature_ids:
            supabase.table("ticket_features").delete().eq("training_id", training_id).execute()
            for fid in feature_ids:
                supabase.table("ticket_features").insert({
                    "training_id": training_id,
                    "feature_id": fid,
                    "status": "Pending",
                }).execute()
            if not (training and training.get("features_committed_at")):
                supabase.table("performance_training").update({"features_committed_at": now_iso}).eq("id", training_id).execute()
        training, _ = _get_training_for_ticket(payload.ticket_id)
        _invalidate_success_performance_caches(payload.ticket_id)
        invalidate_dashboard_read_caches()
        return {"training": training, "feature_ids": feature_ids, "features_locked": _features_locked(training)}
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(status_code=503, detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql first.")
        raise HTTPException(status_code=400, detail=str(e)[:200])


def _last_total_percentage_for_ticket(ticket_id: str) -> float:
    """Get the latest total_percentage from feature_followups for this ticket (via training -> ticket_features)."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not training or not tfs:
        return 0.0
    tf_ids = [f["id"] for f in tfs]
    try:
        # Get latest followup by created_at for any of these ticket_features
        r = supabase.table("feature_followups").select("total_percentage, created_at").in_("ticket_feature_id", tf_ids).order("created_at", desc=True).limit(1).execute()
        if r.data and len(r.data) > 0 and r.data[0].get("total_percentage") is not None:
            return float(r.data[0]["total_percentage"])
    except Exception:
        pass
    return 0.0


def _all_features_completed_for_ticket(ticket_id: str) -> bool:
    """True if every ticket_feature has at least one followup with status=completed."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not tfs:
        return False
    for tf in tfs:
        r = supabase.table("feature_followups").select("id").eq("ticket_feature_id", tf["id"]).eq("status", "completed").limit(1).execute()
        if not r.data or len(r.data) == 0:
            return False
    return True


def _get_initial_percentage(ticket_id: str) -> float:
    """Get initial_percentage from performance_training (1st time user entry)."""
    training, _ = _get_training_for_ticket(ticket_id)
    if training and training.get("initial_percentage") is not None:
        return float(training["initial_percentage"])
    return 0.0


def _count_followups_for_ticket(ticket_id: str) -> int:
    """Count total followup rows for this ticket."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not training or not tfs:
        return 0
    tf_ids = [f["id"] for f in tfs]
    try:
        r = supabase.table("feature_followups").select("id").in_("ticket_feature_id", tf_ids).execute()
        return len(r.data or [])
    except Exception:
        return 0


FOLLOWUP_REVERT_HOURS = 24


def _parse_dt_utc(val) -> datetime | None:
    if not val:
        return None
    try:
        dt = datetime.fromisoformat(val.replace("Z", "+00:00")) if isinstance(val, str) else val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _followup_can_be_reverted(fu: dict) -> bool:
    """Completed followups may be reversed within 24 hours of submission."""
    if (fu.get("status") or "").strip().lower() != "completed":
        return False
    dt = _parse_dt_utc(fu.get("created_at"))
    if not dt:
        return False
    age = (datetime.now(timezone.utc) - dt).total_seconds()
    return 0 <= age <= FOLLOWUP_REVERT_HOURS * 3600


def _resolve_ticket_id_for_ticket_feature(ticket_feature_id: str) -> str | None:
    try:
        tf = supabase.table("ticket_features").select("training_id").eq("id", ticket_feature_id).single().execute()
        if not tf.data or not tf.data.get("training_id"):
            return None
        tr = (
            supabase.table("performance_training")
            .select("performance_id")
            .eq("id", tf.data["training_id"])
            .single()
            .execute()
        )
        return (tr.data or {}).get("performance_id")
    except Exception:
        return None


def _recompute_training_total_for_ticket(ticket_id: str) -> float:
    """Latest total_percentage across followups; falls back to initial_percentage."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not training:
        return 0.0
    tf_ids = [f["id"] for f in (tfs or [])]
    if tf_ids:
        try:
            r = (
                supabase.table("feature_followups")
                .select("total_percentage, created_at")
                .in_("ticket_feature_id", tf_ids)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if r.data and r.data[0].get("total_percentage") is not None:
                return float(r.data[0]["total_percentage"])
        except Exception:
            pass
    init = training.get("initial_percentage")
    return float(init) if init is not None else 0.0


def _feature_has_completed_followup(ticket_feature_id: str) -> bool:
    try:
        r = (
            supabase.table("feature_followups")
            .select("id")
            .eq("ticket_feature_id", ticket_feature_id)
            .eq("status", "completed")
            .limit(1)
            .execute()
        )
        return bool(r.data)
    except Exception:
        return False


@api_router.get("/success/performance/followups")
def list_performance_followups(
    ticket_id: str,
    auth: dict = Depends(get_current_user),
):
    """List followups for a ticket: selected features with their followup entries. Includes initial_percentage."""
    training, tfs = _get_training_for_ticket(ticket_id)
    if not training or not tfs:
        return {"features": [], "total_percentage": training.get("total_percentage") if training else None, "initial_percentage": None, "is_first_followup": False}
    tf_ids = [f["id"] for f in tfs]
    fl_ids = list({f["feature_id"] for f in tfs})
    feature_names = {}
    if fl_ids:
        fl = supabase.table("feature_list").select("id, name").in_("id", fl_ids).execute()
        feature_names = {x["id"]: x["name"] for x in (fl.data or [])}
    followups = []
    try:
        r = supabase.table("feature_followups").select("*").in_("ticket_feature_id", tf_ids).order("created_at", desc=False).execute()
        followups = r.data or []
    except Exception:
        pass
    # Build list of features with their followup rows
    by_tf = {}
    for f in tfs:
        by_tf[f["id"]] = {"ticket_feature_id": f["id"], "feature_id": f["feature_id"], "feature_name": feature_names.get(f["feature_id"], ""), "status": f.get("status", "Pending"), "followups": []}
    for fu in followups:
        fu["can_revert"] = _followup_can_be_reverted(fu)
        tf_id = fu.get("ticket_feature_id")
        if tf_id in by_tf:
            by_tf[tf_id]["followups"].append(fu)
    total_percentage = training.get("total_percentage")
    if total_percentage is not None:
        total_percentage = float(total_percentage)
    init_pct = training.get("initial_percentage")
    init_pct = float(init_pct) if init_pct is not None else None
    n_followups = len(followups)
    return {"features": list(by_tf.values()), "total_percentage": total_percentage, "initial_percentage": init_pct, "is_first_followup": n_followups == 0}


class FollowupClickRequest(BaseModel):
    ticket_id: str
    ticket_feature_id: str


@api_router.post("/success/performance/followup-click")
def log_success_followup_click(payload: FollowupClickRequest, auth: dict = Depends(get_current_user)):
    """Log a click on 'Add followup for this feature' for Success KPI Training Follow-up."""
    try:
        supabase.table("success_followup_click_events").insert(
            {
                "performance_id": payload.ticket_id,
                "ticket_feature_id": payload.ticket_feature_id,
                "created_by": auth.get("id"),
            }
        ).execute()
        _invalidate_success_performance_caches(payload.ticket_id)
        invalidate_dashboard_read_caches()
        return {"ok": True}
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(
                status_code=503,
                detail="Run docs/SUCCESS_FOLLOWUP_CLICK_EVENTS.sql in Supabase to enable click tracking.",
            )
        raise HTTPException(status_code=400, detail=str(e)[:200])


@api_router.get("/success/performance/followup-clicks")
def list_success_followup_clicks(
    ticket_feature_id: str,
    auth: dict = Depends(get_current_user),
):
    """Count and timestamps for follow-up button clicks (per ticket_feature)."""
    try:
        r = (
            supabase.table("success_followup_click_events")
            .select("id, clicked_at")
            .eq("ticket_feature_id", ticket_feature_id)
            .order("clicked_at", desc=True)
            .limit(500)
            .execute()
        )
        rows = r.data or []
        return {"count": len(rows), "events": rows}
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            return {"count": 0, "events": []}
        raise HTTPException(status_code=400, detail=str(e)[:200])


@api_router.post("/success/performance/followup")
def submit_performance_followup(payload: FollowupSubmitRequest, auth: dict = Depends(get_current_user)):
    """Add followup. 1st time: user sends initial_percentage; rest (100-initial) divided equally among features."""
    if payload.status not in ("completed", "pending"):
        raise HTTPException(status_code=400, detail="status must be completed or pending")
    try:
        training, tfs = _get_training_for_ticket(payload.ticket_id)
        if not training or not tfs:
            raise HTTPException(status_code=400, detail="No training or features for this ticket")
        n = len(tfs)
        n_followups = _count_followups_for_ticket(payload.ticket_id)
        is_first = n_followups == 0
        if is_first:
            # First followup: require initial_percentage from user
            if payload.initial_percentage is None:
                raise HTTPException(status_code=400, detail="First followup: enter Initial percentage (base % you already completed)")
            init_pct = float(payload.initial_percentage)
            if init_pct < 0 or init_pct > 100:
                raise HTTPException(status_code=400, detail="initial_percentage must be between 0 and 100")
            prev = init_pct
            # Store initial_percentage in performance_training
            supabase.table("performance_training").update({"initial_percentage": init_pct}).eq("id", training["id"]).execute()
        else:
            prev = _last_total_percentage_for_ticket(payload.ticket_id)
            init_pct = _get_initial_percentage(payload.ticket_id)
        # Remaining % (100 - initial) divided equally among features
        remaining = max(0, 100.0 - init_pct)
        equal_share = round(remaining / n, 2) if n else 0
        added = equal_share if payload.status == "completed" else 0
        total = round(prev + added, 2)
        if total > 100:
            raise HTTPException(
                status_code=400,
                detail=f"Total completion cannot exceed 100%. Current total is {prev}%. This feature's share is {equal_share}%.",
            )
        tf_ids = [f["id"] for f in tfs]
        if payload.ticket_feature_id not in tf_ids:
            raise HTTPException(status_code=400, detail="ticket_feature_id does not belong to this ticket")
        existing = supabase.table("feature_followups").select("id, status").eq("ticket_feature_id", payload.ticket_feature_id).execute()
        if existing.data:
            has_completed = any(f.get("status") == "completed" for f in existing.data)
            if has_completed and payload.status == "completed":
                raise HTTPException(status_code=400, detail="This feature is already marked completed")
        # Store the server-side previous we used (for display/audit)
        insert_row = {
            "ticket_feature_id": payload.ticket_feature_id,
            "previous_percentage": prev,
            "added_percentage": added,
            "total_percentage": total,
            "status": payload.status,
            "remarks": payload.remarks or None,
        }
        tf = next((f for f in tfs if f["id"] == payload.ticket_feature_id), None)
        if tf:
            fl = supabase.table("feature_list").select("name").eq("id", tf["feature_id"]).maybe_single().execute()
            insert_row["feature_name"] = (fl.data or {}).get("name", "")
        else:
            insert_row["feature_name"] = ""
        ins = supabase.table("feature_followups").insert(insert_row).execute()
        supabase.table("performance_training").update({"total_percentage": total, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", training["id"]).execute()
        if payload.status == "completed":
            supabase.table("ticket_features").update({"status": "Completed"}).eq("id", payload.ticket_feature_id).execute()
        if _all_features_completed_for_ticket(payload.ticket_id):
            supabase.table("performance_monitoring").update({"completion_status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", payload.ticket_id).execute()
        created = (ins.data or [{}])[0] if ins.data else {}
        _invalidate_success_performance_caches(payload.ticket_id)
        invalidate_dashboard_read_caches()
        return {"followup": created, "total_percentage": total}
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(status_code=503, detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql and Part2_Part3 migration first.")
        raise HTTPException(status_code=400, detail=str(e)[:200])


@api_router.post("/success/performance/followup/{followup_id}/revert")
def revert_performance_followup(followup_id: str, auth: dict = Depends(get_current_user)):
    """Undo a mistaken Completed followup within 24 hours (restores Pending + recalculates %)."""
    try:
        fr = supabase.table("feature_followups").select("*").eq("id", followup_id).single().execute()
        fu = fr.data
        if not fu:
            raise HTTPException(status_code=404, detail="Followup not found")
        if not _followup_can_be_reverted(fu):
            raise HTTPException(
                status_code=400,
                detail=f"Only Completed followups within {FOLLOWUP_REVERT_HOURS} hours can be reverted",
            )
        tf_id = fu.get("ticket_feature_id")
        if not tf_id:
            raise HTTPException(status_code=400, detail="Invalid followup row")
        ticket_id = _resolve_ticket_id_for_ticket_feature(tf_id)
        if not ticket_id:
            raise HTTPException(status_code=400, detail="Ticket not found for this followup")
        training, _ = _get_training_for_ticket(ticket_id)
        if not training:
            raise HTTPException(status_code=400, detail="No training for this ticket")

        supabase.table("feature_followups").delete().eq("id", followup_id).execute()

        if not _feature_has_completed_followup(tf_id):
            supabase.table("ticket_features").update({"status": "Pending"}).eq("id", tf_id).execute()

        new_total = _recompute_training_total_for_ticket(ticket_id)
        supabase.table("performance_training").update(
            {"total_percentage": new_total, "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", training["id"]).execute()

        supabase.table("performance_monitoring").update(
            {"completion_status": "in_progress", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", ticket_id).eq("completion_status", "completed").execute()

        _invalidate_success_performance_caches(ticket_id)
        invalidate_dashboard_read_caches()
        return {"ok": True, "total_percentage": new_total, "ticket_id": ticket_id}
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(status_code=503, detail="Run database/SUCCESS_PERFORMANCE_MONITORING.sql first.")
        raise HTTPException(status_code=400, detail=str(e)[:200])


# ---------- Users (admin = view only; master_admin = view + edit role, deactivate, section permissions) ----------
# Role name as stored in DB; frontend displays "Master Admin", "Admin", "Approver", "User"
def _map_role(name: str) -> str:
    return _normalize_role(name)


# Section keys for user_section_permissions (Edit User matrix + login).
# Dashboard KPI subsections come from app.dashboard_kpi_sections (auto-merged after dashboard_kpi).
_BASE_SECTION_KEYS = [
    "dashboard", "dashboard_kpi", "improvement", "improvement_i1", "soft_sugg", "soft_sugg_details",
    "support_dashboard", "all_tickets",
    "chores_bugs", "staging", "feature", "approval_status", "completed_chores_bugs", "rejected_tickets",
    "completed_feature", "solution", "task", "success_performance", "success_comp_perform",
    "client_to_lead", "leads", "onboarding", "onboarding_payment_status", "client_payment",
    "training", "db_client", "settings", "users",
]

SECTION_KEYS = merge_section_keys(_BASE_SECTION_KEYS)

_SECTION_LABELS_BASE: dict[str, str] = {
    "dashboard": "Dashboard",
    "dashboard_kpi": "Dashboard - KPI (page)",
    "improvement": "Improvement (submit suggestion)",
    "improvement_i1": "I - 1 (improvement board)",
    "soft_sugg": "IP Suggestion (submit)",
    "soft_sugg_details": "IP Details (board)",
    "support_dashboard": "Support Dashboard",
    "all_tickets": "All Tickets",
    "chores_bugs": "Chores & Bugs",
    "staging": "Staging",
    "feature": "Feature",
    "approval_status": "Approval Status",
    "completed_chores_bugs": "Completed Chores & Bugs",
    "rejected_tickets": "Rejected Tickets",
    "completed_feature": "Completed Feature",
    "solution": "Solution",
    "task": "Task",
    "success_performance": "Performance Monitoring",
    "success_comp_perform": "Comp- Perform",
    "client_to_lead": "Client to Lead",
    "leads": "Lead",
    "onboarding": "Onboarding",
    "onboarding_payment_status": "Payment Status",
    "client_payment": "Client Payment",
    "training": "Training",
    "db_client": "DB Client",
    "settings": "Settings",
    "users": "Users",
}
for _kpi in DASHBOARD_KPI_PERMISSION_SECTIONS:
    _SECTION_LABELS_BASE[_kpi["key"]] = _kpi["label"]
SECTION_LABELS = _SECTION_LABELS_BASE


def _build_section_permissions_list(frontend_role: str, perm_rows: list[dict] | None) -> list[dict]:
    """
    Merge DB rows with SECTION_KEYS for API responses (login, /users/me, Edit User).

    Admin / Master Admin / Approver with *no* rows in user_section_permissions yet get full
    view+edit on every section (legacy). After any permission row is saved, the matrix applies
    to everyone including elevated roles.
    """
    rows = perm_rows or []
    elevated = frontend_role in ("master_admin", "admin", "approver")
    if elevated and len(rows) == 0:
        return [{"section_key": k, "can_view": True, "can_edit": True} for k in SECTION_KEYS]
    by_key = {p["section_key"]: p for p in rows}
    out: list[dict] = []
    for key in SECTION_KEYS:
        p = by_key.get(key)
        out.append(
            {
                "section_key": key,
                "can_view": bool(p["can_view"]) if p else False,
                "can_edit": bool(p["can_edit"]) if p else False,
            }
        )
    return out


@api_router.get("/roles")
def list_roles(auth: dict = Depends(require_roles(["admin", "master_admin"]))):
    """List roles for dropdown (e.g. Edit User). Returns id and name."""
    r = supabase.table("roles").select("id, name, description").order("name").execute()
    return {"data": r.data or []}


@api_router.get("/permissions/section-catalog")
def get_permissions_section_catalog(auth: dict = Depends(require_roles(["admin", "master_admin"]))):
    """
    Full permission matrix for Edit User — includes dynamic Dashboard KPI person dashboards.
    Add entries to DASHBOARD_KPI_DASHBOARDS in app/dashboard_kpi_sections.py to expose new rows.
    """
    from app.dashboard_kpi_sections import dashboard_kpi_section_catalog

    kpi_keys = {s["key"] for s in DASHBOARD_KPI_PERMISSION_SECTIONS}
    rows: list[dict] = []
    for key in SECTION_KEYS:
        if key in kpi_keys:
            group = "dashboard_kpi"
        else:
            group = "app"
        rows.append({"key": key, "label": SECTION_LABELS.get(key, key), "group": group})
    return {
        "section_keys": SECTION_KEYS,
        "rows": rows,
        "dashboard_kpi": dashboard_kpi_section_catalog(),
    }


def _list_users_from_view(safe_search: str, page: int, limit: int):
    """Fetch users via users_view. Raises on failure."""
    q = supabase.table("users_view").select("*")
    if safe_search:
        q = q.or_(f"full_name.ilike.%{safe_search}%,email.ilike.%{safe_search}%")
    q = q.order("id").range((page - 1) * limit, page * limit - 1)
    r = q.execute()
    rows = list(r.data or [])
    count_q = supabase.table("users_view").select("id", count="exact")
    if safe_search:
        count_q = count_q.or_(f"full_name.ilike.%{safe_search}%,email.ilike.%{safe_search}%")
    count_r = count_q.limit(1).execute()
    total = getattr(count_r, "count", len(rows))
    total = total if isinstance(total, int) and total >= 0 else len(rows)
    return rows, total


def _list_users_fallback(page: int, limit: int, search: str | None):
    """Fallback when users_view fails: build list from user_profiles + roles + auth.admin."""
    auth_resp = supabase.auth.admin.list_users(per_page=1000)
    auth_users = getattr(auth_resp, "users", []) or []
    auth_by_id = {str(u.id): getattr(u, "email", "") or "" for u in auth_users}
    profiles = supabase.table("user_profiles").select("id, full_name, role_id, is_active, created_at").execute()
    prows = profiles.data or []
    if not prows:
        return [], 0
    role_ids = list({p["role_id"] for p in prows})
    roles = supabase.table("roles").select("id, name").in_("id", role_ids).execute()
    roles_by_id = {r["id"]: r.get("name", "user") for r in (roles.data or [])}
    merged = []
    for p in prows:
        email = auth_by_id.get(str(p["id"]), "")
        if search and search.strip():
            s = search.strip().lower()
            if s not in ((p.get("full_name") or "").lower(), email.lower()):
                continue
        merged.append({
            "id": p["id"],
            "email": email,
            "full_name": p.get("full_name", ""),
            "display_name": roles_by_id.get(p["role_id"], "user"),
            "role_name": roles_by_id.get(p["role_id"], "user"),
            "role": _map_role(roles_by_id.get(p["role_id"], "user")),
            "is_active": p.get("is_active", True),
            "created_at": str(p.get("created_at", "")),
        })
    merged.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    total = len(merged)
    start = (page - 1) * limit
    return merged[start : start + limit], total


@api_router.get("/users")
def list_users(
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    auth: dict = Depends(require_roles(["admin", "master_admin"])),
):
    """List users. Admin and Master Admin can view; only Master Admin can edit (via PUT)."""
    safe_search = ""
    if search and search.strip():
        safe_search = _sanitize_ilike_input(search, max_len=100)
    try:
        rows, total = _list_users_from_view(safe_search, page, limit)
    except Exception as e:
        print(f"[GET /users] users_view failed ({e}), trying fallback")
        try:
            rows, total = _list_users_fallback(page, limit, search)
        except Exception as e2:
            print(f"[GET /users] Fallback failed: {e2}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load users: {str(e2)[:200]}",
            )
    for row in rows:
        if "role" not in row:
            row["role"] = _map_role(row.get("role_name", "user"))
        if "display_name" not in row and "full_name" in row:
            row["display_name"] = row.get("role_name") or row["full_name"]
    return {"data": rows, "total": total, "page": page, "limit": limit}


@api_router.get("/users/{user_id}")
def get_user(user_id: str, auth: dict = Depends(require_roles(["admin", "master_admin"]))):
    r = supabase.table("users_view").select("*").eq("id", user_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="User not found")
    d = r.data
    d["role"] = _map_role(d.get("role_name", "user"))
    return d


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    display_name: str | None = None
    role_id: str | None = None  # only master_admin can set
    is_active: bool | None = None


@api_router.put("/users/{user_id}")
def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    auth: dict = Depends(require_roles(["master_admin"])),
):
    """Update user profile. Master Admin only. Can set full_name, display_name, role_id, is_active."""
    r = supabase.table("user_profiles").select("id").eq("id", user_id).single().execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="User not found")
    data = {}
    if payload.full_name is not None:
        data["full_name"] = payload.full_name
    if payload.display_name is not None:
        data["display_name"] = payload.display_name
    if payload.role_id is not None:
        data["role_id"] = payload.role_id
    if payload.is_active is not None:
        data["is_active"] = payload.is_active
    if not data:
        return supabase.table("user_profiles").select("*").eq("id", user_id).single().execute().data
    supabase.table("user_profiles").update(data).eq("id", user_id).execute()
    out = supabase.table("users_view").select("*").eq("id", user_id).single().execute()
    d = out.data if out.data else {}
    d["role"] = _map_role(d.get("role_name", "user"))
    return d


class SectionPermissionItem(BaseModel):
    section_key: str
    can_view: bool
    can_edit: bool


class SectionPermissionsUpdate(BaseModel):
    permissions: list[SectionPermissionItem]


@api_router.get("/users/{user_id}/section-permissions")
def get_section_permissions(
    user_id: str,
    auth: dict = Depends(require_roles(["master_admin"])),
):
    """Get section view/edit permissions for a user. Master Admin only."""
    pr = supabase.table("user_profiles").select("role_id").eq("id", user_id).single().execute()
    if not pr.data:
        raise HTTPException(status_code=404, detail="User not found")
    role_row = supabase.table("roles").select("name").eq("id", pr.data["role_id"]).single().execute()
    frontend_role = _map_role(role_row.data.get("name") if role_row.data else None)
    r = supabase.table("user_section_permissions").select("*").eq("user_id", user_id).execute()
    rows = r.data or []
    result = _build_section_permissions_list(frontend_role, rows)
    return {"data": result}


@api_router.put("/users/{user_id}/section-permissions")
def update_section_permissions(
    user_id: str,
    payload: SectionPermissionsUpdate,
    auth: dict = Depends(require_roles(["master_admin"])),
):
    """Set section view/edit permissions for a user. Master Admin only."""
    pr = supabase.table("user_profiles").select("id").eq("id", user_id).single().execute()
    if not pr.data:
        raise HTTPException(status_code=404, detail="User not found")
    now = datetime.utcnow().isoformat()
    for item in payload.permissions:
        if item.section_key not in SECTION_KEYS:
            continue
        # Explicit-only: no row in DB means no access. Remove row when both false.
        if not item.can_view and not item.can_edit:
            try:
                supabase.table("user_section_permissions").delete().eq("user_id", user_id).eq("section_key", item.section_key).execute()
            except Exception:
                pass
            continue
        row = {"user_id": user_id, "section_key": item.section_key, "can_view": item.can_view, "can_edit": item.can_edit, "updated_at": now}
        try:
            supabase.table("user_section_permissions").upsert(row, on_conflict="user_id,section_key").execute()
        except Exception:
            supabase.table("user_section_permissions").delete().eq("user_id", user_id).eq("section_key", item.section_key).execute()
            supabase.table("user_section_permissions").insert(row).execute()
    return {"message": "Section permissions updated"}


# ---------- Solutions ----------
class CreateSolutionRequest(BaseModel):
    ticket_id: str
    solution_number: int  # 1 or 2
    title: str
    description: str


@api_router.get("/solutions/ticket/{ticket_id}")
def list_solutions(ticket_id: str, auth: dict = Depends(get_current_user)):
    r = supabase.table("solutions").select("*").eq("ticket_id", ticket_id).order("solution_number").execute()
    return r.data or []


@api_router.post("/solutions")
def create_solution(payload: CreateSolutionRequest, auth: dict = Depends(get_current_user)):
    data = {
        "ticket_id": payload.ticket_id,
        "solution_number": payload.solution_number,
        "title": payload.title,
        "description": payload.description,
        "proposed_by": auth["id"],
    }
    r = supabase.table("solutions").insert(data).execute()
    return r.data[0] if r.data else {}


@api_router.put("/solutions/{solution_id}")
def update_solution(solution_id: str, payload: dict = None, auth: dict = Depends(get_current_user)):
    if not payload:
        raise HTTPException(status_code=400, detail="Request body required")
    r = supabase.table("solutions").update(payload).eq("id", solution_id).execute()
    return r.data[0] if r.data else {}


# ---------- Staging ----------
class CreateStagingRequest(BaseModel):
    ticket_id: str
    staging_environment: str = "staging-1"
    version: str = ""
    deployment_notes: str | None = None


@api_router.get("/staging/deployments")
def list_staging(
    page: int = 1,
    limit: int = 20,
    status: str | None = None,
    auth: dict = Depends(get_current_user),
):
    q = supabase.table("staging_deployments").select("*", count="exact")
    if status:
        q = q.eq("status", status)
    q = q.range((page - 1) * limit, page * limit - 1).order("created_at", desc=True)
    r = q.execute()
    return {"data": r.data or [], "total": r.count or 0, "page": page, "limit": limit}


@api_router.post("/staging/deployments")
def create_staging(payload: CreateStagingRequest, auth: dict = Depends(get_current_user)):
    data = {
        "ticket_id": payload.ticket_id,
        "staging_environment": payload.staging_environment,
        "version": payload.version,
        "deployment_notes": payload.deployment_notes,
        "deployed_by": auth["id"],
    }
    r = supabase.table("staging_deployments").insert(data).execute()
    return r.data[0] if r.data else {}


@api_router.put("/staging/deployments/{deployment_id}")
def update_staging(deployment_id: str, payload: dict = None, auth: dict = Depends(get_current_user)):
    if not payload:
        raise HTTPException(status_code=400, detail="Request body required")
    r = supabase.table("staging_deployments").update(payload).eq("id", deployment_id).execute()
    return r.data[0] if r.data else {}

# ---------------------------------------------------------------------------
# CHECKLIST MODULE (Task -> Checklist)
# ---------------------------------------------------------------------------
# Fallback if checklist_departments table is empty or fails
DEPARTMENTS_FALLBACK = [
    "Customer Support & Success",
    "Marketing",
    "Accounts & Admin",
    "Internal Development",
]
FREQUENCY_LABELS = {"D": "Daily", "W": "Weekly", "M": "Monthly", "Q": "Quarterly", "F": "Half-yearly", "Y": "Yearly"}


class CreateChecklistTaskRequest(BaseModel):
    task_name: str
    department: str
    frequency: str  # D, 2D, W, 2W, M, Q, F, Y
    start_date: str  # YYYY-MM-DD


def _parse_iso_date(val: Any) -> date | None:
    """Parse Supabase date/datetime/string to date; None if invalid."""
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, str):
        s = val.strip()[:10]
        if len(s) >= 10:
            try:
                return date.fromisoformat(s)
            except ValueError:
                return None
    return None


def _get_holidays_for_year(year: int) -> set[date]:
    """Return set of holiday dates for the year from checklist_holidays table."""
    out: set[date] = set()
    try:
        r = supabase.table("checklist_holidays").select("holiday_date").eq("year", year).execute()
        for row in r.data or []:
            d = _parse_iso_date(row.get("holiday_date"))
            if d:
                out.add(d)
    except Exception as e:
        _log(f"checklist holidays load: {e}")
    return out


def _cron_email_failure_response(
    *,
    module: str,
    failed: list[dict],
    sent_count: int,
    pending_users: int,
    extra: dict | None = None,
) -> dict:
    """HTTP 200 with error detail so cron-job.org does not treat Postmark/config issues as crash."""
    err_msg = (failed[0].get("error") if failed else None) or "No emails sent"
    body: dict[str, Any] = {
        "status": "completed",
        "ok": False,
        "email_sent": False,
        "emails_sent": sent_count,
        "eligible_users": pending_users,
        "reason": "send_failed",
        "message": err_msg,
        "send_errors": failed[:10],
        "module": module,
    }
    if extra:
        body.update(extra)
    return body


def _get_checklist_occurrence_dates(task: dict, year: int) -> list:
    """Get occurrence dates for a checklist task in given year."""
    from app.checklist_utils import get_occurrence_dates

    start = _parse_iso_date(task.get("start_date"))
    if not start:
        return []
    freq = task.get("frequency", "D")
    holidays = _get_holidays_for_year(year)
    is_holiday = lambda d: d in holidays
    return get_occurrence_dates(start, freq, year, is_holiday)


def _get_checklist_departments() -> list[str]:
    """Fetch department names from checklist_departments table; fallback to hardcoded list."""
    try:
        r = supabase.table("checklist_departments").select("name").order("name").execute()
        names = [row["name"] for row in (r.data or []) if row.get("name")]
        return names if names else DEPARTMENTS_FALLBACK
    except Exception:
        return DEPARTMENTS_FALLBACK


_CHECKLIST_NA_SUPPORTED: bool | None = None


def _checklist_na_table_missing(err: str) -> bool:
    e = (err or "").lower()
    return (
        "checklist_occurrence_na" in e
        and (
            "does not exist" in e
            or "42p01" in e
            or "pgrst204" in e
            or "pgrst205" in e
            or "could not find" in e
            or "schema cache" in e
            or "not found" in e
        )
    )


def _checklist_na_supported() -> bool:
    """True when database/CHECKLIST_OCCURRENCE_NA.sql is applied. Only caches success (not transient failures)."""
    global _CHECKLIST_NA_SUPPORTED
    if _CHECKLIST_NA_SUPPORTED is True:
        return True
    try:
        supabase.table("checklist_occurrence_na").select("id").limit(1).execute()
        _CHECKLIST_NA_SUPPORTED = True
        return True
    except Exception as e:
        err = str(e)
        if _checklist_na_table_missing(err):
            _CHECKLIST_NA_SUPPORTED = False
            return False
        _log(f"checklist_occurrence_na probe (will retry): {err[:200]}")
        return False


def reset_checklist_na_supported_cache() -> None:
    global _CHECKLIST_NA_SUPPORTED
    _CHECKLIST_NA_SUPPORTED = None


def _parse_checklist_na_from_date(raw: object) -> date | None:
    if raw is None or raw == "":
        return None
    try:
        if isinstance(raw, date):
            return raw
        return date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return None


def _checklist_row_marked_na(task: dict) -> bool:
    """True when whole checklist task is NA (one universal Mark NA per task)."""
    v = task.get("marked_na")
    if v is True:
        return True
    if v in (1, 1.0):
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "t", "1", "yes"):
        return True
    # Legacy: na_from_date or per-day NA rows implied whole-task stop
    return _parse_checklist_na_from_date(task.get("na_from_date")) is not None


def _checklist_occurrence_excluded_for_reminder(
    task: dict,
    occurrence: date,
    na_pairs: set[tuple[str, str]],
) -> bool:
    """True when this occurrence must not trigger checklist emails (whole-task or per-date NA)."""
    if _checklist_row_marked_na(task):
        return True
    tid = str(task.get("id") or "")
    if tid and (tid, occurrence.isoformat()) in na_pairs:
        return True
    return False


def _fetch_checklist_na_pairs(task_ids: list, range_start: date, range_end: date) -> set[tuple[str, str]]:
    """(task_id, occurrence_date) marked NA in range."""
    if not task_ids or not _checklist_na_supported():
        return set()
    try:
        r = (
            supabase.table("checklist_occurrence_na")
            .select("task_id, occurrence_date")
            .in_("task_id", task_ids)
            .gte("occurrence_date", range_start.isoformat())
            .lte("occurrence_date", range_end.isoformat())
            .execute()
        )
        out: set[tuple[str, str]] = set()
        for row in r.data or []:
            tid = row.get("task_id")
            od = row.get("occurrence_date")
            if tid and od:
                out.add((str(tid), str(od)[:10]))
        return out
    except Exception:
        return set()


def _checklist_occurrences_for_user(
    user_id: str,
    range_start: date,
    range_end: date,
    *,
    reference_no: str | None = None,
    only_uncompleted: bool = False,
) -> list[dict]:
    """Build checklist occurrence rows for a user in a date range (shared by list + NA modal)."""
    from app.checklist_utils import get_occurrence_dates_in_range

    cols = "id, task_name, doer_id, department, frequency, start_date, reference_no, na_from_date, marked_na"
    q = supabase.table("checklist_tasks").select(cols).eq("doer_id", user_id)
    if reference_no:
        q = q.eq("reference_no", reference_no)
    try:
        tasks = (q.execute().data or [])
    except Exception:
        cols_fallback = "id, task_name, doer_id, department, frequency, start_date, reference_no, na_from_date"
        q2 = supabase.table("checklist_tasks").select(cols_fallback).eq("doer_id", user_id)
        if reference_no:
            q2 = q2.eq("reference_no", reference_no)
        tasks = (q2.execute().data or [])
    task_ids = [t["id"] for t in tasks]
    comp: dict[tuple[str, str], str | None] = {}
    if task_ids:
        try:
            cr = supabase.table("checklist_completions").select("task_id, occurrence_date, completed_at")
            cr = cr.gte("occurrence_date", range_start.isoformat()).lte("occurrence_date", range_end.isoformat())
            cr = cr.in_("task_id", task_ids)
            for row in (cr.execute().data or []):
                comp[(str(row["task_id"]), str(row["occurrence_date"])[:10])] = row.get("completed_at")
        except Exception:
            pass
    na_pairs = _fetch_checklist_na_pairs(task_ids, range_start, range_end)
    holidays_set: set[date] = set()
    for yr in (range_start.year, range_end.year):
        holidays_set.update(_get_holidays_for_year(yr))
    is_holiday = lambda d, h=holidays_set: d in h
    doer_map: dict = {}
    try:
        pr = supabase.table("user_profiles").select("id, full_name").eq("id", user_id).limit(1).execute()
        if pr.data:
            doer_map[user_id] = pr.data[0].get("full_name", "")
    except Exception:
        pass
    occurrences: list[dict] = []
    for task in tasks:
        if _checklist_row_marked_na(task):
            continue
        t_id = str(task["id"])
        start = task.get("start_date")
        if isinstance(start, str):
            start = date.fromisoformat(start)
        freq = task.get("frequency", "D")
        dates = get_occurrence_dates_in_range(start, freq, range_start, range_end, is_holiday)
        for d in dates:
            od = d.isoformat()
            if (t_id, od) in na_pairs:
                continue
            completed_at = comp.get((t_id, od))
            if only_uncompleted and completed_at:
                continue
            occurrences.append({
                "task_id": t_id,
                "task_name": task.get("task_name", ""),
                "reference_no": task.get("reference_no"),
                "doer_id": task.get("doer_id"),
                "doer_name": doer_map.get(task.get("doer_id"), ""),
                "department": task.get("department", ""),
                "occurrence_date": od,
                "completed_at": completed_at,
            })
    occurrences.sort(key=lambda x: (x["occurrence_date"], x["task_name"]))
    return occurrences


@api_router.get("/checklist/departments")
def list_checklist_departments(auth: dict = Depends(get_current_user)):
    """List departments for checklist dropdown (from checklist_departments table)."""
    return {"departments": _get_checklist_departments()}


@api_router.get("/checklist/holidays")
def list_checklist_holidays(year: int = Query(...), auth: dict = Depends(get_current_user)):
    """List holidays for a year."""
    try:
        r = supabase.table("checklist_holidays").select("holiday_date, holiday_name").eq("year", year).order("holiday_date").execute()
        return {"holidays": r.data or []}
    except Exception as e:
        return {"holidays": []}


class HolidayUploadItem(BaseModel):
    holiday_date: str  # YYYY-MM-DD
    holiday_name: str


class HolidayUploadRequest(BaseModel):
    year: int
    holidays: list[HolidayUploadItem]


@api_router.post("/checklist/holidays/upload")
def upload_holiday_list(payload: HolidayUploadRequest, auth: dict = Depends(require_roles(["admin", "master_admin"]))):
    """Upload holiday list for a year. Available from Dec 15 for next year."""
    today = date.today()
    if today.month < 12 or today.day < 15:
        raise HTTPException(400, "Holiday list upload available from December 15th for the next year.")
    if payload.year <= today.year:
        raise HTTPException(400, "Can only upload holiday list for next year (after Dec 15).")
    rows = [{"holiday_date": h.holiday_date, "holiday_name": h.holiday_name, "year": payload.year} for h in payload.holidays]
    try:
        supabase.table("checklist_holidays").upsert(rows, on_conflict="holiday_date,year").execute()
        return {"success": True, "count": len(rows)}
    except Exception as e:
        raise HTTPException(400, str(e)[:200])


@api_router.post("/checklist/tasks")
def create_checklist_task(payload: CreateChecklistTaskRequest, auth: dict = Depends(get_current_user)):
    """Create a checklist task. Doer is the logged-in user."""
    allowed = _get_checklist_departments()
    if payload.department not in allowed:
        raise HTTPException(400, f"Invalid department. Use one of: {allowed}")
    if payload.frequency not in ("D", "2D", "W", "2W", "M", "Q", "F", "Y"):
        raise HTTPException(400, "Frequency must be D, 2D, W, 2W, M, Q, F or Y")
    try:
        start_d = date.fromisoformat(payload.start_date)
    except ValueError:
        raise HTTPException(400, "Invalid start_date. Use YYYY-MM-DD")
    data = {
        "task_name": payload.task_name,
        "doer_id": auth["id"],
        "department": payload.department,
        "frequency": payload.frequency,
        "start_date": payload.start_date,
        "created_by": auth["id"],
    }
    try:
        pr = supabase.table("user_profiles").select("full_name").eq("id", auth["id"]).limit(1).execute()
        name = (pr.data or [{}])[0].get("full_name") or "USER"
        prefix = "".join(c for c in name.upper() if c.isalnum())[:6] or "USER"
        prefix = prefix[:6]
        existing = supabase.table("checklist_tasks").select("reference_no").like("reference_no", f"CHK-{prefix}-%").execute()
        nums = []
        for row in (existing.data or []):
            ref = row.get("reference_no") or ""
            if ref.startswith(f"CHK-{prefix}-"):
                try:
                    nums.append(int(ref.split("-")[-1]))
                except ValueError:
                    pass
        next_num = max(nums, default=0) + 1
        data["reference_no"] = f"CHK-{prefix}-{next_num:03d}"
    except Exception as e:
        _log(f"checklist reference_no fallback: {e}")
        import uuid
        data["reference_no"] = f"CHK-{str(uuid.uuid4())[:8].upper()}"
    try:
        r = supabase.table("checklist_tasks").insert(data).execute()
        return r.data[0] if r.data else {}
    except Exception as e:
        _log(f"checklist create_task error: {e}")
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(503, "Checklist tables not set up. Run database/CHECKLIST_MODULE.sql in Supabase SQL Editor.")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/checklist/tasks")
def list_checklist_tasks(
    user_id: str | None = Query(None),
    reference_no: str | None = Query(None),
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """List checklist tasks. Default: logged-in user's tasks. Admin/Master can pass user_id to see that user, or see all if explicitly requested."""
    try:
        role = current.get("role", "user")
        if role not in ("admin", "master_admin"):
            user_id = auth["id"]
        elif user_id is None:
            user_id = auth["id"]  # default to own tasks for admins too
        cols = "id, task_name, doer_id, department, frequency, start_date, created_by, created_at, reference_no"
        q = supabase.table("checklist_tasks").select(cols)
        if user_id:
            q = q.eq("doer_id", user_id)
        if reference_no:
            q = q.eq("reference_no", reference_no)
        r = q.order("created_at", desc=True).limit(500).execute()
        tasks = r.data or []
        doer_ids = list({t["doer_id"] for t in tasks if t.get("doer_id")})
        doer_map = {}
        if doer_ids:
            try:
                pr = supabase.table("user_profiles").select("id, full_name").in_("id", doer_ids).execute()
                doer_map = {p["id"]: p.get("full_name", "") for p in (pr.data or [])}
            except Exception:
                pass
        for t in tasks:
            t["doer_name"] = doer_map.get(t.get("doer_id"), "")
        return {"tasks": tasks}
    except Exception as e:
        _log(f"checklist/tasks error: {e}")
        return {"tasks": []}


@api_router.get("/checklist/occurrences")
def list_checklist_occurrences(
    filter_type: str = Query("today", alias="filter"),
    user_id: str | None = Query(None),
    reference_no: str | None = Query(None),
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """
    Get checklist occurrences. filter: today|completed|overdue|upcoming.
    Default: logged-in user's tasks. Admin can pass user_id to see that user.
    Occurrences marked NA are excluded.
    """
    try:
        role = current.get("role", "user")
        if role not in ("admin", "master_admin"):
            user_id = auth["id"]
        elif user_id is None:
            user_id = auth["id"]
        today = date.today()
        if filter_type == "today":
            range_start, range_end = today, today
        elif filter_type == "completed":
            range_start = today - timedelta(days=365)
            range_end = today
        elif filter_type == "overdue":
            range_start = today - timedelta(days=365)
            range_end = today - timedelta(days=1)
        else:
            range_start = today + timedelta(days=1)
            range_end = today + timedelta(days=90)
        occurrences = _checklist_occurrences_for_user(
            str(user_id),
            range_start,
            range_end,
            reference_no=reference_no,
            only_uncompleted=False,
        )
        if filter_type == "completed":
            occurrences = [o for o in occurrences if o.get("completed_at")]
        elif filter_type == "overdue":
            occurrences = [o for o in occurrences if not o.get("completed_at")]
        elif filter_type == "upcoming":
            occurrences = [o for o in occurrences if not o.get("completed_at")]
        if len(occurrences) > 1000:
            occurrences = occurrences[:1000]
        return {"occurrences": occurrences}
    except Exception as e:
        _log(f"checklist/occurrences error: {e}")
        return {"occurrences": []}


@api_router.get("/checklist/na-active")
def list_checklist_na_active(
    user_id: str | None = Query(None),
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """One row per active checklist task for NA_Checklist (universal Mark NA per task)."""
    if not _checklist_na_supported():
        raise HTTPException(
            400,
            "Checklist NA is not enabled. Run database/CHECKLIST_OCCURRENCE_NA.sql in Supabase, then retry.",
        )
    role = current.get("role", "user")
    if role not in ("admin", "master_admin"):
        user_id = auth["id"]
    elif user_id is None:
        user_id = auth["id"]
    today = date.today()
    today_rows = _checklist_occurrences_for_user(str(user_id), today, today, only_uncompleted=True)
    overdue_rows = _checklist_occurrences_for_user(
        str(user_id), today - timedelta(days=365), today - timedelta(days=1), only_uncompleted=True
    )
    upcoming_rows = _checklist_occurrences_for_user(
        str(user_id), today + timedelta(days=1), today + timedelta(days=90), only_uncompleted=True
    )
    by_task: dict[str, dict] = {}
    for row in today_rows + overdue_rows + upcoming_rows:
        tid = str(row["task_id"])
        if tid not in by_task:
            by_task[tid] = {
                "task_id": tid,
                "task_name": row.get("task_name", ""),
                "reference_no": row.get("reference_no"),
                "department": row.get("department", ""),
                "doer_id": row.get("doer_id"),
                "doer_name": row.get("doer_name", ""),
                "pending_count": 0,
                "has_today": False,
                "has_overdue": False,
                "has_upcoming": False,
            }
        ent = by_task[tid]
        ent["pending_count"] = int(ent["pending_count"]) + 1
        od = row.get("occurrence_date", "")
        if od == today.isoformat():
            ent["has_today"] = True
        elif od and od < today.isoformat():
            ent["has_overdue"] = True
        else:
            ent["has_upcoming"] = True
    tasks_out = sorted(by_task.values(), key=lambda x: (x.get("reference_no") or "", x.get("task_name") or ""))
    doer_name = tasks_out[0].get("doer_name", "") if tasks_out else ""
    if not doer_name:
        try:
            pr = supabase.table("user_profiles").select("full_name").eq("id", user_id).limit(1).execute()
            doer_name = (pr.data or [{}])[0].get("full_name", "")
        except Exception:
            pass
    return {
        "tasks": tasks_out,
        "count": len(tasks_out),
        "doer_name": doer_name,
        "user_id": str(user_id),
        "items": [],
    }


class MarkChecklistNaRequest(BaseModel):
    occurrence_date: str | None = None  # ignored — whole-task NA


@api_router.post("/checklist/tasks/{task_id}/mark-na")
def mark_checklist_task_na(
    task_id: str,
    payload: MarkChecklistNaRequest | None = None,
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """Mark entire checklist task as NA — all dates hidden; all completion rows deleted."""
    if not _checklist_na_supported():
        raise HTTPException(
            400,
            "Checklist NA is not enabled. Run database/CHECKLIST_OCCURRENCE_NA.sql in Supabase, then retry.",
        )
    try:
        task = (
            supabase.table("checklist_tasks")
            .select("doer_id, task_name, reference_no, marked_na, na_from_date")
            .eq("id", task_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(404, "Task not found")
    if not task.data:
        raise HTTPException(404, "Task not found")
    if _checklist_row_marked_na(task.data):
        return {
            "success": True,
            "task_id": task_id,
            "already_marked_na": True,
            "reference_no": task.data.get("reference_no"),
            "task_name": task.data.get("task_name"),
        }
    doer_id = str(task.data.get("doer_id"))
    role = current.get("role", "user")
    if str(auth["id"]) != doer_id and role not in ("admin", "master_admin"):
        raise HTTPException(403, "Only the assigned doer or an admin can mark NA")
    today_str = date.today().isoformat()
    try:
        supabase.table("checklist_completions").delete().eq("task_id", task_id).execute()
    except Exception as e:
        _log(f"checklist mark-na delete all completions: {e}")
    update_row = {"marked_na": True, "na_from_date": today_str}
    try:
        supabase.table("checklist_tasks").update(update_row).eq("id", task_id).execute()
    except Exception as e:
        err = str(e).lower()
        if "marked_na" in err and ("does not exist" in err or "42703" in err):
            try:
                supabase.table("checklist_tasks").update({"na_from_date": today_str}).eq("id", task_id).execute()
            except Exception as e2:
                raise HTTPException(400, str(e2)[:200])
        else:
            raise HTTPException(400, str(e)[:200])
    invalidate_dashboard_read_caches()
    return {
        "success": True,
        "task_id": task_id,
        "marked_na": True,
        "reference_no": task.data.get("reference_no"),
        "task_name": task.data.get("task_name"),
    }


class CompleteChecklistRequest(BaseModel):
    occurrence_date: str  # YYYY-MM-DD


@api_router.post("/checklist/tasks/{task_id}/complete")
def complete_checklist_task(task_id: str, payload: CompleteChecklistRequest, auth: dict = Depends(get_current_user)):
    """Mark a task as completed for the given occurrence date (Submit)."""
    try:
        task = supabase.table("checklist_tasks").select("doer_id").eq("id", task_id).single().execute()
        if not task.data:
            raise HTTPException(404, "Task not found")
        if str(task.data["doer_id"]) != str(auth["id"]):
            raise HTTPException(403, "Only the assigned doer can complete this task")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(404, "Task not found")
    data = {
        "task_id": task_id,
        "occurrence_date": payload.occurrence_date,
        "completed_by": auth["id"],
    }
    try:
        supabase.table("checklist_completions").upsert(data, on_conflict="task_id,occurrence_date").execute()
        invalidate_dashboard_read_caches()
        return {"success": True, "message": "Task marked as completed"}
    except Exception as e:
        raise HTTPException(400, str(e)[:200])


@api_router.get("/checklist/users")
def list_checklist_users(auth: dict = Depends(get_current_user), current: dict = Depends(get_current_user_with_role)):
    """List users for admin name filter (Master Admin & Admin only)."""
    if current.get("role") not in ("admin", "master_admin"):
        return {"users": []}
    try:
        r = (
            supabase.table("user_profiles")
            .select("id, full_name")
            .eq("is_active", True)
            .order("full_name")
            .limit(500)
            .execute()
        )
        return {"users": r.data or []}
    except Exception:
        return {"users": []}


# ---------------------------------------------------------------------------
# Delegation Tasks (Task module – separate from Support)
# ---------------------------------------------------------------------------
class CreateDelegationTaskRequest(BaseModel):
    title: str  # Task Name
    assignee_id: str
    due_date: str
    delegation_on: str | None = None
    submission_date: str | None = None
    has_document: str | None = None  # 'yes' | 'no'
    document_url: str | None = None
    submitted_by: str | None = None


@api_router.get("/delegation/users")
def list_delegation_users(auth: dict = Depends(get_current_user), current: dict = Depends(get_current_user_with_role)):
    """List active users for Submitted By / assignee dropdowns (all authenticated users)."""
    try:
        r = (
            supabase.table("user_profiles")
            .select("id, full_name")
            .eq("is_active", True)
            .order("full_name")
            .limit(500)
            .execute()
        )
        return {"users": r.data or []}
    except Exception:
        return {"users": []}


@api_router.get("/delegation/tasks")
def list_delegation_tasks(
    status: str | None = Query(None),
    assignee_id: str | None = Query(None),
    reference_no: str | None = Query(None),
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """List delegation tasks. Default status=pending. By default show logged-in user's tasks; Admin/Master can choose another user or All."""
    try:
        cols = "id, title, assignee_id, due_date, status, created_at, delegation_on, submission_date, has_document, document_url, submitted_by, reference_no, completed_at"
        q = supabase.table("delegation_tasks").select(cols)
        role = current.get("role", "user")
        if role not in ("admin", "master_admin", "approver"):
            q = q.eq("assignee_id", auth["id"])
        else:
            # Admin / Master Admin / Approver: default to own tasks; explicit assignee_id = that user; __all__ = all tasks
            if assignee_id and assignee_id != "__all__":
                q = q.eq("assignee_id", assignee_id)
            elif not assignee_id:
                q = q.eq("assignee_id", auth["id"])
            # else assignee_id == "__all__": no assignee filter, show all users' tasks
        # Default pending; send status='all' to see all tasks
        if status == "all":
            pass
        else:
            q = q.eq("status", status or "pending")
        if reference_no:
            q = q.eq("reference_no", reference_no)
        r = q.order("due_date", desc=False).limit(500).execute()
        tasks = r.data or []
        assignee_ids = {t["assignee_id"] for t in tasks if t.get("assignee_id")}
        submitted_by_ids = {t["submitted_by"] for t in tasks if t.get("submitted_by")}
        all_user_ids = assignee_ids | submitted_by_ids
        user_map = {}
        if all_user_ids:
            try:
                pr = supabase.table("user_profiles").select("id, full_name").in_("id", list(all_user_ids)).execute()
                user_map = {p["id"]: p.get("full_name", "") for p in (pr.data or [])}
            except Exception as e:
                _log(f"delegation/tasks: failed to load user profiles for ids={list(all_user_ids)[:5]}...: {e}")
        for t in tasks:
            t["assignee_name"] = user_map.get(t.get("assignee_id"), "")
            t["submitted_by_name"] = user_map.get(t.get("submitted_by"), "")
        # When showing all users' tasks: group by Submitted By first, then by due_date
        tasks.sort(key=lambda t: (
            (t.get("submitted_by_name") or "").strip().lower(),
            t.get("due_date") or "",
            t.get("created_at") or "",
        ))
        return {"tasks": tasks}
    except Exception as e:
        _log(f"delegation/tasks error: {e}")
        return {"tasks": []}


@api_router.post("/delegation/tasks")
def create_delegation_task(payload: CreateDelegationTaskRequest, auth: dict = Depends(get_current_user)):
    """Create a delegation task."""
    try:
        date.fromisoformat(payload.due_date)
    except ValueError:
        raise HTTPException(400, "Invalid due_date. Use YYYY-MM-DD")
    for field_name, val in [("delegation_on", payload.delegation_on), ("submission_date", payload.submission_date)]:
        if val:
            try:
                date.fromisoformat(val)
            except ValueError as err:
                raise HTTPException(400, f"Invalid {field_name}. Use YYYY-MM-DD") from err
    data = {
        "title": payload.title,
        "assignee_id": payload.assignee_id,
        "due_date": payload.due_date,
        "created_by": auth["id"],
    }
    if payload.delegation_on:
        data["delegation_on"] = payload.delegation_on
    if payload.submission_date:
        data["submission_date"] = payload.submission_date
    if payload.has_document:
        data["has_document"] = payload.has_document
    if payload.document_url:
        data["document_url"] = payload.document_url
    if payload.submitted_by:
        data["submitted_by"] = payload.submitted_by
    # Generate unique reference_no based on submitted_by user name (e.g. DEL-AMAN-001)
    try:
        pr = supabase.table("user_profiles").select("full_name").eq("id", payload.submitted_by or payload.assignee_id).limit(1).execute()
        name = (pr.data or [{}])[0].get("full_name") or "USER"
        prefix = "".join(c for c in name.upper() if c.isalnum())[:6] or "USER"
        prefix = prefix[:6]
        existing = supabase.table("delegation_tasks").select("reference_no").like("reference_no", f"DEL-{prefix}-%").execute()
        nums = []
        for row in (existing.data or []):
            ref = row.get("reference_no") or ""
            if ref.startswith(f"DEL-{prefix}-"):
                try:
                    nums.append(int(ref.split("-")[-1]))
                except ValueError:
                    pass
        next_num = max(nums, default=0) + 1
        data["reference_no"] = f"DEL-{prefix}-{next_num:03d}"
    except Exception as e:
        _log(f"delegation reference_no fallback: {e}")
        import uuid
        data["reference_no"] = f"DEL-{str(uuid.uuid4())[:8].upper()}"
    try:
        r = supabase.table("delegation_tasks").insert(data).execute()
        return r.data[0] if r.data else {}
    except Exception as e:
        _log(f"delegation create error: {e}")
        err = str(e).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(503, "Delegation table not set up. Run database/DELEGATION_AND_PENDING_REMINDER.sql in Supabase.")
        raise HTTPException(400, str(e)[:200])


@api_router.put("/delegation/tasks/{task_id}")
def update_delegation_task(task_id: str, payload: dict, auth: dict = Depends(get_current_user), current: dict = Depends(get_current_user_with_role)):
    """Update delegation task. Only Master Admin can edit fields other than status. Status complete/cancel allowed for assignee or admin."""
    from datetime import datetime, timezone
    role = current.get("role", "user")
    allowed_all = {"status", "title", "due_date", "assignee_id", "delegation_on", "submission_date", "has_document", "document_url", "submitted_by", "completed_at"}
    data = {}
    status_only = set(payload.keys()) <= {"status", "document_url"}
    if role == "master_admin":
        data = {k: v for k, v in payload.items() if k in allowed_all and v is not None}
    else:
        if not status_only:
            raise HTTPException(403, "Only Master Admin can edit task fields. You can only Complete or Cancel.")
        # Assignee or Admin can complete/cancel
        task_row = supabase.table("delegation_tasks").select("assignee_id, has_document").eq("id", task_id).limit(1).execute()
        if not task_row.data:
            raise HTTPException(404, "Task not found")
        assignee_id = task_row.data[0].get("assignee_id")
        has_document = task_row.data[0].get("has_document")
        if payload.get("status") == "completed" and has_document == "yes" and not payload.get("document_url"):
            raise HTTPException(400, "Document is required. Please upload the document before completing.")
        if role not in ("admin", "master_admin") and assignee_id != auth["id"]:
            raise HTTPException(403, "You can only complete or cancel your own assigned tasks.")
        if "status" in payload and payload["status"] in ("completed", "cancelled"):
            data["status"] = payload["status"]
        if "document_url" in payload and payload["document_url"]:
            data["document_url"] = payload["document_url"]
    if payload.get("status") == "completed":
        data["completed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not data:
        raise HTTPException(400, "No valid fields to update")
    try:
        r = supabase.table("delegation_tasks").update(data).eq("id", task_id).execute()
        invalidate_dashboard_read_caches()
        return r.data[0] if r.data else {}
    except Exception as e:
        raise HTTPException(400, str(e)[:200])


# ---------------------------------------------------------------------------
# Client to Lead – Leads (multi-stage workflow)
# ---------------------------------------------------------------------------
LEAD_STAGE_ORDER = [
    "lead_details",
    "contacted",
    "brochure",
    "demo_schedule",
    "demo_completed",
    "google_form",
    "offer_letter",
    "po",
    "performa_invoice",
    "implementation_invoice",
    "whatsapp_group",
    "setup_data",
    "account_setup",
    "item_setup",
    "training_stage",
    "first_invoice",
    "first_invoice_payment",
    "final_closing",
]


class CreateLeadRequest(BaseModel):
    company_name: str
    stage: str
    assigned_poc_id: str | None = None
    status: str = "Open"


@api_router.get("/leads/stages")
def list_lead_stages(auth: dict = Depends(get_current_user)):
    """Stage dropdown options from DB (lead_stages table)."""
    try:
        r = supabase.table("lead_stages").select("name").order("display_order").execute()
        return {"stages": [row["name"] for row in (r.data or [])]}
    except Exception as e:
        _log(f"leads/stages: {e}")
        return {"stages": [
            "Lead", "Contacted", "Brochure", "Demo Schedule", "Demo Completed",
            "Quotation", "PO", "Implementation Invoice", "Account Setup", "Item Setup",
            "Training", "First Invoice", "First Invoice Payment",
        ]}


@api_router.get("/leads/users")
def list_lead_users(auth: dict = Depends(get_current_user)):
    """List users for Assigned POC dropdown (user_profiles)."""
    try:
        r = supabase.table("user_profiles").select("id, full_name").eq("is_active", True).order("full_name").execute()
        return {"users": r.data or []}
    except Exception as e:
        _log(f"leads/users: {e}")
        return {"users": []}


def _generate_lead_reference_no(company_name: str) -> str:
    """First 4 letters of company name (UPPERCASE) + running number (e.g. COMP0001)."""
    prefix = (company_name or "LEAD")[:4].upper()
    if not prefix.isalnum():
        prefix = "LEAD"
    try:
        existing = supabase.table("leads").select("reference_no").ilike("reference_no", f"{prefix}%").execute()
        nums = []
        for row in (existing.data or []):
            ref = (row.get("reference_no") or "").strip()
            if ref.startswith(prefix) and len(ref) > len(prefix):
                try:
                    nums.append(int(ref[len(prefix):]))
                except ValueError:
                    pass
        next_num = max(nums, default=0) + 1
        return f"{prefix}{next_num:04d}"
    except Exception as e:
        _log(f"lead reference_no: {e}")
        import uuid
        return f"{prefix}{str(uuid.uuid4())[:4].upper()}"


@api_router.post("/leads")
def create_lead(payload: CreateLeadRequest, auth: dict = Depends(get_current_user)):
    """Create lead. Auto-generates reference_no and timestamp."""
    company_name = (payload.company_name or "").strip() or "Test"
    stage = (payload.stage or "Lead").strip()
    reference_no = _generate_lead_reference_no(company_name)
    status = (payload.status or "Open").strip()
    if status not in ("Open", "Closed"):
        status = "Open"
    data = {
        "company_name": company_name,
        "stage": stage,
        "reference_no": reference_no,
        "status": status,
        "created_by": auth["id"],
    }
    if payload.assigned_poc_id:
        data["assigned_poc_id"] = payload.assigned_poc_id
    try:
        r = supabase.table("leads").insert(data).execute()
        return r.data[0] if r.data else {}
    except Exception as e:
        _log(f"leads create: {e}")
        if "does not exist" in str(e).lower() or "relation" in str(e).lower():
            raise HTTPException(503, "Leads table not set up. Run database/CLIENT_TO_LEAD_LEADS.sql in Supabase.")
        raise HTTPException(400, str(e)[:200])


@api_router.get("/leads")
def list_leads(
    status: str | None = Query(None),
    company: str | None = Query(None, description="Filter by company name (partial match)"),
    stage: str | None = Query(None, description="Filter by stage"),
    reference_no: str | None = Query(None, description="Filter by reference number (partial match)"),
    date_from: str | None = Query(None, description="Filter created_at from date YYYY-MM-DD"),
    date_to: str | None = Query(None, description="Filter created_at to date YYYY-MM-DD"),
    auth: dict = Depends(get_current_user),
):
    """List leads with optional filters: status, company, stage, reference_no, date_from, date_to."""
    try:
        q = supabase.table("leads").select("id, company_name, stage, assigned_poc_id, reference_no, status, created_at").order("reference_no", desc=True).order("created_at", desc=True)
        if status:
            q = q.eq("status", status)
        if company and company.strip():
            safe_company = _sanitize_ilike_input(company, max_len=120)
            if safe_company:
                q = q.ilike("company_name", f"%{safe_company}%")
        if stage and stage.strip():
            q = q.eq("stage", stage.strip())
        if reference_no and reference_no.strip():
            safe_reference = _sanitize_ilike_input(reference_no, max_len=80)
            if safe_reference:
                q = q.ilike("reference_no", f"%{safe_reference}%")
        if date_from and date_from.strip():
            q = q.gte("created_at", date_from.strip() + "T00:00:00")
        if date_to and date_to.strip():
            q = q.lte("created_at", date_to.strip() + "T23:59:59.999999")
        r = q.execute()
        rows = r.data or []
        poc_ids = {row["assigned_poc_id"] for row in rows if row.get("assigned_poc_id")}
        if poc_ids:
            try:
                pr = supabase.table("user_profiles").select("id, full_name").in_("id", list(poc_ids)).execute()
                poc_map = {p["id"]: p.get("full_name", "") for p in (pr.data or [])}
            except Exception:
                poc_map = {}
        else:
            poc_map = {}
        for row in rows:
            row["assigned_poc_name"] = poc_map.get(row.get("assigned_poc_id"), "")
        return {"leads": rows}
    except Exception as e:
        _log(f"leads list: {e}")
        if "does not exist" in str(e).lower():
            return {"leads": []}
        raise HTTPException(500, str(e)[:200])


@api_router.get("/leads/by-reference/{reference_no}")
def get_lead_by_reference(reference_no: str, auth: dict = Depends(get_current_user)):
    """Get single lead by reference number (e.g. DEMO0001). Used for pretty URLs."""
    try:
        r = supabase.table("leads").select("*").eq("reference_no", reference_no).execute()
        rows = r.data or []
        if not rows:
            raise HTTPException(404, "Lead not found")
        lead = rows[0]
        lead_id = lead["id"]
        stage_r = supabase.table("lead_stage_data").select("stage_slug, data, updated_at").eq("lead_id", lead_id).execute()
        by_slug = {row["stage_slug"]: {"data": row.get("data") or {}, "updated_at": row.get("updated_at")} for row in (stage_r.data or [])}
        lead["stage_data"] = by_slug
        if lead.get("assigned_poc_id"):
            try:
                pr = supabase.table("user_profiles").select("id, full_name").eq("id", lead["assigned_poc_id"]).single().execute()
                lead["assigned_poc_name"] = pr.data.get("full_name", "") if pr.data else ""
            except Exception:
                lead["assigned_poc_name"] = ""
        else:
            lead["assigned_poc_name"] = ""
        return lead
    except HTTPException:
        raise
    except Exception as e:
        _log(f"leads get by reference: {e}")
        raise HTTPException(500, str(e)[:200])


@api_router.get("/leads/active")
def list_active_leads_for_dashboard(auth: dict = Depends(get_current_user)):
    """Active (Open) leads with flattened person_name, city, state for dashboard table."""
    try:
        q = supabase.table("leads").select("id, company_name, stage, assigned_poc_id, reference_no").eq("status", "Open").order("created_at", desc=True)
        r = q.execute()
        rows = r.data or []
        if not rows:
            return {"leads": []}
        lead_ids = [row["id"] for row in rows]
        poc_ids = {row["assigned_poc_id"] for row in rows if row.get("assigned_poc_id")}
        poc_map = {}
        if poc_ids:
            try:
                pr = supabase.table("user_profiles").select("id, full_name").in_("id", list(poc_ids)).execute()
                poc_map = {p["id"]: p.get("full_name", "") for p in (pr.data or [])}
            except Exception:
                pass
        stage_r = supabase.table("lead_stage_data").select("lead_id, stage_slug, data").in_("lead_id", lead_ids).execute()
        stage_rows = stage_r.data or []
        by_lead: dict = {}
        for s in stage_rows:
            lid = s.get("lead_id")
            if not lid:
                continue
            if lid not in by_lead:
                by_lead[lid] = {}
            data = s.get("data") or {}
            if isinstance(data, dict):
                by_lead[lid][s.get("stage_slug", "")] = data
        out = []
        for row in rows:
            lid = row["id"]
            lead_details = (by_lead.get(lid) or {}).get("lead_details") or {}
            contacted = (by_lead.get(lid) or {}).get("contacted") or {}
            person_name = lead_details.get("person_name") if isinstance(lead_details, dict) else ""
            city = contacted.get("city") if isinstance(contacted, dict) else ""
            state = contacted.get("state") if isinstance(contacted, dict) else ""
            out.append({
                "id": row["id"],
                "reference_no": row.get("reference_no", ""),
                "company_name": row.get("company_name", ""),
                "stage": row.get("stage", ""),
                "assigned_poc_name": poc_map.get(row.get("assigned_poc_id"), ""),
                "person_name": person_name or "",
                "city": city or "",
                "state": state or "",
            })
        return {"leads": out}
    except Exception as e:
        _log(f"leads/active: {e}")
        if "does not exist" in str(e).lower():
            return {"leads": []}
        raise HTTPException(500, str(e)[:200])


@api_router.get("/leads/{lead_id}")
def get_lead(lead_id: str, auth: dict = Depends(get_current_user)):
    """Get single lead with all stage data."""
    try:
        r = supabase.table("leads").select("*").eq("id", lead_id).single().execute()
        if not r.data:
            raise HTTPException(404, "Lead not found")
        lead = r.data
        stage_r = supabase.table("lead_stage_data").select("stage_slug, data, updated_at").eq("lead_id", lead_id).execute()
        by_slug = {row["stage_slug"]: {"data": row.get("data") or {}, "updated_at": row.get("updated_at")} for row in (stage_r.data or [])}
        lead["stage_data"] = by_slug
        if lead.get("assigned_poc_id"):
            try:
                pr = supabase.table("user_profiles").select("id, full_name").eq("id", lead["assigned_poc_id"]).single().execute()
                lead["assigned_poc_name"] = pr.data.get("full_name", "") if pr.data else ""
            except Exception:
                lead["assigned_poc_name"] = ""
        else:
            lead["assigned_poc_name"] = ""
        return lead
    except HTTPException:
        raise
    except Exception as e:
        _log(f"leads get: {e}")
        raise HTTPException(500, str(e)[:200])


def _lead_next_stage_slug(lead_id: str) -> str | None:
    """Return the next stage_slug that is not yet filled for this lead."""
    try:
        r = supabase.table("lead_stage_data").select("stage_slug").eq("lead_id", lead_id).execute()
        filled = {row["stage_slug"] for row in (r.data or [])}
        for slug in LEAD_STAGE_ORDER:
            if slug not in filled:
                return slug
        return None
    except Exception:
        return LEAD_STAGE_ORDER[0]


def _lead_editable_by_user(lead_id: str, current_role: str) -> bool:
    """For role 'user', lead is editable only within 4 hours of lead creation. Admin/approver/master_admin can always edit."""
    if current_role not in ("user",):
        return True
    try:
        lead_r = supabase.table("leads").select("created_at").eq("id", lead_id).single().execute()
        if not lead_r.data or not lead_r.data.get("created_at"):
            return True
        created_str = lead_r.data["created_at"]
        if isinstance(created_str, str):
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
        else:
            return True
        now = datetime.now(timezone.utc)
        delta = now - created_dt
        return delta.total_seconds() <= 4 * 3600
    except Exception:
        return True


@api_router.put("/leads/{lead_id}/stages/{stage_slug}")
def upsert_lead_stage(
    lead_id: str,
    stage_slug: str,
    payload: dict,
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """Upsert stage data. Validates sequential order: previous stage must be filled first. User role: not editable after 4 hours from lead creation."""
    if not _lead_editable_by_user(lead_id, current.get("role", "user")):
        raise HTTPException(403, "This lead can no longer be edited (4-hour limit for User role).")
    if stage_slug not in LEAD_STAGE_ORDER:
        raise HTTPException(400, f"Invalid stage: {stage_slug}")
    try:
        lead_r = supabase.table("leads").select("id").eq("id", lead_id).single().execute()
        if not lead_r.data:
            raise HTTPException(404, "Lead not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)[:200])
    idx = LEAD_STAGE_ORDER.index(stage_slug)
    for i in range(idx):
        prev_slug = LEAD_STAGE_ORDER[i]
        r = supabase.table("lead_stage_data").select("id").eq("lead_id", lead_id).eq("stage_slug", prev_slug).execute()
        if not r.data or len(r.data) == 0:
            raise HTTPException(400, f"Complete the previous stage '{prev_slug}' first.")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    # Merge payload into existing stage data so partial saves don't wipe other fields
    existing_data = {}
    try:
        stage_r = supabase.table("lead_stage_data").select("data").eq("lead_id", lead_id).eq("stage_slug", stage_slug).execute()
        if stage_r.data and len(stage_r.data) > 0 and isinstance(stage_r.data[0].get("data"), dict):
            existing_data = stage_r.data[0]["data"]
    except Exception:
        pass
    merged_data = {**existing_data, **payload}
    row = {"lead_id": lead_id, "stage_slug": stage_slug, "data": merged_data, "updated_at": now}
    try:
        supabase.table("lead_stage_data").upsert(row, on_conflict="lead_id,stage_slug").execute()
        return {"success": True, "stage_slug": stage_slug}
    except Exception as e:
        _log(f"leads stage upsert: {e}")
        raise HTTPException(400, str(e)[:200])


@api_router.patch("/leads/{lead_id}")
def update_lead(
    lead_id: str,
    payload: dict,
    auth: dict = Depends(get_current_user),
    current: dict = Depends(get_current_user_with_role),
):
    """Update lead (e.g. stage, status). User role: not editable after 4 hours from lead creation."""
    if not _lead_editable_by_user(lead_id, current.get("role", "user")):
        raise HTTPException(403, "This lead can no longer be edited (4-hour limit for User role).")
    allowed = {"stage", "status", "assigned_poc_id", "company_name"}
    data = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if not data:
        raise HTTPException(400, "No valid fields to update")
    try:
        r = supabase.table("leads").update(data).eq("id", lead_id).execute()
        return r.data[0] if r.data else {}
    except Exception as e:
        raise HTTPException(400, str(e)[:200])


def _cron_secret_matches(request: Request) -> bool:
    """Accept any configured cron secret (shared across reminder jobs)."""
    hdr = (request.headers.get("X-Cron-Secret") or request.headers.get("x-cron-secret") or "").strip()
    auth_hdr = (request.headers.get("Authorization") or request.headers.get("authorization") or "").strip()
    bearer = auth_hdr[7:].strip() if auth_hdr.lower().startswith("bearer ") else ""
    query_secret = (request.query_params.get("secret") or "").strip()
    for key in (
        "CHECKLIST_CRON_SECRET",
        "FEATURE_APPROVAL_CRON_SECRET",
        "NOTIFICATION_CRON_SECRET",
        "DELEGATION_CRON_SECRET",
        "PENDING_REMINDER_CRON_SECRET",
        "ESCALATION_CRON_SECRET",
    ):
        secret = (os.getenv(key) or "").strip()
        if secret and (hdr == secret or bearer == secret or query_secret == secret):
            return True
    return False


def _cron_email_started_response(job_label: str) -> dict:
    """Immediate HTTP response for cron-job.org (avoids 30s client timeout)."""
    return {
        "status": "started",
        "ok": True,
        "message": (
            f"{job_label} started in background. "
            "cron-job.org should show Success within a few seconds. "
            "Check Render logs for emails_sent and Postmark errors."
        ),
    }


async def _send_checklist_reminder_email(to_email: str, task_names: list[str], doer_name: str) -> tuple[bool, str | None]:
    """Send reminder email via Postmark API. Returns (ok, error)."""
    to_email = (to_email or "").strip()
    if not to_email:
        return False, "No recipient email"

    from app.checklist_delegation_email_templates import build_checklist_reminder_html
    from app.utils.email import send_email_detail

    html_content, plain_fallback = build_checklist_reminder_html(doer_name, task_names)

    ok, err = await send_email_detail(
        to_email=to_email,
        subject="Checklist: Tasks due today",
        html_content=html_content,
        plain_fallback=plain_fallback,
    )
    if ok:
        _log(f"Checklist reminder sent to {to_email}")
    return ok, err


async def _run_checklist_reminders_impl(*, force_resend: bool = False) -> dict:
    """Run checklist daily reminders; returns summary for cron HTTP response."""
    try:
        from app.checklist_utils import get_occurrence_dates
        from app.email_working_day import cron_email_skip_response, should_skip_cron_emails

        skip, skip_reason = should_skip_cron_emails(force=force_resend)
        if skip:
            _log(f"Checklist reminder skipped: {skip_reason}")
            return cron_email_skip_response(skip_reason, module="checklist_daily")
        today = date.today()
        try:
            q = supabase.table("checklist_tasks").select("*")
            if _checklist_na_supported():
                q = q.or_("marked_na.is.null,marked_na.eq.false")
            r = q.execute()
            tasks = [t for t in (r.data or []) if not _checklist_row_marked_na(t)]
        except Exception as e:
            _log(f"checklist reminder: task query filter: {e}")
            r = supabase.table("checklist_tasks").select("*").execute()
            tasks = [t for t in (r.data or []) if not _checklist_row_marked_na(t)]
        doer_ids = list({str(t.get("doer_id", "")) for t in tasks if t.get("doer_id")})
        user_map = {}
        if doer_ids:
            try:
                profiles_r = supabase.table("user_profiles").select("id, email, full_name").in_("id", doer_ids).execute()
                for p in (profiles_r.data or []):
                    uid = str(p.get("id", ""))
                    email_val = (p.get("email") or "").strip()
                    user_map[uid] = {"email": email_val, "name": p.get("full_name") or "User"}
            except Exception as e:
                _log(f"checklist reminder: user_profiles failed: {e}")
            need_auth = any(uid not in user_map or not (user_map.get(uid) or {}).get("email") for uid in doer_ids)
            if need_auth:
                try:
                    auth_r = supabase.auth.admin.list_users(per_page=1000)
                    auth_users = getattr(auth_r, "users", []) or []
                    prof_r = supabase.table("user_profiles").select("id, full_name").in_("id", doer_ids).execute()
                    profs = {str(x["id"]): x.get("full_name") or "User" for x in (prof_r.data or [])}
                    for u in auth_users:
                        uid = str(getattr(u, "id", "") or (u.get("id") if isinstance(u, dict) else ""))
                        em = (getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None) or "").strip()
                        if uid in doer_ids and (uid not in user_map or not (user_map.get(uid) or {}).get("email")):
                            user_map[uid] = {"email": em, "name": profs.get(uid, "User")}
                except Exception as e2:
                    _log(f"checklist reminder: auth fallback failed: {e2}")
        if force_resend:
            try:
                supabase.table("checklist_reminder_sent").delete().eq("reminder_date", today.isoformat()).execute()
            except Exception as e:
                _log(f"checklist reminder force_resend clear: {e}")
        try:
            sent_r = supabase.table("checklist_reminder_sent").select("user_id").eq("reminder_date", today.isoformat()).execute()
            already_sent = {str(row["user_id"]) for row in (sent_r.data or [])}
        except Exception as e:
            _log(f"checklist_reminder_sent missing? Run CHECKLIST_DELEGATION_REMINDER_SYSTEM.sql — {e}")
            already_sent = set()
        comp = {}
        try:
            cr = supabase.table("checklist_completions").select("task_id, occurrence_date").execute()
            for row in cr.data or []:
                od = row.get("occurrence_date")
                if isinstance(od, str) and "T" in od:
                    od = od[:10]
                comp[(str(row["task_id"]), od or "")] = True
        except Exception:
            pass
        by_user: dict[str, list[str]] = {}
        holidays = _get_holidays_for_year(today.year)
        task_ids_rem = [str(t.get("id")) for t in tasks if t.get("id")]
        na_pairs_today = _fetch_checklist_na_pairs(task_ids_rem, today, today)

        def is_holiday(d: date) -> bool:
            return d in holidays

        for task in tasks:
            t_id = task.get("id")
            if not t_id:
                continue
            if _checklist_occurrence_excluded_for_reminder(task, today, na_pairs_today):
                continue
            start = _parse_iso_date(task.get("start_date"))
            if not start:
                continue
            doer_id = str(task.get("doer_id", ""))
            if not doer_id or doer_id in already_sent:
                continue
            freq = task.get("frequency", "D") or "D"
            try:
                dates = get_occurrence_dates(start, freq, today.year, is_holiday)
            except Exception as ex:
                _log(f"checklist reminder: occurrence dates task={t_id}: {ex}")
                continue
            for d in dates:
                if d == today:
                    key = (str(t_id), d.isoformat())
                    if not comp.get(key):
                        by_user.setdefault(doer_id, []).append(task.get("task_name") or "Task")
                    break
        sent_count = 0
        failed: list[dict] = []
        for uid, names in by_user.items():
            if not names or uid in already_sent:
                continue
            u = user_map.get(uid, {})
            email = (u.get("email") or "").strip()
            name = u.get("name", "") or "User"
            if not email:
                continue
            ok_send, err = await _send_checklist_reminder_email(email, names, name)
            if ok_send:
                try:
                    supabase.table("checklist_reminder_sent").insert({
                        "user_id": uid,
                        "reminder_date": today.isoformat(),
                    }).execute()
                    sent_count += 1
                except Exception as e:
                    _log(f"checklist reminder: failed recording send for user_id={uid} date={today.isoformat()}: {e}")
            else:
                failed.append({"email": email, "error": err or "send failed"})
        _log(f"Checklist reminder: sent {sent_count} for {today.isoformat()}")
        pending_users = {uid for uid in by_user if uid not in already_sent}
        if not by_user:
            return {
                "status": "completed",
                "ok": True,
                "email_sent": False,
                "emails_sent": 0,
                "reason": "no_tasks_due_today",
                "message": "No checklist tasks due today for any user.",
            }
        if not pending_users and sent_count == 0:
            return {
                "status": "completed",
                "ok": True,
                "email_sent": False,
                "emails_sent": 0,
                "reason": "already_sent_today",
                "message": "No new email — checklist reminders already sent today (use ?force=true once to resend).",
            }
        if sent_count == 0 and failed:
            return _cron_email_failure_response(
                module="checklist_daily",
                failed=failed,
                sent_count=0,
                pending_users=len(pending_users),
            )
        if sent_count == 0 and pending_users:
            return {
                "status": "completed",
                "ok": True,
                "email_sent": False,
                "emails_sent": 0,
                "eligible_users": len(pending_users),
                "reason": "no_recipient_email",
                "message": "Users have due tasks but no email on file (check user_profiles / auth).",
            }
        return {
            "status": "completed",
            "ok": True,
            "email_sent": sent_count > 0,
            "emails_sent": sent_count,
            "eligible_users": len(pending_users),
            "message": f"Sent {sent_count} checklist reminder email(s).",
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"Checklist reminder error: {e!r}")
        import traceback

        _log(traceback.format_exc())
        return {
            "status": "error",
            "ok": False,
            "email_sent": False,
            "emails_sent": 0,
            "message": str(e)[:500],
            "error_type": type(e).__name__,
        }


async def _run_checklist_reminders_background():
    try:
        await _run_checklist_reminders_impl(force_resend=False)
    except Exception as e:
        _log(f"Checklist reminder background error: {e}")


@api_router.api_route("/checklist/send-daily-reminders", methods=["GET", "POST"])
async def send_checklist_daily_reminders(
    request: Request,
    background_tasks: BackgroundTasks,
    auth: dict | None = Depends(get_current_user_optional),
):
    """
    Checklist daily reminders. Cron: GET/POST + X-Cron-Secret (reports emails_sent in JSON).
    ?force=true clears today's sent log. Same secret as feature-approval cron is accepted.
    """
    force_resend = request.query_params.get("force", "").strip().lower() in ("1", "true", "yes")
    if _cron_secret_matches(request):

        async def _cron_checklist_job() -> None:
            try:
                result = await _run_checklist_reminders_impl(force_resend=force_resend)
                _log(f"Checklist cron finished: {result}")
            except Exception as e:
                _log(f"Checklist cron error: {e}")

        background_tasks.add_task(_cron_checklist_job)
        return _cron_email_started_response("Checklist daily reminder")
    if auth:
        role = _get_role_from_profile(auth["id"])
        if role not in ("admin", "master_admin"):
            raise HTTPException(403, "Admin only")
    else:
        raise HTTPException(
            401,
            "Set CHECKLIST_CRON_SECRET or FEATURE_APPROVAL_CRON_SECRET in X-Cron-Secret, or log in as admin.",
        )
    background_tasks.add_task(_run_checklist_reminders_background)
    return {"status": "started", "message": "Checklist reminder started. Check server logs."}


class SmtpTestBody(BaseModel):
    """Optional recipient; defaults to SMTP_FROM_EMAIL from env."""

    to: EmailStr | None = None


@api_router.post("/smtp/test")
async def smtp_send_test_email(request: Request, body: SmtpTestBody = SmtpTestBody()):
    """
    Send one test message via send_email() (SendGrid API or SMTP).
    Set SMTP_TEST_SECRET in backend/.env, restart, then send header X-SMTP-Test-Secret with the same value.
    JSON body optional: {"to": "recipient@example.com"} — else uses SMTP_FROM_EMAIL.
    """
    secret = (os.getenv("SMTP_TEST_SECRET") or "").strip()
    if not secret:
        raise HTTPException(
            503,
            "Set SMTP_TEST_SECRET in backend/.env to any random string, restart uvicorn, then send header X-SMTP-Test-Secret with that value.",
        )
    hdr = (request.headers.get("X-SMTP-Test-Secret") or request.headers.get("x-smtp-test-secret") or "").strip()
    if hdr != secret:
        raise HTTPException(403, "Missing or invalid X-SMTP-Test-Secret header.")

    to = str(body.to).strip() if body.to else ""
    if not to:
        to = (
            (os.getenv("SMTP_FROM_EMAIL") or "")
            or (os.getenv("POSTMARK_FROM_EMAIL") or "")
            or (os.getenv("POSTMARK_SMTP_FROM") or "")
        ).strip()
    if not to:
        raise HTTPException(
            400,
            'Set POSTMARK_FROM_EMAIL / SMTP_FROM_EMAIL in .env or POST JSON {"to": "you@example.com"}.',
        )
    from app.utils.email import get_last_email_error, send_email_detail

    ok, err = await send_email_detail(
        to_email=to,
        subject="FMS backend: SMTP test",
        html_content=(
            "<html><body><p>This is a <strong>test email</strong> from your IP FMS backend.</p>"
            "<p>If you received it, SendGrid or SMTP is configured correctly.</p></body></html>"
        ),
        plain_fallback="FMS SMTP test: plain text OK means send_email ran.",
    )
    if not ok:
        raise HTTPException(500, err or get_last_email_error() or "send_email failed")
    return {"ok": True, "to": to, "message": "Test email sent — check inbox and spam."}


# ---------- Delegation Daily Reminder (same pattern as Checklist) ----------
async def _send_delegation_reminder_email(to_email: str, task_titles: list[str], assignee_name: str) -> tuple[bool, str | None]:
    """Send delegation reminder email. Returns (ok, error)."""
    to_email = (to_email or "").strip()
    if not to_email:
        return False, "No recipient email"

    from app.checklist_delegation_email_templates import build_delegation_reminder_html
    from app.utils.email import send_email_detail

    html_content, plain_fallback = build_delegation_reminder_html(assignee_name, task_titles)

    ok, err = await send_email_detail(
        to_email=to_email,
        subject="Delegation: Pending tasks due",
        html_content=html_content,
        plain_fallback=plain_fallback,
    )
    if ok:
        _log(f"Delegation reminder sent to {to_email}")
    return ok, err


async def _run_delegation_reminders_impl(*, force_resend: bool = False) -> dict:
    """Run delegation daily reminders; returns summary for cron HTTP response."""
    try:
        from app.email_working_day import cron_email_skip_response, should_skip_cron_emails

        skip, skip_reason = should_skip_cron_emails(force=force_resend)
        if skip:
            _log(f"Delegation reminder skipped: {skip_reason}")
            return cron_email_skip_response(skip_reason, module="delegation_daily")
        today = date.today()
        del_r = supabase.table("delegation_tasks").select("id, title, assignee_id, due_date").in_("status", ["pending", "in_progress"]).lte("due_date", today.isoformat()).execute()
        tasks = del_r.data or []
        assignee_ids = list({str(t.get("assignee_id", "")) for t in tasks if t.get("assignee_id")})
        user_map = {}
        if assignee_ids:
            try:
                profiles_r = supabase.table("user_profiles").select("id, email, full_name").in_("id", assignee_ids).execute()
                for p in (profiles_r.data or []):
                    uid = str(p.get("id", ""))
                    email_val = (p.get("email") or "").strip()
                    user_map[uid] = {"email": email_val, "name": p.get("full_name") or "User"}
            except Exception as e:
                _log(f"Delegation reminder: user_profiles failed: {e}")
            need_auth = any(uid not in user_map or not (user_map.get(uid) or {}).get("email") for uid in assignee_ids)
            if need_auth:
                try:
                    auth_r = supabase.auth.admin.list_users(per_page=1000)
                    auth_users = getattr(auth_r, "users", []) or []
                    prof_r = supabase.table("user_profiles").select("id, full_name").in_("id", assignee_ids).execute()
                    profs = {str(x["id"]): x.get("full_name") or "User" for x in (prof_r.data or [])}
                    for u in auth_users:
                        uid = str(getattr(u, "id", "") or (u.get("id") if isinstance(u, dict) else ""))
                        em = (getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None) or "").strip()
                        if uid in assignee_ids and (uid not in user_map or not (user_map.get(uid) or {}).get("email")):
                            user_map[uid] = {"email": em, "name": profs.get(uid, "User")}
                except Exception as e2:
                    _log(f"Delegation reminder: auth fallback failed: {e2}")
        if force_resend:
            try:
                supabase.table("delegation_reminder_sent").delete().eq("reminder_date", today.isoformat()).execute()
            except Exception as e:
                _log(f"delegation reminder force_resend clear: {e}")
        try:
            sent_r = supabase.table("delegation_reminder_sent").select("user_id").eq("reminder_date", today.isoformat()).execute()
            already_sent = {str(row["user_id"]) for row in (sent_r.data or [])}
        except Exception as e:
            _log(f"delegation_reminder_sent missing? Run CHECKLIST_DELEGATION_REMINDER_SYSTEM.sql — {e}")
            already_sent = set()
        by_user: dict[str, list[str]] = {}
        for task in tasks:
            assignee_id = str(task.get("assignee_id", ""))
            if not assignee_id:
                continue
            by_user.setdefault(assignee_id, []).append(task.get("title") or "Untitled")
        pending_users = {uid for uid in by_user if uid not in already_sent}
        sent_count = 0
        failed: list[dict] = []
        for uid, titles in by_user.items():
            if not titles or uid in already_sent:
                continue
            u = user_map.get(uid, {})
            email = (u.get("email") or "").strip()
            name = u.get("name") or "User"
            if not email:
                continue
            ok_send, err = await _send_delegation_reminder_email(email, titles, name)
            if ok_send:
                try:
                    supabase.table("delegation_reminder_sent").insert({
                        "user_id": uid,
                        "reminder_date": today.isoformat(),
                    }).execute()
                    sent_count += 1
                except Exception as e:
                    _log(f"Delegation reminder: failed recording send for user_id={uid} date={today.isoformat()}: {e}")
            else:
                failed.append({"email": email, "error": err or "send failed"})
        _log(f"Delegation reminder: sent {sent_count} for {today.isoformat()}")
        if not by_user:
            return {
                "status": "completed",
                "email_sent": False,
                "emails_sent": 0,
                "message": "No pending or overdue delegation tasks.",
            }
        if not pending_users and sent_count == 0:
            return {
                "status": "completed",
                "ok": True,
                "email_sent": False,
                "emails_sent": 0,
                "reason": "already_sent_today",
                "message": "No new email — delegation reminders already sent today (use ?force=true once to resend).",
            }
        if sent_count == 0 and failed:
            return _cron_email_failure_response(
                module="delegation_daily",
                failed=failed,
                sent_count=0,
                pending_users=len(pending_users),
            )
        if sent_count == 0 and pending_users:
            return {
                "status": "completed",
                "ok": True,
                "email_sent": False,
                "emails_sent": 0,
                "eligible_users": len(pending_users),
                "reason": "no_recipient_email",
                "message": "Assignees have due tasks but no email on file.",
            }
        return {
            "status": "completed",
            "ok": True,
            "email_sent": sent_count > 0,
            "emails_sent": sent_count,
            "eligible_users": len(pending_users),
            "message": f"Sent {sent_count} delegation reminder email(s).",
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"Delegation reminder error: {e!r}")
        import traceback

        _log(traceback.format_exc())
        return {
            "status": "error",
            "ok": False,
            "email_sent": False,
            "emails_sent": 0,
            "message": str(e)[:500],
            "error_type": type(e).__name__,
        }


async def _run_delegation_reminders_background():
    try:
        await _run_delegation_reminders_impl(force_resend=False)
    except Exception as e:
        _log(f"Delegation reminder background error: {e}")


@api_router.api_route("/delegation/send-daily-reminders", methods=["GET", "POST"])
async def send_delegation_daily_reminders(
    request: Request,
    background_tasks: BackgroundTasks,
    auth: dict | None = Depends(get_current_user_optional),
):
    """
    Delegation daily reminders. Cron: GET/POST + X-Cron-Secret (reports emails_sent in JSON).
    ?force=true clears today's sent log. Same secret as feature-approval cron is accepted.
    """
    force_resend = request.query_params.get("force", "").strip().lower() in ("1", "true", "yes")
    if _cron_secret_matches(request):

        async def _cron_delegation_job() -> None:
            try:
                result = await _run_delegation_reminders_impl(force_resend=force_resend)
                _log(f"Delegation cron finished: {result}")
            except Exception as e:
                _log(f"Delegation cron error: {e}")

        background_tasks.add_task(_cron_delegation_job)
        return _cron_email_started_response("Delegation daily reminder")
    if auth:
        role = _get_role_from_profile(auth["id"])
        if role not in ("admin", "master_admin"):
            raise HTTPException(403, "Admin only")
    else:
        raise HTTPException(
            401,
            "Set DELEGATION_CRON_SECRET or FEATURE_APPROVAL_CRON_SECRET in X-Cron-Secret, or log in as admin.",
        )
    background_tasks.add_task(_run_delegation_reminders_background)
    return {"status": "started", "message": "Delegation reminder started. Check server logs."}


# ---------------------------------------------------------------------------
# Pending Reminder Digest (Checklist & Delegation + Support Chores&Bug & Feature by stage)
# Sent to admin, master_admin, approver roles only
# ---------------------------------------------------------------------------

async def _send_pending_digest_email(
    to_email: str,
    recipient_name: str,
    *,
    checklist_lines: list[str],
    delegation_lines: list[str],
    chores_bug_lines: list[str],
    feature_lines: list[str],
) -> tuple[bool, str | None]:
    """Send pending digest via Postmark (utils/email). Returns (ok, error)."""
    to_email = (to_email or "").strip()
    if not to_email:
        return False, "No recipient email"
    from app.checklist_delegation_email_templates import build_pending_digest_html
    from app.utils.email import send_email_detail

    subject = "Pending Task Reminder – Checklist, Delegation & Support"
    html_content, plain_fallback = build_pending_digest_html(
        recipient_name,
        checklist_lines=checklist_lines,
        delegation_lines=delegation_lines,
        chores_bug_lines=chores_bug_lines,
        feature_lines=feature_lines,
    )
    ok, err = await send_email_detail(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        plain_fallback=plain_fallback,
    )
    if ok:
        _log(f"Pending digest sent to {to_email}")
    return ok, err


def _get_level1_level2_user_ids() -> list[str]:
    """Return user IDs with role admin, master_admin, or approver (digest recipients)."""
    try:
        admin_roles = supabase.table("roles").select("id").in_("name", ["admin", "master_admin", "approver"]).execute()
        role_ids = [r["id"] for r in (admin_roles.data or [])]
        if not role_ids:
            return []
        profiles = supabase.table("user_profiles").select("id").in_("role_id", role_ids).eq("is_active", True).execute()
        return [str(p["id"]) for p in (profiles.data or [])]
    except Exception as e:
        _log(f"Pending digest: get recipients error: {e}")
        return []


async def _run_pending_digest_impl(*, force_resend: bool = False) -> dict:
    """Run pending digest (checklist, delegation, chores/bug, feature); returns cron-friendly summary."""
    try:
        from app.checklist_utils import get_occurrence_dates
        from app.email_working_day import cron_email_skip_response, should_skip_cron_emails
        from app.reminder_utils import get_chores_bugs_stage, get_staging_feature_stage, is_chores_bug_pending, is_feature_pending

        skip, skip_reason = should_skip_cron_emails(force=force_resend)
        if skip:
            _log(f"Pending digest skipped: {skip_reason}")
            return cron_email_skip_response(skip_reason, module="pending_digest")
        today = date.today()
        level12_ids = _get_level1_level2_user_ids()
        if not level12_ids:
            return {
                "status": "completed",
                "email_sent": False,
                "emails_sent": 0,
                "message": "No recipients — add Admin/Master Admin/Approver users with email.",
            }
        if force_resend:
            try:
                supabase.table("pending_reminder_sent").delete().eq("reminder_date", today.isoformat()).execute()
            except Exception as e:
                _log(f"pending digest force_resend clear: {e}")
        try:
            already_sent_r = supabase.table("pending_reminder_sent").select("user_id").eq("reminder_date", today.isoformat()).execute()
            already_sent = {str(r["user_id"]) for r in (already_sent_r.data or [])}
        except Exception as e:
            _log(f"pending_reminder_sent missing? Run DELEGATION_AND_PENDING_REMINDER.sql — {e}")
            already_sent = set()
        try:
            users_r = supabase.table("users_view").select("id, email, full_name").execute()
            user_map = {str(u["id"]): {"email": (u.get("email") or "").strip(), "name": u.get("full_name") or "User"} for u in (users_r.data or [])}
        except Exception:
            user_map = {}

        def assignee_name(aid) -> str:
            if not aid:
                return "-"
            return user_map.get(str(aid), {}).get("name", str(aid)[:8])

        holidays = _get_holidays_for_year(today.year)
        is_holiday = lambda d, h=holidays: d in h
        checklist_lines = []
        try:
            tasks_r = supabase.table("checklist_tasks").select("*").execute()
            tasks_list = tasks_r.data or []
            task_ids_digest = [str(t.get("id")) for t in tasks_list if t.get("id")]
            na_pairs_today = _fetch_checklist_na_pairs(task_ids_digest, today, today)
            comp_r = supabase.table("checklist_completions").select("task_id, occurrence_date").execute()
            comp = {}
            for row in comp_r.data or []:
                od = row.get("occurrence_date")
                if isinstance(od, str) and "T" in od:
                    od = od[:10]
                comp[(str(row["task_id"]), od or "")] = True
            for task in tasks_list:
                if _checklist_occurrence_excluded_for_reminder(task, today, na_pairs_today):
                    continue
                start = task.get("start_date")
                if isinstance(start, str):
                    start = date.fromisoformat(start)
                freq = task.get("frequency", "D")
                dates = get_occurrence_dates(start, freq, today.year, is_holiday)
                for d in dates:
                    if d == today:
                        key = (str(task["id"]), d.isoformat())
                        if not comp.get(key):
                            doer = assignee_name(task.get("doer_id"))
                            checklist_lines.append(f"{task.get('task_name')} · Doer: {doer}")
                        break
        except Exception as e:
            _log(f"Pending digest checklist: {e}")
            checklist_lines = ["(Error loading checklist)"]

        delegation_lines = []
        try:
            del_r = supabase.table("delegation_tasks").select("id, title, assignee_id, due_date").in_("status", ["pending", "in_progress"]).lte("due_date", today.isoformat()).execute()
            for t in del_r.data or []:
                assignee = assignee_name(t.get("assignee_id"))
                delegation_lines.append(f"{t.get('title')} · Assignee: {assignee} · Due: {t.get('due_date')}")
        except Exception:
            delegation_lines = ["(Error loading delegation)"]

        chores_bug_lines = []
        try:
            cb_r = supabase.table("tickets").select("*").in_("type", ["chore", "bug"]).is_("quality_solution", "null").execute()
            tickets_cb = cb_r.data or []
            staged: dict[str, list] = {}
            for t in tickets_cb:
                if not is_chores_bug_pending(t):
                    continue
                s = get_chores_bugs_stage(t)
                label = s["stage_label"]
                staged.setdefault(label, []).append(t)
            for label in sorted(staged.keys(), key=lambda x: (int(x.split()[1]) if x.split()[1].isdigit() else 0, x)):
                for t in staged[label]:
                    ref = t.get("reference_no") or t.get("id", "")[:8]
                    title = (t.get("title") or "")[:50]
                    assignee = assignee_name(t.get("assignee_id"))
                    chores_bug_lines.append(f"[{label}] {ref} — {title} · {assignee}")
        except Exception as e:
            _log(f"Pending digest chores&bug: {e}")
            chores_bug_lines = ["(Error loading chores & bug)"]

        feature_lines = []
        try:
            feat_r = supabase.table("tickets").select("*").eq("type", "feature").execute()
            tickets_feat = feat_r.data or []
            staged_f: dict[str, list] = {}
            for t in tickets_feat:
                if not is_feature_pending(t):
                    continue
                s = get_staging_feature_stage(t)
                label = s["stage_label"]
                staged_f.setdefault(label, []).append(t)
            for label in sorted(staged_f.keys(), key=lambda x: ("0" if "Approval" in x else "1" + x)):
                for t in staged_f[label]:
                    ref = t.get("reference_no") or t.get("id", "")[:8]
                    title = (t.get("title") or "")[:50]
                    assignee = assignee_name(t.get("assignee_id"))
                    feature_lines.append(f"[{label}] {ref} — {title} · {assignee}")
        except Exception as e:
            _log(f"Pending digest feature: {e}")
            feature_lines = ["(Error loading feature tickets)"]

        pending_ids = [uid for uid in level12_ids if uid not in already_sent]
        sent_count = 0
        failed: list[dict] = []
        for uid in pending_ids:
            u = user_map.get(uid, {})
            email = u.get("email", "").strip()
            name = u.get("name", "User")
            if not email:
                continue
            ok_send, err = await _send_pending_digest_email(
                email,
                name,
                checklist_lines=checklist_lines,
                delegation_lines=delegation_lines,
                chores_bug_lines=chores_bug_lines,
                feature_lines=feature_lines,
            )
            if ok_send:
                try:
                    supabase.table("pending_reminder_sent").insert({
                        "user_id": uid,
                        "reminder_date": today.isoformat(),
                    }).execute()
                    sent_count += 1
                except Exception:
                    pass
            else:
                failed.append({"email": email, "error": err or "send failed"})
        _log(f"Pending digest: sent {sent_count} for {today.isoformat()}")
        if not pending_ids and sent_count == 0:
            return {
                "status": "completed",
                "email_sent": False,
                "emails_sent": 0,
                "reason": "already_sent_today",
                "message": "No new email — digest already sent today (use ?force=true once to resend).",
            }
        if sent_count == 0 and failed:
            raise HTTPException(
                status_code=500,
                detail=failed[0].get("error") or "All pending digest emails failed",
            )
        return {
            "status": "completed",
            "email_sent": sent_count > 0,
            "emails_sent": sent_count,
            "eligible_recipients": len(pending_ids),
            "message": f"Sent {sent_count} pending digest email(s).",
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"Pending digest error: {e}")
        raise HTTPException(status_code=500, detail=str(e)[:500]) from e


async def _run_pending_digest_background():
    try:
        await _run_pending_digest_impl(force_resend=False)
    except Exception as e:
        _log(f"Pending digest background error: {e}")


@api_router.api_route("/reminders/send-pending-digest", methods=["GET", "POST"])
async def send_pending_digest(
    request: Request,
    background_tasks: BackgroundTasks,
    auth: dict | None = Depends(get_current_user_optional),
):
    """
    Pending digest: Checklist & Delegation + Support. Cron: GET/POST + X-Cron-Secret.
    Returns emails_sent in JSON. ?force=true clears today's sent log for retest.
    """
    force_resend = request.query_params.get("force", "").strip().lower() in ("1", "true", "yes")
    if _cron_secret_matches(request):

        async def _cron_pending_digest_job() -> None:
            try:
                result = await _run_pending_digest_impl(force_resend=force_resend)
                _log(f"Pending digest cron finished: {result}")
            except Exception as e:
                _log(f"Pending digest cron error: {e}")

        background_tasks.add_task(_cron_pending_digest_job)
        return _cron_email_started_response("Pending reminder digest")
    if auth:
        role = _get_role_from_profile(auth["id"])
        if role not in ("admin", "master_admin"):
            raise HTTPException(403, "Admin only (or use cron secret)")
    else:
        raise HTTPException(
            401,
            "Set PENDING_REMINDER_CRON_SECRET or FEATURE_APPROVAL_CRON_SECRET in X-Cron-Secret, or log in as admin.",
        )
    background_tasks.add_task(_run_pending_digest_background)
    return {"status": "started", "message": "Pending digest started. Check server logs."}


# ---------------------------------------------------------------------------
# Attachment upload (ticket attachments in Supabase Storage)
# Bucket MUST be PUBLIC in Supabase (Storage -> Buckets -> ticket-attachments -> Public: ON)
# so that "View" opens the document. See SUPABASE_ATTACHMENT_VIEW_FIX.md
ATTACHMENT_BUCKET = os.getenv("SUPABASE_ATTACHMENT_BUCKET", "ticket-attachments")
ATTACHMENT_MAX_BYTES = int(os.getenv("ATTACHMENT_MAX_MB", "10")) * 1024 * 1024  # default 10 MB
ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp",
    "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

# Only register /upload route if python-multipart is installed (so app starts even without it)
try:
    import python_multipart  # noqa: F401
    _MULTIPART_AVAILABLE = True
except ImportError:
    _MULTIPART_AVAILABLE = False
    _log("WARNING: python-multipart not installed. /upload disabled. Install with: pip install python-multipart")


def _get_storage_jwt() -> str | None:
    """Return a JWT (eyJ...) to use for Supabase Storage API. Storage requires JWT, not sb_secret_ keys."""
    service = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    storage_jwt = (os.getenv("SUPABASE_STORAGE_JWT") or "").strip()
    if service.startswith("eyJ"):
        return service
    if storage_jwt.startswith("eyJ"):
        return storage_jwt
    anon = (os.getenv("SUPABASE_ANON_KEY") or "").strip()
    if anon.startswith("eyJ"):
        return anon
    return None


if _MULTIPART_AVAILABLE:
    @api_router.post("/upload")
    def upload_attachment(file: UploadFile = File(...), auth: dict = Depends(get_current_user)):
        """
        Upload a file to Supabase Storage (ticket-attachments bucket).
        Returns { "url": "https://...public/..." } for use as attachment_url on tickets.
        Storage API requires a JWT key (starts with eyJ). Set SUPABASE_STORAGE_JWT or use JWT-format service_role in .env.
        """
        storage_jwt = _get_storage_jwt()
        if not storage_jwt:
            _log("Upload rejected: no JWT key for Storage (Storage API needs eyJ... key, not sb_secret_ or Key ID)")
            raise HTTPException(
                status_code=503,
                detail="Storage upload needs a JWT (long string starting with eyJ). Do NOT use the Key ID from Settings → JWT Keys (e.g. 493059e5-...). Use Settings → API and copy the 'service_role' or 'anon' key (eyJ...). Set SUPABASE_STORAGE_JWT=<that key> in backend/.env.",
            )
        if not file.filename or file.filename.strip() == "":
            raise HTTPException(status_code=400, detail="Filename required")
        content_type = (file.content_type or "").strip().lower()
        if content_type and content_type not in ALLOWED_ATTACHMENT_TYPES and not content_type.startswith("image/"):
            if not content_type.startswith("image/"):
                raise HTTPException(
                    status_code=400,
                    detail="File type not allowed. Allowed: PDF, images, text, Word, Excel.",
                )
        contents = file.file.read()
        if len(contents) > ATTACHMENT_MAX_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Max size: {ATTACHMENT_MAX_BYTES // (1024*1024)} MB",
            )
        safe_name = "".join(c for c in file.filename if c.isalnum() or c in "._- ")
        if not safe_name:
            safe_name = "file"
        object_path = f"{auth['id']}/{uuid.uuid4().hex}_{safe_name}"
        base = (os.getenv("SUPABASE_URL") or "").rstrip("/")

        # Upload via Supabase Storage REST API (requires JWT in Authorization, not sb_secret_)
        upload_url = f"{base}/storage/v1/object/{ATTACHMENT_BUCKET}/{object_path}"
        headers = {"Authorization": f"Bearer {storage_jwt}"}
        content_type_val = content_type or "application/octet-stream"
        files = {"file": (safe_name, contents, content_type_val)}
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(upload_url, headers=headers, files=files)
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            _log(f"Storage upload HTTP error: {e.response.status_code} {e.response.text[:200]}")
            err_text = (e.response.text or str(e)).lower()
            if e.response.status_code == 403 and ("compact jws" in err_text or "unauthorized" in err_text):
                raise HTTPException(
                    status_code=503,
                    detail="Storage rejected the API key (Invalid JWT). Use a key that starts with 'eyJ'. In backend/.env set SUPABASE_STORAGE_JWT to your service_role JWT from Supabase Dashboard → Settings → API (copy the long key starting with eyJ).",
                )
            err_msg = (e.response.text or str(e))[:300]
            raise HTTPException(
                status_code=500,
                detail=f"Upload failed: {err_msg}. Ensure bucket 'ticket-attachments' exists and is public; run database/STORAGE_TICKET_ATTACHMENTS_POLICIES.sql.",
            )
        except Exception as e:
            _log(f"Storage upload error: {type(e).__name__}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Upload failed: {str(e)[:200]}",
            )

        # Always return a string public URL (never a mock object)
        url = f"{base}/storage/v1/object/public/{ATTACHMENT_BUCKET}/{object_path}"
        _log(f"Upload OK: {object_path} -> {url[:80]}...")
        return {"url": url}
else:
    @api_router.post("/upload")
    def upload_attachment_disabled():
        raise HTTPException(
            status_code=503,
            detail="File upload requires python-multipart. In backend folder run: pip install python-multipart then restart the server.",
        )

# Mount API router at BOTH root and /api - fixes "Not Found" if frontend uses /api prefix
app.include_router(api_router)
app.include_router(api_router, prefix="/api")
