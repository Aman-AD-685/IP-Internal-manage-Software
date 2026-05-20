"""Notify feature submitter when approver acts (approve / reject / hold) via UI or email."""
from __future__ import annotations

import asyncio
import html
import logging
import threading
from typing import Any

from app.supabase_client import supabase
from app.utils.email import send_email_detail

_log = logging.getLogger("feature_approval_submitter_notify")


def _resolve_submitter_email(ticket_id: str) -> tuple[str | None, str]:
    """Return (email, display_name) for the user who submitted the feature request."""
    r = (
        supabase.table("tickets")
        .select("created_by, submitted_by, user_name, reference_no, title")
        .eq("id", ticket_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        return None, "Submitter"
    row = r.data[0]
    submitted_by = (row.get("submitted_by") or "").strip()
    user_name = (row.get("user_name") or "").strip()
    display = submitted_by or user_name or "Submitter"
    if submitted_by and "@" in submitted_by:
        return submitted_by.lower(), display

    cid = row.get("created_by")
    if cid:
        try:
            pr = (
                supabase.table("user_profiles")
                .select("email, full_name")
                .eq("id", str(cid))
                .limit(1)
                .execute()
            )
            if pr.data:
                em = (pr.data[0].get("email") or "").strip().lower()
                name = (pr.data[0].get("full_name") or "").strip() or display
                if em:
                    return em, name
        except Exception as e:
            _log.warning("submitter profile lookup %s: %s", ticket_id, e)
    return None, display


def _status_label(status: str) -> str:
    if status == "approved":
        return "Approved"
    if status == "rejected":
        return "Rejected"
    if status == "hold":
        return "On hold"
    return status.replace("_", " ").title()


async def send_submitter_approval_notification(
    ticket_id: str,
    *,
    status: str,
    reference_no: str | None = None,
    title: str | None = None,
    remarks: str | None = None,
    source: str = "ui",
) -> tuple[bool, str | None]:
    to_email, name = _resolve_submitter_email(ticket_id)
    if not to_email:
        _log.info("no submitter email for ticket %s — skip notify", ticket_id)
        return False, "No submitter email on file"

    if not reference_no or not title:
        tr = (
            supabase.table("tickets")
            .select("reference_no, title")
            .eq("id", ticket_id)
            .limit(1)
            .execute()
        )
        if tr.data:
            reference_no = reference_no or tr.data[0].get("reference_no")
            title = title or tr.data[0].get("title")

    ref = (reference_no or "").strip() or str(ticket_id)[:8]
    feat_title = (title or "").strip() or "Feature request"
    label = _status_label(status)
    remarks_block = ""
    if remarks and status in ("rejected", "hold"):
        remarks_block = (
            f'<p style="color:#94a3b8;font-size:14px;"><strong>Remarks:</strong> '
            f"{html.escape(remarks.strip())}</p>"
        )

    accent = "#10b981" if status == "approved" else "#f59e0b" if status == "hold" else "#f43f5e"
    html_body = f"""<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px">
<div style="max-width:560px;margin:0 auto;padding:24px;border-radius:12px;border:1px solid rgba(56,189,248,.25);background:#1e293b">
  <h2 style="margin:0 0 12px;color:{accent}">Feature request {html.escape(label)}</h2>
  <p>Hi {html.escape(name)},</p>
  <p>Your feature request <strong>{html.escape(ref)}</strong> — <em>{html.escape(feat_title)}</em> — was marked <strong>{html.escape(label)}</strong> by an approver ({html.escape(source)}).</p>
  {remarks_block}
  <p style="color:#64748b;font-size:13px;">Open <strong>Approval Status</strong> in the app to view details.</p>
</div></body></html>"""

    plain = (
        f"Hi {name},\n\n"
        f"Your feature request {ref} ({feat_title}) was marked {label} by an approver.\n"
    )
    if remarks and status in ("rejected", "hold"):
        plain += f"\nRemarks: {remarks.strip()}\n"
    plain += "\nOpen Approval Status in the app for details.\n"

    subject = f"Feature {ref}: {label}"
    ok, err = await send_email_detail(to_email, subject, html_body, plain_fallback=plain)
    if ok:
        _log.info("submitter notify %s -> %s status=%s", ref, to_email, status)
    else:
        _log.warning("submitter notify failed %s -> %s: %s", ref, to_email, err)
    return ok, err


def fire_submitter_approval_notification(
    ticket_id: str,
    *,
    status: str,
    reference_no: str | None = None,
    title: str | None = None,
    remarks: str | None = None,
    source: str = "ui",
) -> None:
    """Fire-and-forget email to submitter (safe from sync FastAPI routes)."""

    def _run() -> None:
        try:
            asyncio.run(
                send_submitter_approval_notification(
                    ticket_id,
                    status=status,
                    reference_no=reference_no,
                    title=title,
                    remarks=remarks,
                    source=source,
                )
            )
        except Exception as e:
            _log.warning("submitter notify thread %s: %s", ticket_id, e)

    threading.Thread(target=_run, daemon=True).start()
