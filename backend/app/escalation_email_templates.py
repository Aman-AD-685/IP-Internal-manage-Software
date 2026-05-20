"""HTML email templates for pending escalation mails."""
from __future__ import annotations

import html
from typing import Any

TIMEFRAME_LABELS = {
    "24_48": ("24hr – Less Than 48hr", "#eab308"),
    "48_72": ("48hr – Less Than 72hr", "#f97316"),
    "72_plus": ("72hr Or More", "#ef4444"),
}

STAGE_SECTION = {
    2: ("#eab308", "Stage 2 Pending"),
    3: ("#f97316", "Stage 3 Pending"),
    4: ("#ef4444", "Stage 4 Pending"),
}

STANDARD_COLS = [
    "Reference",
    "Company",
    "Title",
    "Description",
    "Assigned User",
    "Pending Since",
    "Time Delay",
]

STAGE_COLS = [
    "Reference",
    "Company",
    "Ticket Type",
    "Title",
    "Description",
    "Assigned User",
    "Pending Time",
    "Delay Duration",
]


def _esc(s: str | None) -> str:
    return html.escape((s or "").strip() or "—")


def _table(columns: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return '<p style="color:#94a3b8;font-size:13px;">No tickets in this section.</p>'
    th = "".join(
        '<th style="padding:11px 9px;text-align:left;color:#67e8f9;font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid rgba(56,189,248,.25);white-space:nowrap;">'
        f"{_esc(c)}</th>"
        for c in columns
    )
    body = ""
    for row in rows:
        tds = "".join(
            f'<td style="padding:11px 9px;color:#e2e8f0;font-size:13px;vertical-align:top;line-height:1.45;border-bottom:1px solid rgba(148,163,184,.12);">{c}</td>'
            for c in row
        )
        body += f'<tr>{tds}</tr>'
    return (
        '<div style="overflow-x:auto;border-radius:12px;border:1px solid rgba(56,189,248,.22);margin-bottom:16px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:680px;background:rgba(15,23,42,.35);">'
        f"<thead><tr style=\"background:rgba(15,23,42,.95);\">{th}</tr></thead><tbody>{body}</tbody></table></div>"
    )


def build_timeframe_html(
    grouped: dict[str, list[dict[str, Any]]],
    *,
    total: int,
    critical_count: int,
) -> str:
    sections: list[str] = []
    for key in ("24_48", "48_72", "72_plus"):
        label, color = TIMEFRAME_LABELS[key]
        items = grouped.get(key) or []
        rows = [
            [
                _esc(it.get("reference")),
                _esc(it.get("company")),
                _esc(it.get("title")),
                _esc(it.get("description")),
                _esc(it.get("assignee")),
                _esc(it.get("pending_since")),
                _esc(it.get("delay")),
            ]
            for it in items
        ]
        sections.append(
            f'<h2 style="margin:24px 0 8px;font-size:16px;color:{color};">{_esc(label)} '
            f'<span style="font-size:12px;color:#94a3b8;">({len(items)} tickets)</span></h2>'
            + _table(STANDARD_COLS, rows)
        )
    inner = (
        f'<p style="color:#94a3b8;font-size:12px;margin:-8px 0 12px;">Within each timeframe, tickets are sorted by <strong style="color:#e2e8f0;">longest delay first</strong>. '
        f"Demo&nbsp;C is excluded.</p>"
        + f'<p style="color:#bae6fd;font-size:14px;margin:0 0 16px;">'
        f"<strong style=\"color:#fff;\">{total}</strong> open pending ticket(s) · "
        f'<strong style="color:#ef4444;">{critical_count}</strong> critical (72hr+)</p>'
        + "".join(sections)
    )
    return _email_shell(
        "[Pending Escalation Report] Tickets Pending in Different Timeframes",
        "Grouped by delay band · Longest delay first in each section · Demo C excluded · Company on each row",
        "#38bdf8",
        inner,
    )


def build_critical_html(sections: dict[str, list[dict[str, Any]]], total: int) -> str:
    blocks: list[str] = []
    for label, items in sections.items():
        rows = [
            [
                _esc(it.get("reference")),
                _esc(it.get("company")),
                _esc(it.get("title")),
                _esc(it.get("description")),
                _esc(it.get("assignee")),
                _esc(it.get("pending_since")),
                _esc(it.get("delay")),
            ]
            for it in items
        ]
        blocks.append(
            f'<h2 style="margin:20px 0 8px;font-size:15px;color:#fca5a5;">{_esc(label)} ({len(items)})</h2>'
            + _table(STANDARD_COLS, rows)
        )
    inner = (
        '<div style="padding:14px 18px;margin-bottom:20px;border-radius:12px;border:2px solid #ef4444;'
        'background:linear-gradient(90deg,#450a0a,#1c1917);">'
        '<strong style="color:#fecaca;font-size:15px;">CRITICAL ESCALATION</strong>'
        f'<p style="margin:8px 0 0;color:#fca5a5;font-size:13px;">{total} ticket(s) pending 72 hours or more — immediate attention required.</p>'
        '<p style="margin:10px 0 0;color:#94a3b8;font-size:12px;">Within each group, <strong style="color:#fecaca;">longest delay first</strong>. Demo&nbsp;C excluded.</p></div>'
        + "".join(blocks)
    )
    return _email_shell(
        "[CRITICAL] Pending Escalation — 72hr+",
        "High priority · Longest delay first per section · Demo C excluded",
        "#ef4444",
        inner,
        critical=True,
    )


def build_stage_html(stage_num: int, items: list[dict[str, Any]]) -> str:
    color, title = STAGE_SECTION[stage_num]
    rows = [
        [
            _esc(it.get("reference")),
            _esc(it.get("company")),
            _esc(it.get("ticket_type")),
            _esc(it.get("title")),
            _esc(it.get("description")),
            _esc(it.get("assignee")),
            _esc(it.get("pending_since")),
            _esc(it.get("delay")),
        ]
        for it in items
    ]
    inner = (
        f'<p style="color:#bae6fd;font-size:14px;"><strong style="color:{color};">{len(items)}</strong> '
        f"ticket(s) pending at {html.escape(title)} · "
        f'<span style="color:#94a3b8;font-size:12px;">Sorted by longest delay first · Demo&nbsp;C excluded</span></p>'
        + _table(STAGE_COLS, rows)
    )
    return _email_shell(
        f"[Stage {stage_num}] Pending Notification",
        title,
        color,
        inner,
    )


def _email_shell(title: str, subtitle: str, accent: str, inner: str, *, critical: bool = False) -> str:
    header_bg = (
        "linear-gradient(125deg,#7f1d1d 0%,#450a0a 50%,#1c1917 100%)"
        if critical
        else "linear-gradient(125deg,#0c4a6e 0%,#1e1b4b 45%,#312e81 100%)"
    )
    sub_color = "#fecaca" if critical else "#bae6fd"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(title)}</title></head>
<body style="margin:0;padding:0;background:#030712;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="padding:32px 12px;background:radial-gradient(ellipse at top,#0f172a 0%,#030712 55%);">
    <tr><td align="center">
      <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;
        border-radius:16px;overflow:hidden;border:1px solid {accent}55;
        box-shadow:0 0 40px {accent}22,0 24px 48px rgba(0,0,0,.45);">
        <tr><td style="padding:32px 28px;background:{header_bg};">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:#67e8f9;margin-bottom:8px;">
            IP Internal Management</div>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#f8fafc;">{_esc(title)}</h1>
          <p style="margin:12px 0 0;font-size:14px;color:{sub_color};">{html.escape(subtitle)}</p>
        </td></tr>
        <tr><td style="padding:20px 16px 24px;background:linear-gradient(180deg,#0f172a 0%,#020617 100%);">
          {inner}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#020617;font-size:11px;color:#64748b;text-align:center;">
          Automated escalation · Do not reply · IP Internal Management Software
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
