"""
Resolve public backend + frontend URLs for email links (approve/reject, ticket links).

Production (Render): set PUBLIC_API_URL or rely on RENDER_EXTERNAL_URL.
Never emit 127.0.0.1 links when running on Render.
"""
from __future__ import annotations

import os

# Must match fms-frontend/src/api/axios.ts PRODUCTION_API_FALLBACK
PRODUCTION_API_FALLBACK = "https://support.industryprime.dpdns.org"
PRODUCTION_FRONTEND_FALLBACK = "https://www.industryprime.dpdns.org"


def _env(key: str) -> str:
    return (os.getenv(key) or "").strip()


def is_loopback_url(url: str) -> bool:
    low = (url or "").lower()
    return "127.0.0.1" in low or "localhost" in low or low.startswith("http://0.0.0.0")


def running_on_render() -> bool:
    return bool(
        _env("RENDER")
        or _env("RENDER_EXTERNAL_URL")
        or _env("RENDER_SERVICE_ID")
        or _env("RENDER_SERVICE_NAME")
    )


def get_public_api_base() -> str:
    """
    Absolute backend URL for /approval/email-action links in outbound email.
    """
    candidates: list[str] = []
    for key in ("PUBLIC_API_URL", "API_PUBLIC_URL", "BACKEND_PUBLIC_URL"):
        v = _env(key)
        if v:
            candidates.append(v.rstrip("/"))

    render_url = _env("RENDER_EXTERNAL_URL")
    if render_url:
        candidates.append(render_url.rstrip("/"))

    on_render = running_on_render()

    for url in candidates:
        if on_render and is_loopback_url(url):
            continue
        if url:
            return url.rstrip("/")

    if on_render:
        return PRODUCTION_API_FALLBACK.rstrip("/")

    port = _env("BACKEND_PORT") or "8020"
    return f"http://127.0.0.1:{port}"


def _normalize_production_frontend_url(url: str) -> str:
    """Apex dpdns host → www so password-reset links keep hash tokens after redirect."""
    base = (url or "").rstrip("/")
    if base == "https://industryprime.dpdns.org":
        return PRODUCTION_FRONTEND_FALLBACK.rstrip("/")
    return base


def get_frontend_base() -> str:
    for key in ("FRONTEND_URL", "SITE_URL", "PUBLIC_FRONTEND_URL"):
        v = _env(key)
        if v and not (running_on_render() and is_loopback_url(v)):
            return _normalize_production_frontend_url(v)
    if running_on_render():
        return PRODUCTION_FRONTEND_FALLBACK.rstrip("/")
    return "http://localhost:3001"


def build_approval_email_action_url(token: str, action: str) -> str:
    base = get_public_api_base()
    return f"{base}/approval/email-action?token={token}&action={action}"


def log_public_urls_startup() -> None:
    import sys

    on_render = running_on_render()
    api = get_public_api_base()
    fe = get_frontend_base()
    warn = " ⚠ loopback in email links!" if is_loopback_url(api) and on_render else ""
    print(
        f"[urls] public_api={api} frontend={fe} render={on_render}{warn}",
        file=sys.stderr,
        flush=True,
    )
    if on_render and is_loopback_url(api):
        print(
            "[urls] Set PUBLIC_API_URL=https://support.industryprime.dpdns.org on Render and redeploy.",
            file=sys.stderr,
            flush=True,
        )
