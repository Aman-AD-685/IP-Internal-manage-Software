"""Live app release key — merge Vercel /release.json, env, and Supabase for WS + HTTP."""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import httpx

from app.public_urls import get_frontend_base

_log = logging.getLogger("release_sync")

_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_CACHE_TTL_SEC = 10
_WATCH_INTERVAL_SEC = 30
_last_ws_broadcast_key: str | None = None


def _normalize_release_key(key: str | None) -> str:
    k = (key or "").strip().lower()
    if not k:
        return ""
    if k == "dev-local":
        return k
    if re.fullmatch(r"[a-f0-9]{6,40}", k):
        return k[:7]
    return k


def _is_actionable_release_key(key: str | None) -> bool:
    k = (key or "").strip()
    return bool(k and k != "dev-local")


def fetch_frontend_release_manifest() -> dict[str, Any] | None:
    """Read live Vercel deploy manifest (updates on every frontend push)."""
    url = f"{get_frontend_base().rstrip('/')}/release.json"
    try:
        r = httpx.get(
            url,
            timeout=8.0,
            headers={"Accept": "application/json", "Cache-Control": "no-cache"},
        )
        if r.status_code >= 400:
            return None
        data = r.json()
        if isinstance(data, dict) and data.get("release_key"):
            return data
    except Exception as e:
        _log.debug("frontend release.json fetch failed: %s", type(e).__name__)
    return None


def invalidate_release_broadcast_cache() -> None:
    _CACHE["ts"] = 0.0
    _CACHE["payload"] = None


def build_app_release_broadcast(supabase_client) -> dict[str, Any]:
    """
    Merge release sources (priority for key): live frontend /release.json → APP_RELEASE_KEY env → Supabase row.
    """
    now = time.time()
    cached = _CACHE.get("payload")
    if cached and now - float(_CACHE.get("ts") or 0) < _CACHE_TTL_SEC:
        return cached

    env_key = (os.getenv("APP_RELEASE_KEY") or "").strip()
    title = (os.getenv("APP_RELEASE_TITLE") or "New features are live").strip()
    message = (
        os.getenv("APP_RELEASE_MESSAGE")
        or "A new version is available. Refresh to load the latest features."
    ).strip()
    release_key = env_key or ""
    is_active = True

    db_title = ""
    db_message = ""
    try:
        r = (
            supabase_client.table("app_release_broadcast")
            .select("release_key, title, message, is_active")
            .eq("id", 1)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0]
        if row:
            if row.get("release_key"):
                release_key = str(row["release_key"]).strip()
            if row.get("title"):
                db_title = str(row["title"]).strip()
            if row.get("message"):
                db_message = str(row["message"]).strip()
            is_active = bool(row.get("is_active", True))
    except Exception as e:
        _log.debug("app_release_broadcast db read: %s", type(e).__name__)

    frontend = fetch_frontend_release_manifest()
    frontend_key = (frontend or {}).get("release_key", "")
    if _is_actionable_release_key(frontend_key):
        release_key = str(frontend_key).strip()
        if frontend.get("title"):
            title = str(frontend["title"]).strip()
        if frontend.get("message"):
            message = str(frontend["message"]).strip()
        if "is_active" in frontend:
            is_active = bool(frontend.get("is_active"))
    elif _is_actionable_release_key(env_key):
        release_key = env_key
    elif db_title:
        title = db_title
    if db_message and not frontend:
        message = db_message

    if not release_key:
        release_key = "dev-local"

    payload = {
        "release_key": release_key,
        "title": title,
        "message": message,
        "is_active": is_active,
    }
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload


async def run_release_watch_loop(supabase_client) -> None:
    """Poll live frontend /release.json and push WS when deploy key changes."""
    import asyncio

    from app.ws_hub import broadcast_app_release_changed

    global _last_ws_broadcast_key
    await asyncio.sleep(5)
    while True:
        try:
            payload = await asyncio.to_thread(build_app_release_broadcast, supabase_client)
            key = str(payload.get("release_key") or "").strip()
            if payload.get("is_active") and _is_actionable_release_key(key):
                if _last_ws_broadcast_key is None:
                    _last_ws_broadcast_key = key
                elif _normalize_release_key(key) != _normalize_release_key(_last_ws_broadcast_key):
                    _last_ws_broadcast_key = key
                    broadcast_app_release_changed(payload)
                    _log.info("WS broadcast app_release_changed key=%s", key[:12])
        except Exception as e:
            _log.debug("release watch loop: %s", type(e).__name__)
        await asyncio.sleep(_WATCH_INTERVAL_SEC)


def start_release_watch_loop(supabase_client) -> None:
    import asyncio

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(run_release_watch_loop(supabase_client))
    except RuntimeError:
        pass
