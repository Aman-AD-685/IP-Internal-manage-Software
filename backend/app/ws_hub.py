"""In-process WebSocket fan-out for live system events (single Render instance)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

_log = logging.getLogger("ws_hub")
WS_SEND_TIMEOUT_SEC = 2.0

_main_loop: asyncio.AbstractEventLoop | None = None


def bind_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


class WsHub:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, default=str)
        async with self._lock:
            targets = list(self._connections)
        if not targets:
            return

        async def send_one(ws: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(ws.send_text(text), timeout=WS_SEND_TIMEOUT_SEC)
                return None
            except Exception:
                return ws

        results = await asyncio.gather(*(send_one(ws) for ws in targets), return_exceptions=False)
        dead = [ws for ws in results if ws is not None]
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

    async def send_json(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(payload, default=str))


ws_hub = WsHub()


def broadcast_ws_event(payload: dict[str, Any]) -> None:
    """Schedule broadcast from sync code (e.g. system lock enable)."""
    loop = _main_loop
    if loop is None or not loop.is_running():
        return
    try:
        asyncio.run_coroutine_threadsafe(ws_hub.broadcast(payload), loop)
    except Exception as e:
        _log.warning("ws broadcast schedule failed: %s", type(e).__name__)


def broadcast_system_lock_changed(state: dict[str, Any]) -> None:
    broadcast_ws_event({"type": "system_lock_changed", "data": state})


def broadcast_app_release_changed(state: dict[str, Any]) -> None:
    broadcast_ws_event({"type": "app_release_changed", "data": state})


def broadcast_ticket_changed(
    ticket_id: str,
    reason: str = "update",
    *,
    extra: dict[str, Any] | None = None,
) -> None:
    """
    Notify connected clients that a ticket changed (stage, remark, approval, etc.).
    Clients invalidate list/detail caches and refetch — payload stays small.
    reason: stage | remark | approval | staging | promote | create | update
    """
    data: dict[str, Any] = {"ticket_id": str(ticket_id), "reason": reason}
    if extra:
        data.update(extra)
    broadcast_ws_event({"type": "ticket_changed", "data": data})
