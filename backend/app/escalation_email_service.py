"""
Advanced Pending Escalation & Approval Email Configuration — business logic.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from app.escalation_email_templates import (
    build_critical_html,
    build_stage_html,
    build_timeframe_html,
)
from app.reminder_utils import get_chores_bugs_stage, get_staging_feature_stage, is_chores_bug_pending
from app.ticket_na import apply_exclude_ticket_na, ticket_marked_na
from app.supabase_client import supabase
from app.utils.email import send_email_detail

_log = logging.getLogger("escalation_email")

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
DEFAULT_TZ = "Asia/Kolkata"
MAX_RETRIES = 3
RETRY_BASE_SEC = 1.5

CONFIG_TYPES = (
    "pending_timeframe",
    "critical_pending",
    "stage_2",
    "stage_3",
    "stage_4",
)

_IST_FIXED = timezone(timedelta(hours=5, minutes=30))

TICKET_SELECT = (
    "id, reference_no, title, description, type, status, status_1, status_2, status_3, status_4, "
    "quality_solution, staging_planned, staging_review_status, live_review_status, live_status, "
    "assignee_id, user_name, submitted_by, created_by, "
    "created_at, query_arrival_at, planned_2, actual_2, planned_3, actual_3, "
    "planned_4, actual_4, resolved_at, company_name, company_id"
)


def _notify(msg: str) -> None:
    _log.warning(msg)


def _get_tz(tz_name: str | None):
    name = (tz_name or DEFAULT_TZ).strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except Exception:
        pass
    if name.lower() in ("asia/kolkata", "asia/calcutta"):
        return _IST_FIXED
    return timezone.utc


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


def _hours_pending(since_iso: str | None) -> float:
    start = _parse_ts(since_iso)
    if not start:
        return 0.0
    return max(0.0, (datetime.now(timezone.utc) - start).total_seconds() / 3600.0)


def _timeframe_bucket(hours: float) -> str | None:
    if 24 <= hours < 48:
        return "24_48"
    if 48 <= hours < 72:
        return "48_72"
    if hours >= 72:
        return "72_plus"
    return None


def _format_delay(hours: float) -> str:
    if hours < 1:
        return f"{int(hours * 60)}m"
    if hours < 24:
        return f"{int(hours)}h"
    d = int(hours // 24)
    h = int(hours % 24)
    return f"{d}d {h}h" if h else f"{d}d"


def _format_dt_local(iso: str | None, tz_name: str = DEFAULT_TZ) -> str:
    dt = _parse_ts(iso)
    if not dt:
        return "—"
    try:
        local = dt.astimezone(_get_tz(tz_name))
        return local.strftime("%d %b %Y, %H:%M")
    except Exception:
        return str(iso)[:19] if iso else "—"


def _desc_preview(text: str | None, max_len: int = 140) -> str:
    s = (text or "").strip().replace("\r\n", " ")
    if not s:
        return "—"
    return s if len(s) <= max_len else s[: max_len - 1].rstrip() + "…"


def _ticket_ref(t: dict[str, Any]) -> str:
    return (t.get("reference_no") or "").strip() or str(t.get("id", ""))[:8]


def _pending_since_iso(t: dict[str, Any], stage_num: int | None = None) -> str:
    if t.get("staging_planned") or t.get("status_2") == "staging":
        return str(t.get("staging_planned") or t.get("query_arrival_at") or t.get("created_at") or "")
    if stage_num == 3:
        return str(t.get("actual_2") or t.get("planned_3") or t.get("query_arrival_at") or t.get("created_at") or "")
    if stage_num == 4:
        return str(t.get("actual_3") or t.get("planned_4") or t.get("query_arrival_at") or t.get("created_at") or "")
    return str(t.get("query_arrival_at") or t.get("created_at") or "")


def _is_open_ticket(t: dict[str, Any]) -> bool:
    if str(t.get("status_4") or "").lower() in ("completed", "complete", "done"):
        return False
    if t.get("resolved_at"):
        return False
    st = (t.get("status") or "").lower()
    if st in ("completed", "resolved", "closed", "cancelled", "fixed"):
        return False
    if t.get("live_review_status") == "completed" and not t.get("staging_planned"):
        return False
    return True


def _as_profile_uuid(val) -> str | None:
    """Return canonical UUID string if val is a UUID, else None (free-text submitted_by stays out)."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        return str(UUID(s))
    except (ValueError, AttributeError):
        return None


def _collect_escalation_profile_ids(tickets: list[dict[str, Any]]) -> list[str]:
    ids: set[str] = set()
    for t in tickets:
        for key in ("assignee_id", "created_by"):
            u = _as_profile_uuid(t.get(key))
            if u:
                ids.add(u)
        u_sb = _as_profile_uuid(t.get("submitted_by"))
        if u_sb:
            ids.add(u_sb)
    return sorted(ids)


def _assignee_display(t: dict[str, Any], user_map: dict[str, str]) -> str:
    """Internal assignee from profile first; fall back to company user_name and other ticket fields."""
    aid = _as_profile_uuid(t.get("assignee_id"))
    if aid:
        dn = user_map.get(aid)
        if dn and dn.strip():
            return dn.strip()

    user_nm = (t.get("user_name") or "").strip()
    if user_nm:
        return user_nm

    sb_raw = (t.get("submitted_by") or "").strip()
    if sb_raw:
        sb_uid = _as_profile_uuid(sb_raw)
        if sb_uid:
            dn = user_map.get(sb_uid)
            if dn and dn.strip():
                return dn.strip()
        return sb_raw

    cid = _as_profile_uuid(t.get("created_by"))
    if cid:
        dn = user_map.get(cid)
        if dn and dn.strip():
            return dn.strip()

    return "—"


def get_user_display_map(user_ids: list[str]) -> dict[str, str]:
    """Resolve display names; keys are canonical lowercase UUID strings."""
    out: dict[str, str] = {}
    raw_ids = sorted({str(x).strip() for x in user_ids if x and str(x).strip()})
    if not raw_ids:
        return out
    chunk = 100
    for i in range(0, len(raw_ids), chunk):
        part = raw_ids[i : i + chunk]
        try:
            r = supabase.table("user_profiles").select("id, email, full_name").in_("id", part).execute()
            for p in r.data or []:
                raw = p.get("id")
                if not raw:
                    continue
                try:
                    uid = str(UUID(str(raw)))
                except (ValueError, TypeError):
                    uid = str(raw).strip()
                if uid:
                    out[uid] = (p.get("full_name") or "").strip() or (p.get("email") or "").strip() or "User"
        except Exception as e:
            _notify(f"user_profiles: {e}")
    return out


def _normalize_company_name_key(name: str | None) -> str:
    """Lowercase, underscores → spaces, collapse whitespace (Demo_c → demo c)."""
    return " ".join((name or "").strip().lower().replace("_", " ").split())


def _ticket_is_demo_c_excluded(t: dict[str, Any]) -> bool:
    """Match dashboard logic: exclude Demo C / Demo_c from escalation emails."""
    bn = _normalize_company_name_key(t.get("company_name"))
    return bn in ("demo c", "democ")


def _hydrate_missing_company_names(tickets: list[dict[str, Any]]) -> None:
    """Fill empty company_name from companies table when company_id is set."""
    ids = sorted(
        {
            str(t["company_id"])
            for t in tickets
            if t.get("company_id") and not (str(t.get("company_name") or "").strip())
        }
    )
    if not ids:
        return
    by_id: dict[str, str] = {}
    chunk = 120
    for i in range(0, len(ids), chunk):
        part = ids[i : i + chunk]
        try:
            r = supabase.table("companies").select("id,name").in_("id", part).execute()
            for row in r.data or []:
                cid = str(row.get("id") or "")
                if cid:
                    by_id[cid] = (row.get("name") or "").strip()
        except Exception as e:
            _notify(f"escalation companies lookup: {e}")
    for t in tickets:
        cid = str(t.get("company_id") or "")
        if not cid or (str(t.get("company_name") or "").strip()):
            continue
        n = by_id.get(cid)
        if n:
            t["company_name"] = n


def _sort_escalation_by_hours_desc(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda x: float(x.get("hours") or 0), reverse=True)


def _group_timeframe_sorted(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {"24_48": [], "48_72": [], "72_plus": []}
    for it in items:
        b = it.get("bucket")
        if b in grouped:
            grouped[b].append(it)
    for k in grouped:
        grouped[k] = _sort_escalation_by_hours_desc(grouped[k])
    return grouped


def _sort_critical_sections(sections: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    return {label: _sort_escalation_by_hours_desc(rows) for label, rows in sections.items()}


def _to_row(t: dict[str, Any], user_map: dict[str, str], stage_num: int | None = None) -> dict[str, Any]:
    since = _pending_since_iso(t, stage_num)
    hours = _hours_pending(since)
    if t.get("type") in ("chore", "bug"):
        stage = get_chores_bugs_stage(t)
        stage_label = stage["stage_label"]
    else:
        stage = get_staging_feature_stage(t)
        stage_label = stage["stage_label"]
    return {
        "reference": _ticket_ref(t),
        "company": (t.get("company_name") or "").strip() or "—",
        "title": (t.get("title") or "—")[:120],
        "description": _desc_preview(t.get("description")),
        "assignee": _assignee_display(t, user_map),
        "stage_label": stage_label,
        "pending_since": _format_dt_local(since),
        "delay": _format_delay(hours),
        "hours": hours,
        "ticket_type": (t.get("type") or "—").capitalize(),
    }


# ---------------------------------------------------------------------------
# Config & recipients (DB)
# ---------------------------------------------------------------------------


def ensure_configs() -> None:
    for ctype, label in [
        ("pending_timeframe", "Pending Timeframe Escalation"),
        ("critical_pending", "Critical Pending Escalation"),
        ("stage_2", "Stage 2 Pending"),
        ("stage_3", "Stage 3 Pending"),
        ("stage_4", "Stage 4 Pending"),
    ]:
        try:
            ex = (
                supabase.table("escalation_email_config")
                .select("id")
                .eq("configuration_type", ctype)
                .limit(1)
                .execute()
            )
            if not ex.data:
                supabase.table("escalation_email_config").insert(
                    {"configuration_type": ctype, "stage_name": label, "is_enabled": True}
                ).execute()
        except Exception as e:
            _notify(f"ensure_configs {ctype}: {e}")


def list_all_configs() -> list[dict[str, Any]]:
    ensure_configs()
    r = supabase.table("escalation_email_config").select("*").order("configuration_type").execute()
    configs = r.data or []
    rec_r = supabase.table("escalation_email_receivers").select("*").order("created_at").execute()
    receivers = rec_r.data or []
    by_config: dict[str, list] = {}
    for rec in receivers:
        cid = str(rec.get("config_id", ""))
        by_config.setdefault(cid, []).append(rec)
    out = []
    for c in configs:
        cid = str(c["id"])
        out.append({**c, "receivers": by_config.get(cid, [])})
    return out


def get_config_by_type(configuration_type: str) -> dict[str, Any] | None:
    r = (
        supabase.table("escalation_email_config")
        .select("*")
        .eq("configuration_type", configuration_type)
        .limit(1)
        .execute()
    )
    return (r.data or [None])[0]


def patch_config(configuration_type: str, *, is_enabled: bool | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if is_enabled is not None:
        data["is_enabled"] = bool(is_enabled)
    r = (
        supabase.table("escalation_email_config")
        .update(data)
        .eq("configuration_type", configuration_type)
        .execute()
    )
    if not r.data:
        raise ValueError("Configuration not found")
    return r.data[0]


def add_receivers(
    configuration_type: str,
    emails: list[str],
    *,
    created_by: str | None = None,
) -> list[dict[str, Any]]:
    cfg = get_config_by_type(configuration_type)
    if not cfg:
        raise ValueError("Configuration not found")
    config_id = cfg["id"]
    added: list[dict[str, Any]] = []
    for raw in emails:
        em = raw.strip().lower()
        if not em or not valid_email(em):
            continue
        try:
            row = {
                "config_id": config_id,
                "email": em,
                "is_enabled": True,
                "created_by": created_by,
            }
            ins = supabase.table("escalation_email_receivers").insert(row).execute()
            if ins.data:
                added.append(ins.data[0])
        except Exception as e:
            err = str(e).lower()
            if "duplicate" not in err and "unique" not in err and "23505" not in err:
                _notify(f"add_receiver {em}: {e}")
    return added


def parse_bulk_emails(text: str) -> list[str]:
    parts = re.split(r"[,;\s]+", (text or "").strip())
    return [p.strip().lower() for p in parts if p.strip() and valid_email(p.strip())]


def update_receiver(receiver_id: str, *, is_enabled: bool | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if is_enabled is not None:
        data["is_enabled"] = bool(is_enabled)
    if not data:
        raise ValueError("No fields to update")
    r = supabase.table("escalation_email_receivers").update(data).eq("id", receiver_id).execute()
    if not r.data:
        raise ValueError("Recipient not found")
    return r.data[0]


def delete_receiver(receiver_id: str) -> None:
    supabase.table("escalation_email_receivers").delete().eq("id", receiver_id).execute()


def _enabled_recipients(configuration_type: str) -> list[str]:
    cfg = get_config_by_type(configuration_type)
    if not cfg or not cfg.get("is_enabled"):
        return []
    rec_r = (
        supabase.table("escalation_email_receivers")
        .select("email, is_enabled")
        .eq("config_id", cfg["id"])
        .execute()
    )
    return [
        (r.get("email") or "").strip().lower()
        for r in (rec_r.data or [])
        if r.get("is_enabled") and valid_email(r.get("email"))
    ]


# ---------------------------------------------------------------------------
# Ticket queries
# ---------------------------------------------------------------------------


def _fetch_escalation_tickets() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        cb = apply_exclude_ticket_na(
            supabase.table("tickets")
            .select(TICKET_SELECT)
            .in_("type", ["chore", "bug"])
            .is_("quality_solution", "null")
        ).execute()
        rows.extend(cb.data or [])
    except Exception as e:
        _notify(f"fetch chores/bugs: {e}")
    try:
        st = (
            supabase.table("tickets")
            .select(TICKET_SELECT)
            .or_("staging_planned.not.is.null,status_2.eq.staging")
            .or_("live_review_status.is.null,live_review_status.neq.completed")
            .execute()
        )
        seen = {str(t["id"]) for t in rows}
        for t in st.data or []:
            if str(t["id"]) not in seen:
                rows.append(t)
                seen.add(str(t["id"]))
    except Exception as e:
        _notify(f"fetch staging: {e}")
    open_ts = [t for t in rows if _is_open_ticket(t) and not ticket_marked_na(t)]
    _hydrate_missing_company_names(open_ts)
    return [t for t in open_ts if not _ticket_is_demo_c_excluded(t)]


def _eligible_timeframe_items() -> list[dict[str, Any]]:
    tickets = _fetch_escalation_tickets()
    user_map = get_user_display_map(_collect_escalation_profile_ids(tickets))
    items: list[dict[str, Any]] = []
    for t in tickets:
        if t.get("type") in ("chore", "bug") and not is_chores_bug_pending(t):
            continue
        row = _to_row(t, user_map)
        bucket = _timeframe_bucket(row["hours"])
        if bucket:
            row["bucket"] = bucket
            items.append(row)
    return items


def _eligible_critical_items() -> dict[str, list[dict[str, Any]]]:
    tickets = _fetch_escalation_tickets()
    user_map = get_user_display_map(_collect_escalation_profile_ids(tickets))
    chores: list[dict[str, Any]] = []
    bugs: list[dict[str, Any]] = []
    staging: list[dict[str, Any]] = []
    for t in tickets:
        row = _to_row(t, user_map)
        if row["hours"] < 72:
            continue
        tp = t.get("type")
        if tp == "chore":
            chores.append(row)
        elif tp == "bug":
            bugs.append(row)
        elif t.get("staging_planned") or t.get("status_2") == "staging":
            staging.append(row)
        elif tp in ("chore", "bug"):
            if tp == "chore":
                chores.append(row)
            else:
                bugs.append(row)
    return _sort_critical_sections({"Chores": chores, "Bugs": bugs, "Staging": staging})


def _eligible_stage_items(stage_num: int) -> list[dict[str, Any]]:
    tickets = _fetch_escalation_tickets()
    user_map = get_user_display_map(_collect_escalation_profile_ids(tickets))
    items: list[dict[str, Any]] = []
    for t in tickets:
        if t.get("type") not in ("chore", "bug"):
            continue
        stage = get_chores_bugs_stage(t)
        if stage.get("stage_num") != stage_num:
            continue
        row = _to_row(t, user_map, stage_num)
        items.append(row)
    return _sort_escalation_by_hours_desc(items)


# ---------------------------------------------------------------------------
# Dedup, logs, send
# ---------------------------------------------------------------------------


def _daily_dedup_key(configuration_type: str) -> str:
    tz = _get_tz(DEFAULT_TZ)
    today = datetime.now(tz).date().isoformat()
    return f"{configuration_type}:daily:{today}"


def try_claim_dedup(key: str) -> bool:
    try:
        ex = supabase.table("escalation_reminder_dedup").select("dedup_key").eq("dedup_key", key).limit(1).execute()
        if ex.data:
            return False
        supabase.table("escalation_reminder_dedup").insert({"dedup_key": key}).execute()
        return True
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err or "unique" in err or "23505" in err:
            return False
        _notify(f"dedup: {e}")
        return False


def release_dedup(key: str) -> None:
    try:
        supabase.table("escalation_reminder_dedup").delete().eq("dedup_key", key).execute()
    except Exception as e:
        _notify(f"release_dedup: {e}")


def log_send(
    *,
    configuration_type: str,
    recipient: str,
    subject: str,
    total_pending: int,
    status: str,
    error_message: str | None = None,
    metadata: dict | None = None,
) -> str | None:
    try:
        ins = supabase.table("escalation_send_logs").insert(
            {
                "configuration_type": configuration_type,
                "recipient": recipient[:500],
                "subject": subject[:500],
                "total_pending": int(total_pending),
                "status": status[:50],
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "error_message": (error_message or "")[:2000] or None,
                "metadata": metadata or {},
            }
        ).execute()
        if ins.data:
            return str(ins.data[0].get("id", ""))
    except Exception as e:
        _notify(f"log_send: {e}")
    return None


def log_manual_trigger(
    *,
    configuration_type: str,
    triggered_by: str | None,
    trigger_source: str,
    force_bypass: bool,
    result: dict,
) -> None:
    try:
        supabase.table("escalation_manual_trigger_logs").insert(
            {
                "configuration_type": configuration_type,
                "triggered_by": triggered_by,
                "trigger_source": trigger_source,
                "force_bypass": force_bypass,
                "result": result,
            }
        ).execute()
    except Exception as e:
        _notify(f"manual_trigger_log: {e}")


def _touch_last_sent(configuration_type: str) -> None:
    try:
        supabase.table("escalation_email_config").update(
            {"last_sent_at": datetime.now(timezone.utc).isoformat()}
        ).eq("configuration_type", configuration_type).execute()
    except Exception as e:
        _notify(f"last_sent_at: {e}")


def recent_logs(limit: int = 50, configuration_type: str | None = None) -> list[dict[str, Any]]:
    lim = max(1, min(200, limit))
    q = supabase.table("escalation_send_logs").select("*").order("sent_at", desc=True).limit(lim)
    if configuration_type:
        q = q.eq("configuration_type", configuration_type)
    return (q.execute().data or [])


def recent_manual_triggers(limit: int = 30) -> list[dict[str, Any]]:
    lim = max(1, min(100, limit))
    r = (
        supabase.table("escalation_manual_trigger_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(lim)
        .execute()
    )
    return r.data or []


async def send_with_retries(to_email: str, subject: str, html_body: str, plain: str) -> tuple[bool, str | None]:
    last_err: str | None = None
    for attempt in range(MAX_RETRIES):
        ok, err = await send_email_detail(to_email, subject, html_body, plain_fallback=plain)
        if ok:
            return True, None
        last_err = err or "send failed"
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(RETRY_BASE_SEC * (attempt + 1))
    return False, last_err


async def preview_html(configuration_type: str) -> str:
    if configuration_type == "pending_timeframe":
        items = _eligible_timeframe_items()
        grouped = _group_timeframe_sorted(items)
        critical = len(grouped["72_plus"])
        return build_timeframe_html(grouped, total=len(items), critical_count=critical)
    if configuration_type == "critical_pending":
        sections = _eligible_critical_items()
        total = sum(len(v) for v in sections.values())
        return build_critical_html(sections, total)
    if configuration_type in ("stage_2", "stage_3", "stage_4"):
        sn = int(configuration_type.split("_")[1])
        return build_stage_html(sn, _eligible_stage_items(sn))
    raise ValueError("Unknown configuration type")


async def send_test_email(configuration_type: str, to_email: str) -> tuple[bool, str | None]:
    if not valid_email(to_email):
        return False, "Invalid email"
    body = await preview_html(configuration_type)
    subj = f"[Test] Escalation — {configuration_type}"
    return await send_with_retries(to_email, subj, body, "Test escalation email — see HTML version.")


async def retry_failed_log(log_id: str) -> dict[str, Any]:
    r = supabase.table("escalation_send_logs").select("*").eq("id", log_id).limit(1).execute()
    row = (r.data or [None])[0]
    if not row or row.get("status") != "failed":
        raise ValueError("Log not found or not failed")
    ctype = row["configuration_type"]
    body = await preview_html(ctype)
    subj = row.get("subject") or f"Escalation retry — {ctype}"
    ok, err = await send_with_retries(row["recipient"], subj, body, "Escalation retry")
    log_send(
        configuration_type=ctype,
        recipient=row["recipient"],
        subject=subj,
        total_pending=row.get("total_pending") or 0,
        status="sent" if ok else "failed",
        error_message=err,
        metadata={"retry_of": log_id},
    )
    return {"ok": ok, "error": err}


async def run_escalation_batch(
    configuration_type: str,
    *,
    force: bool = False,
    triggered_by: str | None = None,
    trigger_source: str = "cron",
) -> dict[str, Any]:
    if configuration_type not in CONFIG_TYPES:
        return {"ok": False, "error": "invalid configuration_type"}

    cfg = get_config_by_type(configuration_type)
    if not cfg:
        return {"skipped": True, "reason": "config_missing"}
    if not force and not cfg.get("is_enabled"):
        return {"skipped": True, "reason": "disabled"}

    dedup_key = _daily_dedup_key(configuration_type)
    if not force:
        if not try_claim_dedup(dedup_key):
            return {"skipped": True, "reason": "already_sent_today", "dedup_key": dedup_key}

    try:
        recipients = _enabled_recipients(configuration_type)
        if not recipients:
            if not force:
                release_dedup(dedup_key)
            return {"skipped": True, "reason": "no_recipients"}

        if configuration_type == "pending_timeframe":
            items = _eligible_timeframe_items()
            if not items:
                if not force:
                    release_dedup(dedup_key)
                return {"skipped": True, "reason": "no_tickets"}
            grouped = _group_timeframe_sorted(items)
            html_body = build_timeframe_html(
                grouped, total=len(items), critical_count=len(grouped["72_plus"])
            )
            subj = "[Pending Escalation Report] Tickets Pending in Different Timeframes"
            meta = {k: len(v) for k, v in grouped.items()}
            total = len(items)

        elif configuration_type == "critical_pending":
            sections = _eligible_critical_items()
            total = sum(len(v) for v in sections.values())
            if not total:
                if not force:
                    release_dedup(dedup_key)
                return {"skipped": True, "reason": "no_tickets"}
            html_body = build_critical_html(sections, total)
            subj = f"[CRITICAL] Pending Escalation — {total} ticket(s) 72hr+"
            meta = {k: len(v) for k, v in sections.items()}

        else:
            sn = int(configuration_type.split("_")[1])
            items = _eligible_stage_items(sn)
            if not items:
                if not force:
                    release_dedup(dedup_key)
                return {"skipped": True, "reason": "no_tickets"}
            html_body = build_stage_html(sn, items)
            subj = f"[Stage {sn}] Pending Notification — {len(items)} ticket(s)"
            meta = {"count": len(items)}
            total = len(items)

        plain = f"Escalation {configuration_type}: {total} ticket(s). Open the HTML email for details."
        ok_count = 0
        err_count = 0
        for em in recipients:
            success, err = await send_with_retries(em, subj, html_body, plain)
            if success:
                ok_count += 1
                log_send(
                    configuration_type=configuration_type,
                    recipient=em,
                    subject=subj,
                    total_pending=total,
                    status="sent",
                    metadata=meta,
                )
            else:
                err_count += 1
                log_send(
                    configuration_type=configuration_type,
                    recipient=em,
                    subject=subj,
                    total_pending=total,
                    status="failed",
                    error_message=err,
                    metadata=meta,
                )

        if ok_count > 0:
            _touch_last_sent(configuration_type)

        if not force and ok_count == 0 and err_count > 0:
            release_dedup(dedup_key)

        from app.utils.email import get_last_email_error

        last_err = get_last_email_error()
        if ok_count == 0 and err_count > 0:
            return {
                "ok": False,
                "error": last_err or "All escalation emails failed. Check Postmark on Render.",
                "configuration_type": configuration_type,
                "pending": total,
                "recipients_attempted": len(recipients),
                "sent_ok": 0,
                "failed": err_count,
            }

        result = {
            "ok": True,
            "configuration_type": configuration_type,
            "pending": total,
            "recipients_attempted": len(recipients),
            "sent_ok": ok_count,
            "failed": err_count,
        }
        log_manual_trigger(
            configuration_type=configuration_type,
            triggered_by=triggered_by,
            trigger_source=trigger_source,
            force_bypass=force,
            result=result,
        )
        return result
    except Exception as e:
        _notify(f"batch {configuration_type}: {e}")
        if not force:
            release_dedup(dedup_key)
        return {"ok": False, "error": str(e)[:500]}


async def run_all_stage_batches(*, force: bool = False, triggered_by: str | None = None) -> dict[str, Any]:
    results = {}
    for ctype in ("stage_2", "stage_3", "stage_4"):
        results[ctype] = await run_escalation_batch(
            ctype, force=force, triggered_by=triggered_by, trigger_source="cron"
        )
    return {"ok": True, "results": results}


def get_pending_stats() -> dict[str, Any]:
    tf = _eligible_timeframe_items()
    grouped = {"24_48": 0, "48_72": 0, "72_plus": 0}
    for it in tf:
        grouped[it["bucket"]] = grouped.get(it["bucket"], 0) + 1
    crit = _eligible_critical_items()
    crit_total = sum(len(v) for v in crit.values())
    stages = {
        f"stage_{n}": len(_eligible_stage_items(n)) for n in (2, 3, 4)
    }
    return {
        "timeframe": grouped,
        "timeframe_total": len(tf),
        "critical_total": crit_total,
        "stages": stages,
    }
