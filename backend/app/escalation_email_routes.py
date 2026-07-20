"""Advanced Pending Escalation Email Configuration API."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field

from app.auth_middleware import get_current_user, get_current_user_optional
from app.escalation_email_service import (
    CONFIG_TYPES,
    add_receivers,
    delete_receiver,
    get_pending_stats,
    list_all_configs,
    parse_bulk_emails,
    patch_config,
    preview_html,
    recent_logs,
    recent_manual_triggers,
    retry_failed_log,
    run_all_stage_batches,
    run_escalation_batch,
    send_test_email,
    update_receiver,
)

escalation_email_router = APIRouter(tags=["escalation"])
_log = logging.getLogger("escalation_email_routes")


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _require_admin(auth: dict = Depends(get_current_user)) -> dict:
    if _role(auth["id"]) not in ("admin", "master_admin"):
        raise HTTPException(status_code=403, detail="Admin or Master Admin only")
    return auth


def _extract_bearer(request: Request) -> str:
    auth_hdr = request.headers.get("Authorization") or request.headers.get("authorization") or ""
    if auth_hdr.lower().startswith("bearer "):
        return auth_hdr[7:].strip()
    return ""


def _cron_secret() -> str:
    return (
        os.getenv("ESCALATION_CRON_SECRET")
        or os.getenv("NOTIFICATION_CRON_SECRET")
        or os.getenv("FEATURE_APPROVAL_CRON_SECRET")
        or os.getenv("CHECKLIST_CRON_SECRET")
        or ""
    ).strip()


def _is_cron_authorized(request: Request) -> bool:
    secret = _cron_secret()
    if not secret:
        return False
    hdr = (request.headers.get("X-Cron-Secret") or request.headers.get("x-cron-secret") or "").strip()
    bearer = _extract_bearer(request)
    query_secret = (request.query_params.get("secret") or "").strip()
    return hdr == secret or bearer == secret or query_secret == secret


def _cron_escalation_started_response(job_label: str) -> dict:
    return {
        "status": "started",
        "ok": True,
        "message": (
            f"{job_label} started in background. "
            "cron-job.org should show Success within a few seconds. "
            "Check Render logs for emails_sent."
        ),
    }


def _cron_or_admin(
    request: Request,
    auth: dict | None = Depends(get_current_user_optional),
) -> dict:
    if _is_cron_authorized(request):
        return {"cron": True}
    if auth and _role(auth["id"]) in ("admin", "master_admin"):
        return auth
    raise HTTPException(
        status_code=401,
        detail="Use Authorization: Bearer <ESCALATION_CRON_SECRET> or X-Cron-Secret, or sign in as Admin.",
    )


class ReceiversBody(BaseModel):
    emails: list[EmailStr] = Field(default_factory=list)
    bulk: str = ""


class ConfigPatch(BaseModel):
    is_enabled: bool | None = None


class RecipientPatch(BaseModel):
    is_enabled: bool | None = None


class TestEmailBody(BaseModel):
    to: EmailStr
    configuration_type: str


class RunBody(BaseModel):
    force: bool = False


@escalation_email_router.get("/escalation/ping")
def escalation_ping():
    return {"ok": True, "routes": "escalation-v1", "config_types": list(CONFIG_TYPES)}


@escalation_email_router.get("/escalation/email-status")
def email_delivery_status(_auth: dict = Depends(_require_admin)):
    from app.utils.email import get_email_delivery_status, get_last_email_error

    return {
        **get_email_delivery_status(),
        "last_error": get_last_email_error(),
    }


@escalation_email_router.get("/escalation/config")
def get_configs(_auth: dict = Depends(_require_admin)):
    try:
        from app.utils.email import get_email_delivery_status

        return {
            "items": list_all_configs(),
            "stats": get_pending_stats(),
            "email_delivery": get_email_delivery_status(),
        }
    except Exception as e:
        _log.exception("escalation config list failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Escalation email is not set up. Run database/ESCALATION_EMAIL_SYSTEM.sql.",
        ) from e

@escalation_email_router.patch("/escalation/config/{configuration_type}")
def patch_config_route(
    configuration_type: str,
    body: ConfigPatch,
    auth: dict = Depends(_require_admin),
):
    try:
        return patch_config(configuration_type, is_enabled=body.is_enabled)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@escalation_email_router.post("/escalation/config/{configuration_type}/receivers")
def post_receivers(
    configuration_type: str,
    body: ReceiversBody,
    auth: dict = Depends(_require_admin),
):
    emails = [str(e) for e in body.emails]
    if body.bulk.strip():
        emails.extend(parse_bulk_emails(body.bulk))
    if not emails:
        raise HTTPException(status_code=400, detail="No valid emails provided")
    try:
        added = add_receivers(configuration_type, emails, created_by=auth.get("id"))
        return {"added": added, "count": len(added)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@escalation_email_router.patch("/escalation/receivers/{receiver_id}")
def patch_receiver_route(receiver_id: str, body: RecipientPatch, _auth: dict = Depends(_require_admin)):
    try:
        return update_receiver(receiver_id, is_enabled=body.is_enabled)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@escalation_email_router.delete("/escalation/receivers/{receiver_id}")
def delete_receiver_route(receiver_id: str, _auth: dict = Depends(_require_admin)):
    delete_receiver(receiver_id)
    return {"ok": True}


@escalation_email_router.get("/escalation/logs")
def logs_get(
    limit: int = 50,
    configuration_type: str | None = None,
    _auth: dict = Depends(_require_admin),
):
    return {"items": recent_logs(limit, configuration_type)}


@escalation_email_router.get("/escalation/manual-triggers")
def manual_triggers_get(limit: int = 30, _auth: dict = Depends(_require_admin)):
    return {"items": recent_manual_triggers(limit)}


@escalation_email_router.get("/escalation/preview/{configuration_type}", response_class=HTMLResponse)
async def preview_route(configuration_type: str, _auth: dict = Depends(_require_admin)):
    try:
        return HTMLResponse(await preview_html(configuration_type))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@escalation_email_router.post("/escalation/test-email")
async def test_email_route(body: TestEmailBody, _auth: dict = Depends(_require_admin)):
    ok, err = await send_test_email(body.configuration_type, str(body.to))
    if not ok:
        raise HTTPException(status_code=500, detail=err or "Send failed")
    return {"ok": True, "to": str(body.to)}


@escalation_email_router.post("/escalation/force-send/{configuration_type}")
async def force_send_route(
    configuration_type: str,
    auth: dict = Depends(_require_admin),
):
    return await run_escalation_batch(
        configuration_type,
        force=True,
        triggered_by=auth.get("id"),
        trigger_source="manual",
    )


@escalation_email_router.post("/escalation/retry/{log_id}")
async def retry_route(log_id: str, _auth: dict = Depends(_require_admin)):
    try:
        return await retry_failed_log(log_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# --- Cron endpoints (external scheduler) ---


def _cron_escalation_response(result: dict) -> dict:
    """Cron-job.org: HTTP 200 with JSON (Postmark errors in message)."""
    hints = {
        "already_sent_today": "No new email — already sent today (use ?force=true once to resend).",
        "no_recipients": "No email — add enabled receivers in Escalation Settings.",
        "no_tickets": "No email — no tickets match this escalation rule.",
        "disabled": "No email — this escalation configuration is disabled.",
    }
    reason = str(result.get("reason") or "")
    sent = int(result.get("sent_ok") or 0)
    ok = result.get("ok") is not False
    msg = hints.get(reason) or (f"Sent {sent} email(s)." if sent else "Completed.")
    if result.get("ok") is False and result.get("error"):
        msg = str(result.get("error"))[:500]
    return {
        "status": "completed" if ok else "error",
        "ok": ok,
        "email_sent": sent > 0,
        "emails_sent": sent,
        "pending_tickets": result.get("pending", 0),
        "configuration_type": result.get("configuration_type"),
        "skipped": bool(result.get("skipped")),
        "reason": reason or None,
        "message": msg,
    }


@escalation_email_router.api_route("/escalation/send-pending-mails", methods=["GET", "POST"])
async def cron_pending_mails(
    background_tasks: BackgroundTasks,
    request: Request,
    ctx: dict = Depends(_cron_or_admin),
    body: RunBody | None = Body(None),
    force: bool = False,
):
    force_flag = force or (bool(body.force) if body else False)
    if ctx.get("cron"):

        async def _bg() -> None:
            try:
                result = await run_escalation_batch(
                    "pending_timeframe",
                    force=force_flag,
                    trigger_source="cron",
                )
                _log("Escalation pending cron finished: %s", result)
            except Exception as e:
                _log("Escalation pending cron error: %s", e)

        background_tasks.add_task(_bg)
        return _cron_escalation_started_response("Escalation pending timeframe")
    uid = ctx.get("id")
    return await run_escalation_batch(
        "pending_timeframe",
        force=force_flag,
        triggered_by=uid,
        trigger_source="manual" if force_flag else "cron",
    )


@escalation_email_router.api_route("/escalation/send-critical-mails", methods=["GET", "POST"])
async def cron_critical_mails(
    background_tasks: BackgroundTasks,
    request: Request,
    ctx: dict = Depends(_cron_or_admin),
    body: RunBody | None = Body(None),
    force: bool = False,
):
    force_flag = force or (bool(body.force) if body else False)
    if ctx.get("cron"):

        async def _bg() -> None:
            try:
                result = await run_escalation_batch(
                    "critical_pending",
                    force=force_flag,
                    trigger_source="cron",
                )
                _log("Escalation critical cron finished: %s", result)
            except Exception as e:
                _log("Escalation critical cron error: %s", e)

        background_tasks.add_task(_bg)
        return _cron_escalation_started_response("Escalation critical pending")
    uid = ctx.get("id")
    return await run_escalation_batch(
        "critical_pending",
        force=force_flag,
        triggered_by=uid,
        trigger_source="manual" if force_flag else "cron",
    )


@escalation_email_router.api_route("/escalation/send-stage-mails", methods=["GET", "POST"])
async def cron_stage_mails(
    background_tasks: BackgroundTasks,
    request: Request,
    ctx: dict = Depends(_cron_or_admin),
    body: RunBody | None = Body(None),
    force: bool = False,
):
    force_flag = force or (bool(body.force) if body else False)
    if ctx.get("cron"):

        async def _bg() -> None:
            try:
                raw = await run_all_stage_batches(force=force_flag)
                _log("Escalation stage cron finished: %s", raw)
            except Exception as e:
                _log("Escalation stage cron error: %s", e)

        background_tasks.add_task(_bg)
        return _cron_escalation_started_response("Escalation stage reminders")
    uid = ctx.get("id")
    return await run_all_stage_batches(
        force=force_flag,
        triggered_by=uid,
    )
