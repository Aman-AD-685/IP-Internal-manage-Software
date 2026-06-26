from __future__ import annotations

import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from app.attendance_sync_service import (
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


def _extract_bearer(request: Request) -> str:
    auth_hdr = (request.headers.get("Authorization") or request.headers.get("authorization") or "").strip()
    if auth_hdr.lower().startswith("bearer "):
        return auth_hdr[7:].strip()
    return ""


def _cron_or_admin(
    request: Request,
    auth: dict | None = Depends(get_current_user_optional),
) -> dict:
    hdr = (request.headers.get("X-Cron-Secret") or request.headers.get("x-cron-secret") or "").strip()
    bearer = _extract_bearer(request)
    query_secret = (request.query_params.get("secret") or "").strip()
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
def attendance_sync_status(
    limit: int = 10,
    _ctx: dict = Depends(_cron_or_admin),
):
    return get_attendance_sync_status(limit=limit)


@attendance_sync_router.post("/dashboard/attendance-leave-summary")
def dashboard_attendance_leave_summary(
    body: AttendanceLeaveSummaryBody,
    auth: dict | None = Depends(get_current_user_optional),
):
    if not auth or _role(auth["id"]) not in ("admin", "master_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return get_monthly_attendance_leave_summary(
        users=[item.model_dump() for item in body.users],
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
