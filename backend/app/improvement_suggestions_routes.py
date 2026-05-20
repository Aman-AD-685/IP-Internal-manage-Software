"""Improvement suggestions API — submit (Improvement) and I-1 board (user-wise access)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_middleware import get_current_user
from app.supabase_client import supabase

improvement_router = APIRouter(tags=["improvement-suggestions"])

IMPROVEMENT_SECTION = "improvement"
IMPROVEMENT_I1_SECTION = "improvement_i1"


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _perm_rows(user_id: str) -> list[dict[str, Any]]:
    try:
        r = (
            supabase.table("user_section_permissions")
            .select("section_key, can_view, can_edit")
            .eq("user_id", user_id)
            .execute()
        )
        return r.data or []
    except Exception:
        return []


def _section_access(user_id: str, section_key: str, *, need_edit: bool = False) -> bool:
    """Match Edit User matrix (legacy: elevated roles with no rows = full access)."""
    role = _role(user_id)
    rows = _perm_rows(user_id)
    elevated = role in ("master_admin", "admin", "approver")
    if elevated and len(rows) == 0:
        return True
    p = next((r for r in rows if r.get("section_key") == section_key), None)
    if not p:
        return False
    if need_edit:
        return bool(p.get("can_view")) and bool(p.get("can_edit"))
    return bool(p.get("can_view"))


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
        "updated_at": row.get("updated_at"),
    }


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
        r = (
            supabase.table("improvement_suggestions")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as e:
        err = str(e)
        if "improvement_suggestions" in err and ("does not exist" in err or "PGRST205" in err):
            raise HTTPException(
                status_code=503,
                detail="Table missing. Run database/IMPROVEMENT_SUGGESTIONS_SYSTEM.sql in Supabase.",
            ) from e
        raise HTTPException(status_code=500, detail="Could not load improvement suggestions.") from e
    rows = [_row_out(x) for x in (r.data or [])]
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
        .select("*")
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
    if body.status is not None:
        patch["status"] = body.status
    try:
        ur = supabase.table("improvement_suggestions").update(patch).eq("id", row_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not update suggestion.") from e
    if not ur.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return {"success": True, "data": _row_out(ur.data[0])}


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
    return {"success": True, "reference_no": ref}
