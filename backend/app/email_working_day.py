"""
Skip automated reminder / escalation emails on Sundays and checklist holidays.

Uses the same ``checklist_holidays`` table as the Checklist module (upload via Task → Checklist).
Timezone for "today" matches other cron email jobs (Asia/Kolkata).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.supabase_client import supabase

_log = logging.getLogger("email_working_day")

DEFAULT_EMAIL_CRON_TZ = "Asia/Kolkata"
_IST_FIXED = timezone(timedelta(hours=5, minutes=30))


def _get_tz(tz_name: str | None):
    name = (tz_name or DEFAULT_EMAIL_CRON_TZ).strip() or DEFAULT_EMAIL_CRON_TZ
    try:
        return ZoneInfo(name)
    except Exception:
        pass
    if name.lower() in ("asia/kolkata", "asia/calcutta"):
        return _IST_FIXED
    return timezone.utc


def _parse_iso_date(val: str | None) -> date | None:
    if not val:
        return None
    s = str(val).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def today_for_email_cron(tz_name: str = DEFAULT_EMAIL_CRON_TZ) -> date:
    return datetime.now(_get_tz(tz_name)).date()


def load_holidays_map(*years: int) -> dict[date, str]:
    """holiday_date → name (loads distinct years from checklist_holidays)."""
    out: dict[date, str] = {}
    seen_years = {y for y in years if y}
    if not seen_years:
        seen_years = {date.today().year}
    for year in seen_years:
        try:
            r = (
                supabase.table("checklist_holidays")
                .select("holiday_date, holiday_name")
                .eq("year", year)
                .execute()
            )
            for row in r.data or []:
                d = _parse_iso_date(row.get("holiday_date"))
                if d:
                    out[d] = (row.get("holiday_name") or "Holiday").strip() or "Holiday"
        except Exception as e:
            _log.warning("checklist_holidays load year=%s: %s", year, e)
    return out


def non_working_day_reason(
    on_date: date | None = None,
    *,
    tz_name: str = DEFAULT_EMAIL_CRON_TZ,
) -> str | None:
    """
    Return skip reason if cron emails must not run (Sunday or checklist holiday).
    None means emails may be sent.
    """
    d = on_date or today_for_email_cron(tz_name)
    if d.weekday() == 6:
        return "sunday"
    holidays = load_holidays_map(d.year, d.year - 1, d.year + 1)
    if d in holidays:
        return f"holiday:{holidays[d]}"
    return None


def should_skip_cron_emails(
    *,
    force: bool = False,
    on_date: date | None = None,
    tz_name: str = DEFAULT_EMAIL_CRON_TZ,
) -> tuple[bool, str | None]:
    """When force=True (manual resend), do not skip for Sunday/holiday."""
    if force:
        return False, None
    reason = non_working_day_reason(on_date, tz_name=tz_name)
    if reason:
        return True, reason
    return False, None


def cron_email_skip_response(reason: str, *, module: str = "email") -> dict[str, Any]:
    label = "Sunday" if reason == "sunday" else "holiday"
    detail = reason.split(":", 1)[1] if reason.startswith("holiday:") else None
    msg = (
        f"No {module} emails sent — {label}"
        + (f" ({detail})" if detail else "")
        + ". Cron runs again on the next working day."
    )
    return {
        "status": "skipped",
        "skipped": True,
        "ok": True,
        "email_sent": False,
        "emails_sent": 0,
        "reason": reason,
        "message": msg,
    }


def get_cron_working_day_status(
    *,
    force: bool = False,
    on_date: date | None = None,
    tz_name: str = DEFAULT_EMAIL_CRON_TZ,
) -> dict[str, Any]:
    """Admin/cron helper: whether automated emails should run today (IST by default)."""
    d = on_date or today_for_email_cron(tz_name)
    holidays = load_holidays_map(d.year, d.year - 1, d.year + 1)
    skip, reason = should_skip_cron_emails(force=force, on_date=d, tz_name=tz_name)
    return {
        "date": d.isoformat(),
        "timezone": tz_name,
        "weekday": d.strftime("%A"),
        "is_sunday": d.weekday() == 6,
        "holiday_name": holidays.get(d),
        "skip_cron_emails": skip,
        "skip_reason": reason,
        "force_override": force,
    }
