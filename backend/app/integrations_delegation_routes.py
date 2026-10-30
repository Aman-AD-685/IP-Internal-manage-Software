"""Machine/integration API for Claude & scripts — no browser login.

Auth: X-FMS-Integration-Key (or Authorization: Bearer <key>).
Does not touch SPA /delegation/tasks bot checks.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from app.delegation_write import insert_delegation_task
from app.integration_auth import require_integration_key
from app.supabase_client import supabase

integrations_delegation_router = APIRouter(
    prefix="/integrations/delegation",
    tags=["integrations-delegation"],
)
_log = logging.getLogger("integrations_delegation")


def _ymd(value: Any) -> str | None:
    """Normalize to YYYY-MM-DD; accept ISO datetime strings."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s[:10]
    try:
        date.fromisoformat(s)
    except ValueError as err:
        raise HTTPException(400, f"Invalid date {s!r}. Use YYYY-MM-DD") from err
    return s


class IntegrationCreateDelegationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    due_date: str = Field(
        ...,
        validation_alias=AliasChoices("due_date", "dueDate", "DueDate"),
    )
    assignee_email: str | None = Field(
        None,
        max_length=320,
        validation_alias=AliasChoices("assignee_email", "assigneeEmail"),
    )
    assignee_id: str | None = Field(
        None,
        validation_alias=AliasChoices("assignee_id", "assigneeId"),
    )
    submitted_by_email: str | None = Field(
        None,
        max_length=320,
        validation_alias=AliasChoices("submitted_by_email", "submittedByEmail"),
    )
    submitted_by: str | None = Field(
        None,
        validation_alias=AliasChoices("submitted_by", "submittedBy"),
    )
    # Bot often sends camelCase; accept both. Missing → defaulted to due_date on create.
    delegation_on: str | None = Field(
        None,
        validation_alias=AliasChoices(
            "delegation_on",
            "delegationOn",
            "DelegationOn",
            "delegation_date",
            "delegationDate",
        ),
    )
    submission_date: str | None = Field(
        None,
        validation_alias=AliasChoices(
            "submission_date",
            "submissionDate",
            "SubmissionDate",
            "submit_date",
            "submitDate",
        ),
    )
    has_document: str | None = Field(
        None,
        validation_alias=AliasChoices("has_document", "hasDocument"),
    )
    document_url: str | None = Field(
        None,
        max_length=2000,
        validation_alias=AliasChoices("document_url", "documentUrl"),
    )
    external_ref: str | None = Field(
        None,
        max_length=200,
        validation_alias=AliasChoices("external_ref", "externalRef"),
    )

    @model_validator(mode="before")
    @classmethod
    def _flatten_nested(cls, data: Any) -> Any:
        """Accept {task:{...}} / {data:{...}} wrappers some bots send."""
        if not isinstance(data, dict):
            return data
        for nest in ("task", "data", "payload", "body"):
            inner = data.get(nest)
            if isinstance(inner, dict):
                return {**inner, **{k: v for k, v in data.items() if k != nest}}
        return data

    @field_validator("due_date", "delegation_on", "submission_date", mode="before")
    @classmethod
    def _normalize_dates(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return str(v).strip()


def _norm_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _active_user_by_email(email: str) -> dict:
    em = _norm_email(email)
    if not em or "@" not in em:
        raise HTTPException(400, "Invalid email.")
    try:
        r = (
            supabase.table("user_profiles")
            .select("id, email, full_name, is_active")
            .ilike("email", em)
            .limit(5)
            .execute()
        )
    except Exception as e:
        _log.exception("user lookup by email failed: %s", e)
        raise HTTPException(503, "Could not look up user.") from e
    rows = [row for row in (r.data or []) if _norm_email(row.get("email")) == em]
    if not rows:
        raise HTTPException(404, f"No user found for email: {em}")
    row = rows[0]
    if row.get("is_active") is False:
        raise HTTPException(404, f"User is inactive: {em}")
    return row


def _active_user_by_id(user_id: str) -> dict:
    uid = (user_id or "").strip()
    if not uid:
        raise HTTPException(400, "assignee_id is required when assignee_email is omitted.")
    try:
        r = (
            supabase.table("user_profiles")
            .select("id, email, full_name, is_active")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
    except Exception as e:
        _log.exception("user lookup by id failed: %s", e)
        raise HTTPException(503, "Could not look up user.") from e
    if not r.data:
        raise HTTPException(404, "User not found for assignee_id.")
    row = r.data[0]
    if row.get("is_active") is False:
        raise HTTPException(404, "User is inactive.")
    return row


def _resolve_user(*, email: str | None, user_id: str | None, label: str) -> dict:
    em = _norm_email(email)
    uid = (user_id or "").strip()
    if em:
        by_email = _active_user_by_email(em)
        if uid and str(by_email.get("id")) != uid:
            raise HTTPException(400, f"{label}: email and id do not match the same user.")
        return by_email
    if uid:
        return _active_user_by_id(uid)
    raise HTTPException(400, f"{label}: provide email (preferred) or id.")


def _integration_actor_id(fallback_user_id: str) -> str:
    actor = (os.getenv("DELEGATION_INTEGRATION_ACTOR_ID") or "").strip()
    return actor or fallback_user_id


@integrations_delegation_router.get("/users", dependencies=[Depends(require_integration_key)])
def list_integration_delegation_users():
    """Active users for Claude: email + name + id. No login — API key only."""
    try:
        r = (
            supabase.table("user_profiles")
            .select("id, full_name, email")
            .eq("is_active", True)
            .order("full_name")
            .limit(500)
            .execute()
        )
        users = []
        for row in r.data or []:
            uid = row.get("id")
            if not uid:
                continue
            users.append(
                {
                    "id": str(uid),
                    "full_name": (row.get("full_name") or "").strip() or str(uid),
                    "email": (row.get("email") or "").strip(),
                }
            )
        return {"users": users}
    except Exception as e:
        _log.exception("integrations delegation users error: %s", e)
        raise HTTPException(503, "Could not list users.") from e


@integrations_delegation_router.post("/tasks", dependencies=[Depends(require_integration_key)])
def create_integration_delegation_task(payload: IntegrationCreateDelegationRequest):
    """Create a delegation task for a staff user. No FMS login required."""
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(400, "title is required.")

    assignee = _resolve_user(
        email=payload.assignee_email,
        user_id=payload.assignee_id,
        label="assignee",
    )
    assignee_id = str(assignee["id"])

    submitted_by_id: str | None = None
    if payload.submitted_by_email or payload.submitted_by:
        submitted = _resolve_user(
            email=payload.submitted_by_email,
            user_id=payload.submitted_by,
            label="submitted_by",
        )
        submitted_by_id = str(submitted["id"])
    else:
        submitted_by_id = assignee_id

    has_document = (payload.has_document or "").strip().lower() or None
    if has_document and has_document not in ("yes", "no"):
        raise HTTPException(400, "has_document must be 'yes' or 'no'.")

    due_date = _ymd(payload.due_date)
    if not due_date:
        raise HTTPException(400, "due_date is required (YYYY-MM-DD).")
    # Always persist all three dates — missing → same as due_date (bot may omit or camelCase).
    delegation_on = _ymd(payload.delegation_on) or due_date
    submission_date = _ymd(payload.submission_date) or due_date

    created_by = _integration_actor_id(assignee_id)
    row = insert_delegation_task(
        title=title,
        assignee_id=assignee_id,
        due_date=due_date,
        created_by=created_by,
        delegation_on=delegation_on,
        submission_date=submission_date,
        has_document=has_document,
        document_url=(payload.document_url or "").strip() or None,
        submitted_by=submitted_by_id,
    )
    _log.info(
        "integration create task ref=%s assignee=%s due=%s delegation_on=%s submission_date=%s external_ref=%s",
        row.get("reference_no"),
        assignee.get("email"),
        due_date,
        delegation_on,
        submission_date,
        (payload.external_ref or "").strip() or None,
    )
    return {
        "ok": True,
        "task": row,
        "assignee": {
            "id": assignee_id,
            "email": (assignee.get("email") or "").strip(),
            "full_name": (assignee.get("full_name") or "").strip(),
        },
        "external_ref": (payload.external_ref or "").strip() or None,
    }


_TASK_COLS = (
    "id, reference_no, title, assignee_id, submitted_by, status, due_date, delegation_on, "
    "submission_date, has_document, document_url, created_at, completed_at"
)
# Only open tasks are exposed to integration clients — never completed or cancelled.
_LIST_STATUSES = ("pending", "in_progress")


@integrations_delegation_router.get("/tasks", dependencies=[Depends(require_integration_key)])
def list_integration_delegation_tasks(
    status: str = Query("pending", description="pending | in_progress | all (all = pending + in_progress)"),
    assignee_email: str | None = Query(None),
    created_since: str | None = Query(None, description="YYYY-MM-DD; only tasks created on/after"),
    limit: int = Query(200, ge=1, le=500),
):
    """Pull delegation tasks (default: pending) for an external system."""
    st = (status or "").strip().lower()
    if st != "all" and st not in _LIST_STATUSES:
        raise HTTPException(400, f"status must be one of {', '.join(_LIST_STATUSES)} or all.")
    q = supabase.table("delegation_tasks").select(_TASK_COLS)
    q = q.in_("status", list(_LIST_STATUSES)) if st == "all" else q.eq("status", st)
    if assignee_email:
        q = q.eq("assignee_id", str(_active_user_by_email(assignee_email)["id"]))
    since = _ymd(created_since)
    if since:
        q = q.gte("created_at", since)
    try:
        r = q.order("due_date", desc=False).limit(limit).execute()
    except Exception as e:
        _log.exception("integration list tasks failed: %s", e)
        raise HTTPException(503, "Could not list tasks.") from e
    tasks = r.data or []
    ids = {t[k] for t in tasks for k in ("assignee_id", "submitted_by") if t.get(k)}
    users: dict[str, dict] = {}
    if ids:
        try:
            pr = supabase.table("user_profiles").select("id, full_name, email").in_("id", list(ids)).execute()
            users = {str(p["id"]): p for p in pr.data or []}
        except Exception as e:
            _log.warning("integration list tasks: user lookup failed: %s", e)
    for t in tasks:
        a = users.get(str(t.get("assignee_id")), {})
        s = users.get(str(t.get("submitted_by")), {})
        t["assignee_email"] = (a.get("email") or "").strip()
        t["assignee_name"] = (a.get("full_name") or "").strip()
        t["submitted_by_email"] = (s.get("email") or "").strip()
    return {"count": len(tasks), "tasks": tasks}


class IntegrationUpdateDelegationRequest(BaseModel):
    status: str = Field(..., description="completed | cancelled")
    document_url: str | None = Field(
        None,
        max_length=2000,
        validation_alias=AliasChoices("document_url", "documentUrl"),
    )


@integrations_delegation_router.patch(
    "/tasks/{task_ref}", dependencies=[Depends(require_integration_key)]
)
def update_integration_delegation_task(task_ref: str, payload: IntegrationUpdateDelegationRequest):
    """Complete or cancel a task by id or reference_no. Same rules as the SPA PUT for non-admins."""
    status = (payload.status or "").strip().lower()
    if status not in ("completed", "cancelled"):
        raise HTTPException(400, "status must be completed or cancelled.")
    ref = (task_ref or "").strip()
    col = "id" if _looks_like_uuid(ref) else "reference_no"
    try:
        found = (
            supabase.table("delegation_tasks")
            .select("id, status, has_document")
            .eq(col, ref)
            .limit(1)
            .execute()
        )
    except Exception as e:
        _log.exception("integration task lookup failed: %s", e)
        raise HTTPException(503, "Could not look up task.") from e
    if not found.data:
        raise HTTPException(404, "Task not found.")
    task = found.data[0]
    if task.get("status") not in ("pending", "in_progress"):
        raise HTTPException(409, f"Task is already {task.get('status')}.")
    doc = (payload.document_url or "").strip() or None
    if status == "completed" and task.get("has_document") == "yes" and not doc:
        raise HTTPException(400, "document_url is required to complete this task.")

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data: dict[str, Any] = {"status": status, f"{status}_at": now}
    if doc:
        data["document_url"] = doc
    try:
        # Status guard in the UPDATE itself so two concurrent calls can't both close the task.
        r = (
            supabase.table("delegation_tasks")
            .update(data)
            .eq("id", task["id"])
            .in_("status", ["pending", "in_progress"])
            .execute()
        )
    except Exception as e:
        _log.exception("integration task update failed: %s", e)
        raise HTTPException(503, "Could not update task.") from e
    if not r.data:
        raise HTTPException(409, "Task was closed by another request.")
    from app.main import invalidate_dashboard_read_caches  # lazy: main imports this module

    invalidate_dashboard_read_caches()
    _log.info("integration task %s -> %s", ref, status)
    return {"ok": True, "task": r.data[0]}


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False
