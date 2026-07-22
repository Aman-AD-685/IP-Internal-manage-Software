"""Bot protect log API — Master Admin only (Settings)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth_middleware import get_current_user
from app.bot_protect import list_bot_events, list_open_bot_strikes

bot_protect_router = APIRouter(tags=["bot-protect"])


def _require_master_admin(auth: dict = Depends(get_current_user)) -> dict:
    from app.main import _get_role_from_profile

    role = _get_role_from_profile(auth["id"])
    if role != "master_admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return {**auth, "role": role}


@bot_protect_router.get("/bot-protect/events")
def bot_protect_events(
    limit: int = Query(100, ge=1, le=500),
    auth: dict = Depends(_require_master_admin),
):
    """Recent bot hits / blocks. Master Admin only."""
    _ = auth
    items = list_bot_events(limit=limit)
    open_strikes = list_open_bot_strikes()
    return {
        "success": True,
        "items": items,
        "open_strikes": open_strikes,
        "hint": "If the table is empty after blocks, run database/BOT_PROTECT_EVENTS.sql in Supabase (in-memory log still works until restart).",
    }
