"""Shared delegation_tasks insert (SPA + integration API)."""
from __future__ import annotations

import logging
import uuid
from datetime import date

from fastapi import HTTPException

from app.supabase_client import supabase

_log = logging.getLogger("delegation_write")


def generate_delegation_reference_no(*, name_source_user_id: str) -> str:
    """Build DEL-<NAMEPREFIX>-NNN from submitted_by/assignee profile name."""
    try:
        pr = (
            supabase.table("user_profiles")
            .select("full_name")
            .eq("id", name_source_user_id)
            .limit(1)
            .execute()
        )
        name = (pr.data or [{}])[0].get("full_name") or "USER"
        prefix = "".join(c for c in name.upper() if c.isalnum())[:6] or "USER"
        existing = (
            supabase.table("delegation_tasks")
            .select("reference_no")
            .like("reference_no", f"DEL-{prefix}-%")
            .execute()
        )
        nums: list[int] = []
        for row in existing.data or []:
            ref = row.get("reference_no") or ""
            if ref.startswith(f"DEL-{prefix}-"):
                try:
                    nums.append(int(ref.split("-")[-1]))
                except ValueError:
                    pass
        next_num = max(nums, default=0) + 1
        return f"DEL-{prefix}-{next_num:03d}"
    except Exception as e:
        _log.warning("delegation reference_no fallback: %s", e)
        return f"DEL-{str(uuid.uuid4())[:8].upper()}"


def insert_delegation_task(
    *,
    title: str,
    assignee_id: str,
    due_date: str,
    created_by: str,
    delegation_on: str | None = None,
    submission_date: str | None = None,
    has_document: str | None = None,
    document_url: str | None = None,
    submitted_by: str | None = None,
) -> dict:
    """Validate dates and insert one delegation_tasks row. Raises HTTPException."""
    try:
        date.fromisoformat(due_date)
    except ValueError as err:
        raise HTTPException(400, "Invalid due_date. Use YYYY-MM-DD") from err
    for field_name, val in (("delegation_on", delegation_on), ("submission_date", submission_date)):
        if val:
            try:
                date.fromisoformat(val)
            except ValueError as err:
                raise HTTPException(400, f"Invalid {field_name}. Use YYYY-MM-DD") from err

    data: dict = {
        "title": title.strip(),
        "assignee_id": assignee_id,
        "due_date": due_date,
        "created_by": created_by,
        "shift_count": 0,
        "shift_history": [],
    }
    # Always write date columns when provided (integration defaults both to due_date).
    if delegation_on is not None and str(delegation_on).strip():
        data["delegation_on"] = str(delegation_on).strip()[:10]
    if submission_date is not None and str(submission_date).strip():
        data["submission_date"] = str(submission_date).strip()[:10]
    if has_document:
        data["has_document"] = has_document
    if document_url:
        data["document_url"] = document_url
    if submitted_by:
        data["submitted_by"] = submitted_by
    if data.get("submission_date"):
        data["last_assigned_date"] = data["submission_date"]
    elif due_date:
        data["last_assigned_date"] = due_date

    data["reference_no"] = generate_delegation_reference_no(
        name_source_user_id=submitted_by or assignee_id
    )

    try:
        r = supabase.table("delegation_tasks").insert(data).execute()
        return r.data[0] if r.data else {}
    except Exception as e:
        _log.exception("delegation create error: %s", e)
        err = str(e).lower()
        if "shift_count" in err or "shift_history" in err or "last_assigned_date" in err:
            data.pop("shift_count", None)
            data.pop("shift_history", None)
            data.pop("last_assigned_date", None)
            try:
                r = supabase.table("delegation_tasks").insert(data).execute()
                return r.data[0] if r.data else {}
            except Exception as e2:
                e = e2
                err = str(e2).lower()
        if "does not exist" in err or "relation" in err:
            raise HTTPException(
                503,
                "Delegation table not set up. Run database/DELEGATION_AND_PENDING_REMINDER.sql in Supabase.",
            ) from e
        raise HTTPException(400, str(e)[:200]) from e
