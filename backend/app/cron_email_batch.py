"""Run all email reminder modules (timing is on cron-job.org, not in-app)."""
from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger("cron_email_batch")

CRON_JOB_KEYS = (
    "feature_approval",
    "checklist_daily",
    "delegation_daily",
    "pending_digest",
    "escalation_pending",
    "escalation_critical",
    "escalation_stages",
)


async def _run_job(job_key: str, *, force: bool) -> dict[str, Any]:
    if job_key == "feature_approval":
        from app.feature_approval_reminder_service import run_feature_approval_reminder_batch

        return await run_feature_approval_reminder_batch(force=force)

    if job_key == "checklist_daily":
        from app.main import _run_checklist_reminders_impl

        return await _run_checklist_reminders_impl(force_resend=force)

    if job_key == "delegation_daily":
        from app.main import _run_delegation_reminders_impl

        return await _run_delegation_reminders_impl(force_resend=force)

    if job_key == "pending_digest":
        from app.main import _run_pending_digest_impl

        return await _run_pending_digest_impl(force_resend=force)

    if job_key == "escalation_pending":
        from app.escalation_email_service import run_escalation_batch

        return await run_escalation_batch("pending_timeframe", force=force, trigger_source="cron")

    if job_key == "escalation_critical":
        from app.escalation_email_service import run_escalation_batch

        return await run_escalation_batch("critical_pending", force=force, trigger_source="cron")

    if job_key == "escalation_stages":
        from app.escalation_email_service import run_all_stage_batches

        return await run_all_stage_batches(force=force)

    return {"ok": False, "error": f"unknown job {job_key}"}


def _summarize_job_result(job_key: str, result: dict[str, Any]) -> dict[str, Any]:
    sent = int(result.get("sent_ok") or result.get("emails_sent") or 0)
    if result.get("skipped"):
        return {
            "job_key": job_key,
            "ran": False,
            "email_sent": False,
            "reason": result.get("reason"),
        }
    if result.get("ok") is False:
        return {
            "job_key": job_key,
            "ran": True,
            "email_sent": False,
            "error": result.get("error"),
        }
    if job_key == "escalation_stages" and result.get("results"):
        total = sum(int((result["results"].get(k) or {}).get("sent_ok") or 0) for k in result["results"])
        return {"job_key": job_key, "ran": True, "email_sent": total > 0, "emails_sent": total}
    return {
        "job_key": job_key,
        "ran": True,
        "email_sent": sent > 0,
        "emails_sent": sent,
        "reason": result.get("reason"),
    }


def _skip_all_jobs_response(reason: str, keys: list[str]) -> dict[str, Any]:
    from app.email_working_day import cron_email_skip_response

    base = cron_email_skip_response(reason, module="all_cron_emails")
    base["jobs"] = [
        {
            "job_key": key,
            "ran": False,
            "email_sent": False,
            "reason": reason,
        }
        for key in keys
    ]
    base["any_email_sent"] = False
    return base


async def run_all_cron_emails(*, force: bool = False, job_key: str | None = None) -> dict[str, Any]:
    keys = [job_key] if job_key else list(CRON_JOB_KEYS)
    if job_key and job_key not in CRON_JOB_KEYS:
        return {"ok": False, "error": f"Unknown job_key: {job_key}"}

    if not force:
        from app.email_working_day import get_cron_working_day_status

        day_status = get_cron_working_day_status(force=False)
        if day_status.get("skip_cron_emails") and day_status.get("skip_reason"):
            _log.info(
                "All cron emails skipped: %s (%s)",
                day_status.get("skip_reason"),
                day_status.get("date"),
            )
            return _skip_all_jobs_response(str(day_status["skip_reason"]), keys)

    results: list[dict[str, Any]] = []
    for key in keys:
        try:
            raw = await _run_job(key, force=force)
            results.append(_summarize_job_result(key, raw))
        except Exception as e:
            _log.exception("cron email job %s failed", key)
            results.append({"job_key": key, "ran": True, "email_sent": False, "error": str(e)[:300]})

    any_error = any(r.get("error") for r in results)
    return {
        "ok": not any_error,
        "force": force,
        "jobs": results,
        "any_email_sent": any(r.get("email_sent") for r in results),
    }
