"""Improvement suggestions API — submit (Improvement) and I-1 board (user-wise access)."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_middleware import get_current_user
from app.supabase_client import supabase

improvement_router = APIRouter(tags=["improvement-suggestions"])

IMPROVEMENT_SECTION = "improvement"
IMPROVEMENT_I1_SECTION = "improvement_i1"

_I1_LIST_CACHE: TTLCache = TTLCache(maxsize=8, ttl=120)
_I1_LIST_COLS = (
    "id,reference_no,suggestion_text,created_by,user_display_name,status,created_at,done_at,updated_at"
)


def invalidate_improvement_i1_list_cache() -> None:
    _I1_LIST_CACHE.clear()


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _section_access(user_id: str, section_key: str, *, need_edit: bool = False) -> bool:
    from app.section_permissions_util import can_view_section

    return can_view_section(user_id, section_key, need_edit=need_edit)


def _require_improvement_view(auth: dict = Depends(get_current_user)) -> dict:
    if not _section_access(auth["id"], IMPROVEMENT_SECTION):
        raise HTTPException(status_code=403, detail="No access to Improvement")
    return auth


def _require_i1_view(auth: dict = Depends(get_current_user)) -> dict:
    if not _section_access(auth["id"], IMPROVEMENT_I1_SECTION):
        raise HTTPException(status_code=403, detail="No access to I - 1 board")
    return auth


def _require_i1_edit(auth: dict = Depends(get_current_user)) -> dict:
    if not _section_access(auth["id"], IMPROVEMENT_I1_SECTION, need_edit=True):
        raise HTTPException(status_code=403, detail="I - 1 board is read-only for your account")
    return auth


def _user_display_name(user_id: str, email: str | None = None) -> str:
    try:
        r = (
            supabase.table("user_profiles")
            .select("full_name, email")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if r.data:
            name = (r.data[0].get("full_name") or "").strip()
            if name:
                return name
            em = (r.data[0].get("email") or "").strip()
            if em:
                return em
    except Exception:
        pass
    return (email or "").strip() or "User"


def _generate_improvement_reference() -> str:
    try:
        r = (
            supabase.table("improvement_suggestions")
            .select("reference_no")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
        nums: list[int] = []
        for row in r.data or []:
            ref = str((row or {}).get("reference_no") or "").upper()
            m = re.match(r"^IM-(\d+)$", ref)
            if m:
                nums.append(int(m.group(1)))
        n = max(nums, default=0) + 1
        return f"IM-{n:04d}"
    except Exception:
        return f"IM-{int(datetime.now(timezone.utc).timestamp()) % 100000:04d}"


def _row_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "reference_no": row.get("reference_no"),
        "suggestion_text": row.get("suggestion_text"),
        "created_by": row.get("created_by"),
        "user_display_name": row.get("user_display_name"),
        "status": row.get("status") or "not_done",
        "created_at": row.get("created_at"),
        "done_at": row.get("done_at"),
        "updated_at": row.get("updated_at"),
    }


def _load_i1_rows() -> list[dict[str, Any]]:
    try:
        return _I1_LIST_CACHE["rows"]
    except KeyError:
        pass
    r = (
        supabase.table("improvement_suggestions")
        .select(_I1_LIST_COLS)
        .order("created_at", desc=True)
        .execute()
    )
    rows = [_row_out(x) for x in (r.data or [])]
    _I1_LIST_CACHE["rows"] = rows
    return rows


class ImprovementCreateBody(BaseModel):
    suggestion_text: str = Field(..., min_length=1, max_length=8000)


class ImprovementUpdateBody(BaseModel):
    reference_no: str | None = Field(None, min_length=1, max_length=32)
    suggestion_text: str | None = Field(None, min_length=1, max_length=8000)
    status: str | None = Field(None, pattern="^(done|not_done)$")


@improvement_router.get("/improvement-suggestions/me")
def improvement_suggestions_me(auth: dict = Depends(_require_improvement_view)):
    """Current user label for Improvement form."""
    return {
        "user_id": auth["id"],
        "user_display_name": _user_display_name(auth["id"], auth.get("email")),
        "email": auth.get("email"),
    }


@improvement_router.get("/improvement-suggestions")
def list_improvement_suggestions(auth: dict = Depends(_require_i1_view)):
    """I-1 board list (view = improvement_i1; edit = improvement_i1 Edit in User permissions)."""
    try:
        rows = _load_i1_rows()
    except Exception as e:
        err = str(e)
        if "improvement_suggestions" in err and ("does not exist" in err or "PGRST205" in err):
            raise HTTPException(
                status_code=503,
                detail="Table missing. Run database/IMPROVEMENT_SUGGESTIONS_SYSTEM.sql in Supabase.",
            ) from e
        raise HTTPException(status_code=500, detail="Could not load improvement suggestions.") from e
    return {
        "data": rows,
        "can_edit": _section_access(auth["id"], IMPROVEMENT_I1_SECTION, need_edit=True),
    }


@improvement_router.post("/improvement-suggestions")
def create_improvement_suggestion(
    body: ImprovementCreateBody,
    auth: dict = Depends(_require_improvement_view),
):
    text = (body.suggestion_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Suggestion is required.")
    now = datetime.now(timezone.utc).isoformat()
    ref = _generate_improvement_reference()
    display = _user_display_name(auth["id"], auth.get("email"))
    row = {
        "reference_no": ref,
        "suggestion_text": text,
        "created_by": auth["id"],
        "user_display_name": display,
        "status": "not_done",
        "created_at": now,
        "updated_at": now,
    }
    try:
        ins = supabase.table("improvement_suggestions").insert(row).execute()
    except Exception as e:
        err = str(e)
        if "improvement_suggestions" in err and ("does not exist" in err or "PGRST205" in err):
            raise HTTPException(
                status_code=503,
                detail="Table missing. Run database/IMPROVEMENT_SUGGESTIONS_SYSTEM.sql in Supabase.",
            ) from e
        raise HTTPException(status_code=500, detail="Could not save suggestion.") from e
    if not ins.data:
        raise HTTPException(status_code=500, detail="Could not save suggestion.")
    invalidate_improvement_i1_list_cache()
    return {"success": True, "data": _row_out(ins.data[0])}


@improvement_router.patch("/improvement-suggestions/{row_id}")
def update_improvement_suggestion(
    row_id: str,
    body: ImprovementUpdateBody,
    auth: dict = Depends(_require_i1_edit),
):
    if not any(
        v is not None
        for v in (body.reference_no, body.suggestion_text, body.status)
    ):
        raise HTTPException(status_code=400, detail="No fields to update.")
    existing = (
        supabase.table("improvement_suggestions")
        .select("id, status")
        .eq("id", row_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.reference_no is not None:
        ref = body.reference_no.strip().upper()
        if not re.match(r"^IM-\d{1,6}$", ref):
            raise HTTPException(status_code=400, detail="Reference must look like IM-0001.")
        dup = (
            supabase.table("improvement_suggestions")
            .select("id")
            .eq("reference_no", ref)
            .neq("id", row_id)
            .limit(1)
            .execute()
        )
        if dup.data:
            raise HTTPException(status_code=400, detail="Reference number already in use.")
        patch["reference_no"] = ref
    if body.suggestion_text is not None:
        t = body.suggestion_text.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Suggestion cannot be empty.")
        patch["suggestion_text"] = t
    prev_status = (existing.data[0].get("status") or "not_done").strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    if body.status is not None:
        patch["status"] = body.status
        if body.status == "done" and prev_status != "done":
            patch["done_at"] = now_iso
        elif body.status == "not_done" and prev_status == "done":
            patch["done_at"] = None
    try:
        ur = supabase.table("improvement_suggestions").update(patch).eq("id", row_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not update suggestion.") from e
    if not ur.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    updated = ur.data[0]
    invalidate_improvement_i1_list_cache()
    email_sent = False
    email_error: str | None = None
    new_status = (updated.get("status") or "not_done").strip()
    if body.status == "done" and prev_status != "done":
        from app.improvement_done_notify import send_improvement_done_notification

        email_sent, email_error = asyncio.run(send_improvement_done_notification(updated))
    out: dict[str, Any] = {"success": True, "data": _row_out(updated)}
    if body.status is not None:
        out["email_sent"] = email_sent
        if email_error:
            out["email_error"] = email_error
    return out


@improvement_router.delete("/improvement-suggestions/{row_id}")
def delete_improvement_suggestion(row_id: str, auth: dict = Depends(_require_i1_edit)):
    existing = (
        supabase.table("improvement_suggestions")
        .select("reference_no")
        .eq("id", row_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    ref = existing.data[0].get("reference_no")
    try:
        supabase.table("improvement_suggestions").delete().eq("id", row_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not delete suggestion.") from e
    invalidate_improvement_i1_list_cache()
    return {"success": True, "reference_no": ref}
