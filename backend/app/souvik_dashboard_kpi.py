"""
Souvik Dashboard — EA Performance KPI Tracker (Monday–Saturday).

Mirrors the spreadsheet:
  - Daily Entry: 1–10 score per KPI per work day (6 days Mon–Sat).
  - Weekly Log:  per-area + composite score history, one row per week.
  - KPI Reference: scoring criteria & data sources catalog.

Weekly score math (matches the workbook):
  - per-KPI weekly score = avg(daily scores over the 6 weekday slots) * weight_fraction
    (blank/missing day counts as 0, same as the sheet).
  - area sub-total (weekly) = sum of that area's per-KPI weekly scores.
  - per-day area sub-total = average of the area's KPI scores for that day.
  - composite (0–10) = sum of all per-KPI weekly scores.

Raw daily scores live in public.souvik_kpi_daily (see database/SOUVIK_KPI.sql).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import logging

from app.supabase_client import supabase

_log = logging.getLogger("souvik_dashboard_kpi")

# 6 weekday slots: Monday .. Saturday
_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
_DAYS_IN_WEEK = len(_DAY_NAMES)

# ---------------------------------------------------------------------------
# KPI catalog (KPI Reference sheet). Weights sum to 1.0 (100%).
#   Payment Follow-up 35% + Accounts Work 35% + EA / Executive Support 30%.
# ---------------------------------------------------------------------------
SOUVIK_KPI_AREAS: tuple[dict[str, Any], ...] = (
    {
        "key": "payment",
        "title": "Payment Follow-up",
        "weight_percent": 35.0,
        "kpis": (
            {
                "key": "follow_up_timeliness",
                "label": "Follow-up timeliness",
                "weight_percent": 8.75,
                "formula": "(Followed up / Total overdue) × 10",
                "frequency": "Daily",
                "data_source": "AR overdue list",
            },
            {
                "key": "collection_rate",
                "label": "Collection rate",
                "weight_percent": 8.75,
                "formula": "(Amount collected / Amount due) × 10",
                "frequency": "Weekly",
                "data_source": "Payment records",
            },
            {
                "key": "overdue_ageing",
                "label": "Overdue ageing",
                "weight_percent": 8.75,
                "formula": "<15d=10 | 15–30d=7 | >30d=4",
                "frequency": "Weekly",
                "data_source": "AR ageing report",
            },
            {
                "key": "escalation_handling",
                "label": "Escalation handling",
                "weight_percent": 8.75,
                "formula": "Prompt=10 | Delayed=5 | Missed=1",
                "frequency": "As needed",
                "data_source": "Escalation log",
            },
        ),
    },
    {
        "key": "accounts",
        "title": "Accounts Work",
        "weight_percent": 35.0,
        "kpis": (
            {
                "key": "entry_accuracy",
                "label": "Entry accuracy",
                "weight_percent": 8.75,
                "formula": "10 − (errors × 2), min 0",
                "frequency": "Daily",
                "data_source": "Entry error log",
            },
            {
                "key": "backlog_clearance",
                "label": "Backlog clearance",
                "weight_percent": 8.75,
                "formula": "None=10 | 1–2=7 | 3–5=5 | 5+=2",
                "frequency": "Daily",
                "data_source": "Pending entries list",
            },
            {
                "key": "reconciliation",
                "label": "Reconciliation",
                "weight_percent": 8.75,
                "formula": "Done & clean=10 | Issues=6 | Overdue=2",
                "frequency": "Weekly",
                "data_source": "Recon worksheet",
            },
            {
                "key": "reporting_timeliness",
                "label": "Reporting timeliness",
                "weight_percent": 8.75,
                "formula": "On time=10 | Late=5 | Missing=1",
                "frequency": "Weekly",
                "data_source": "Report submission log",
            },
        ),
    },
    {
        "key": "ea",
        "title": "EA / Executive Support",
        "weight_percent": 30.0,
        "kpis": (
            {
                "key": "task_completion_rate",
                "label": "Task completion rate",
                "weight_percent": 7.5,
                "formula": "(Done on time / Assigned) × 10",
                "frequency": "Daily",
                "data_source": "Task list / planner",
            },
            {
                "key": "calendar_scheduling",
                "label": "Calendar & scheduling",
                "weight_percent": 7.5,
                "formula": "Flawless=10 | 1 error=7 | 2=4 | 3+=1",
                "frequency": "Weekly",
                "data_source": "Calendar review",
            },
            {
                "key": "document_prep",
                "label": "Document & prep",
                "weight_percent": 7.5,
                "formula": "All ready=10 | Partial=6 | Not ready=2",
                "frequency": "Per meeting",
                "data_source": "Meeting checklist",
            },
            {
                "key": "proactive_support",
                "label": "Proactive support",
                "weight_percent": 7.5,
                "formula": "Multiple=10 | One=7 | None=5",
                "frequency": "Weekly",
                "data_source": "Manager feedback",
            },
        ),
    },
)

_ALL_KPI_KEYS: tuple[str, ...] = tuple(
    kpi["key"] for area in SOUVIK_KPI_AREAS for kpi in area["kpis"]
)
_KPI_KEY_SET = frozenset(_ALL_KPI_KEYS)


def is_valid_kpi_key(key: str) -> bool:
    return key in _KPI_KEY_SET


def _round1(v: float) -> float:
    return round(float(v) + 1e-9, 1)


def _round2(v: float) -> float:
    return round(float(v) + 1e-9, 2)


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def parse_week_start(week_start: str | None) -> date:
    """Return the Monday for the given ISO date (defaults to current week)."""
    if week_start:
        try:
            d = date.fromisoformat(week_start.strip()[:10])
            return _monday_of(d)
        except Exception:
            pass
    return _monday_of(date.today())


def grade_for_composite(score: float) -> str:
    if score >= 9:
        return "Excellent"
    if score >= 7:
        return "Good"
    if score >= 5:
        return "Needs attention"
    return "Below Target"


def grade_status(score: float) -> str:
    """green / amber / red bucket for UI."""
    if score >= 7:
        return "green"
    if score >= 5:
        return "amber"
    return "red"


def _auto_comment(area_scores: dict[str, float], composite: float) -> str:
    """Mirror the workbook's auto-comment: flag the weakest below-target area."""
    titles = {a["key"]: a["title"] for a in SOUVIK_KPI_AREAS}
    # Lowest-scoring area (on the 0–10 per-area average scale)
    weakest_key = min(area_scores, key=lambda k: area_scores.get(k, 0.0)) if area_scores else None
    weakest_val = area_scores.get(weakest_key, 0.0) if weakest_key else 0.0
    if composite >= 9:
        return "Excellent — fully on target across all areas."
    if composite >= 7:
        return "Good — minor gaps, well managed."
    if composite >= 5:
        return f"Needs attention — {titles.get(weakest_key, 'an area')} has gaps to address."
    if weakest_key and weakest_val < 5:
        return f"URGENT — {titles.get(weakest_key, 'an area')} critically below target."
    return "Below target — immediate action needed."


def _fetch_daily_scores(d_start: date, d_end: date) -> dict[date, dict[str, float]]:
    """Map of work_date -> {kpi_key: score} for any [d_start, d_end] window (single query)."""
    out: dict[date, dict[str, float]] = {}
    try:
        res = (
            supabase.table("souvik_kpi_daily")
            .select("work_date, kpi_key, score")
            .gte("work_date", d_start.isoformat())
            .lte("work_date", d_end.isoformat())
            .execute()
        )
        for row in res.data or []:
            try:
                wd = date.fromisoformat(str(row.get("work_date"))[:10])
            except Exception:
                continue
            key = row.get("kpi_key")
            if key not in _KPI_KEY_SET:
                continue
            score = row.get("score")
            if score is None:
                continue
            out.setdefault(wd, {})[key] = float(score)
    except Exception as e:  # pragma: no cover - network/db guard
        _log.warning("souvik _fetch_daily_scores: %s", e)
    return out


def _week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(_DAYS_IN_WEEK)]


def _compute_week_from_daymap(
    week_start: date, day_map: dict[date, dict[str, float]]
) -> dict[str, Any]:
    """Compute one week's payload from an already-fetched score map (no DB query)."""
    day_dates = _week_dates(week_start)

    areas_out: list[dict[str, Any]] = []
    composite = 0.0
    area_avg_scores: dict[str, float] = {}  # 0–10 per-area average (for comments/cards)

    for area in SOUVIK_KPI_AREAS:
        kpis_out: list[dict[str, Any]] = []
        # per-day sub-total accumulator (average of area KPIs for that day)
        day_subtotal_sum = [0.0] * _DAYS_IN_WEEK
        area_weekly = 0.0
        weight_frac_total = 0.0

        for kpi in area["kpis"]:
            weight_frac = float(kpi["weight_percent"]) / 100.0
            weight_frac_total += weight_frac
            daily: list[float | None] = []
            day_sum = 0.0
            for i, d in enumerate(day_dates):
                v = day_map.get(d, {}).get(kpi["key"])
                daily.append(v)
                val = float(v) if v is not None else 0.0
                day_sum += val
                day_subtotal_sum[i] += val
            avg_daily = day_sum / _DAYS_IN_WEEK
            weekly_score = _round2(avg_daily * weight_frac)
            area_weekly += weekly_score
            kpis_out.append(
                {
                    "key": kpi["key"],
                    "label": kpi["label"],
                    "formula": kpi["formula"],
                    "weight_percent": kpi["weight_percent"],
                    "daily": daily,
                    "weekly_score": weekly_score,
                }
            )

        n_kpis = len(area["kpis"]) or 1
        day_subtotals = [_round1(s / n_kpis) for s in day_subtotal_sum]
        area_weekly = _round2(area_weekly)
        composite += area_weekly
        # per-area average on 0–10 scale = area_weekly / area_weight_fraction
        area_avg_scores[area["key"]] = (
            _round1(area_weekly / weight_frac_total) if weight_frac_total else 0.0
        )

        areas_out.append(
            {
                "key": area["key"],
                "title": area["title"],
                "weight_percent": area["weight_percent"],
                "kpis": kpis_out,
                "day_subtotals": day_subtotals,
                "weekly_subtotal": area_weekly,
            }
        )

    composite = _round1(composite)
    week_end = week_start + timedelta(days=_DAYS_IN_WEEK - 1)
    weekly_percentage = max(0, min(100, round(composite * 10)))
    return {
        "success": True,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "week_label": f"{week_start.strftime('%d-%b-%Y')} – {week_end.strftime('%d-%b-%Y')}",
        "day_names": _DAY_NAMES,
        "day_dates": [d.isoformat() for d in day_dates],
        "areas": areas_out,
        "composite_score": composite,
        "weekly_percentage": weekly_percentage,
        "grade": grade_for_composite(composite),
        "status": grade_status(composite),
        "area_scores": {k: area_avg_scores.get(k, 0.0) for k in area_avg_scores},
    }


def compute_souvik_week(week_start: date) -> dict[str, Any]:
    """Full Daily-Entry payload for one week (fetches that week's scores)."""
    week_end = week_start + timedelta(days=_DAYS_IN_WEEK - 1)
    day_map = _fetch_daily_scores(week_start, week_end)
    return _compute_week_from_daymap(week_start, day_map)


def get_souvik_weekly_log(first_monday: date, weeks: int = 52) -> dict[str, Any]:
    """Weekly Log: composite + per-area score per week, current week highlighted.

    Fetches the full date range in a single query, then computes each week
    in-memory (avoids one DB round-trip per week).
    """
    weeks = max(1, min(weeks, 104))
    today_monday = _monday_of(date.today())
    range_end = first_monday + timedelta(days=7 * (weeks - 1) + (_DAYS_IN_WEEK - 1))
    day_map = _fetch_daily_scores(first_monday, range_end)
    rows: list[dict[str, Any]] = []
    for i in range(weeks):
        ws = first_monday + timedelta(days=7 * i)
        we = ws + timedelta(days=_DAYS_IN_WEEK - 1)
        wk = _compute_week_from_daymap(ws, day_map)
        has_data = wk["composite_score"] > 0
        weekly_percentage = max(0, min(100, round(wk["composite_score"] * 10))) if has_data else None
        rows.append(
            {
                "week_from": ws.isoformat(),
                "week_to": we.isoformat(),
                "week_from_label": ws.strftime("%d-%b-%Y"),
                "week_to_label": we.strftime("%d-%b-%Y"),
                "payment_score": wk["area_scores"].get("payment", 0.0),
                "accounts_score": wk["area_scores"].get("accounts", 0.0),
                "ea_score": wk["area_scores"].get("ea", 0.0),
                "composite_score": wk["composite_score"] if has_data else None,
                "weekly_percentage": weekly_percentage,
                "grade": grade_for_composite(wk["composite_score"]) if has_data else "",
                "auto_comment": _auto_comment(wk["area_scores"], wk["composite_score"]) if has_data else "—",
                "is_current_week": ws == today_monday,
                "has_data": has_data,
            }
        )
    return {
        "success": True,
        "first_monday": first_monday.isoformat(),
        "weeks": weeks,
        "rows": rows,
    }


def get_souvik_reference() -> dict[str, Any]:
    """KPI Reference sheet (scoring criteria & data sources)."""
    areas = [
        {
            "key": a["key"],
            "title": a["title"],
            "weight_percent": a["weight_percent"],
            "kpis": [
                {
                    "key": k["key"],
                    "label": k["label"],
                    "formula": k["formula"],
                    "frequency": k["frequency"],
                    "data_source": k["data_source"],
                    "weight_percent": k["weight_percent"],
                }
                for k in a["kpis"]
            ],
        }
        for a in SOUVIK_KPI_AREAS
    ]
    scoring_guide = [
        {"range": "9–10", "label": "Excellent – fully on target"},
        {"range": "7–8", "label": "Good – minor gaps, well managed"},
        {"range": "5–6", "label": "Needs attention – gaps to address"},
        {"range": "1–4", "label": "Below target – immediate action needed"},
    ]
    return {"success": True, "areas": areas, "scoring_guide": scoring_guide}


def upsert_souvik_daily(
    rows: list[dict[str, Any]],
    created_by: str | None = None,
) -> int:
    """Upsert daily KPI scores. Each row: {work_date, kpi_key, score|None}."""
    if not rows:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    batch: list[dict[str, Any]] = []
    delete_keys: list[tuple[str, str]] = []
    for row in rows:
        wd_raw = str(row.get("work_date") or "").strip()[:10]
        try:
            wd = date.fromisoformat(wd_raw)
        except Exception:
            raise ValueError(f"Invalid work_date: {row.get('work_date')!r}")
        key = str(row.get("kpi_key") or "").strip()
        if key not in _KPI_KEY_SET:
            raise ValueError(f"Unknown kpi_key: {key!r}")
        score = row.get("score")
        if score is None or score == "":
            delete_keys.append((wd.isoformat(), key))
            continue
        try:
            sval = float(score)
        except Exception:
            raise ValueError(f"Invalid score for {key} on {wd.isoformat()}: {score!r}")
        if sval < 0 or sval > 10:
            raise ValueError(f"Score out of range (0–10) for {key} on {wd.isoformat()}")
        item = {
            "work_date": wd.isoformat(),
            "kpi_key": key,
            "score": round(sval, 1),
            "updated_at": now_iso,
        }
        if created_by:
            item["created_by"] = created_by
        batch.append(item)

    saved = 0
    if batch:
        supabase.table("souvik_kpi_daily").upsert(
            batch, on_conflict="work_date,kpi_key"
        ).execute()
        saved = len(batch)
    # Blank cells clear any stored value
    for wd_iso, key in delete_keys:
        try:
            supabase.table("souvik_kpi_daily").delete().eq("work_date", wd_iso).eq(
                "kpi_key", key
            ).execute()
        except Exception as e:  # pragma: no cover
            _log.warning("souvik clear %s/%s: %s", wd_iso, key, e)
    return saved
