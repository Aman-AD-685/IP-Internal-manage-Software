"""Fast public HTML pages for email Approve / Reject / Hold — no app login, no React bundle."""
from __future__ import annotations

import html

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from app.approval_token_service import execute_approval_by_token
from app.public_urls import get_public_api_base, is_loopback_url

approval_public_router = APIRouter(tags=["approval-public"])


def _email_action_post_url(request: Request) -> str:
    """Absolute POST target — works behind Render proxy and avoids relative-path issues."""
    base = str(request.base_url).rstrip("/")
    if not is_loopback_url(base):
        return f"{base}/approval/email-action"
    return f"{get_public_api_base()}/approval/email-action"


def _page_shell(title: str, body: str, *, ok: bool = True) -> str:
    accent = "#10b981" if ok else "#f43f5e"
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{html.escape(title)}</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:'Segoe UI',system-ui,sans-serif;background:radial-gradient(ellipse at top,#0f172a,#030712);
    color:#e2e8f0;padding:20px}}
  .card{{max-width:480px;width:100%;padding:32px;border-radius:16px;
    background:linear-gradient(160deg,#0f172a,#1e1b4b);border:1px solid rgba(56,189,248,.3);
    box-shadow:0 20px 50px rgba(0,0,0,.45)}}
  h1{{margin:0 0 12px;font-size:1.35rem;color:#f8fafc}}
  p{{margin:0 0 16px;line-height:1.55;color:#94a3b8;font-size:15px}}
  .ok{{color:{accent};font-size:2rem;margin-bottom:12px}}
  label{{display:block;margin-bottom:6px;font-size:13px;color:#cbd5e1}}
  textarea{{width:100%;min-height:100px;padding:12px;border-radius:8px;border:1px solid #334155;
    background:#0f172a;color:#f1f5f9;font-size:14px;resize:vertical}}
  button{{width:100%;margin-top:12px;padding:12px;border:none;border-radius:8px;font-weight:700;
    font-size:15px;cursor:pointer}}
  .btn-danger{{background:linear-gradient(135deg,#f43f5e,#be123c);color:#fff}}
  .btn-hold{{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff}}
  .muted{{font-size:12px;color:#64748b;margin-top:20px;text-align:center}}
</style>
</head><body><div class="card">{body}<p class="muted">You can close this window.</p></div></body></html>"""


def _success_html(message: str) -> str:
    body = f'<div class="ok">✓</div><h1>Done</h1><p>{html.escape(message)}</p>'
    return _page_shell("Approval complete", body, ok=True)


def _error_html(message: str) -> str:
    body = f'<div class="ok">✕</div><h1>Could not complete</h1><p>{html.escape(message)}</p>'
    return _page_shell("Approval failed", body, ok=False)


def _remarks_form_html(
    token: str,
    post_url: str,
    *,
    action: str,
    title: str,
    intro: str,
    placeholder: str,
    button_label: str,
    button_class: str,
    error: str = "",
) -> str:
    err = f'<p style="color:#fca5a5">{html.escape(error)}</p>' if error else ""
    body = f"""<h1>{html.escape(title)}</h1>
<p>{intro}</p>
{err}
<form method="post" action="{html.escape(post_url)}">
  <input type="hidden" name="token" value="{html.escape(token)}"/>
  <input type="hidden" name="action" value="{html.escape(action)}"/>
  <label for="remarks">Remarks *</label>
  <textarea id="remarks" name="remarks" required placeholder="{html.escape(placeholder)}"></textarea>
  <button type="submit" class="{button_class}">{html.escape(button_label)}</button>
</form>"""
    return _page_shell(title, body, ok=False)


def _reject_form_html(token: str, post_url: str, error: str = "") -> str:
    return _remarks_form_html(
        token,
        post_url,
        action="reject",
        title="Reject feature request",
        intro=(
            "Remarks are <strong>required</strong>. They are saved on the ticket and shown in "
            "<strong>Approval Status</strong> as <strong>Rejected</strong>."
        ),
        placeholder="Why is this feature rejected?",
        button_label="Confirm rejection",
        button_class="btn-danger",
        error=error,
    )


def _hold_form_html(token: str, post_url: str, error: str = "") -> str:
    return _remarks_form_html(
        token,
        post_url,
        action="hold",
        title="Hold feature request",
        intro=(
            "Hold remarks are <strong>required</strong>. The ticket moves to "
            "<strong>Hold</strong> in Approval Status. An approver can return it to "
            "<strong>Pending approval</strong> from the app."
        ),
        placeholder="Why is this feature on hold?",
        button_label="Confirm hold",
        button_class="btn-hold",
        error=error,
    )


@approval_public_router.get("/approval/email-action", response_class=HTMLResponse)
def approval_email_action_get(
    request: Request,
    token: str = Query(..., min_length=1),
    action: str = Query(..., min_length=1),
):
    """
    Public email link target (no login).
    Approve: runs immediately and returns success HTML (one click, fast).
    Reject / Hold: shows lightweight remarks form (POST to same path).
    """
    action = action.strip().lower()
    post_url = _email_action_post_url(request)
    if action == "approve":
        try:
            out = execute_approval_by_token(token, "approve")
            return HTMLResponse(_success_html(out.get("message") or "Approved."))
        except HTTPException as e:
            return HTMLResponse(_error_html(str(e.detail)), status_code=e.status_code)
    if action == "reject":
        return HTMLResponse(_reject_form_html(token, post_url))
    if action == "hold":
        return HTMLResponse(_hold_form_html(token, post_url))
    return HTMLResponse(_error_html("Invalid action."), status_code=400)


@approval_public_router.post("/approval/email-action", response_class=HTMLResponse)
async def approval_email_action_post(
    request: Request,
    token: str = Form(...),
    action: str = Form(...),
    remarks: str = Form(""),
):
    """Reject / Hold form submit — remarks mandatory."""
    post_url = _email_action_post_url(request)
    action_norm = action.strip().lower()
    if action_norm not in ("reject", "hold"):
        return HTMLResponse(_error_html("Invalid action."), status_code=400)
    if not (remarks or "").strip():
        form_html = _reject_form_html if action_norm == "reject" else _hold_form_html
        return HTMLResponse(form_html(token, post_url, "Please enter remarks."), status_code=400)
    try:
        out = execute_approval_by_token(token, action_norm, remarks=remarks)
        return HTMLResponse(_success_html(out.get("message") or "Saved."))
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else str(e.detail)
        form_html = _reject_form_html if action_norm == "reject" else _hold_form_html
        if e.status_code == 400 and "remarks" in detail.lower():
            return HTMLResponse(form_html(token, post_url, detail), status_code=400)
        return HTMLResponse(_error_html(detail), status_code=e.status_code)
    except Exception:
        return HTMLResponse(
            _error_html("Something went wrong while saving. Please try again or contact support."),
            status_code=500,
        )
