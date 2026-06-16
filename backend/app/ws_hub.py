"""In-process WebSocket fan-out for live system events (single Render instance)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

_log = logging.getLogger("ws_hub")

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
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
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
