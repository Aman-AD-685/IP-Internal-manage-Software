"""WebSocket live events — system lock, app release (authenticated clients)."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.auth_middleware import get_current_user
from app.supabase_client import supabase
from app.system_lock import get_system_lock_state
from app.ws_hub import broadcast_app_release_changed, ws_hub

_log = logging.getLogger("ws_routes")

ws_router = APIRouter(tags=["websocket"])


def _validate_ws_token(token: str) -> dict:
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"id": str(user_resp.user.id), "email": user_resp.user.email or ""}
    except HTTPException:
        raise
    except Exception as e:
        _log.warning("ws token validation failed: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid token") from e


def _require_master_admin(auth: dict = Depends(get_current_user)) -> dict:
    from app.main import _get_role_from_profile

    role = _get_role_from_profile(auth["id"])
    if role != "master_admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return {**auth, "role": role}


def _app_release_snapshot() -> dict:
    from app.main import _get_app_release_broadcast

    return _get_app_release_broadcast()


def _invalidate_app_release_cache() -> None:
    from app.main import invalidate_app_release_cache

    invalidate_app_release_cache()


@ws_router.websocket("/ws")
async def fms_websocket(websocket: WebSocket, token: str = Query(default="")):
    """Live push for system lock + release changes. Token via query (browser WebSocket API)."""
    try:
        _validate_ws_token(token)
    except HTTPException:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    await ws_hub.connect(websocket)
    try:
        lock_state = get_system_lock_state(force_refresh=True)
        release_state = await asyncio.to_thread(_app_release_snapshot)
        await ws_hub.send_json(
            websocket,
            {
                "type": "hello",
                "system_lock": lock_state,
                "app_release": release_state,
            },
        )

        while True:
            raw = await websocket.receive_text()
            if raw.strip().lower() in ("ping", '{"type":"ping"}'):
                await ws_hub.send_json(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        _log.debug("ws session ended: %s", type(e).__name__)
    finally:
        await ws_hub.disconnect(websocket)


@ws_router.post("/app/release/notify")
def notify_app_release_live(auth: dict = Depends(_require_master_admin)):
    """
    Push current release_key to all connected clients (call after bump_app_release in Supabase).
    Master Admin only.
    """
    _invalidate_app_release_cache()
    data = _app_release_snapshot()
    broadcast_app_release_changed(data)
    return {"success": True, "data": data, "connections": ws_hub.connection_count}
