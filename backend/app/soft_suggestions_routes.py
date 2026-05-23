"""Soft suggestions API — IP Suggestion form, IP Details board, Move to Support."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_middleware import get_current_user
from app.supabase_client import supabase

soft_suggestions_router = APIRouter(tags=["soft-suggestions"])

SOFT_SUGG_SECTION = "soft_sugg"
SOFT_SUGG_DETAILS_SECTION = "soft_sugg_details"


def _role(user_id: str) -> str:
    from app.main import _get_role_from_profile

    return _get_role_from_profile(user_id)


def _section_access(user_id: str, section_key: str, *, need_edit: bool = False) -> bool:
    role = _role(user_id)
    if role == "master_admin" and section_key in (SOFT_SUGG_SECTION, SOFT_SUGG_DETAILS_SECTION):
        return True
    from app.section_permissions_util import can_view_section

    return can_view_section(user_id, section_key, need_edit=need_edit)


def _can_edit_all(user_id: str) -> bool:
    return _role(user_id) == "master_admin"


def _can_edit_move(user_id: str) -> bool:
    if _can_edit_all(user_id):
        return True
    return _section_access(user_id, SOFT_SUGG_DETAILS_SECTION, need_edit=True)


def _require_soft_sugg_view(auth: dict = Depends(get_current_user)) -> dict:
    if not _section_access(auth["id"], SOFT_SUGG_SECTION):
        raise HTTPException(status_code=403, detail="No access to IP Suggestion")
    return auth


def _require_details_view(auth: dict = Depends(get_current_user)) -> dict:
    if not _section_access(auth["id"], SOFT_SUGG_DETAILS_SECTION):
        raise HTTPException(status_code=403, detail="No access to IP Details")
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


def _generate_reference() -> str:
    try:
        r = (
            supabase.table("soft_suggestions")
            .select("reference_no")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
        nums: list[int] = []
        for row in r.data or []:
            ref = str((row or {}).get("reference_no") or "").upper()
            m = re.match(r"^SS-(\d+)$", ref)
            if m:
                nums.append(int(m.group(1)))
        return f"SS-{max(nums, default=0) + 1:04d}"
    except Exception:
        return f"SS-{int(datetime.now(timezone.utc).timestamp()) % 100000:04d}"


def _page_name(page_id: str | None) -> str | None:
    if not page_id:
        return None
    try:
        r = supabase.table("pages").select("name").eq("id", page_id).limit(1).execute()
        if r.data:
            return (r.data[0].get("name") or "").strip() or None
    except Exception:
        pass
    return None


def _row_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "reference_no": row.get("reference_no"),
        "suggestion_text": row.get("suggestion_text"),
        "attach_link": row.get("attach_link"),
        "page_id": row.get("page_id"),
        "page_name": row.get("page_name"),
        "ticket_type": row.get("ticket_type") or "chore",
        "created_by": row.get("created_by"),
        "user_display_name": row.get("user_display_name"),
        "status": row.get("status") or "open",
        "support_ticket_id": row.get("support_ticket_id"),
        "support_ticket_ref": row.get("support_ticket_ref"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


class SoftSuggCreateBody(BaseModel):
    suggestion_text: str = Field(..., min_length=1, max_length=8000)
    attach_link: str | None = Field(None, max_length=2000)
    page_id: str | None = None
    ticket_type: str = Field(..., pattern="^(chore|bug|feature)$")


class SoftSuggUpdateBody(BaseModel):
    reference_no: str | None = Field(None, max_length=32)
    suggestion_text: str | None = Field(None, min_length=1, max_length=8000)
    attach_link: str | None = Field(None, max_length=2000)
    page_id: str | None = None
    ticket_type: str | None = Field(None, pattern="^(chore|bug|feature)$")


class SoftSuggLinkTicketBody(BaseModel):
    ticket_id: str = Field(..., min_length=1)


@soft_suggestions_router.get("/soft-suggestions/me")
def soft_suggestions_me(auth: dict = Depends(_require_soft_sugg_view)):
    pages: list[dict[str, str]] = []
    try:
        r = supabase.table("pages").select("id, name").order("name").limit(500).execute()
        for p in r.data or []:
            if p.get("id") and p.get("name"):
                pages.append({"id": str(p["id"]), "name": str(p["name"])})
    except Exception:
        pass
    return {
        "user_id": auth["id"],
        "user_display_name": _user_display_name(auth["id"], auth.get("email")),
        "email": auth.get("email"),
        "pages": pages,
    }


@soft_suggestions_router.get("/soft-suggestions")
def list_soft_suggestions(auth: dict = Depends(_require_details_view)):
    try:
        r = (
            supabase.table("soft_suggestions")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as e:
        err = str(e)
        if "soft_suggestions" in err and ("does not exist" in err or "PGRST205" in err):
            raise HTTPException(
                status_code=503,
                detail="Table missing. Run database/SOFT_SUGGESTIONS_SYSTEM.sql in Supabase.",
            ) from e
        raise HTTPException(status_code=500, detail="Could not load suggestions.") from e
    return {
        "data": [_row_out(x) for x in (r.data or [])],
        "can_edit_all": _can_edit_all(auth["id"]),
        "can_edit_move": _can_edit_move(auth["id"]),
    }


@soft_suggestions_router.post("/soft-suggestions")
def create_soft_suggestion(body: SoftSuggCreateBody, auth: dict = Depends(_require_soft_sugg_view)):
    text = (body.suggestion_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Suggestion is required.")
    tt = (body.ticket_type or "chore").strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    pid = (body.page_id or "").strip() or None
    row = {
        "reference_no": _generate_reference(),
        "suggestion_text": text,
        "attach_link": (body.attach_link or "").strip() or None,
        "page_id": pid,
        "page_name": _page_name(pid),
        "ticket_type": tt,
        "created_by": auth["id"],
        "user_display_name": _user_display_name(auth["id"], auth.get("email")),
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    try:
        ins = supabase.table("soft_suggestions").insert(row).execute()
    except Exception as e:
        err = str(e)
        if "soft_suggestions" in err and ("does not exist" in err or "PGRST205" in err):
            raise HTTPException(
                status_code=503,
                detail="Table missing. Run database/SOFT_SUGGESTIONS_SYSTEM.sql in Supabase.",
            ) from e
        raise HTTPException(status_code=500, detail="Could not save suggestion.") from e
    if not ins.data:
        raise HTTPException(status_code=500, detail="Could not save suggestion.")
    return {"success": True, "data": _row_out(ins.data[0])}


@soft_suggestions_router.patch("/soft-suggestions/{row_id}")
def update_soft_suggestion(
    row_id: str,
    body: SoftSuggUpdateBody,
    auth: dict = Depends(get_current_user),
):
    if not _can_edit_all(auth["id"]):
        raise HTTPException(status_code=403, detail="Only Master Admin can edit suggestion fields.")
    if not any(
        v is not None
        for v in (body.reference_no, body.suggestion_text, body.attach_link, body.page_id, body.ticket_type)
    ):
        raise HTTPException(status_code=400, detail="No fields to update.")
    patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.reference_no is not None:
        ref = body.reference_no.strip().upper()
        if not re.match(r"^SS-\d{1,6}$", ref):
            raise HTTPException(status_code=400, detail="Reference must look like SS-0001.")
        dup = (
            supabase.table("soft_suggestions")
            .select("id")
            .eq("reference_no", ref)
            .neq("id", row_id)
            .limit(1)
            .execute()
        )
        if dup.data:
            raise HTTPException(status_code=400, detail="Reference already in use.")
        patch["reference_no"] = ref
    if body.suggestion_text is not None:
        t = body.suggestion_text.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Suggestion cannot be empty.")
        patch["suggestion_text"] = t
    if body.attach_link is not None:
        patch["attach_link"] = body.attach_link.strip() or None
    if body.page_id is not None:
        pid = body.page_id.strip() or None
        patch["page_id"] = pid
        patch["page_name"] = _page_name(pid)
    if body.ticket_type is not None:
        patch["ticket_type"] = body.ticket_type
    ur = supabase.table("soft_suggestions").update(patch).eq("id", row_id).execute()
    if not ur.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return {"success": True, "data": _row_out(ur.data[0])}


@soft_suggestions_router.post("/soft-suggestions/{row_id}/link-ticket")
def link_soft_suggestion_ticket(
    row_id: str,
    body: SoftSuggLinkTicketBody,
    auth: dict = Depends(get_current_user),
):
    if not _can_edit_move(auth["id"]):
        raise HTTPException(status_code=403, detail="No permission to Move to Soft.")
    existing = (
        supabase.table("soft_suggestions")
        .select("*")
        .eq("id", row_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    if existing.data[0].get("status") == "moved":
        raise HTTPException(status_code=400, detail="Already moved to Support.")
    tr = (
        supabase.table("tickets")
        .select("id, reference_no, type")
        .eq("id", body.ticket_id)
        .limit(1)
        .execute()
    )
    if not tr.data:
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    now = datetime.now(timezone.utc).isoformat()
    patch = {
        "status": "moved",
        "support_ticket_id": body.ticket_id,
        "support_ticket_ref": tr.data[0].get("reference_no"),
        "updated_at": now,
    }
    ur = supabase.table("soft_suggestions").update(patch).eq("id", row_id).execute()
    if not ur.data:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return {"success": True, "data": _row_out(ur.data[0])}


@soft_suggestions_router.delete("/soft-suggestions/{row_id}")
def delete_soft_suggestion(row_id: str, auth: dict = Depends(get_current_user)):
    if not _can_edit_all(auth["id"]):
        raise HTTPException(status_code=403, detail="Only Master Admin can delete.")
    supabase.table("soft_suggestions").delete().eq("id", row_id).execute()
    return {"success": True}
