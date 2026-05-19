"""
Soumya Dashboard — Section 5.1 Core KPI metrics + delay-ranked ticket list.
Uses tickets table (+ optional soumya_sla_weekly_snapshots for trends).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import logging

from app.kpi_calendar_week import (
    get_kpi_calendar_week_range,
    kpi_max_week_index_in_month,
    week_of_month_for_date,
)
from app.reminder_utils import get_chores_bugs_stage, is_chores_bug_pending
from app.supabase_client import supabase

_log = logging.getLogger("soumya_dashboard_kpi")

_SLA_OPTIONAL_COLS = (
    "stage2_entry_at,committed_deadline,closed_at,sla_priority,"
    "deadline_email_sent_at,ack_received_at,interrupted_by_urgent"
)

_PLACEHOLDER_COMPANY_NAMES = frozenset(
    {
        "demo",
        "demo company",
        "demo c",
        "democ",
        "demo_c",
        "company a",
        "company b",
        "company c",
        "all company",
        "unknown",
        "n/a",
        "na",
        "test",
        "sample",
        "null",
        "none",
    }
)

# Generic FK labels — never use as display name; fall back to ref map / stored name.
_GENERIC_COMPANY_LABELS = frozenset({"company a", "company b", "company c", "all company"})

# Legacy bulk-import bucket (maps to "Company A" in companies table)
_ALL_COMPANY_PLACEHOLDER_IDS = frozenset({"2142d04b-67bc-4a7f-bd80-47cff23aa379"})

_REF_NO_TO_COMPANY: dict[str, str] = {}
_REF_NO_TO_COMPANY_LOADED = False

_OLD_REF_PATTERN = re.compile(
    r"old\s*ref\s*:\s*((?:EX-)?(?:CH|BU|FE)-[0-9]+)",
    re.IGNORECASE,
)

_TICKET_COLS = (
    "id,reference_no,title,description,type,company_id,company_name,priority,created_at,query_arrival_at,"
    "status,status_1,actual_1,planned_2,status_2,actual_2,status_3,actual_3,status_4,actual_4,"
    "quality_solution,query_response_at,assignee_id,staging_planned,live_review_status,"
    + _SLA_OPTIONAL_COLS
)

_TICKET_COLS_CORE = (
    "id,reference_no,title,description,type,company_id,company_name,priority,created_at,query_arrival_at,"
    "status,status_1,actual_1,planned_2,status_2,actual_2,status_3,actual_3,status_4,actual_4,"
    "quality_solution,query_response_at,assignee_id,staging_planned,live_review_status"
)

_HOUR = 3600.0
_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_RANKED_PAGE_DEFAULT = 25


def _is_demo_c_company(t: dict) -> bool:
    """Exclude Demo C / generic placeholder companies from Soumya KPI scope."""
    cn = (t.get("company_name") or "").strip().lower()
    if cn in ("demo_c", "demo c", "democ") or _is_placeholder_company_name(cn):
        return True
    cid = t.get("company_id")
    if cid and str(cid) in _ALL_COMPANY_PLACEHOLDER_IDS:
        return True
    return False


def _exclude_demo_c(tickets: list[dict]) -> list[dict]:
    return [t for t in tickets if not _is_demo_c_company(t)]


def _parse_month_num(month: str) -> int:
    key = (month or "").strip()[:3].title()
    for i, name in enumerate(_MONTH_NAMES, 1):
        if name.lower() == key.lower():
            return i
    return datetime.now().month


def _parse_week_num(week: str) -> int:
    m = re.search(r"\d+", week or "")
    return max(1, int(m.group())) if m else 1


def _parse_iso_date(val: Any) -> date | None:
    if val is None or (isinstance(val, str) and not str(val).strip()):
        return None
    try:
        if isinstance(val, date) and not isinstance(val, datetime):
            return val
        if isinstance(val, datetime):
            return val.date()
        s = str(val).strip()
        if "T" in s or " " in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s[:10])
    except Exception:
        return None


def _ticket_arrival_date(t: dict) -> date | None:
    return _parse_iso_date(t.get("query_arrival_at")) or _parse_iso_date(t.get("created_at"))


def _tickets_arrival_in_range(tickets: list[dict], range_start: date, range_end: date) -> list[dict]:
    out: list[dict] = []
    for t in tickets:
        d = _ticket_arrival_date(t)
        if d is not None and range_start <= d <= range_end:
            out.append(t)
    return out


def _closed_in_range(t: dict, range_start: date, range_end: date) -> bool:
    closed = _closed_at(t)
    if not closed:
        return False
    d = closed.date() if isinstance(closed, datetime) else _parse_iso_date(closed)
    return d is not None and range_start <= d <= range_end


def _tickets_closed_in_range(tickets: list[dict], range_start: date, range_end: date) -> list[dict]:
    return [t for t in tickets if _closed_in_range(t, range_start, range_end)]


def _parse_dt(val: Any) -> datetime | None:
    if val is None or (isinstance(val, str) and not str(val).strip()):
        return None
    try:
        s = str(val).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hours_between(start: datetime | None, end: datetime | None) -> float | None:
    if not start or not end:
        return None
    return max(0.0, (end - start).total_seconds() / _HOUR)


def _week_start(d: date | None = None) -> date:
    d = d or _now().date()
    return d - timedelta(days=d.weekday())


def _end_of_day_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)


def _kpi_as_of(range_end: date) -> datetime:
    """Past KPI weeks are measured at week end; current week uses now."""
    if range_end >= _now().date():
        return _now()
    return _end_of_day_utc(range_end)


def _stage2_entry(t: dict) -> datetime | None:
    return (
        _parse_dt(t.get("stage2_entry_at"))
        or _parse_dt(t.get("actual_1"))
        or _parse_dt(t.get("planned_2"))
        or _parse_dt(t.get("query_arrival_at"))
        or _parse_dt(t.get("created_at"))
    )


def _is_chore_bug(t: dict) -> bool:
    return str(t.get("type") or "").lower() in ("chore", "bug")


def _is_at_stage2_open(t: dict) -> bool:
    """Chores/bugs in Stage 2 development (aligned with Support FMS / reminder_utils)."""
    if not _is_chore_bug(t):
        return False
    if not is_chores_bug_pending(t):
        return False
    if str(t.get("status_4") or "").lower() == "completed":
        return False
    s1 = str(t.get("status_1") or "").strip().lower()
    s2 = str(t.get("status_2") or "").strip().lower()
    if s1 in ("yes",):
        return False
    if s2 in ("completed", "rejected"):
        return False
    # Explicit Stage 2 queue: response done (no) + dev not finished
    if s1 in ("", "no") and s2 in ("pending", "hold", "staging", ""):
        return True
    return get_chores_bugs_stage(t).get("stage_num") == 2


def _closed_at(t: dict) -> datetime | None:
    return _parse_dt(t.get("closed_at")) or _parse_dt(t.get("actual_4"))


def _is_closed(t: dict) -> bool:
    if str(t.get("status_4") or "").lower() == "completed":
        return True
    return _closed_at(t) is not None


def _is_placeholder_company_name(name: str | None) -> bool:
    if not name:
        return True
    normalized = str(name).strip().lower()
    if not normalized or normalized in ("null", "none", "-"):
        return True
    return normalized in _PLACEHOLDER_COMPANY_NAMES


def _is_generic_company_label(name: str | None) -> bool:
    if not name:
        return False
    return str(name).strip().lower() in _GENERIC_COMPANY_LABELS


def _normalize_company_display(name: str) -> str:
    n = (name or "").strip()
    low = n.lower()
    if low in ("demo_c", "democ", "demo c"):
        return "Demo C"
    return n


def _old_ref_from_description(t: dict) -> str | None:
    """Parse 'Old Ref: CH-0037' style links from ticket description."""
    desc = t.get("description") or ""
    m = _OLD_REF_PATTERN.search(desc)
    if not m:
        return None
    return m.group(1).strip().upper()


def _build_ref_no_to_company_map() -> dict[str, str]:
    """reference_no -> best known company name (from tickets with real company names)."""
    global _REF_NO_TO_COMPANY, _REF_NO_TO_COMPANY_LOADED
    if _REF_NO_TO_COMPANY_LOADED:
        return _REF_NO_TO_COMPANY
    _REF_NO_TO_COMPANY_LOADED = True
    try:
        r = (
            supabase.table("tickets")
            .select("reference_no, company_id, company_name")
            .in_("type", ["chore", "bug"])
            .execute()
        )
        rows = list(r.data or [])
        company_ids = {row.get("company_id") for row in rows if row.get("company_id")}
        companies_map: dict[str, str] = {}
        if company_ids:
            cr = (
                supabase.table("companies")
                .select("id,name")
                .in_("id", list(company_ids))
                .execute()
            )
            companies_map = {
                c["id"]: (c.get("name") or "").strip()
                for c in (cr.data or [])
                if c.get("id")
            }
        for row in rows:
            ref = (row.get("reference_no") or "").strip()
            if not ref:
                continue
            name = _pick_company_name(row, companies_map, _REF_NO_TO_COMPANY)
            if name:
                _REF_NO_TO_COMPANY.setdefault(ref, name)
    except Exception as e:
        _log.warning("soumya ref_no_to_company: %s", e)
    return _REF_NO_TO_COMPANY


def _pick_company_name(
    row: dict, companies_map: dict[str, str], ref_map: dict[str, str]
) -> str:
    """Stored name, ref index, then companies FK — skip only generic Company A/B/C style labels."""
    cid = row.get("company_id")
    from_id = (companies_map.get(cid) or "").strip() if cid else ""
    stored = (row.get("company_name") or "").strip()
    from_ref = (ref_map.get((row.get("reference_no") or "").strip()) or "").strip()
    for candidate in (stored, from_ref, from_id):
        if not candidate:
            continue
        low = candidate.lower()
        if low in ("demo c", "demo_c", "democ"):
            return "Demo C"
        if _is_generic_company_label(candidate):
            continue
        if _is_placeholder_company_name(candidate) and low not in ("demo c", "demo_c", "democ"):
            continue
        return _normalize_company_display(candidate)
    return ""


def _resolve_company_display(
    t: dict, companies_map: dict[str, str], ref_map: dict[str, str]
) -> str:
    name = _pick_company_name(t, companies_map, ref_map)
    if name:
        return name
    old_ref = _old_ref_from_description(t)
    if old_ref:
        linked = (ref_map.get(old_ref) or "").strip()
        if linked and not _is_placeholder_company_name(linked):
            return linked
    return ""


def _enrich_company_names(tickets: list[dict]) -> list[dict]:
    if not tickets:
        return tickets
    ref_map = _build_ref_no_to_company_map()
    company_ids = {t.get("company_id") for t in tickets if t.get("company_id")}
    companies_map: dict[str, str] = {}
    if company_ids:
        try:
            r = (
                supabase.table("companies")
                .select("id,name")
                .in_("id", list(company_ids))
                .execute()
            )
            companies_map = {c["id"]: (c.get("name") or "").strip() for c in (r.data or []) if c.get("id")}
        except Exception as e:
            _log.warning("soumya enrich companies: %s", e)
    for t in tickets:
        resolved = _resolve_company_display(t, companies_map, ref_map)
        t["company_name"] = resolved or "—"
    return tickets


def _fetch_tickets(limit: int = 5000) -> list[dict]:
    """Load chores/bugs; retry with fewer columns if migration columns are missing."""
    for cols in (_TICKET_COLS, _TICKET_COLS_CORE):
        try:
            r = (
                supabase.table("tickets")
                .select(cols)
                .in_("type", ["chore", "bug"])
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return _enrich_company_names(list(r.data or []))
        except Exception as e:
            _log.warning("soumya kpi fetch tickets (%s): %s", cols[:40], e)
    return []


def _has_response_delay(t: dict) -> tuple[bool, float]:
    """30-minute response SLA (same as Support dashboard)."""
    qa = _parse_dt(t.get("query_arrival_at")) or _parse_dt(t.get("created_at"))
    qr = _parse_dt(t.get("query_response_at"))
    now = _now()
    if not qa:
        return False, 0.0
    if not qr:
        overdue_h = max(0.0, (_hours_between(qa, now) or 0.0) - 0.5)
        return overdue_h > 0, overdue_h
    delay_h = _hours_between(qa, qr) or 0.0
    return delay_h > 0.5, delay_h


def _pending_overdue_hours(t: dict) -> float:
    """Hours past 24h from submit while still pending (Support FMS style)."""
    if not is_chores_bug_pending(t):
        return 0.0
    submitted = _parse_dt(t.get("query_arrival_at")) or _parse_dt(t.get("created_at"))
    if not submitted:
        return 0.0
    age_h = _hours_between(submitted, _now()) or 0.0
    return max(0.0, age_h - 24.0)


def _delay_score(t: dict) -> tuple[int, float, list[str]]:
    """Higher score = more delays. Returns (score, primary_hours, delay_types)."""
    types: list[str] = []
    score = 0
    hours = 0.0
    now = _now()

    if _is_at_stage2_open(t):
        entry = _stage2_entry(t)
        if entry:
            age_h = _hours_between(entry, now) or 0.0
            hours = max(hours, age_h)
            if age_h >= 72:
                score += 3
                types.append("Stage 2 breach 72hr+")
            elif age_h > 24:
                score += 2
                types.append("Stage 2 warning 24–72hr")
            elif age_h > 0:
                score += 1
                types.append("Stage 2 active")

    resp_late, resp_h = _has_response_delay(t)
    if resp_late and not _is_closed(t):
        score += 2
        types.append("Response SLA")
        hours = max(hours, resp_h)

    overdue_h = _pending_overdue_hours(t)
    if overdue_h > 0:
        score += 1
        types.append("Pending overdue 24hr+")
        hours = max(hours, overdue_h + 24)

    has_comp, comp_note = _has_completion_delay(t)
    if has_comp:
        score += 1
        types.append("Completion delay")
        created = _parse_dt(t.get("created_at"))
        actual4 = _parse_dt(t.get("actual_4"))
        if created and actual4:
            comp_h = (actual4 - created).total_seconds() / 3600.0
            hours = max(hours, comp_h)
        elif comp_note:
            m = re.search(r"(\d+)\s*d", comp_note)
            if m:
                hours = max(hours, int(m.group(1)) * 24.0)

    if t.get("interrupted_by_urgent") is True:
        score += 1
        types.append("Interrupted by urgent")

    return score, hours, types


def _has_completion_delay(t: dict) -> tuple[bool, str]:
    if not _is_chore_bug(t):
        return False, ""
    if str(t.get("status_4") or "").lower() != "completed":
        return False, ""
    created = _parse_dt(t.get("created_at"))
    actual4 = _parse_dt(t.get("actual_4"))
    if not created or not actual4:
        return False, ""
    days = (actual4 - created).total_seconds() / 86400
    if days > 1:
        return True, f"TAT {int(days)}d"
    return False, ""


def _is_pending_staging(t: dict) -> bool:
    """Same rules as Support → Staging list (staging_planned or status_2=staging, not live-completed)."""
    if str(t.get("live_review_status") or "").lower() == "completed":
        return False
    if t.get("staging_planned"):
        return True
    return str(t.get("status_2") or "").lower() == "staging"


def card_stage2_volume(tickets: list[dict], *, as_of: datetime | None = None) -> dict:
    ref = as_of or _now()
    bucket_0_24 = bucket_24_72 = bucket_72_plus = 0
    for t in tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        age_h = _hours_between(entry, ref) or 0.0
        if age_h <= 24:
            bucket_0_24 += 1
        elif age_h <= 72:
            bucket_24_72 += 1
        else:
            bucket_72_plus += 1
    return {
        "bucket_0_24": bucket_0_24,
        "bucket_24_72": bucket_24_72,
        "bucket_72_plus": bucket_72_plus,
        "total": bucket_0_24 + bucket_24_72 + bucket_72_plus,
        "labels": {"safe": "0–24 hr", "warning": "24–72 hr", "breach": "72 hr+"},
        "colors": {"safe": "#3b82f6", "warning": "#f59e0b", "breach": "#ef4444"},
    }


def _weekly_resolution_pool(
    week_tickets: list[dict], range_start: date, range_end: date
) -> list[dict]:
    """Chores/bugs with query arrival in selected KPI week, closed within that calendar week."""
    return [
        t
        for t in week_tickets
        if _is_chore_bug(t) and _is_closed(t) and _closed_in_range(t, range_start, range_end)
    ]


def card_avg_resolution(tickets: list[dict], trends: list[dict] | None = None) -> dict:
    hours_list: list[float] = []
    for t in tickets:
        if not _is_closed(t):
            continue
        entry = _stage2_entry(t)
        closed = _closed_at(t)
        if not entry or not closed:
            continue
        h = _hours_between(entry, closed)
        if h is not None:
            hours_list.append(h)
    avg = sum(hours_list) / len(hours_list) if hours_list else 0.0
    target_h = 48.0
    return {
        "avg_hours": round(avg, 1),
        "avg_display": _fmt_hours(avg),
        "sample_size": len(hours_list),
        "target_hours": target_h,
        "on_target": avg <= target_h if hours_list else True,
        "status": "green" if (not hours_list or avg <= target_h) else "red",
        "trend_weeks": trends or [],
    }


def card_escalation_frequency(
    tickets: list[dict], trends: list[dict], *, as_of: datetime | None = None
) -> dict:
    ref = as_of or _now()
    count = 0
    for t in tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        age_h = _hours_between(entry, ref) or 0.0
        if age_h >= 72:
            count += 1
    target = 2
    return {
        "count_this_week": count,
        "target_max": target,
        "on_target": count < target,
        "trend_weeks": trends,
    }


def _effective_committed_deadline(t: dict) -> datetime | None:
    """
    Soumya committed close deadline per ticket.
    Uses committed_deadline when set; otherwise infers from FMS workflow (Stage 4 SLA or 1-day TAT).
    """
    explicit = _parse_dt(t.get("committed_deadline"))
    if explicit:
        return explicit
    if not _is_chore_bug(t):
        return None
    a3 = _parse_dt(t.get("actual_3"))
    if a3 and str(t.get("status_3") or "").lower() == "completed":
        return a3 + timedelta(hours=2)
    qa = _parse_dt(t.get("query_arrival_at")) or _parse_dt(t.get("created_at"))
    if qa:
        return qa + timedelta(days=1)
    return None


def _weekly_deadline_adherence_pool(
    week_tickets: list[dict], range_start: date, range_end: date
) -> list[dict]:
    """Week arrivals closed in selected calendar week with a resolvable committed deadline."""
    return [
        t
        for t in week_tickets
        if _is_chore_bug(t)
        and _is_closed(t)
        and _closed_in_range(t, range_start, range_end)
        and _effective_committed_deadline(t) is not None
    ]


def card_deadline_adherence(tickets: list[dict]) -> dict:
    """(on_time_closed / total_closed_with_deadline) * 100 — target above 90%."""
    total = on_time = 0
    for t in tickets:
        if not _is_closed(t):
            continue
        deadline = _effective_committed_deadline(t)
        if not deadline:
            continue
        closed = _closed_at(t)
        if not closed:
            continue
        total += 1
        if closed <= deadline:
            on_time += 1
    pct = round((on_time / total) * 100, 1) if total else None
    has_data = total > 0
    return {
        "percent": pct if pct is not None else 0.0,
        "percent_display": f"{pct}%" if pct is not None else "—",
        "on_time": on_time,
        "total_with_deadline": total,
        "total_closed": total,
        "target_percent": 90,
        "has_data": has_data,
        "on_target": pct >= 90 if has_data else False,
        "status": "neutral" if not has_data else ("green" if pct >= 90 else "red"),
    }


def card_ack_response(tickets: list[dict]) -> dict:
    hours_list: list[float] = []
    for t in tickets:
        sent = _parse_dt(t.get("deadline_email_sent_at"))
        ack = _parse_dt(t.get("ack_received_at"))
        if not sent or not ack:
            continue
        h = _hours_between(sent, ack)
        if h is not None:
            hours_list.append(h)
    avg = sum(hours_list) / len(hours_list) if hours_list else 0.0
    target = 4.0
    return {
        "avg_hours": round(avg, 1),
        "avg_display": _fmt_hours(avg),
        "sample_size": len(hours_list),
        "target_hours": target,
        "on_target": avg <= target if hours_list else True,
        "status": "green" if (not hours_list or avg <= target) else "red",
    }


def card_weekly_sla_breach(
    tickets: list[dict], trends: list[dict], *, as_of: datetime | None = None
) -> dict:
    ref = as_of or _now()
    breach = 0
    for t in tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        if (_hours_between(entry, ref) or 0) >= 72:
            breach += 1
    return {
        "count_this_week": breach,
        "target": 0,
        "on_target": breach == 0,
        "trend_weeks": trends,
    }


def card_pending_staging(all_tickets: list[dict]) -> dict:
    """Live count of tickets in Staging (not filtered by KPI week)."""
    pending = [t for t in all_tickets if _is_pending_staging(t)]
    chores_bugs = sum(1 for t in pending if _is_chore_bug(t))
    features = sum(1 for t in pending if str(t.get("type") or "").lower() == "feature")
    other = len(pending) - chores_bugs - features
    return {
        "total": len(pending),
        "chores_bugs": chores_bugs,
        "features": features,
        "other": other,
    }


def _fmt_duration_hours(h: float | None) -> str:
    """Human duration: e.g. '2 days 5 hr 18 min'."""
    if h is None or h < 0:
        return "—"
    total_sec = max(0, int(round(float(h) * 3600)))
    d = total_sec // 86400
    rem = total_sec % 86400
    hr = rem // 3600
    m = (rem % 3600) // 60
    parts: list[str] = []
    if d > 0:
        parts.append(f"{d} day{'s' if d != 1 else ''}")
    if hr > 0:
        parts.append(f"{hr} hr")
    if m > 0 or not parts:
        parts.append(f"{m} min")
    return " ".join(parts)


def _fmt_hours(h: float) -> str:
    return _fmt_duration_hours(h)


def _build_delay_messages(t: dict) -> list[str]:
    """Short, meaningful delay reasons for leaderboard (wrap-friendly)."""
    msgs: list[str] = []
    now = _now()

    if _is_at_stage2_open(t):
        entry = _stage2_entry(t)
        if entry:
            age_h = _hours_between(entry, now) or 0.0
            dur = _fmt_duration_hours(age_h)
            if age_h >= 72:
                msgs.append(f"Stage 2 SLA breached — open {dur} (over 72 hr limit)")
            elif age_h > 24:
                msgs.append(f"Stage 2 aging — open {dur} (24–72 hr band)")
            elif age_h > 0:
                msgs.append(f"Stage 2 in progress — {dur}")

    resp_late, resp_h = _has_response_delay(t)
    if resp_late and not _is_closed(t):
        overdue = _fmt_duration_hours(max(0.0, resp_h - 0.5))
        msgs.append(f"Reply overdue — no response within 30 min (+{overdue})")

    overdue_h = _pending_overdue_hours(t)
    if overdue_h > 0:
        msgs.append(f"Pending past 24 hr SLA — {_fmt_duration_hours(overdue_h + 24)} since submit")

    has_comp, comp_note = _has_completion_delay(t)
    if has_comp:
        created = _parse_dt(t.get("created_at"))
        actual4 = _parse_dt(t.get("actual_4"))
        if created and actual4:
            tat = _fmt_duration_hours((actual4 - created).total_seconds() / 3600.0)
            msgs.append(f"Completion delayed — total time {tat} (over 1 day SLA)")
        else:
            msgs.append(f"Completion delayed — {comp_note or 'TAT over 1 day'}")

    if t.get("interrupted_by_urgent") is True:
        msgs.append("Work paused — interrupted by urgent ticket")

    if not msgs and _is_chore_bug(t) and not _is_closed(t):
        submitted = _parse_dt(t.get("query_arrival_at")) or _parse_dt(t.get("created_at"))
        if submitted:
            age_h = _hours_between(submitted, now) or 0.0
            if age_h > 0:
                msgs.append(f"Open ticket — {_fmt_duration_hours(age_h)} since query arrival")

    return msgs


def _delay_label_from_messages(messages: list[str]) -> str:
    if not messages:
        return "—"
    return " · ".join(messages)


def _detail_row(t: dict, *, note: str = "", hours: float | None = None) -> dict:
    score, h, dtypes = _delay_score(t)
    hrs = round(hours if hours is not None else h, 1)
    messages = _build_delay_messages(t)
    if note:
        messages = [note, *messages] if messages else [note]
    label = _delay_label_from_messages(messages)
    return {
        "id": t.get("id"),
        "reference_no": (t.get("reference_no") or "").strip() or "—",
        "title": (t.get("title") or "").strip() or "—",
        "description": (t.get("description") or "").strip() or "—",
        "company_name": (t.get("company_name") or "").strip() or "—",
        "type": (t.get("type") or "chore").title(),
        "priority": (t.get("sla_priority") or t.get("priority") or "—"),
        "delay_hours": hrs,
        "delay_display": _fmt_duration_hours(hrs),
        "delay_messages": messages,
        "delay_label": label,
        "delay_score": score,
    }


def _stage2_age_bucket(t: dict, *, as_of: datetime | None = None) -> str | None:
    if not _is_at_stage2_open(t):
        return None
    entry = _stage2_entry(t)
    if not entry:
        return None
    ref = as_of or _now()
    age_h = _hours_between(entry, ref) or 0.0
    if age_h <= 24:
        return "0–24 hr"
    if age_h <= 72:
        return "24–72 hr"
    return "72 hr+"


def build_card_details(
    week_tickets: list[dict],
    closed_in_week: list[dict],
    *,
    range_start: date,
    range_end: date,
    all_tickets: list[dict] | None = None,
    as_of: datetime | None = None,
) -> dict:
    """Ticket rows for KPI card detail modals."""
    ref = as_of or _now()
    stage2_items: list[dict] = []
    for t in week_tickets:
        bucket = _stage2_age_bucket(t, as_of=ref)
        if not bucket:
            continue
        stage2_items.append(_detail_row(t, note=f"Stage 2 · {bucket}"))

    resolution_pool = _weekly_resolution_pool(week_tickets, range_start, range_end)
    resolution_items: list[dict] = []
    for t in resolution_pool:
        entry = _stage2_entry(t)
        closed = _closed_at(t)
        if not entry or not closed:
            continue
        h = _hours_between(entry, closed)
        if h is None:
            continue
        resolution_items.append(
            _detail_row(t, note=f"Weekly resolution · {_fmt_duration_hours(h)}", hours=h)
        )

    escalation_items: list[dict] = []
    for t in week_tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        age_h = _hours_between(entry, ref) or 0.0
        if age_h >= 72:
            escalation_items.append(_detail_row(t, note="Stage 2 breach 72hr+", hours=age_h))

    deadline_pool = _weekly_deadline_adherence_pool(week_tickets, range_start, range_end)
    on_time_items: list[dict] = []
    late_items: list[dict] = []
    for t in deadline_pool:
        deadline = _effective_committed_deadline(t)
        closed = _closed_at(t)
        if not deadline or not closed:
            continue
        dl_label = deadline.strftime("%d %b %Y, %H:%M")
        if closed <= deadline:
            on_time_items.append(_detail_row(t, note=f"Closed on time (deadline {dl_label})"))
        else:
            late_h = _hours_between(deadline, closed) or 0.0
            late_items.append(
                _detail_row(
                    t,
                    note=f"Closed late by {_fmt_duration_hours(late_h)} (deadline {dl_label})",
                    hours=late_h,
                )
            )

    breach_items: list[dict] = []
    for t in week_tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        breach_h = _hours_between(entry, ref) or 0.0
        if breach_h >= 72:
            breach_items.append(_detail_row(t, note="SLA breach 72hr+", hours=breach_h))

    staging_items: list[dict] = []
    for t in all_tickets or []:
        if not _is_pending_staging(t):
            continue
        typ = str(t.get("type") or "").title()
        staging_items.append(_detail_row(t, note=f"In Staging · {typ}"))

    return {
        "stage2_volume": stage2_items,
        "avg_resolution": resolution_items,
        "escalation_frequency": escalation_items,
        "deadline_adherence": on_time_items + late_items,
        "deadline_on_time": on_time_items,
        "deadline_late": late_items,
        "weekly_sla_breach": breach_items,
        "pending_staging": staging_items,
    }


def build_delay_ranked_list(
    tickets: list[dict],
    *,
    offset: int = 0,
    limit: int = _RANKED_PAGE_DEFAULT,
) -> tuple[list[dict], int]:
    scored: list[tuple[int, float, dict]] = []
    for t in tickets:
        if not _is_chore_bug(t):
            continue
        score, hours, dtypes = _delay_score(t)
        if score <= 0 and hours <= 0 and _is_at_stage2_open(t):
            entry = _stage2_entry(t)
            hours = _hours_between(entry, _now()) or 0.0
            score = 1
            dtypes = ["Stage 2 active"]
        if score <= 0 and hours <= 0:
            continue
        scored.append((score, hours, {**t, "_delay_score": score, "_delay_hours": round(hours, 1), "_delay_types": dtypes}))
    scored.sort(key=lambda x: (-x[0], -x[1], x[2].get("reference_no") or ""))
    total = len(scored)
    page = scored[offset : offset + limit]
    out: list[dict] = []
    for i, (_, hours, row) in enumerate(page):
        rank = offset + i + 1
        messages = _build_delay_messages(row)
        hrs = row.get("_delay_hours") or hours
        out.append(
            {
                "rank": rank,
                "id": row.get("id"),
                "reference_no": row.get("reference_no"),
                "title": row.get("title"),
                "description": (row.get("description") or "").strip() or "—",
                "company_name": row.get("company_name"),
                "type": row.get("type"),
                "priority": row.get("sla_priority") or row.get("priority"),
                "delay_score": row.get("_delay_score"),
                "delay_hours": hrs,
                "delay_display": _fmt_duration_hours(hrs),
                "delay_messages": messages,
                "delay_types": row.get("_delay_types") or [],
                "delay_label": _delay_label_from_messages(messages),
            }
        )
    return out, total


def _load_weekly_trends(weeks: int = 8) -> list[dict]:
    try:
        r = (
            supabase.table("soumya_sla_weekly_snapshots")
            .select("*")
            .order("week_start", desc=True)
            .limit(weeks)
            .execute()
        )
        rows = list(reversed(r.data or []))
        return [
            {
                "week_start": str(x.get("week_start")),
                "escalation_count": int(x.get("escalation_count") or 0),
                "sla_breach_count": int(x.get("sla_breach_count") or 0),
                "avg_resolution_hours": round(float(x.get("avg_resolution_hours") or 0), 1),
            }
            for x in rows
        ]
    except Exception:
        return []


def _upsert_weekly_snapshot(metrics: dict) -> None:
    ws = _week_start()
    try:
        supabase.table("soumya_sla_weekly_snapshots").upsert(
            {
                "week_start": ws.isoformat(),
                "escalation_count": metrics.get("escalation_count", 0),
                "sla_breach_count": metrics.get("sla_breach_count", 0),
                "avg_resolution_hours": metrics.get("avg_resolution_hours"),
                "deadline_adherence_pct": metrics.get("deadline_adherence_pct"),
                "ack_avg_hours": metrics.get("ack_avg_hours"),
                "updated_at": _now().isoformat(),
            },
            on_conflict="week_start",
        ).execute()
    except Exception as e:
        _log.warning("soumya weekly snapshot: %s", e)


def compute_soumya_dashboard(
    month: str = "Feb",
    year: str = "2026",
    week: str = "week 1",
    *,
    leaderboard_scope: str = "week",
    ranked_offset: int = 0,
    ranked_limit: int = _RANKED_PAGE_DEFAULT,
) -> dict[str, Any]:
    """
    Week-based Soumya KPI (Support / Chores & Bugs scope).
    Excludes Demo C. Query arrival (or created) must fall in the selected KPI week.
    """
    y = int(year) if str(year).isdigit() else datetime.now().year
    month_num = _parse_month_num(month)
    week_num = _parse_week_num(week)
    max_week_index = kpi_max_week_index_in_month(y, month_num)
    week_num = max(1, min(week_num, max_week_index))
    week_range = get_kpi_calendar_week_range(y, month_num, week_num)
    if not week_range:
        week_range = get_kpi_calendar_week_range(y, month_num, 1) or (
            date.today(),
            date.today(),
        )
    range_start, range_end = week_range
    as_of = _kpi_as_of(range_end)

    all_tickets = _exclude_demo_c(_fetch_tickets())
    week_tickets = _tickets_arrival_in_range(all_tickets, range_start, range_end)
    closed_in_week = _tickets_closed_in_range(all_tickets, range_start, range_end)

    trends = _load_weekly_trends(8)
    resolution_weekly = _weekly_resolution_pool(week_tickets, range_start, range_end)
    c1 = card_stage2_volume(week_tickets, as_of=as_of)
    c2 = card_avg_resolution(resolution_weekly, trends)
    c3 = card_escalation_frequency(week_tickets, trends, as_of=as_of)
    deadline_weekly = _weekly_deadline_adherence_pool(week_tickets, range_start, range_end)
    c4 = card_deadline_adherence(deadline_weekly)
    c6 = card_weekly_sla_breach(week_tickets, trends, as_of=as_of)
    c_staging = card_pending_staging(all_tickets)
    scope = (leaderboard_scope or "week").strip().lower()
    leaderboard_pool = all_tickets if scope == "all" else week_tickets
    ranked, total_ranked = build_delay_ranked_list(
        leaderboard_pool, offset=max(0, ranked_offset), limit=max(1, min(ranked_limit, 100))
    )
    card_details = build_card_details(
        week_tickets,
        closed_in_week,
        range_start=range_start,
        range_end=range_end,
        all_tickets=all_tickets,
        as_of=as_of,
    )

    if ranked_offset == 0:
        _upsert_weekly_snapshot(
            {
                "escalation_count": c3["count_this_week"],
                "sla_breach_count": c6["count_this_week"],
                "avg_resolution_hours": c2["avg_hours"],
                "deadline_adherence_pct": c4["percent"],
                "ack_avg_hours": None,
            }
        )

    return {
        "success": True,
        "person": "Soumya",
        "generated_at": _now().isoformat(),
        "cards": {
            "stage2_volume": c1,
            "avg_resolution": c2,
            "escalation_frequency": c3,
            "deadline_adherence": c4,
            "weekly_sla_breach": c6,
            "pending_staging": c_staging,
        },
        "delay_ranked_tickets": ranked,
        "card_details": card_details,
        "meta": {
            "month": _MONTH_NAMES[month_num - 1],
            "year": str(y),
            "week": f"week {week_num}",
            "week_start": range_start.isoformat(),
            "week_end": range_end.isoformat(),
            "week_label": f"{range_start.strftime('%d %b')} – {range_end.strftime('%d %b %Y')}",
            "data_as_of": as_of.isoformat(),
            "cards_use_week_arrivals": True,
            "max_week_index": max_week_index,
            "leaderboard_scope": "all" if scope == "all" else "week",
            "total_tickets_scanned": len(week_tickets),
            "leaderboard_pool_size": len(leaderboard_pool),
            "total_in_pool": len(all_tickets),
            "total_ranked": total_ranked,
            "ranked_count": len(ranked),
            "ranked_offset": ranked_offset,
            "ranked_limit": ranked_limit,
            "has_more": ranked_offset + len(ranked) < total_ranked,
            "excludes_demo_c": True,
        },
    }


def run_soumya_sla_hourly_scan() -> dict[str, Any]:
    """
    Hourly cron: refresh weekly snapshot + flag tickets over 72hr (email hook placeholder).
    Set deadline_email_sent_at when email integration is wired.
    """
    today = date.today()
    payload = compute_soumya_dashboard(
        _MONTH_NAMES[today.month - 1],
        str(today.year),
        f"week {week_of_month_for_date(today)}",
    )
    breached = []
    tickets = _exclude_demo_c(_fetch_tickets(2000))
    now = _now()
    for t in tickets:
        if not _is_at_stage2_open(t):
            continue
        entry = _stage2_entry(t)
        if not entry:
            continue
        if (_hours_between(entry, now) or 0) >= 72:
            breached.append({"id": t.get("id"), "reference_no": t.get("reference_no")})
    return {
        "ok": True,
        "breach_count": len(breached),
        "breached_sample": breached[:20],
        "weekly_snapshot_updated": True,
        "cards": payload.get("cards"),
    }
