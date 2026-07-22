"""Live + unit smoke for bot protect. Run: cd backend && python scripts/test_bot_protect_flow.py"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

BASE = os.getenv("BOT_PROTECT_TEST_BASE", "http://127.0.0.1:8020").rstrip("/")
report: list[tuple[str, bool, str]] = []


def ok(name: str, passed: bool, detail: str = "") -> None:
    report.append((name, passed, detail))
    mark = "PASS" if passed else "FAIL"
    line = f"[{mark}] {name}" + (f" -- {detail}" if detail else "")
    print(line.encode("ascii", errors="replace").decode("ascii"))


def http_json(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw[:300]}
        return e.code, payload


def main() -> int:
    # --- Unit (in-process) ---
    os.environ.setdefault("AUTH_FORM_BOT_CHECKS", "1")
    os.environ.setdefault("AUTH_FORM_TIMING_REQUIRED", "1")
    os.environ.setdefault("AUTH_FORM_MIN_MS", "800")
    os.environ.setdefault("BOT_STRIKE_ENABLED", "1")
    os.environ.setdefault("BOT_STRIKE_LIMIT", "3")

    from fastapi import HTTPException
    from app import bot_protect as bp

    now = int(time.time() * 1000)
    try:
        bp.enforce_auth_form_bot_checks(website="http://x", form_opened_ms=now - 2000)
        ok("unit honeypot rejects", False, "should have raised")
    except HTTPException as e:
        ok("unit honeypot rejects", e.status_code == 403, str(e.detail))

    try:
        bp.enforce_auth_form_bot_checks(website="", form_opened_ms=now - 2000)
        ok("unit human timing ok", True)
    except HTTPException as e:
        ok("unit human timing ok", False, str(e.detail))

    bp.clear_bot_strikes(email="flow-bot@example.com")
    for i in range(3):
        try:
            bp.enforce_form_bot_checks_with_strike(
                website="http://bot",
                form_opened_ms=now - 2000,
                email="flow-bot@example.com",
                page="Login",
            )
        except HTTPException:
            pass
    ok(
        "unit strikes reach 3",
        bp.get_bot_strike_count(email="flow-bot@example.com") >= 3,
        f"count={bp.get_bot_strike_count(email='flow-bot@example.com')}",
    )
    events = bp.list_bot_events(limit=50)
    ok(
        "unit events include Login page",
        any(e.get("page") == "Login" and e.get("email") == "flow-bot@example.com" for e in events),
        f"events={len(events)}",
    )

    # Middleware gates (in-process; live localhost skips unless BOT_PROTECT_FORCE=1)
    os.environ["BOT_PROTECT_FORCE"] = "1"
    os.environ["BOT_UA_BLOCK"] = "1"
    os.environ["FMS_CLIENT_HEADER_REQUIRED"] = "1"
    os.environ["ENV"] = "production"

    class _Req:
        def __init__(self, path: str, method: str = "POST", ua: str = "", client_hdr: str = ""):
            self.method = method
            self.url = type("U", (), {"path": path})()
            self.headers = {}
            if ua:
                self.headers["user-agent"] = ua
            if client_hdr:
                self.headers["x-fms-client"] = client_hdr
            self.client = type("C", (), {"host": "8.8.8.8"})()

    blocked = bp.bot_protect_response(_Req("/tickets", ua="python-requests/2.31", client_hdr="web"))
    ok(
        "unit middleware blocks bot UA on /tickets",
        blocked is not None and blocked.status_code == 403,
        f"resp={None if blocked is None else blocked.status_code}",
    )
    blocked2 = bp.bot_protect_response(
        _Req("/delegation/tasks", ua="Mozilla/5.0", client_hdr="")
    )
    ok(
        "unit middleware blocks missing X-FMS-Client",
        blocked2 is not None and blocked2.status_code == 403,
        f"resp={None if blocked2 is None else blocked2.status_code}",
    )
    allowed = bp.bot_protect_response(
        _Req("/tickets", ua="Mozilla/5.0 Chrome/120", client_hdr="web")
    )
    ok("unit middleware allows browser client", allowed is None)

    # --- Live HTTP ---
    status, _ = http_json("GET", "/health")
    ok("live /health", status == 200, f"status={status}")

    status, body = http_json(
        "POST",
        "/auth/login",
        {
            "email": "bot-flow-test@example.com",
            "password": "not-the-password",
            "website": "http://i-am-bot",
            "form_opened_ms": now - 5000,
        },
        headers={"X-FMS-Client": "web", "User-Agent": "Mozilla/5.0 (Windows) Chrome/120.0"},
    )
    ok(
        "live login honeypot -> 403",
        status == 403,
        f"status={status} detail={body.get('detail')}",
    )

    status, body = http_json(
        "POST",
        "/auth/login",
        {
            "email": "bot-flow-test@example.com",
            "password": "not-the-password",
            "website": "",
            "form_opened_ms": now - 50,
        },
        headers={"X-FMS-Client": "web", "User-Agent": "Mozilla/5.0 (Windows) Chrome/120.0"},
    )
    # timing required may be off locally — accept 403 (timing) or 401 (credentials)
    ok(
        "live login too-fast or invalid creds",
        status in (401, 403),
        f"status={status} detail={body.get('detail')}",
    )

    status, body = http_json(
        "POST",
        "/tickets",
        {"title": "bot", "type": "chore", "website": "http://bot", "form_opened_ms": now - 5000},
        headers={
            "X-FMS-Client": "web",
            "User-Agent": "python-requests/2.31",
            "Authorization": "Bearer fake",
        },
    )
    ok(
        "live tickets with bot UA / no auth -> blocked",
        status in (401, 403),
        f"status={status} detail={body.get('detail')}",
    )

    status, body = http_json(
        "POST",
        "/delegation/tasks",
        {
            "title": "bot",
            "assignee_id": "00000000-0000-0000-0000-000000000001",
            "due_date": "2026-07-22",
            "website": "http://bot",
            "form_opened_ms": now - 5000,
        },
        headers={"User-Agent": "curl/8.0", "X-FMS-Client": "web"},
    )
    ok(
        "live delegation bot UA -> blocked",
        status in (401, 403),
        f"status={status} detail={body.get('detail')}",
    )

    status, body = http_json("GET", "/bot-protect/events")
    ok(
        "live bot-protect/events without auth -> 401/403",
        status in (401, 403),
        f"status={status}",
    )

    status, body = http_json(
        "GET",
        "/api/bot-protect/events",
        headers={"Authorization": "Bearer eyJhbGciOiJub25lIn0.e30.", "X-FMS-Client": "web"},
    )
    ok(
        "live bot-protect/events bad token -> 401/403",
        status in (401, 403),
        f"status={status}",
    )

    # OpenAPI advertises the route
    status, spec = http_json("GET", "/openapi.json")
    paths = spec.get("paths") if isinstance(spec, dict) else {}
    ok(
        "openapi has /bot-protect/events",
        status == 200 and "/bot-protect/events" in paths,
        f"status={status}",
    )

    failed = [n for n, p, _ in report if not p]
    print("\n=== SUMMARY ===")
    print(f"Passed: {sum(1 for _, p, _ in report if p)} / {len(report)}")
    if failed:
        print("Failed:", ", ".join(failed))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
