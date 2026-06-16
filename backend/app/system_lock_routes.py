"""System lock API — Master Admin control + status for all authenticated users."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_middleware import get_current_user
from app.system_lock import (
    disable_system_lock,
    enable_system_lock,
    get_system_lock_state,
    list_system_lock_audit,
)

system_lock_router = APIRouter(tags=["system-lock"])


def _require_master_admin(auth: dict = Depends(get_current_user)) -> dict:
    from app.main import _get_role_from_profile

    role = _get_role_from_profile(auth["id"])
    if role != "master_admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return {**auth, "role": role}


class SystemLockEnableRequest(BaseModel):
    reason: str = Field(..., min_length=10, max_length=2000)


@system_lock_router.get("/system-lock/status")
def system_lock_status(auth: dict = Depends(get_current_user)):
    """Current lock state (reason visible to all signed-in users)."""
    data = get_system_lock_state()
    return {"success": True, "data": data}


@system_lock_router.post("/system-lock/lock")
def system_lock_enable(
    payload: SystemLockEnableRequest,
    auth: dict = Depends(_require_master_admin),
):
    try:
        data = enable_system_lock(
            user_id=str(auth["id"]),
            email=str(auth.get("email") or ""),
            reason=payload.reason.strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Could not enable system lock. Run database/SYSTEM_LOCK.sql in Supabase.",
        ) from e
    return {"success": True, "data": data, "message": "System access lock enabled."}


@system_lock_router.post("/system-lock/unlock")
def system_lock_disable(auth: dict = Depends(_require_master_admin)):
    try:
        data = disable_system_lock(
            user_id=str(auth["id"]),
            email=str(auth.get("email") or ""),
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Could not disable system lock. Run database/SYSTEM_LOCK.sql in Supabase.",
        ) from e
    return {"success": True, "data": data, "message": "System access lock disabled."}


@system_lock_router.get("/system-lock/audit")
def system_lock_audit(
    limit: int = 50,
    auth: dict = Depends(_require_master_admin),
):
    items = list_system_lock_audit(limit=limit)
    return {"success": True, "items": items}
