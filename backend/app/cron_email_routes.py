"""cron-job.org endpoints — no in-app schedule UI or email_job_schedules table."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from app.auth_middleware import get_current_user_optional
from app.cron_email_batch import CRON_JOB_KEYS, run_all_cron_emails

cron_email_router = APIRouter(tags=["cron-email"])
_log = logging.getLogger("cron_email_routes")


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _cron_authorized(request: Request) -> bool:
    hdr = (request.headers.get("X-Cron-Secret") or request.headers.get("x-cron-secret") or "").strip()
    auth_hdr = (request.headers.get("Authorization") or request.headers.get("authorization") or "").strip()
    bearer = auth_hdr[7:].strip() if auth_hdr.lower().startswith("bearer ") else ""
    query_secret = (request.query_params.get("secret") or "").strip()
    for key in (
        "FEATURE_APPROVAL_CRON_SECRET",
        "CHECKLIST_CRON_SECRET",
        "NOTIFICATION_CRON_SECRET",
        "ESCALATION_CRON_SECRET",
        "SCHEDULER_CRON_SECRET",
    ):
        secret = (os.getenv(key) or "").strip()
        if secret and (hdr == secret or bearer == secret or query_secret == secret):
            return True
    return False


async def _cron_run_all(
    request: Request,
    *,
    force: bool = False,
    job: str | None = None,
    auth: dict | None = None,
) -> dict:
    is_cron = _cron_authorized(request)
    is_admin = bool(auth and _role(auth["id"]) in ("admin", "master_admin"))
    if not is_cron and not is_admin:
        raise HTTPException(
            status_code=401,
            detail="Use X-Cron-Secret (cron-job.org) or sign in as Admin.",
        )
    # Always HTTP 200 for cron so cron-job.org logs show JSON (Postmark/config errors are in body).
    return await run_all_cron_emails(force=force, job_key=job or None)


@cron_email_router.api_route("/cron/run-all-emails", methods=["GET", "POST"])
async def cron_run_all_emails(
    request: Request,
    background_tasks: BackgroundTasks,
    force: bool = False,
    job: str | None = None,
    auth: dict | None = Depends(get_current_user_optional),
):
    """
    cron-job.org: call at the times you want (e.g. daily 8:00 IST).
    Runs feature approval, checklist, delegation, and escalation batches.
    Optional: ?job=checklist_daily  ?force=true (admin test).
    """
    if _cron_authorized(request):

        async def _bg() -> None:
            try:
                result = await run_all_cron_emails(force=force, job_key=job or None)
                _log("run-all-emails cron finished: %s", result)
            except Exception as e:
                _log("run-all-emails cron error: %s", e)

        background_tasks.add_task(_bg)
        return {
            "status": "started",
            "ok": True,
            "message": "All email jobs started in background. Check Render logs.",
        }
    return await _cron_run_all(request, force=force, job=job, auth=auth)


@cron_email_router.api_route("/scheduler/tick", methods=["GET", "POST"])
async def scheduler_tick_legacy(
    request: Request,
    background_tasks: BackgroundTasks,
    force: bool = False,
    job: str | None = None,
    auth: dict | None = Depends(get_current_user_optional),
):
    """Legacy URL — same as /cron/run-all-emails (in-app scheduler removed)."""
    if _cron_authorized(request):

        async def _bg() -> None:
            try:
                result = await run_all_cron_emails(force=force, job_key=job or None)
                _log("scheduler/tick cron finished: %s", result)
            except Exception as e:
                _log("scheduler/tick cron error: %s", e)

        background_tasks.add_task(_bg)
        return {
            "status": "started",
            "ok": True,
            "message": "All email jobs started in background. Check Render logs.",
        }
    return await _cron_run_all(request, force=force, job=job, auth=auth)


@cron_email_router.get("/cron/job-keys")
def cron_job_keys_list():
    return {"job_keys": list(CRON_JOB_KEYS)}


@cron_email_router.get("/cron/working-day")
def cron_working_day_check(
    request: Request,
    force: bool = False,
    auth: dict | None = Depends(get_current_user_optional),
):
    """
    Check if today (Asia/Kolkata) is Sunday or a checklist holiday — no cron emails on those days.
    Cron secret or Admin only.
    """
    is_cron = _cron_authorized(request)
    is_admin = bool(auth and _role(auth["id"]) in ("admin", "master_admin"))
    if not is_cron and not is_admin:
        raise HTTPException(status_code=401, detail="Use X-Cron-Secret or sign in as Admin.")
    from app.email_working_day import get_cron_working_day_status

    return get_cron_working_day_status(force=force)
