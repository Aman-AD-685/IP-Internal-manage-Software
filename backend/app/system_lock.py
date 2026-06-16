"""Global system lock — Master Admin can block all other users from the application."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from app.supabase_client import supabase

_log = logging.getLogger("system_lock")

_LOCK_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_LOCK_CACHE_TTL_SEC = 2.0
_TABLE_MISSING_LOGGED = False

_SYSTEM_LOCK_EXEMPT_PREFIXES = (
    "/health",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/app/release",
    "/api/app/release",
    "/auth/login",
    "/api/auth/login",
    "/auth/register",
    "/api/auth/register",
    "/auth/refresh",
    "/api/auth/refresh",
    "/auth/forgot-password",
    "/api/auth/forgot-password",
    "/auth/recovery-password",
    "/api/auth/recovery-password",
    "/auth/resend-confirmation",
    "/api/auth/resend-confirmation",
    "/approval/execute-by-token",
    "/api/approval/execute-by-token",
    "/approval/email-action",
    "/api/approval/email-action",
    "/system-lock/status",
    "/api/system-lock/status",
    "/system-lock/lock",
    "/api/system-lock/lock",
    "/system-lock/unlock",
    "/api/system-lock/unlock",
    "/system-lock/audit",
    "/api/system-lock/audit",
    "/cron/",
    "/api/cron/",
    "/scheduler/",
    "/api/scheduler/",
    "/escalation/cron",
    "/api/escalation/cron",
    "/feature-approval-reminders/run",
    "/api/feature-approval-reminders/run",
    "/checklist/send-daily-reminders",
    "/api/checklist/send-daily-reminders",
    "/reminders/",
    "/api/reminders/",
)


def _normalize_path(path: str) -> str:
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    return p


def is_system_lock_exempt_path(path: str) -> bool:
    p = _normalize_path(path)
    if p in ("/", "/api"):
        return True
    for prefix in _SYSTEM_LOCK_EXEMPT_PREFIXES:
        if p == prefix.rstrip("/") or p.startswith(prefix):
            return True
    return False


def invalidate_system_lock_cache() -> None:
    _LOCK_CACHE["ts"] = 0.0
    _LOCK_CACHE["payload"] = None


def _default_unlocked_state() -> dict[str, Any]:
    return {
        "is_locked": False,
        "reason": None,
        "locked_by": None,
        "locked_by_name": None,
        "locked_at": None,
        "unlocked_at": None,
        "updated_at": None,
    }


def get_system_lock_state(*, force_refresh: bool = False) -> dict[str, Any]:
    """Read singleton lock row (cached). Returns unlocked if table missing."""
    global _TABLE_MISSING_LOGGED
    now = time.monotonic()
    cached = _LOCK_CACHE.get("payload")
    if (
        not force_refresh
        and cached is not None
        and now - float(_LOCK_CACHE.get("ts") or 0) < _LOCK_CACHE_TTL_SEC
    ):
        return dict(cached)

    try:
        r = (
            supabase.table("system_lock_settings")
            .select("is_locked, reason, locked_by, locked_at, unlocked_at, updated_at")
            .eq("id", 1)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0]
    except Exception as e:
        if not _TABLE_MISSING_LOGGED:
            _log.warning("system_lock_settings unavailable (run database/SYSTEM_LOCK.sql): %s", e)
            _TABLE_MISSING_LOGGED = True
        payload = _default_unlocked_state()
        _LOCK_CACHE["ts"] = now
        _LOCK_CACHE["payload"] = payload
        return dict(payload)

    if not row:
        payload = _default_unlocked_state()
    else:
        locked_by = row.get("locked_by")
        locked_by_name = None
        if locked_by:
            try:
                pr = (
                    supabase.table("user_profiles")
                    .select("full_name, email")
                    .eq("id", str(locked_by))
                    .limit(1)
                    .execute()
                )
                if pr.data:
                    locked_by_name = (pr.data[0].get("full_name") or pr.data[0].get("email") or "").strip() or None
            except Exception:
                pass
        payload = {
            "is_locked": bool(row.get("is_locked")),
            "reason": (row.get("reason") or "").strip() or None,
            "locked_by": str(locked_by) if locked_by else None,
            "locked_by_name": locked_by_name,
            "locked_at": row.get("locked_at"),
            "unlocked_at": row.get("unlocked_at"),
            "updated_at": row.get("updated_at"),
        }

    _LOCK_CACHE["ts"] = now
    _LOCK_CACHE["payload"] = payload
    return dict(payload)


def system_locked_response(reason: str | None) -> JSONResponse:
    return JSONResponse(
        status_code=423,
        content={
            "success": False,
            "error": "SYSTEM_LOCKED",
            "message": "System access has been temporarily disabled by the Master Admin.",
            "reason": reason or "",
        },
        headers={"Cache-Control": "no-store"},
    )


def _role_for_user_id(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


async def check_request_system_lock(request: Request) -> JSONResponse | None:
    """Return 423 when system is locked and caller is not Master Admin."""
    if request.method == "OPTIONS":
        return None
    path = request.url.path
    if is_system_lock_exempt_path(path):
        return None

    state = get_system_lock_state()
    if not state.get("is_locked"):
        return None

    auth_header = (request.headers.get("authorization") or request.headers.get("Authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        return system_locked_response(state.get("reason"))

    token = auth_header[7:].strip()
    if not token:
        return system_locked_response(state.get("reason"))

    try:
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not user_resp.user:
            return system_locked_response(state.get("reason"))
        user_id = str(user_resp.user.id)
    except Exception as e:
        _log.warning("system lock get_user failed: %s", type(e).__name__)
        return system_locked_response(state.get("reason"))

    try:
        role = _role_for_user_id(user_id)
    except Exception as e:
        _log.warning("system lock role lookup failed for %s: %s", user_id[:8], type(e).__name__)
        role = ""

    if role == "master_admin":
        return None

    return system_locked_response(state.get("reason"))


def enable_system_lock(*, user_id: str, email: str, reason: str) -> dict[str, Any]:
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise ValueError("Reason must be at least 10 characters.")

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("system_lock_settings").upsert(
        {
            "id": 1,
            "is_locked": True,
            "reason": reason,
            "locked_by": user_id,
            "locked_at": now,
            "unlocked_at": None,
            "updated_at": now,
        },
        on_conflict="id",
    ).execute()
    supabase.table("system_lock_audit").insert(
        {
            "action": "SYSTEM_LOCK_ENABLED",
            "performed_by": user_id,
            "performer_email": (email or "").strip().lower() or None,
            "reason": reason,
        }
    ).execute()
    invalidate_system_lock_cache()
    return get_system_lock_state(force_refresh=True)


def disable_system_lock(*, user_id: str, email: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("system_lock_settings").upsert(
        {
            "id": 1,
            "is_locked": False,
            "reason": None,
            "locked_at": None,
            "unlocked_at": now,
            "updated_at": now,
        },
        on_conflict="id",
    ).execute()
    supabase.table("system_lock_audit").insert(
        {
            "action": "SYSTEM_LOCK_DISABLED",
            "performed_by": user_id,
            "performer_email": (email or "").strip().lower() or None,
            "reason": None,
        }
    ).execute()
    invalidate_system_lock_cache()
    return get_system_lock_state(force_refresh=True)


def list_system_lock_audit(*, limit: int = 50) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit or 50), 200))
    try:
        r = (
            supabase.table("system_lock_audit")
            .select("id, action, performed_by, performer_email, reason, created_at")
            .order("created_at", desc=True)
            .limit(lim)
            .execute()
        )
        return r.data or []
    except Exception as e:
        _log.warning("system_lock_audit list failed: %s", e)
        return []
