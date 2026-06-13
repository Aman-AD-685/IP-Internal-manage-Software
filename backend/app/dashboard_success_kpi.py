"""
Success KPI for the Rimpa dashboard: pulls from ALL Success / performance_monitoring data
(not filtered by dashboard user). Cards use selected week + fixed targets: 16 / 1 / 25 / 2.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.kpi_calendar_week import get_kpi_calendar_week_range, kpi_max_week_index_in_month
from app.performance_na import filter_performance_rows, performance_marked_na_company_ids
from app.supabase_client import supabase

SUCCESS_KPI_POC_TARGET = 16
SUCCESS_KPI_TRAIN_TARGET = 1
SUCCESS_KPI_FOLLOWUP_TARGET = 25
SUCCESS_KPI_INCREASE_TARGET = 2

# KPI weeks ending on or after this Monday exclude POC Collected (card + overall %).
SUCCESS_KPI_POC_DISABLED_FROM = date(2026, 6, 9)

_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WD_SHORT = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _live_dashboard_kpi_fallback() -> dict[str, Any]:
    """Live fallback aggregation when mv_dashboard_kpi is unavailable/empty."""
    try:
        rows = (
            supabase.table("onboarding_client_payment")
            .select("invoice_amount,invoice_date,payment_received_date")
            .limit(20000)
            .execute()
            .data
            or []
        )
        now_utc = datetime.now(timezone.utc)
        month_start = date(now_utc.year, now_utc.month, 1)
        total_orders = len(rows)
        pending_orders = 0
        completed_orders = 0
        revenue_total = 0.0
        revenue_mtd = 0.0
        for row in rows:
            paid = row.get("payment_received_date")
            if paid:
                completed_orders += 1
            else:
                pending_orders += 1
            try:
                raw = str(row.get("invoice_amount") or "").strip().replace(",", "")
                amount = float(raw) if raw else 0.0
            except Exception:
                amount = 0.0
            revenue_total += amount
            inv_d = _parse_iso_to_date(row.get("invoice_date"))
            if inv_d and inv_d >= month_start:
                revenue_mtd += amount
        return {
            "snapshot_at": now_utc.isoformat(),
            "total_orders": int(total_orders),
            "pending_orders": int(pending_orders),
            "completed_orders": int(completed_orders),
            "revenue_total": float(round(revenue_total, 2)),
            "revenue_mtd": float(round(revenue_mtd, 2)),
            "source": "live_fallback",
        }
    except Exception:
        return {
            "snapshot_at": datetime.now(timezone.utc).isoformat(),
            "total_orders": 0,
            "pending_orders": 0,
            "completed_orders": 0,
            "revenue_total": 0.0,
            "revenue_mtd": 0.0,
            "source": "live_fallback_error",
        }


def _get_dashboard_kpi_snapshot() -> dict[str, Any]:
    """Prefer mv_dashboard_kpi, fallback to live aggregation when no row is available."""
    try:
        mv = (
            supabase.table("mv_dashboard_kpi")
            .select("snapshot_at,total_orders,pending_orders,completed_orders,revenue_total,revenue_mtd")
            .limit(1)
            .execute()
        )
        row = (mv.data or [None])[0] if (mv.data and len(mv.data) > 0) else None
        if row:
            row["source"] = "mv_dashboard_kpi"
            return row
    except Exception:
        pass
    return _live_dashboard_kpi_fallback()


def _format_dashboard_week_label(week_start: date, week_end: date) -> str:
    """Human-readable KPI week label (full Monday–Sunday calendar week)."""
    sm, em = _MONTH_ABBR[week_start.month - 1], _MONTH_ABBR[week_end.month - 1]
    return (
        f"{_WD_SHORT[week_start.weekday()]} {week_start.day} {sm} – "
        f"{_WD_SHORT[week_end.weekday()]} {week_end.day} {em}"
    )


def _parse_iso_to_date(value) -> date | None:
    try:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, str):
            if "T" in value or " " in value:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
            return date.fromisoformat(value[:10])
    except Exception:
        return None


def _in_range(d: date | None, rs: date, re: date) -> bool:
    return d is not None and rs <= d <= re


def _success_kpi_includes_poc(week_end: date) -> bool:
    """POC Collected card and % only for KPI weeks wholly before SUCCESS_KPI_POC_DISABLED_FROM."""
    return week_end < SUCCESS_KPI_POC_DISABLED_FROM


def _company_key(company_id: Any, company_name: str | None) -> str | None:
    """Stable unique company key for KPI card counts."""
    if company_id is not None and str(company_id).strip():
        return f"id:{str(company_id).strip()}"
    nm = (company_name or "").strip().lower()
    if nm:
        return f"name:{nm}"
    return None


def compute_success_kpi_for_dashboard(
    week_start: date,
    week_end: date,
    y: int,
    month_num: int,
) -> tuple[dict[str, Any] | None, list[float]]:
    """
    Returns (success_kpi dict, weekly_success_pct list of 5 values for bar chart).
    """
    weekly_success_pct: list[float] = []
    try:
        dashboard_kpi_snapshot = _get_dashboard_kpi_snapshot()
        pm_rows: list[dict] = []
        try:
            pr = (
                supabase.table("performance_monitoring")
                .select("id, company_id, reference_no, message_owner, response, contact, created_at, created_by")
                .limit(10000)
                .execute()
            )
            pm_rows = pr.data or []
        except Exception:
            pm_rows = []

        na_company_ids = performance_marked_na_company_ids()
        pm_rows = filter_performance_rows(pm_rows, na_filter="exclude_na", na_company_ids=na_company_ids)

        pm_by_id = {row.get("id"): row for row in pm_rows if row.get("id")}
        company_ids = {row.get("company_id") for row in pm_rows if row.get("company_id")}
        companies_map: dict[str, str] = {}
        if company_ids:
            try:
                cr = supabase.table("companies").select("id, name").in_("id", list(company_ids)).execute()
                companies_map = {c["id"]: c["name"] for c in (cr.data or [])}
            except Exception:
                pass

        pm_ids = [pid for pid in pm_by_id.keys() if pid]
        trainings: list[dict] = []
        if pm_ids:
            try:
                tr = (
                    supabase.table("performance_training")
                    .select(
                        "id, performance_id, call_poc, message_poc, message_owner, training_schedule_date, "
                        "training_status, remarks, created_at, total_percentage, initial_percentage"
                    )
                    .in_("performance_id", pm_ids)
                    .execute()
                )
                trainings = tr.data or []
            except Exception:
                trainings = []

        training_by_id = {t.get("id"): t for t in trainings if t.get("id")}
        perf_for_training = {t.get("id"): t.get("performance_id") for t in trainings if t.get("id")}

        training_ids = [t_id for t_id in training_by_id.keys() if t_id]
        ticket_features: list[dict] = []
        if training_ids:
            try:
                tfr = (
                    supabase.table("ticket_features")
                    .select("id, training_id, feature_id, status")
                    .in_("training_id", training_ids)
                    .execute()
                )
                ticket_features = tfr.data or []
            except Exception:
                ticket_features = []

        tf_by_id = {tf.get("id"): tf for tf in ticket_features if tf.get("id")}
        tf_ids = [tid for tid in tf_by_id.keys() if tid]
        feature_ids = {tf.get("feature_id") for tf in ticket_features if tf.get("feature_id")}
        feature_names: dict[str, str] = {}
        if feature_ids:
            try:
                fl = supabase.table("feature_list").select("id, name").in_("id", list(feature_ids)).execute()
                feature_names = {x["id"]: x["name"] for x in (fl.data or [])}
            except Exception:
                pass

        followups: list[dict] = []
        if tf_ids:
            try:
                fu = (
                    supabase.table("feature_followups")
                    .select(
                        "id, ticket_feature_id, status, remarks, created_at, total_percentage, "
                        "previous_percentage, feature_name"
                    )
                    .in_("ticket_feature_id", tf_ids)
                    .execute()
                )
                followups = fu.data or []
            except Exception:
                followups = []

        rs, re = week_start, week_end
        includes_poc = _success_kpi_includes_poc(re)

        def _pm_company_excluded(pm_row: dict | None) -> bool:
            if not pm_row or not pm_row.get("id"):
                return True
            cid = str(pm_row.get("company_id") or "")
            return bool(cid and cid in na_company_ids)

        # --- Weekly counts for KPI cards (selected week) ---
        poc_week = 0
        poc_target = SUCCESS_KPI_POC_TARGET
        poc_pct = 0
        poc_details = {
            "referenceNumbers": [],
            "companies": [],
            "messageOwner": [],
            "dates": [],
            "responses": [],
            "contacts": [],
        }
        if includes_poc:
            # POC Collected = count of Performance Monitoring (POC) rows *entered* in this week (created_at in range).
            poc_rows_w = [
                row
                for row in pm_rows
                if _in_range(_parse_iso_to_date(row.get("created_at")), rs, re)
                and not _pm_company_excluded(row)
            ]
            poc_company_keys = {
                _company_key(row.get("company_id"), companies_map.get(row.get("company_id"), ""))
                for row in poc_rows_w
            }
            poc_company_keys.discard(None)
            poc_week = len(poc_company_keys)
            poc_pct = round(min(100, (poc_week / poc_target) * 100)) if poc_target else 0
            poc_details = {
                "referenceNumbers": [str(row.get("reference_no") or "") for row in poc_rows_w],
                "companies": [companies_map.get(row.get("company_id"), "") for row in poc_rows_w],
                "messageOwner": [row.get("message_owner") for row in poc_rows_w],
                "dates": [str(row.get("created_at") or "") for row in poc_rows_w],
                "responses": [row.get("response") or "" for row in poc_rows_w],
                "contacts": [row.get("contact") or "" for row in poc_rows_w],
            }

        train_week = []
        for t in trainings:
            d = _parse_iso_to_date(t.get("training_schedule_date") or t.get("created_at"))
            if _in_range(d, rs, re):
                train_week.append(t)
        train_company_keys: set[str] = set()
        for t in train_week:
            if str(t.get("training_status") or "").lower() != "yes":
                continue
            pm_row = pm_by_id.get(t.get("performance_id"), {})
            if _pm_company_excluded(pm_row):
                continue
            k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
            if k:
                train_company_keys.add(k)
        train_current = len(train_company_keys)
        train_target = SUCCESS_KPI_TRAIN_TARGET
        train_pct = round(min(100, (train_current / train_target) * 100)) if train_target else 0

        features_by_training: dict[str, list[str]] = {}
        for tf in ticket_features:
            tid = tf.get("training_id")
            if not tid:
                continue
            fname = feature_names.get(tf.get("feature_id"), "")
            if fname:
                features_by_training.setdefault(tid, []).append(fname)

        followups_week = []
        for fu in followups:
            d = _parse_iso_to_date(fu.get("created_at"))
            if _in_range(d, rs, re):
                followups_week.append(fu)

        all_click_rows: list[dict] = []
        try:
            month_start = date(y, month_num, 1)
            month_end = date(y, month_num, monthrange(y, month_num)[1])
            ce = (
                supabase.table("success_followup_click_events")
                .select("id, clicked_at, ticket_feature_id")
                .gte("clicked_at", f"{month_start.isoformat()}T00:00:00")
                .lte("clicked_at", f"{month_end.isoformat()}T23:59:59.999999")
                .limit(5000)
                .execute()
            )
            all_click_rows = ce.data or []
        except Exception:
            all_click_rows = []

        def _count_clicks_in_range(wrs: date, wre: date) -> int:
            n = 0
            for row in all_click_rows:
                d = _parse_iso_to_date(row.get("clicked_at"))
                if _in_range(d, wrs, wre):
                    n += 1
            return n

        click_week_count = _count_clicks_in_range(rs, re)

        followup_company_keys: set[str] = set()
        for fu in followups_week:
            tf_id = fu.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {})
            tr = training_by_id.get(tf_row.get("training_id"))
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
            if _pm_company_excluded(pm_row):
                continue
            k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
            if k:
                followup_company_keys.add(k)
        for row in all_click_rows:
            d = _parse_iso_to_date(row.get("clicked_at"))
            if not _in_range(d, rs, re):
                continue
            tf_id = row.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {}) if tf_id else {}
            tr = training_by_id.get(tf_row.get("training_id")) if tf_row else None
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr and tr.get("id") else None, {})
            if _pm_company_excluded(pm_row):
                continue
            k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
            if k:
                followup_company_keys.add(k)

        fu_from_rows = len(followups_week)
        fu_current = len(followup_company_keys)
        fu_target = SUCCESS_KPI_FOLLOWUP_TARGET
        fu_pct = round(min(100, (fu_current / fu_target) * 100)) if fu_target else 0

        success_rows = [
            fu
            for fu in followups_week
            if fu.get("total_percentage") is not None
            and fu.get("previous_percentage") is not None
            and float(fu["total_percentage"]) > float(fu["previous_percentage"])
        ]
        success_company_keys: set[str] = set()
        for fu in success_rows:
            tf_id = fu.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {})
            tr = training_by_id.get(tf_row.get("training_id"))
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
            if _pm_company_excluded(pm_row):
                continue
            k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
            if k:
                success_company_keys.add(k)
        success_current = len(success_company_keys)
        success_target = SUCCESS_KPI_INCREASE_TARGET
        success_pct = round(min(100, (success_current / success_target) * 100)) if success_target else 0

        if includes_poc:
            pct_values = [poc_pct, train_pct, fu_pct, success_pct]
        else:
            pct_values = [train_pct, fu_pct, success_pct]
        overall_pct = round(sum(pct_values) / len(pct_values), 2) if pct_values else 0

        # Details for modals (week-scoped): keep record-level rows (duplicates allowed).
        train_companies: list[str] = []
        train_call_poc: list[str] = []
        train_message_poc: list[str] = []
        train_dates: list[str] = []
        train_status: list[str] = []
        train_remarks: list[str] = []
        train_features: list[list[str]] = []
        for t in train_week:
            perf_id = t.get("performance_id")
            pm_row = pm_by_id.get(perf_id, {})
            train_companies.append(companies_map.get(pm_row.get("company_id"), ""))
            train_call_poc.append(t.get("call_poc") or "")
            train_message_poc.append(t.get("message_poc") or "")
            train_dates.append(str(t.get("training_schedule_date") or t.get("created_at") or ""))
            train_status.append(t.get("training_status") or "")
            train_remarks.append(t.get("remarks") or "")
            train_features.append(features_by_training.get(t.get("id"), []))
        train_details = {
            "companies": train_companies,
            "callPOC": train_call_poc,
            "messagePOC": train_message_poc,
            "trainingDates": train_dates,
            "trainingStatus": train_status,
            "remarks": train_remarks,
            "features": train_features,
        }

        fu_companies: list[str] = []
        fu_remarks: list[str] = []
        fu_dates: list[str] = []
        fu_before: list[float | None] = []
        fu_after: list[float | None] = []
        fu_features: list[str] = []
        for fu in followups_week:
            tf_id = fu.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {})
            tr = training_by_id.get(tf_row.get("training_id"))
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
            fu_companies.append(companies_map.get(pm_row.get("company_id"), ""))
            fu_remarks.append(fu.get("remarks") or "")
            fu_dates.append(str(fu.get("created_at") or ""))
            fu_before.append(float(fu.get("previous_percentage")) if fu.get("previous_percentage") is not None else None)
            fu_after.append(float(fu.get("total_percentage")) if fu.get("total_percentage") is not None else None)
            fname = fu.get("feature_name") or feature_names.get(tf_row.get("feature_id"), "")
            fu_features.append(fname)
        click_events_week: list[dict[str, Any]] = []
        for row in all_click_rows:
            d = _parse_iso_to_date(row.get("clicked_at"))
            if not _in_range(d, rs, re):
                continue
            tf_id = row.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {}) if tf_id else {}
            tr = training_by_id.get(tf_row.get("training_id")) if tf_row else None
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr and tr.get("id") else None, {})
            fname = feature_names.get(tf_row.get("feature_id"), "") if tf_row else ""
            click_events_week.append(
                {
                    "company": companies_map.get(pm_row.get("company_id"), ""),
                    "feature": fname,
                    "clickedAt": str(row.get("clicked_at") or ""),
                }
            )
        click_events_week.sort(key=lambda x: x.get("clickedAt") or "", reverse=True)

        fu_details = {
            "companies": fu_companies,
            "remarks": fu_remarks,
            "followupDates": fu_dates,
            "beforePercentages": fu_before,
            "afterPercentages": fu_after,
            "features": [[f] for f in fu_features],
            "clickCountWeek": click_week_count,
            "followupRowsWeek": fu_from_rows,
            "uniqueCompanyCountWeek": fu_current,
            "clickEventsWeek": click_events_week,
        }

        succ_companies: list[str] = []
        succ_remarks: list[str] = []
        succ_dates: list[str] = []
        succ_before: list[float | None] = []
        succ_after: list[float | None] = []
        succ_features: list[str] = []
        for fu in success_rows:
            tf_id = fu.get("ticket_feature_id")
            tf_row = tf_by_id.get(tf_id, {})
            tr = training_by_id.get(tf_row.get("training_id"))
            pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
            succ_companies.append(companies_map.get(pm_row.get("company_id"), ""))
            succ_remarks.append(fu.get("remarks") or "")
            succ_dates.append(str(fu.get("created_at") or ""))
            succ_before.append(float(fu.get("previous_percentage")) if fu.get("previous_percentage") is not None else None)
            succ_after.append(float(fu.get("total_percentage")) if fu.get("total_percentage") is not None else None)
            fname = fu.get("feature_name") or feature_names.get(tf_row.get("feature_id"), "")
            succ_features.append(fname)
        succ_details = {
            "companies": succ_companies,
            "remarks": succ_remarks,
            "followupDates": succ_dates,
            "beforePercentages": succ_before,
            "afterPercentages": succ_after,
            "features": [[f] for f in succ_features],
        }

        # Weekly graph: KPI weeks (full Mon–Sun; merged across month boundaries where applicable)
        max_wm = kpi_max_week_index_in_month(y, month_num)
        for w in range(1, max_wm + 1):
            rng = get_kpi_calendar_week_range(y, month_num, w)
            if not rng:
                weekly_success_pct.append(0)
                continue
            wrs, wre = rng
            week_includes_poc = _success_kpi_includes_poc(wre)
            poc_pct_w = 0.0
            if week_includes_poc:
                poc_w_rows = [
                    row
                    for row in pm_rows
                    if _in_range(_parse_iso_to_date(row.get("created_at")), wrs, wre)
                ]
                poc_w_keys = {
                    _company_key(row.get("company_id"), companies_map.get(row.get("company_id"), ""))
                    for row in poc_w_rows
                }
                poc_w_keys.discard(None)
                poc_w = len(poc_w_keys)
                poc_pct_w = min(100, (poc_w / SUCCESS_KPI_POC_TARGET) * 100) if SUCCESS_KPI_POC_TARGET else 0
            train_w = []
            for t in trainings:
                d = _parse_iso_to_date(t.get("training_schedule_date") or t.get("created_at"))
                if _in_range(d, wrs, wre):
                    train_w.append(t)
            train_w_keys: set[str] = set()
            for t in train_w:
                if str(t.get("training_status") or "").lower() != "yes":
                    continue
                pm_row = pm_by_id.get(t.get("performance_id"), {})
                if _pm_company_excluded(pm_row):
                    continue
                k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
                if k:
                    train_w_keys.add(k)
            train_pct_w = min(
                100,
                (len(train_w_keys) / SUCCESS_KPI_TRAIN_TARGET) * 100,
            ) if SUCCESS_KPI_TRAIN_TARGET else 0
            fu_w = [fu for fu in followups if _in_range(_parse_iso_to_date(fu.get("created_at")), wrs, wre)]
            clicks_w = _count_clicks_in_range(wrs, wre)
            fu_w_keys: set[str] = set()
            for fu in fu_w:
                tf_id = fu.get("ticket_feature_id")
                tf_row = tf_by_id.get(tf_id, {})
                tr = training_by_id.get(tf_row.get("training_id"))
                pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
                if _pm_company_excluded(pm_row):
                    continue
                k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
                if k:
                    fu_w_keys.add(k)
            for row in all_click_rows:
                d = _parse_iso_to_date(row.get("clicked_at"))
                if not _in_range(d, wrs, wre):
                    continue
                tf_id = row.get("ticket_feature_id")
                tf_row = tf_by_id.get(tf_id, {}) if tf_id else {}
                tr = training_by_id.get(tf_row.get("training_id")) if tf_row else None
                pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr and tr.get("id") else None, {})
                if _pm_company_excluded(pm_row):
                    continue
                k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
                if k:
                    fu_w_keys.add(k)
            fu_cnt = len(fu_w_keys)
            fu_pct_w = min(100, (fu_cnt / SUCCESS_KPI_FOLLOWUP_TARGET) * 100) if SUCCESS_KPI_FOLLOWUP_TARGET else 0
            inc_w = [
                fu
                for fu in fu_w
                if fu.get("total_percentage") is not None
                and fu.get("previous_percentage") is not None
                and float(fu["total_percentage"]) > float(fu["previous_percentage"])
            ]
            inc_w_keys: set[str] = set()
            for fu in inc_w:
                tf_id = fu.get("ticket_feature_id")
                tf_row = tf_by_id.get(tf_id, {})
                tr = training_by_id.get(tf_row.get("training_id"))
                pm_row = pm_by_id.get(perf_for_training.get(tr.get("id")) if tr else None, {})
                if _pm_company_excluded(pm_row):
                    continue
                k = _company_key(pm_row.get("company_id"), companies_map.get(pm_row.get("company_id"), ""))
                if k:
                    inc_w_keys.add(k)
            success_inc_pct_w = min(100, (len(inc_w_keys) / SUCCESS_KPI_INCREASE_TARGET) * 100) if SUCCESS_KPI_INCREASE_TARGET else 0
            if week_includes_poc:
                week_pct_parts = [poc_pct_w, train_pct_w, fu_pct_w, success_inc_pct_w]
            else:
                week_pct_parts = [train_pct_w, fu_pct_w, success_inc_pct_w]
            overall_w = round(sum(week_pct_parts) / len(week_pct_parts), 2) if week_pct_parts else 0
            weekly_success_pct.append(overall_w)

        success_kpi = {
            "pocCollected": {
                "currentValue": poc_week,
                "targetValue": poc_target,
                "percentage": f"{poc_week}/{poc_target}",
                "details": poc_details,
            },
            "weeklyTrainingTarget": {
                "currentValue": train_current,
                "targetValue": train_target,
                "percentage": f"{train_current}/{train_target}",
                "details": train_details,
            },
            "trainingFollowUp": {
                "currentValue": fu_current,
                "targetValue": fu_target,
                "percentage": f"{fu_current}/{fu_target}",
                "details": fu_details,
            },
            "successIncrease": {
                "currentValue": success_current,
                "targetValue": success_target,
                "percentage": f"{success_current}/{success_target}",
                "details": succ_details,
            },
            "overallPercentage": overall_pct,
            "meta": {
                "weekLabel": _format_dashboard_week_label(week_start, week_end),
                "pocIncluded": includes_poc,
                "dashboardKpiSnapshot": dashboard_kpi_snapshot,
                "targets": {
                    "poc": SUCCESS_KPI_POC_TARGET,
                    "training": SUCCESS_KPI_TRAIN_TARGET,
                    "followup": SUCCESS_KPI_FOLLOWUP_TARGET,
                    "increase": SUCCESS_KPI_INCREASE_TARGET,
                },
            },
        }
        return success_kpi, weekly_success_pct
    except Exception:
        return None, [0, 0, 0, 0, 0]

