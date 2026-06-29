from __future__ import annotations

import os

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel

from app.attendance_sync_service import (
    get_attendance_sync_public_status,
    get_attendance_sync_status,
    get_monthly_attendance_leave_summary,
    run_attendance_sync,
)
from app.auth_middleware import get_current_user_optional


attendance_sync_router = APIRouter(tags=["attendance-sync"])


class AttendanceLeaveUser(BaseModel):
    id: str
    full_name: str


class AttendanceLeaveSummaryBody(BaseModel):
    users: list[AttendanceLeaveUser]
    month: str | None = None
    year: int | None = None


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _trusted_user_name(user_id: str, fallback: str | None = None) -> str:
    from app.supabase_client import supabase

    try:
        profile = (
            supabase.table("user_profiles")
            .select("full_name,display_name")
            .eq("id", user_id)
            .single()
            .execute()
        )
        row = profile.data or {}
        name = (row.get("full_name") or row.get("display_name") or "").strip()
        if name:
            return name
    except Exception:
        pass
    return (fallback or "Current User").strip() or "Current User"


def _extract_bearer(request: Request) -> str:
    auth_hdr = (request.headers.get("Authorization") or request.headers.get("authorization") or "").strip()
    if auth_hdr.lower().startswith("bearer "):
        return auth_hdr[7:].strip()
    return ""


def _normalize_cron_secret_value(value: str | None) -> str:
    """Accept either raw secret or pasted ENV-style `NAME=value` strings."""
    raw = (value or "").strip()
    for key in (
        "ATTENDANCE_SYNC_CRON_SECRET",
        "SCHEDULER_CRON_SECRET",
        "CHECKLIST_CRON_SECRET",
    ):
        prefix = f"{key}="
        if raw.startswith(prefix):
            return raw[len(prefix):].strip()
    return raw


def _cron_or_admin(
    request: Request,
    x_cron_secret: str | None = Header(None, alias="X-Cron-Secret"),
    authorization: str | None = Header(None, alias="Authorization"),
    secret: str | None = Query(None, description="Cron secret; prefer X-Cron-Secret header in production."),
    auth: dict | None = Depends(get_current_user_optional),
) -> dict:
    hdr = (
        x_cron_secret
        or request.headers.get("X-Cron-Secret")
        or request.headers.get("x-cron-secret")
        or ""
    ).strip()
    bearer = ""
    auth_hdr = (authorization or "").strip()
    if auth_hdr.lower().startswith("bearer "):
        bearer = auth_hdr[7:].strip()
    else:
        bearer = _extract_bearer(request)
    hdr = _normalize_cron_secret_value(hdr)
    bearer = _normalize_cron_secret_value(bearer)
    query_secret = _normalize_cron_secret_value(secret or request.query_params.get("secret"))
    for key in (
        "ATTENDANCE_SYNC_CRON_SECRET",
        "SCHEDULER_CRON_SECRET",
        "CHECKLIST_CRON_SECRET",
    ):
        secret = (os.getenv(key) or "").strip()
        if secret and (hdr == secret or bearer == secret or query_secret == secret):
            return {"cron": True}
    if auth and _role(auth["id"]) in ("admin", "master_admin"):
        return auth
    raise HTTPException(
        status_code=401,
        detail="Use X-Cron-Secret/Authorization Bearer with ATTENDANCE_SYNC_CRON_SECRET or sign in as Admin.",
    )


@attendance_sync_router.get("/attendance-sync/ping")
def attendance_sync_ping():
    return {"ok": True, "routes": "attendance-sync-v1"}


@attendance_sync_router.get("/attendance-sync/status")
def attendance_sync_status():
    """Read-only public sync status for Swagger/production health checks.

    The actual sync trigger remains protected by _cron_or_admin.
    """
    return get_attendance_sync_public_status()


@attendance_sync_router.get("/attendance-sync/status/details")
def attendance_sync_status_details(
    limit: int = 10,
    _ctx: dict = Depends(_cron_or_admin),
):
    """Detailed run history for Admin/Cron diagnostics."""
    return get_attendance_sync_status(limit=limit)


@attendance_sync_router.post("/dashboard/attendance-leave-summary")
def dashboard_attendance_leave_summary(
    body: AttendanceLeaveSummaryBody,
    auth: dict | None = Depends(get_current_user_optional),
):
    if not auth:
        raise HTTPException(status_code=403, detail="Authentication required")
    users = [item.model_dump() for item in body.users]
    if _role(auth["id"]) not in ("admin", "master_admin"):
        if len(users) != 1 or users[0].get("id") != auth["id"]:
            raise HTTPException(status_code=403, detail="Can only view your own attendance summary")
        users = [{
            "id": auth["id"],
            "full_name": _trusted_user_name(auth["id"], auth.get("email")),
        }]
    return get_monthly_attendance_leave_summary(
        users=users,
        month=body.month,
        year=body.year,
    )


@attendance_sync_router.api_route("/cron/attendance-sync", methods=["GET", "POST"])
async def attendance_sync_cron(
    request: Request,
    background_tasks: BackgroundTasks,
    sync: bool = False,
    ctx: dict = Depends(_cron_or_admin),
):
    """
    Cron endpoint for daily 12 PM IST.
    cron-job.org/Render Cron should call this URL with X-Cron-Secret.
    """
    trigger_source = "cron" if ctx.get("cron") else "manual"
    if ctx.get("cron") and not sync:

        def _bg() -> None:
            run_attendance_sync(trigger_source=trigger_source)

        background_tasks.add_task(_bg)
        return {
            "ok": True,
            "status": "started",
            "message": "Attendance sync started in background. Check attendance_sync_runs or Render logs.",
        }
    return run_attendance_sync(trigger_source=trigger_source)
