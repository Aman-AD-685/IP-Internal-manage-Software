"""Transactional auth emails (password reset) — simple HTML for deliverability."""
from __future__ import annotations

import html
from urllib.parse import urlparse

RESET_ACCENT = "#0284c7"
PRODUCT_NAME = "Industryprime"


def _esc(s: str | None) -> str:
    return html.escape((s or "").strip())


def build_password_reset_email(
    *,
    recipient_email: str,
    reset_url: str,
    expires_hours: int = 1,
) -> tuple[str, str, str]:
    """
    Returns (subject, html_content, plain_fallback).
    Keep layout simple (light background, minimal markup) to reduce spam scoring.
    """
    email_safe = _esc(recipient_email)
    url_safe = _esc(reset_url)
    url_plain = (reset_url or "").strip()
    parsed = urlparse(url_plain)
    host_hint = parsed.netloc or "our secure sign-in page"

    subject = f"{PRODUCT_NAME} — password reset"

    plain = (
        f"{PRODUCT_NAME} — password reset\n\n"
        f"We received a request to reset the password for {recipient_email.strip()}.\n"
        f"If you did not request this, ignore this email.\n\n"
        f"Reset your password (expires in {expires_hours} hour, single use):\n"
        f"{url_plain}\n\n"
        f"This link opens {host_hint} and then returns you to {PRODUCT_NAME}.\n\n"
        f"— {PRODUCT_NAME}\n"
        "Automated message — do not reply."
    )

    inner = f"""
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
        We received a request to reset the password for
        <strong style="color:#0f172a;">{email_safe}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">
        If you did not make this request, you can safely ignore this email. Your password will not change.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
        Use the button below to choose a new password. The link expires in
        <strong>{expires_hours} hour</strong> and works only once.
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
        <tr>
          <td style="border-radius:6px;background-color:{RESET_ACCENT};">
            <a href="{url_safe}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;
              color:#ffffff;text-decoration:none;border-radius:6px;">
              Reset password
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
        Button not working? Copy this link into your browser:<br>
        <a href="{url_safe}" style="color:#0369a1;word-break:break-all;">{url_safe}</a>
      </p>
    """

    html_out = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>{_esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
    style="background-color:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;
        border:1px solid #e2e8f0;">
        <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;font-size:12px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase;">
            {_esc(PRODUCT_NAME)}</p>
          <h1 style="margin:0;font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;">
            Reset your password</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 28px;">{inner}</td></tr>
        <tr><td style="padding:16px 32px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;
          border-radius:0 0 8px 8px;">
          <p style="margin:0;font-size:12px;line-height:1.55;color:#94a3b8;text-align:center;">
            {_esc(PRODUCT_NAME)} · Internal management software<br/>
            Automated message — please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    return subject, html_out, plain
