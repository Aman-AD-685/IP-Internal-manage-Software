"""
Grouped daily reminders for Support tickets: type=feature, approval_status pending (null).
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.supabase_client import supabase
from app.utils.email import get_last_email_error, send_email_detail

_log = logging.getLogger("feature_approval_reminder")

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
DEFAULT_TZ = "Asia/Kolkata"
MAX_RETRIES = 3
RETRY_BASE_SEC = 1.5

# India Standard Time (no DST). Used when ZoneInfo("Asia/Kolkata") fails (Windows without tzdata).
_IST_FIXED = timezone(timedelta(hours=5, minutes=30))


def _notify(msg: str) -> None:
    _log.warning(msg)


def _get_tz(tz_name: str | None):
    """
    Resolve IANA timezone. On Windows, install `tzdata` so all zones work; otherwise Asia/Kolkata falls back to fixed IST.
    """
    name = (tz_name or DEFAULT_TZ).strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except Exception:
        pass
    key = name.lower().replace(" ", "_")
    if key in ("asia/kolkata", "asia/calcutta"):
        return _IST_FIXED
    _notify(f"timezone {name!r} not found — install `tzdata` (pip) or use a standard name; using UTC for this step")
    return timezone.utc


def _frontend_base() -> str:
    from app.public_urls import get_frontend_base

    return get_frontend_base()


def _public_api_base() -> str:
    from app.public_urls import get_public_api_base

    return get_public_api_base()


def _ticket_link(ticket_id: str) -> str:
    return f"{_frontend_base()}/tickets/{ticket_id}"


def valid_email(s: str) -> bool:
    s = (s or "").strip()
    return bool(s and EMAIL_RE.match(s))


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        ts = str(s).replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _format_dt_local(iso: str | None, tz_name: str) -> str:
    dt = _parse_ts(iso)
    if not dt:
        return "—"
    try:
        tz = _get_tz(tz_name or DEFAULT_TZ)
        local = dt.astimezone(tz)
        return local.strftime("%d %b %Y, %H:%M %Z")
    except Exception:
        return str(iso)[:19]


def _pending_duration(iso: str | None) -> str:
    start = _parse_ts(iso)
    if not start:
        return "—"
    try:
        sec = max(0, int((datetime.now(timezone.utc) - start).total_seconds()))
        d, rem = divmod(sec, 86400)
        h, rem = divmod(rem, 3600)
        m = rem // 60
        parts: list[str] = []
        if d:
            parts.append(f"{d}d")
        if h:
            parts.append(f"{h}h")
        if m or not parts:
            parts.append(f"{m}m")
        return " ".join(parts)
    except Exception:
        return "—"


def get_user_display_map(user_ids: list[str]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    ids = [str(x) for x in user_ids if x]
    if not ids:
        return out
    try:
        r = supabase.table("user_profiles").select("id, email, full_name").in_("id", ids).execute()
        for p in r.data or []:
            uid = str(p.get("id", ""))
            out[uid] = {
                "email": (p.get("email") or "").strip(),
                "name": (p.get("full_name") or "").strip() or "User",
            }
    except Exception as e:
        _notify(f"user_profiles load: {e}")
    return out


def list_recipients() -> list[dict[str, Any]]:
    r = (
        supabase.table("feature_approval_email_settings")
        .select("id, email, name, is_enabled, created_at")
        .order("created_at")
        .execute()
    )
    return r.data or []


def add_recipient(email: str, name: str = "") -> dict[str, Any]:
    em = (email or "").strip().lower()
    if not valid_email(em):
        raise ValueError("Invalid email")
    row = {
        "email": em,
        "name": (name or "").strip(),
        "is_enabled": True,
    }
    ins = supabase.table("feature_approval_email_settings").insert(row).execute()
    if not ins.data:
        raise ValueError("Could not add recipient (duplicate email?)")
    return ins.data[0]


def update_recipient(rid: str, *, name: str | None = None, is_enabled: bool | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if name is not None:
        data["name"] = name.strip()
    if is_enabled is not None:
        data["is_enabled"] = bool(is_enabled)
    if not data:
        raise ValueError("No fields to update")
    r = supabase.table("feature_approval_email_settings").update(data).eq("id", rid).execute()
    if not r.data:
        raise ValueError("Recipient not found")
    return r.data[0]


def delete_recipient(rid: str) -> None:
    supabase.table("feature_approval_email_settings").delete().eq("id", rid).execute()


def get_schedule() -> dict[str, Any]:
    r = supabase.table("feature_approval_schedule").select("*").eq("id", 1).limit(1).execute()
    row = (r.data or [None])[0]
    if not row:
        return {
            "id": 1,
            "enabled": True,
            "hour": 8,
            "minute": 7,
            "timezone": DEFAULT_TZ,
            "updated_at": None,
        }
    return row


def upsert_schedule(*, enabled: bool, hour: int, minute: int, timezone_name: str) -> dict[str, Any]:
    row = {
        "id": 1,
        "enabled": enabled,
        "hour": hour,
        "minute": minute,
        "timezone": timezone_name,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("feature_approval_schedule").upsert(row, on_conflict="id").execute()
    return get_schedule()


def log_send(
    *,
    recipient: str,
    subject: str,
    total_pending: int,
    status: str,
    error_message: str | None = None,
) -> None:
    try:
        supabase.table("feature_approval_email_logs").insert(
            {
                "recipient": recipient[:500],
                "subject": subject[:500],
                "total_pending": int(total_pending),
                "status": status[:50],
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "error_message": (error_message or "")[:2000] or None,
            }
        ).execute()
    except Exception as e:
        _notify(f"log failed: {e}")


def recent_logs(limit: int = 40) -> list[dict[str, Any]]:
    lim = max(1, min(200, limit))
    r = (
        supabase.table("feature_approval_email_logs")
        .select("id, recipient, subject, total_pending, status, sent_at, error_message")
        .order("sent_at", desc=True)
        .limit(lim)
        .execute()
    )
    return r.data or []


def _daily_dedup_key() -> str:
    tz = _get_tz(DEFAULT_TZ)
    today = datetime.now(tz).date().isoformat()
    return f"daily:{today}"


def try_claim_dedup(key: str) -> bool:
    try:
        ex = supabase.table("feature_approval_reminder_dedup").select("dedup_key").eq("dedup_key", key).limit(1).execute()
        if ex.data:
            return False
        supabase.table("feature_approval_reminder_dedup").insert({"dedup_key": key}).execute()
        return True
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err or "unique" in err or "23505" in err:
            return False
        _notify(f"dedup insert: {e}")
        return False


def release_dedup(key: str) -> None:
    try:
        supabase.table("feature_approval_reminder_dedup").delete().eq("dedup_key", key).execute()
    except Exception as e:
        _notify(f"dedup release: {e}")


def fetch_pending_feature_tickets() -> list[dict[str, Any]]:
    r = (
        supabase.table("tickets")
        .select(
            "id, reference_no, title, description, company_name, company_id, created_by, created_at, "
            "user_name, submitted_by, approval_status"
        )
        .eq("type", "feature")
        .is_("approval_status", "null")
        .order("created_at")
        .execute()
    )
    rows = r.data or []
    if not rows:
        return rows
    try:
        from app.main import _enrich_tickets_with_lookups

        return _enrich_tickets_with_lookups(rows)
    except Exception as e:
        _notify(f"ticket enrichment: {e}")
        return rows


def _create_email_approval_links(ticket_id: str) -> dict[str, str]:
    """One-time approve / reject / hold links for reminder email (7-day expiry).

    Uses a single token row per ticket; the ?action= query selects approve/reject/hold
    so all three buttons appear even when only one insert succeeds.
    """
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    from app.public_urls import build_approval_email_action_url

    links: dict[str, str] = {}
    token_str: str | None = None
    for action in ("approve", "reject", "hold"):
        if token_str:
            links[action] = build_approval_email_action_url(token_str, action)
            continue
        try:
            ins = (
                supabase.table("approval_tokens")
                .insert({"ticket_id": ticket_id, "action": action, "expires_at": expires})
                .execute()
            )
            row = (ins.data or [None])[0]
            token = row.get("token") if row else None
            if token:
                token_str = str(token)
                links[action] = build_approval_email_action_url(token_str, action)
        except Exception as e:
            _notify(f"approval token create {ticket_id} action={action}: {e}")
    if token_str:
        for action in ("approve", "reject", "hold"):
            if action not in links:
                links[action] = build_approval_email_action_url(token_str, action)
    return links


def _email_action_button(url: str, label: str, *, gradient: str) -> str:
    """Render an email action button only when url is a real one-time approval link."""
    if "/approval/email-action" not in (url or ""):
        return ""
    return (
        f"<a href=\"{html.escape(url)}\" style=\"display:inline-block;margin:2px 4px;padding:8px 14px;"
        f"background:{gradient};color:#fff;text-decoration:none;border-radius:8px;"
        f"font-size:12px;font-weight:700;\">{html.escape(label)}</a>"
    )


def _desc_preview(text: str | None, max_len: int = 160) -> str:
    s = (text or "").strip().replace("\r\n", "\n")
    if not s:
        return "—"
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def _requested_by_label(t: dict[str, Any], user_map: dict[str, dict[str, str]]) -> str:
    un = (t.get("user_name") or "").strip()
    if un:
        return un
    sb = (t.get("submitted_by") or "").strip()
    if sb and "@" not in sb and len(sb) > 2:
        return sb
    cid = str(t.get("created_by") or "")
    if cid and cid in user_map:
        u = user_map[cid]
        if u.get("name"):
            return u["name"]
        if u.get("email"):
            return u["email"]
    return sb or "—"


def _ticket_ref(t: dict[str, Any]) -> str:
    ref = (t.get("reference_no") or "").strip()
    return ref or str(t.get("id", ""))[:8]


def build_reminder_html(pending: list[dict[str, Any]], tz_name: str) -> str:
    del tz_name
    user_map = get_user_display_map([str(t.get("created_by")) for t in pending if t.get("created_by")])
    rows: list[str] = []
    for t in pending:
        tid = str(t["id"])
        links = _create_email_approval_links(tid)
        action_buttons = "".join(
            [
                _email_action_button(
                    links.get("approve", ""),
                    "Approve",
                    gradient="linear-gradient(135deg,#10b981,#059669)",
                ),
                _email_action_button(
                    links.get("reject", ""),
                    "Rejected",
                    gradient="linear-gradient(135deg,#f43f5e,#be123c)",
                ),
                _email_action_button(
                    links.get("hold", ""),
                    "Hold",
                    gradient="linear-gradient(135deg,#f59e0b,#d97706)",
                ),
            ]
        )
        if not action_buttons.strip():
            action_buttons = (
                f'<span style="color:#94a3b8;font-size:12px;">'
                f"Open in app: <a href=\"{html.escape(_ticket_link(tid))}\" style=\"color:#38bdf8;\">"
                f"{html.escape(_ticket_ref(t))}</a></span>"
            )
        company = (t.get("company_name") or "").strip() or "—"
        rows.append(
            "<tr style=\"border-bottom:1px solid rgba(56,189,248,.15);\">"
            f"<td style=\"padding:14px 10px;font-weight:600;color:#e0f2fe;\">{html.escape(_ticket_ref(t))}</td>"
            f"<td style=\"padding:14px 10px;color:#cbd5e1;\">{html.escape(company)}</td>"
            f"<td style=\"padding:14px 10px;color:#f1f5f9;\">{html.escape((t.get('title') or '—'))}</td>"
            f"<td style=\"padding:14px 10px;color:#94a3b8;font-size:12px;line-height:1.45;\">"
            f"{html.escape(_desc_preview(t.get('description')))}</td>"
            f"<td style=\"padding:14px 10px;color:#cbd5e1;\">{html.escape(_requested_by_label(t, user_map))}</td>"
            f"<td style=\"padding:14px 10px;white-space:nowrap;\">{action_buttons}</td></tr>"
        )
    body_rows = "\n".join(rows)
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pending Feature Approval</title></head>
<body style="margin:0;padding:0;background:#030712;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:radial-gradient(ellipse at top,#0f172a 0%,#030712 55%);">
    <tr><td align="center">
      <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;
        border-radius:16px;overflow:hidden;border:1px solid rgba(56,189,248,.35);
        box-shadow:0 0 40px rgba(14,165,233,.12),0 24px 48px rgba(0,0,0,.45);">
        <tr><td style="padding:32px 28px;background:linear-gradient(125deg,#0c4a6e 0%,#1e1b4b 45%,#312e81 100%);">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:#67e8f9;margin-bottom:8px;">IP Internal Management</div>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#f8fafc;">Pending Feature Approval Reminder</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#bae6fd;"><strong style="color:#fff;">{len(pending)}</strong> feature request(s) need your decision.</p>
        </td></tr>
        <tr><td style="padding:20px 16px 24px;background:linear-gradient(180deg,#0f172a 0%,#020617 100%);">
          <div style="overflow-x:auto;border-radius:12px;border:1px solid rgba(56,189,248,.2);">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:640px;">
              <thead>
                <tr style="background:rgba(15,23,42,.9);">
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Ticket ID</th>
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Company</th>
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Title</th>
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Description</th>
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Requested By</th>
                  <th style="padding:12px 10px;text-align:left;color:#38bdf8;font-size:11px;text-transform:uppercase;">Action</th>
                </tr>
              </thead>
              <tbody>{body_rows}</tbody>
            </table>
          </div>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#020617;font-size:11px;color:#64748b;text-align:center;">
          Automated reminder · Do not reply · IP Internal Management Software
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


async def send_with_retries(to_email: str, subject: str, html: str, plain: str) -> tuple[bool, str | None]:
    last_err: str | None = None
    for attempt in range(MAX_RETRIES):
        ok, err = await send_email_detail(to_email, subject, html, plain_fallback=plain)
        if ok:
            return True, None
        last_err = err or "send failed"
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(RETRY_BASE_SEC * (attempt + 1))
    return False, last_err


async def send_test_email(to_email: str) -> tuple[bool, str | None]:
    """Fast test send — no DB token creation, single Postmark API attempt (avoids production timeout)."""
    if not valid_email(to_email):
        return False, "Invalid email"
    html = (
        "<!DOCTYPE html><html><body style=\"font-family:sans-serif;padding:16px\">"
        "<h2>Feature Approval — Test Email</h2>"
        "<p>If you received this, Postmark is configured correctly on the backend.</p>"
        "<p style=\"color:#64748b;font-size:12px\">IP Internal Management Software</p>"
        "</body></html>"
    )
    subj = "[Test] Pending Feature Approval Reminder"
    plain = "Feature approval test email — Postmark delivery OK."
    return await send_email_detail(to_email, subj, html, plain)


async def run_feature_approval_reminder_batch(*, force: bool = False) -> dict[str, Any]:
    """
    One grouped email per enabled recipient when pending feature tickets exist.
    Daily dedup (Asia/Kolkata) unless force=True (manual run).
    """
    sched = get_schedule()
    tz_name = str(sched.get("timezone") or DEFAULT_TZ)
    if not force and not sched.get("enabled", True):
        return {"skipped": True, "reason": "schedule disabled"}

    dedup_key = _daily_dedup_key()
    if not force:
        if not try_claim_dedup(dedup_key):
            return {"skipped": True, "reason": "already_sent_today", "dedup_key": dedup_key}

    try:
        pending = fetch_pending_feature_tickets()
        if not pending:
            if not force:
                release_dedup(dedup_key)
            return {"skipped": True, "reason": "no_pending_tickets"}

        recs = list_recipients()
        targets = [(r["id"], r["email"]) for r in recs if r.get("is_enabled") and valid_email(r.get("email"))]
        if not targets:
            _notify("no enabled recipients")
            if not force:
                release_dedup(dedup_key)
            return {"skipped": True, "reason": "no_recipients", "pending_count": len(pending)}

        html = build_reminder_html(pending, tz_name)
        subj = f"Pending Feature Approval — {len(pending)} ticket(s)"
        plain = f"{len(pending)} feature ticket(s) pending approval. Open {_frontend_base()}/tickets?type=feature&view=approval"

        ok_count = 0
        err_count = 0
        for _rid, em in targets:
            success, err = await send_with_retries(em, subj, html, plain)
            if success:
                ok_count += 1
                log_send(recipient=em, subject=subj, total_pending=len(pending), status="sent")
            else:
                err_count += 1
                log_send(
                    recipient=em,
                    subject=subj,
                    total_pending=len(pending),
                    status="failed",
                    error_message=err,
                )
                _notify(f"send failed {em}: {err}")

        if not force and ok_count == 0 and err_count > 0:
            release_dedup(dedup_key)

        last_err = get_last_email_error()
        if ok_count == 0 and err_count > 0:
            return {
                "ok": False,
                "error": last_err or "All reminder emails failed to send. Check Postmark env on Render.",
                "pending": len(pending),
                "recipients_attempted": len(targets),
                "sent_ok": 0,
                "failed": err_count,
            }

        return {
            "ok": True,
            "pending": len(pending),
            "recipients_attempted": len(targets),
            "sent_ok": ok_count,
            "failed": err_count,
        }
    except Exception as e:
        _notify(f"batch error: {e}")
        if not force:
            release_dedup(dedup_key)
        return {"ok": False, "error": str(e)[:500]}

