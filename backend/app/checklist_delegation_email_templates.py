"""HTML email templates for Checklist, Delegation, and admin pending digest."""
from __future__ import annotations

import html
from datetime import date
from app.public_urls import get_frontend_base

CHECKLIST_ACCENT = "#14b8a6"
DELEGATION_ACCENT = "#8b5cf6"
DIGEST_ACCENT = "#38bdf8"


def _esc(s: str | None) -> str:
    return html.escape((s or "").strip() or "—")


def _email_shell(
    title: str,
    subtitle: str,
    accent: str,
    inner: str,
    *,
    header_gradient: str | None = None,
    footer_note: str = "Daily task reminder · Do not reply · IP Internal Management Software",
) -> str:
    header_bg = header_gradient or (
        f"linear-gradient(125deg,{accent}22 0%,#0c4a6e 35%,#1e1b4b 70%,#312e81 100%)"
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(title)}</title></head>
<body style="margin:0;padding:0;background:#030712;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="padding:32px 12px;background:radial-gradient(ellipse at top,#0f172a 0%,#030712 55%);">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;
        border-radius:16px;overflow:hidden;border:1px solid {accent}55;
        box-shadow:0 0 40px {accent}22,0 24px 48px rgba(0,0,0,.45);">
        <tr><td style="padding:28px 26px;background:{header_bg};border-bottom:3px solid {accent};">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:#67e8f9;margin-bottom:8px;">
            Industry Prime · Task Management</div>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#f8fafc;line-height:1.3;">{_esc(title)}</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#bae6fd;line-height:1.5;">{html.escape(subtitle)}</p>
        </td></tr>
        <tr><td style="padding:24px 22px 28px;background:linear-gradient(180deg,#0f172a 0%,#020617 100%);">
          {inner}
        </td></tr>
        <tr><td style="padding:14px 22px;background:#020617;font-size:11px;color:#64748b;text-align:center;line-height:1.5;">
          {html.escape(footer_note)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _task_list_card(task_names: list[str], accent: str, empty_msg: str) -> str:
    if not task_names:
        return (
            f'<div style="padding:16px 18px;border-radius:12px;border:1px dashed {accent}44;'
            f'background:rgba(15,23,42,.5);color:#94a3b8;font-size:14px;">{_esc(empty_msg)}</div>'
        )
    rows = ""
    for i, name in enumerate(task_names, 1):
        rows += (
            f'<tr><td style="padding:12px 14px;border-bottom:1px solid rgba(148,163,184,.12);">'
            f'<span style="display:inline-block;min-width:26px;height:26px;line-height:26px;text-align:center;'
            f'border-radius:8px;background:{accent}33;color:{accent};font-size:12px;font-weight:700;margin-right:12px;">'
            f"{i}</span>"
            f'<span style="color:#e2e8f0;font-size:14px;line-height:1.45;">{_esc(name)}</span></td></tr>'
        )
    return (
        f'<div style="border-radius:12px;overflow:hidden;border:1px solid {accent}33;margin:16px 0;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;'
        f'background:rgba(15,23,42,.4);">{rows}</table></div>'
    )


def _stat_badge(value: str, label: str, accent: str) -> str:
    return (
        f'<td style="padding:0 8px 0 0;vertical-align:top;">'
        f'<div style="display:inline-block;padding:14px 20px;border-radius:12px;'
        f'background:linear-gradient(145deg,{accent}22,{accent}08);border:1px solid {accent}44;">'
        f'<div style="font-size:28px;font-weight:800;color:{accent};line-height:1;">{_esc(value)}</div>'
        f'<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-top:6px;">'
        f"{html.escape(label)}</div></div></td>"
    )


def build_checklist_reminder_html(
    recipient_name: str,
    task_names: list[str],
    *,
    today: date | None = None,
) -> tuple[str, str]:
    """Returns (html_content, plain_fallback)."""
    today = today or date.today()
    safe_name = _esc(recipient_name or "there")
    count = len(task_names)

    inner = (
        f'<p style="margin:0 0 4px;color:#cbd5e1;font-size:15px;">Hi <strong style="color:#f1f5f9;">{safe_name}</strong>,</p>'
        f'<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.55;">'
        f"Your checklist has items due <strong style=\"color:{CHECKLIST_ACCENT};\">today</strong> "
        f"({today.strftime('%d %b %Y')}). Please complete them when you can.</p>"
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + _stat_badge(str(count), "Due today", CHECKLIST_ACCENT)
        + "</tr></table>"
        + _task_list_card(task_names, CHECKLIST_ACCENT, "No tasks listed — you're all caught up.")
        + '<p style="margin:20px 0 0;color:#64748b;font-size:12px;">Tip: mark each task done in the app so tomorrow\'s reminder stays accurate.</p>'
    )
    html_out = _email_shell(
        "Checklist — Tasks due today",
        "Daily reminder · Recurring checklist items",
        CHECKLIST_ACCENT,
        inner,
        header_gradient="linear-gradient(125deg,#042f2e 0%,#0c4a6e 40%,#134e4a 100%)",
    )
    plain = (
        f"Hi {recipient_name or 'there'},\n\n"
        f"You have {count} checklist task(s) due today ({today.isoformat()}):\n\n"
        + "\n".join(f"  {i}. {n}" for i, n in enumerate(task_names, 1))
        + "\n\nPlease log in to the app to complete them.\n"
    )
    return html_out, plain


def build_delegation_reminder_html(
    recipient_name: str,
    task_titles: list[str],
    *,
    today: date | None = None,
) -> tuple[str, str]:
    """Returns (html_content, plain_fallback)."""
    today = today or date.today()
    safe_name = _esc(recipient_name or "there")
    count = len(task_titles)

    inner = (
        f'<p style="margin:0 0 4px;color:#cbd5e1;font-size:15px;">Hi <strong style="color:#f1f5f9;">{safe_name}</strong>,</p>'
        f'<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.55;">'
        f"You have <strong style=\"color:{DELEGATION_ACCENT};\">{count}</strong> delegation "
        f"task(s) that are <strong style=\"color:#fbbf24;\">due or overdue</strong> "
        f"as of {today.strftime('%d %b %Y')}.</p>"
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + _stat_badge(str(count), "Pending", DELEGATION_ACCENT)
        + "</tr></table>"
        + _task_list_card(task_titles, DELEGATION_ACCENT, "No pending delegations — great work.")
        + '<p style="margin:20px 0 0;color:#64748b;font-size:12px;">Update status in Delegation when you start or finish a task.</p>'
    )
    html_out = _email_shell(
        "Delegation — Pending tasks",
        "Daily reminder · Assigned work due or overdue",
        DELEGATION_ACCENT,
        inner,
        header_gradient="linear-gradient(125deg,#2e1065 0%,#312e81 45%,#4c1d95 100%)",
    )
    plain = (
        f"Hi {recipient_name or 'there'},\n\n"
        f"You have {count} delegation task(s) due or overdue:\n\n"
        + "\n".join(f"  {i}. {t}" for i, t in enumerate(task_titles, 1))
        + "\n\nPlease log in to the app to update task status.\n"
    )
    return html_out, plain


def _digest_section(
    title: str,
    accent: str,
    lines: list[str],
    *,
    icon: str = "◆",
) -> str:
    if not lines:
        body = '<p style="margin:0;color:#94a3b8;font-size:13px;">None — all clear for this section.</p>'
    else:
        items = "".join(
            f'<li style="margin:0 0 10px;color:#e2e8f0;font-size:13px;line-height:1.5;">{_esc(line)}</li>'
            for line in lines
        )
        body = f'<ul style="margin:8px 0 0;padding-left:20px;">{items}</ul>'
    return (
        f'<div style="margin-bottom:20px;padding:18px 20px;border-radius:12px;'
        f'border-left:4px solid {accent};background:rgba(15,23,42,.55);">'
        f'<h2 style="margin:0 0 10px;font-size:15px;color:{accent};">'
        f'<span style="margin-right:8px;">{icon}</span>{_esc(title)} '
        f'<span style="font-size:12px;color:#64748b;font-weight:400;">({len(lines)})</span></h2>'
        f"{body}</div>"
    )


def build_pending_digest_html(
    recipient_name: str,
    *,
    today: date | None = None,
    checklist_lines: list[str],
    delegation_lines: list[str],
    chores_bug_lines: list[str],
    feature_lines: list[str],
    app_url: str | None = None,
) -> tuple[str, str]:
    """Admin digest: Checklist & Delegation + Support sections."""
    today = today or date.today()
    base = (app_url or get_frontend_base()).rstrip("/")
    safe_name = _esc(recipient_name or "Admin")

    cd_block = (
        '<div style="padding:4px 0 16px;margin-bottom:8px;">'
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:#67e8f9;margin-bottom:14px;">'
        "Section 1 · Operations</div>"
        + _digest_section("Checklist — due today", CHECKLIST_ACCENT, checklist_lines, icon="✓")
        + _digest_section("Delegation — due / overdue", DELEGATION_ACCENT, delegation_lines, icon="➜")
        + "</div>"
    )
    support_block = (
        '<div style="padding:4px 0;">'
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:#67e8f9;margin-bottom:14px;">'
        "Section 2 · Support FMS</div>"
        + _digest_section("Chores & Bug — pending by stage", "#f97316", chores_bug_lines)
        + _digest_section("Feature — pending by stage", "#38bdf8", feature_lines)
        + "</div>"
    )
    inner = (
        f'<p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;">Hi <strong style="color:#f1f5f9;">{safe_name}</strong>,</p>'
        f'<p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.55;">'
        f"Summary of open work for <strong style=\"color:#e2e8f0;\">{today.strftime('%A, %d %B %Y')}</strong>. "
        f"Sent to Admin, Master Admin, and Approver roles.</p>"
        + cd_block
        + support_block
        + (
            '<p style="margin:20px 0 8px;font-size:12px;color:#64748b;">Quick links</p>'
            f'<a href="{html.escape(f"{base}/task/checklist", quote=True)}" style="display:inline-block;margin:0 10px 10px 0;'
            f'padding:12px 20px;border-radius:10px;background:{CHECKLIST_ACCENT};color:#fff;font-size:13px;'
            f'font-weight:600;text-decoration:none;">Checklist</a>'
            f'<a href="{html.escape(f"{base}/task/delegation", quote=True)}" style="display:inline-block;margin:0 0 10px;'
            f'padding:12px 20px;border-radius:10px;background:{DELEGATION_ACCENT};color:#fff;font-size:13px;'
            f'font-weight:600;text-decoration:none;">Delegation</a>'
        )
    )
    html_out = _email_shell(
        "Pending Task Digest",
        "Checklist · Delegation · Support (Chores, Bug & Feature)",
        DIGEST_ACCENT,
        inner,
        footer_note="Admin pending digest · Do not reply · IP Internal Management Software",
    )
    plain_body = f"""Pending Task Reminder – {today.isoformat()}

Hi {recipient_name or 'Admin'},

1. CHECKLIST (due today)
{chr(10).join(checklist_lines) if checklist_lines else '  (None)'}

2. DELEGATION (due/overdue)
{chr(10).join(delegation_lines) if delegation_lines else '  (None)'}

3. CHORES & BUG
{chr(10).join(chores_bug_lines) if chores_bug_lines else '  (None)'}

4. FEATURE
{chr(10).join(feature_lines) if feature_lines else '  (None)'}

Checklist: {base}/task/checklist
Delegation: {base}/task/delegation
"""
    return html_out, plain_body

