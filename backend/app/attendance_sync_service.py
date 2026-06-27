from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx

from app.supabase_client import supabase


DEFAULT_SOURCE_TABLE = "attendance_data"
DEFAULT_KEY_COLUMNS = ("id", "uuid", "attendance_id", "record_id")
DEFAULT_EMPLOYEE_NAME_COLUMNS = ("name", "full_name", "employee_name", "display_name")
UPDATED_AT_COLUMNS = ("updated_at", "modified_at", "created_at", "date")
ATTENDANCE_TABLE_HINTS = ("attendance", "attendance_data")
LEAVE_TABLE_HINTS = ("leave", "leaves", "leave_data", "leave_requests", "employee_leaves")
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _csv_env(name: str, default: tuple[str, ...]) -> list[str]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return list(default)
    return [part.strip() for part in raw.split(",") if part.strip()]


def _source_config() -> dict[str, Any]:
    source_url = (os.getenv("ATTENDANCE_SOURCE_SUPABASE_URL") or "").strip().rstrip("/")
    source_key = (
        os.getenv("ATTENDANCE_SOURCE_SERVICE_ROLE_KEY")
        or os.getenv("ATTENDANCE_SOURCE_ANON_KEY")
        or ""
    ).strip()
    if not source_url or not source_key:
        raise RuntimeError(
            "Missing attendance source config. Set ATTENDANCE_SOURCE_SUPABASE_URL and "
            "ATTENDANCE_SOURCE_SERVICE_ROLE_KEY in backend/.env."
        )
    return {
        "url": source_url,
        "key": source_key,
        "project": source_url.replace("https://", "").replace("http://", "").split(".")[0],
        "tables": _csv_env("ATTENDANCE_SYNC_TABLES", (DEFAULT_SOURCE_TABLE,)),
        "key_columns": _csv_env("ATTENDANCE_SYNC_KEY_COLUMNS", DEFAULT_KEY_COLUMNS),
        "page_size": max(1, min(int(os.getenv("ATTENDANCE_SYNC_PAGE_SIZE") or "1000"), 5000)),
        "attendance_table": (os.getenv("ATTENDANCE_SYNC_ATTENDANCE_TABLE") or DEFAULT_SOURCE_TABLE).strip(),
        "attendance_employee_column": (
            os.getenv("ATTENDANCE_SYNC_ATTENDANCE_EMPLOYEE_COLUMN") or "employee_id"
        ).strip(),
        "employee_table": (os.getenv("ATTENDANCE_SYNC_EMPLOYEE_TABLE") or "employees").strip(),
        "employee_id_column": (os.getenv("ATTENDANCE_SYNC_EMPLOYEE_ID_COLUMN") or "id").strip(),
        "employee_name_columns": _csv_env(
            "ATTENDANCE_SYNC_EMPLOYEE_NAME_COLUMNS",
            DEFAULT_EMPLOYEE_NAME_COLUMNS,
        ),
    }


def _json_hash(row: dict[str, Any]) -> str:
    raw = json.dumps(row, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _record_key(row: dict[str, Any], key_columns: list[str]) -> str:
    for key_spec in key_columns:
        cols = [col.strip() for col in key_spec.split("+") if col.strip()]
        if not cols:
            continue
        values = [row.get(col) for col in cols]
        if all(value is not None and str(value).strip() != "" for value in values):
            return "+".join(f"{col}:{value}" for col, value in zip(cols, values))
    return f"sha256:{_json_hash(row)}"


def _source_updated_at(row: dict[str, Any]) -> str | None:
    for col in UPDATED_AT_COLUMNS:
        value = row.get(col)
        if value:
            return str(value)
    return None


def _fetch_source_page(
    client: httpx.Client,
    *,
    source_url: str,
    source_key: str,
    table: str,
    offset: int,
    page_size: int,
) -> list[dict[str, Any]]:
    encoded_table = quote(table, safe="")
    headers = {
        "apikey": source_key,
        "Authorization": f"Bearer {source_key}",
        "Range": f"{offset}-{offset + page_size - 1}",
        "Range-Unit": "items",
    }
    response = client.get(
        f"{source_url}/rest/v1/{encoded_table}",
        params={"select": "*"},
        headers=headers,
    )
    if response.status_code not in (200, 206):
        raise RuntimeError(
            f"Source table {table} returned HTTP {response.status_code}: {response.text[:500]}"
        )
    data = response.json()
    if not isinstance(data, list):
        raise RuntimeError(f"Source table {table} returned unexpected payload")
    return data


def _fetch_all_source_rows(
    client: httpx.Client,
    *,
    cfg: dict[str, Any],
    table: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = _fetch_source_page(
            client,
            source_url=cfg["url"],
            source_key=cfg["key"],
            table=table,
            offset=offset,
            page_size=cfg["page_size"],
        )
        if not page:
            break
        rows.extend(page)
        if len(page) < cfg["page_size"]:
            break
        offset += cfg["page_size"]
    return rows


def _employee_name(employee: dict[str, Any], name_columns: list[str]) -> str | None:
    for col in name_columns:
        value = employee.get(col)
        if value is not None and str(value).strip():
            return str(value).strip()
    first = str(employee.get("first_name") or "").strip()
    last = str(employee.get("last_name") or "").strip()
    combined = " ".join(part for part in (first, last) if part)
    return combined or None


def _employee_map(
    client: httpx.Client,
    *,
    cfg: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    employees = _fetch_all_source_rows(client, cfg=cfg, table=cfg["employee_table"])
    by_id: dict[str, dict[str, Any]] = {}
    for employee in employees:
        employee_id = employee.get(cfg["employee_id_column"])
        if employee_id is not None and str(employee_id).strip():
            by_id[str(employee_id)] = employee
    return by_id


def _enrich_attendance_rows(
    rows: list[dict[str, Any]],
    *,
    cfg: dict[str, Any],
    employees_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows:
        next_row = dict(row)
        employee_id = next_row.get(cfg["attendance_employee_column"])
        employee = employees_by_id.get(str(employee_id)) if employee_id is not None else None
        if employee:
            next_row["employee_name"] = _employee_name(employee, cfg["employee_name_columns"])
            next_row["employee"] = employee
        enriched.append(next_row)
    return enriched


def _upsert_records(
    *,
    source_project: str,
    table: str,
    rows: list[dict[str, Any]],
    key_columns: list[str],
) -> int:
    if not rows:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    records = [
        {
            "source_project": source_project,
            "source_table": table,
            "source_record_key": _record_key(row, key_columns),
            "payload": row,
            "source_updated_at": _source_updated_at(row),
            "last_synced_at": now,
        }
        for row in rows
    ]
    supabase.table("attendance_sync_records").upsert(
        records,
        on_conflict="source_project,source_table,source_record_key",
    ).execute()
    return len(records)


def _log_run(result: dict[str, Any]) -> None:
    try:
        supabase.table("attendance_sync_runs").insert(result).execute()
    except Exception as exc:
        print(f"attendance sync log failed: {exc}", flush=True)


def run_attendance_sync(*, trigger_source: str = "manual") -> dict[str, Any]:
    cfg = _source_config()
    started_at = datetime.now(timezone.utc)
    rows_read = 0
    rows_upserted = 0
    details: dict[str, Any] = {"tables": {}}
    status = "success"
    error: str | None = None

    try:
        with httpx.Client(timeout=60.0) as client:
            employees_by_id = _employee_map(client, cfg=cfg)
            details["employees_loaded"] = len(employees_by_id)
            for table in cfg["tables"]:
                table_read = 0
                table_upserted = 0
                offset = 0
                while True:
                    rows = _fetch_source_page(
                        client,
                        source_url=cfg["url"],
                        source_key=cfg["key"],
                        table=table,
                        offset=offset,
                        page_size=cfg["page_size"],
                    )
                    if not rows:
                        break
                    table_read += len(rows)
                    if table == cfg["attendance_table"] or "attendance" in table.lower():
                        rows = _enrich_attendance_rows(
                            rows,
                            cfg=cfg,
                            employees_by_id=employees_by_id,
                        )
                    table_upserted += _upsert_records(
                        source_project=cfg["project"],
                        table=table,
                        rows=rows,
                        key_columns=cfg["key_columns"],
                    )
                    if len(rows) < cfg["page_size"]:
                        break
                    offset += cfg["page_size"]
                details["tables"][table] = {
                    "rows_read": table_read,
                    "rows_upserted": table_upserted,
                }
                rows_read += table_read
                rows_upserted += table_upserted
    except Exception as exc:
        status = "failed"
        error = str(exc)

    finished_at = datetime.now(timezone.utc)
    result = {
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "status": status,
        "trigger_source": trigger_source,
        "source_project": cfg["project"],
        "tables": cfg["tables"],
        "rows_read": rows_read,
        "rows_upserted": rows_upserted,
        "error": error,
        "details": details,
    }
    _log_run(result)
    if status == "failed":
        raise RuntimeError(error or "Attendance sync failed")
    return {"ok": True, **result}


def get_attendance_sync_status(limit: int = 10) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 10), 50))
    runs = (
        supabase.table("attendance_sync_runs")
        .select("*")
        .order("started_at", desc=True)
        .limit(safe_limit)
        .execute()
    )
    return {"ok": True, "runs": runs.data or []}


def get_attendance_sync_public_status() -> dict[str, Any]:
    """Public health payload without source/table/error internals."""
    runs = (
        supabase.table("attendance_sync_runs")
        .select("started_at,finished_at,status,rows_read,rows_upserted")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    latest = (runs.data or [None])[0]
    return {
        "ok": True,
        "latest": latest,
    }


def _norm_name(value: Any) -> str:
    cleaned = str(value or "").strip().lower().replace("dashboard", " ")
    return " ".join(cleaned.split())


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    for part in (raw[:10], raw):
        try:
            return date.fromisoformat(part)
        except Exception:
            pass
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except Exception:
            pass
    return None


def _month_range(month: str | None = None, year: int | None = None) -> tuple[date, date, str, int]:
    now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    month_num = now_ist.month
    if month:
        needle = month.strip().lower()[:3]
        for idx, name in enumerate(MONTH_NAMES, 1):
            if name.lower() == needle:
                month_num = idx
                break
    year_num = int(year or now_ist.year)
    start = date(year_num, month_num, 1)
    if month_num == 12:
        end = date(year_num, 12, 31)
    else:
        end = date(year_num, month_num + 1, 1) - timedelta(days=1)
    return start, end, MONTH_NAMES[month_num - 1], year_num


def _name_matches(row_name: Any, user_name: str) -> bool:
    left = _norm_name(row_name)
    right = _norm_name(user_name)
    if not left or not right:
        return False
    if left == right or left in right or right in left:
        return True
    left_tokens = {part for part in left.split() if len(part) >= 3}
    right_tokens = {part for part in right.split() if len(part) >= 3}
    return bool(left_tokens & right_tokens)


def _payload_name(payload: dict[str, Any]) -> str:
    for key in ("employee_name", "full_name", "name", "display_name", "user_name", "staff_name"):
        if payload.get(key):
            return str(payload.get(key))
    employee = payload.get("employee")
    if isinstance(employee, dict):
        return _employee_name(employee, list(DEFAULT_EMPLOYEE_NAME_COLUMNS)) or ""
    return ""


def _attendance_status(payload: dict[str, Any]) -> str | None:
    raw = ""
    for key in ("status", "attendance_status", "mark", "attendance", "present_absent", "final_status"):
        if payload.get(key) is not None:
            raw = str(payload.get(key)).strip().lower()
            break
    if raw in ("p", "present", "prs", "presented", "ot", "overtime"):
        return "P"
    if raw in ("a", "absent", "abs"):
        return "A"
    if raw.startswith("present"):
        return "P"
    if raw.startswith("absent"):
        return "A"
    return None


def _attendance_date(payload: dict[str, Any]) -> date | None:
    for key in ("date", "attendance_date", "attendanceDate", "work_date", "punch_date", "created_at"):
        parsed = _parse_date(payload.get(key))
        if parsed:
            return parsed
    return None


def _leave_date_range(payload: dict[str, Any]) -> tuple[date | None, date | None]:
    start = None
    end = None
    for key in ("start_date", "from_date", "leave_from", "leaveStart", "date", "leave_date"):
        start = _parse_date(payload.get(key))
        if start:
            break
    for key in ("end_date", "to_date", "leave_to", "leaveEnd", "date", "leave_date"):
        end = _parse_date(payload.get(key))
        if end:
            break
    return start, end or start


def _is_countable_leave(payload: dict[str, Any]) -> bool:
    raw = " ".join(
        str(payload.get(key) or "").strip().lower()
        for key in ("status", "leave_status", "approval_status", "state")
    )
    if any(term in raw for term in ("reject", "cancel", "denied", "declined")):
        return False
    return True


def _looks_like_attendance_table(source_table: Any) -> bool:
    table = str(source_table or "").strip().lower()
    return any(hint in table for hint in ATTENDANCE_TABLE_HINTS) and "leave" not in table


def _looks_like_leave_table(source_table: Any) -> bool:
    table = str(source_table or "").strip().lower()
    return any(hint in table for hint in LEAVE_TABLE_HINTS)


def _iter_dates(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _working_day_weight(day: date, *, exclude_saturday: bool = False) -> float:
    if day.weekday() == 6:  # Sunday
        return 0.0
    if exclude_saturday and day.weekday() == 5:
        return 0.0
    return 1.0


def _round_day_count(value: float) -> int | float:
    rounded = round(value, 2)
    if rounded.is_integer():
        return int(rounded)
    return rounded


def _working_days_between(start: date, end: date, *, exclude_saturday: bool = False) -> float:
    if end < start:
        return 0.0
    return sum(_working_day_weight(day, exclude_saturday=exclude_saturday) for day in _iter_dates(start, end))


def _exclude_saturday_for_user(user_name: str) -> bool:
    return "adrija" in _norm_name(user_name)


def _base_user_summary(users: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(user.get("id") or ""): {
            "userId": str(user.get("id") or ""),
            "name": str(user.get("full_name") or user.get("name") or ""),
            "attendance": {
                "present": 0,
                "absent": 0,
                "workingDays": 0,
                "dataUntil": None,
                "presentDates": [],
                "absentDates": [],
            },
            "leave": {"days": 0, "dates": []},
        }
        for user in users
        if str(user.get("id") or "").strip()
    }


def get_monthly_attendance_leave_summary(
    *,
    users: list[dict[str, Any]],
    month: str | None = None,
    year: int | None = None,
) -> dict[str, Any]:
    start, end, month_label, year_num = _month_range(month, year)
    summaries = _base_user_summary(users)
    names_by_id = {user_id: item["name"] for user_id, item in summaries.items()}
    attendance_by_user: dict[str, dict[date, str]] = {user_id: {} for user_id in summaries}
    leave_by_user: dict[str, set[date]] = {user_id: set() for user_id in summaries}
    latest_attendance_date: date | None = None

    rows = (
        supabase.table("attendance_sync_records")
        .select("source_table,payload")
        .limit(10000)
        .execute()
        .data
        or []
    )

    for row in rows:
        if not _looks_like_attendance_table(row.get("source_table")):
            continue
        payload = row.get("source_payload") if isinstance(row.get("source_payload"), dict) else row.get("payload") or row
        if not isinstance(payload, dict):
            continue
        attendance_date = _parse_date(row.get("attendance_date")) or _attendance_date(payload)
        status_payload = dict(payload)
        if row.get("status") is not None:
            status_payload["status"] = row.get("status")
        if row.get("final_status") is not None:
            status_payload["final_status"] = row.get("final_status")
        status = _attendance_status(status_payload)
        if not attendance_date or attendance_date < start or attendance_date > end or status not in ("P", "A"):
            continue
        latest_attendance_date = max(latest_attendance_date, attendance_date) if latest_attendance_date else attendance_date
        row_name = row.get("employee_name") or _payload_name(payload)
        for user_id, user_name in names_by_id.items():
            if _name_matches(row_name, user_name):
                # If a source has more than one mark in a day, Present wins over Absent.
                if attendance_by_user[user_id].get(attendance_date) != "P":
                    attendance_by_user[user_id][attendance_date] = status

    leave_rows = rows

    for row in leave_rows:
        if not _looks_like_leave_table(row.get("source_table")):
            continue
        payload = row.get("payload")
        if not isinstance(payload, dict) or not _is_countable_leave(payload):
            continue
        leave_start, leave_end = _leave_date_range(payload)
        if not leave_start or not leave_end or leave_end < start or leave_start > end:
            continue
        row_name = _payload_name(payload)
        for user_id, user_name in names_by_id.items():
            if _name_matches(row_name, user_name):
                clipped_start = max(leave_start, start)
                clipped_end = min(leave_end, end)
                leave_by_user[user_id].update(_iter_dates(clipped_start, clipped_end))

    data_until = latest_attendance_date or min(end, datetime.now(timezone(timedelta(hours=5, minutes=30))).date())
    data_until = min(max(data_until, start), end)
    for user_id, day_statuses in attendance_by_user.items():
        exclude_saturday = _exclude_saturday_for_user(names_by_id.get(user_id, ""))
        working_days = _working_days_between(start, data_until, exclude_saturday=exclude_saturday)
        present_days = sum(
            _working_day_weight(day, exclude_saturday=exclude_saturday)
            for day, status in day_statuses.items()
            if status == "P" and start <= day <= data_until
        )
        leave_days = sum(
            _working_day_weight(day, exclude_saturday=exclude_saturday)
            for day in leave_by_user[user_id]
            if start <= day <= data_until
        )
        present_dates = sorted(
            day
            for day, status in day_statuses.items()
            if status == "P"
            and start <= day <= data_until
            and _working_day_weight(day, exclude_saturday=exclude_saturday) > 0
        )
        leave_dates = sorted(
            day
            for day in leave_by_user[user_id]
            if start <= day <= data_until and _working_day_weight(day, exclude_saturday=exclude_saturday) > 0
        )
        absent_dates = [
            day
            for day in _iter_dates(start, data_until)
            if _working_day_weight(day, exclude_saturday=exclude_saturday) > 0
            and day not in present_dates
            and day not in leave_dates
        ]
        absent_days = max(working_days - present_days - leave_days, 0)
        summaries[user_id]["attendance"] = {
            "present": _round_day_count(present_days),
            "absent": _round_day_count(absent_days),
            "workingDays": _round_day_count(working_days),
            "dataUntil": data_until.isoformat(),
            "presentDates": [day.isoformat() for day in present_dates],
            "absentDates": [day.isoformat() for day in absent_dates],
        }
        summaries[user_id]["leave"] = {
            "days": _round_day_count(leave_days),
            "dates": [day.isoformat() for day in leave_dates],
        }

    return {
        "ok": True,
        "month": month_label,
        "year": year_num,
        "from": start.isoformat(),
        "to": data_until.isoformat(),
        "monthEnd": end.isoformat(),
        "users": summaries,
    }
