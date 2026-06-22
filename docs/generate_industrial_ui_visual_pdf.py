"""
Generate a human-readable VISUAL PDF with UI mockup images.

Output: docs/INDUSTRIAL_UI_DESIGN_VISUAL.pdf
        docs/mockups/*.png (source images)

Usage:
  python docs/generate_industrial_ui_visual_pdf.py
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from xhtml2pdf import pisa

ROOT = Path(__file__).resolve().parent
MOCKUPS = ROOT / "mockups"
PDF_PATH = ROOT / "INDUSTRIAL_UI_DESIGN_VISUAL.pdf"

# Industrial palette
C_BG = (245, 247, 251)
C_SIDEBAR = (11, 18, 32)
C_SIDEBAR_ITEM = (31, 42, 68)
C_PRIMARY = (37, 99, 235)
C_ORANGE = (245, 158, 11)
C_WHITE = (255, 255, 255)
C_TEXT = (15, 23, 42)
C_MUTED = (100, 116, 139)
C_BORDER = (229, 231, 235)
C_HEADER_BG = (248, 250, 252)
C_SUCCESS = (34, 197, 94)
C_DANGER = (239, 68, 68)
C_WARN_BG = (254, 243, 199)

W, H = 1280, 800


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int, int, int],
    fill,
    outline=None,
    radius: int = 12,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_shell(
    draw: ImageDraw.ImageDraw,
    page_title: str,
    cta: str = "Refresh",
    cta_color: tuple = C_ORANGE,
    active_nav: int = 0,
) -> tuple[int, int, int, int]:
    """Draw sidebar + top header. Returns content area (x1,y1,x2,y2)."""
    draw.rectangle((0, 0, W, H), fill=C_BG)
    draw.rectangle((0, 0, 220, H), fill=C_SIDEBAR)
    rounded_rect(draw, (24, 28, 196, 72), fill=C_SIDEBAR_ITEM, radius=10)

    nav_labels = ["Dashboard", "Support", "Task", "Success", "Users", "Settings"]
    y = 100
    for i, label in enumerate(nav_labels):
        col = C_PRIMARY if i == active_nav else C_SIDEBAR_ITEM
        if i == active_nav:
            rounded_rect(draw, (24, y, 196, y + 36), fill=col, radius=8)
            draw.text((40, y + 9), label, fill=C_WHITE, font=_font(14, bold=True))
        else:
            draw.text((40, y + 9), label, fill=(148, 163, 184), font=_font(14))
        y += 44

    draw.rectangle((220, 0, W, 76), fill=C_WHITE)
    draw.line((220, 76, W, 76), fill=C_BORDER, width=1)
    draw.text((252, 24), page_title, fill=C_TEXT, font=_font(26, bold=True))
    rounded_rect(draw, (W - 200, 20, W - 40, 58), fill=cta_color, radius=10)
    draw.text((W - 120, 33), cta, fill=C_TEXT, font=_font(14, bold=True), anchor="mm")

    return (248, 96, W - 32, H - 32)


def mock_palette() -> Image.Image:
    img = Image.new("RGB", (W, H), C_WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((48, 40), "Design System — Color Palette", fill=C_TEXT, font=_font(32, bold=True))
    draw.text((48, 88), "Modern industrial theme", fill=C_MUTED, font=_font(16))

    swatches = [
        ("Primary Blue", C_PRIMARY, "#2563EB", "Links, focus, secondary buttons"),
        ("Industrial Orange", C_ORANGE, "#F59E0B", "Primary CTA, highlights"),
        ("Page Background", C_BG, "#F5F7FB", "Main app background"),
        ("Sidebar Dark", C_SIDEBAR, "#0B1220", "Navigation panel"),
        ("Success", C_SUCCESS, "#22C55E", "Completed / OK badges"),
        ("Danger", C_DANGER, "#EF4444", "Errors, critical alerts"),
    ]
    x, y = 48, 140
    for i, (name, rgb, hexv, use) in enumerate(swatches):
        col = i % 3
        row = i // 3
        bx = x + col * 400
        by = y + row * 200
        rounded_rect(draw, (bx, by, bx + 360, by + 160), fill=rgb, radius=16)
        draw.text((bx + 20, by + 20), name, fill=C_WHITE if sum(rgb) < 400 else C_TEXT, font=_font(18, bold=True))
        draw.text((bx + 20, by + 52), hexv, fill=C_WHITE if sum(rgb) < 400 else C_MUTED, font=_font(14))
        draw.text((bx + 20, by + 120), use, fill=C_WHITE if sum(rgb) < 400 else C_MUTED, font=_font(13))

    draw.text((48, H - 60), "Cards: 12px radius  |  Buttons: 10px radius  |  8px spacing grid", fill=C_MUTED, font=_font(14))
    return img


def mock_dashboard() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Dashboard", "Export", C_PRIMARY, active_nav=0)

    # KPI row
    labels = [("All Tickets", "248", C_PRIMARY), ("Pending", "42", C_ORANGE), ("Feature", "18", C_PRIMARY), ("Staging", "7", (14, 165, 233))]
    x = area[0]
    for i, (lbl, val, accent) in enumerate(labels):
        bx = x + i * 248
        rounded_rect(draw, (bx, area[1], bx + 228, area[1] + 110), fill=C_WHITE, outline=C_BORDER)
        draw.rectangle((bx, area[1], bx + 8, area[1] + 110), fill=accent)
        draw.text((bx + 24, area[1] + 20), lbl, fill=C_MUTED, font=_font(13))
        draw.text((bx + 24, area[1] + 52), val, fill=C_TEXT, font=_font(32, bold=True))

    # Chart
    cy = area[1] + 130
    rounded_rect(draw, (area[0], cy, area[0] + 520, cy + 320), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, cy + 16), "Response & Completion Trends", fill=C_TEXT, font=_font(16, bold=True))
    bars = [140, 90, 120, 170, 100, 150, 130]
    bx = area[0] + 40
    for h in bars:
        rounded_rect(draw, (bx, cy + 280 - h, bx + 48, cy + 280), fill=C_PRIMARY, radius=6)
        bx += 62

    # Side stats
    sx = area[0] + 540
    rounded_rect(draw, (sx, cy, area[2], cy + 150), fill=C_WHITE, outline=C_BORDER)
    draw.text((sx + 20, cy + 16), "Payment Summary", fill=C_TEXT, font=_font(16, bold=True))
    draw.text((sx + 20, cy + 56), "Due: ₹ 12.4L", fill=C_MUTED, font=_font(14))
    draw.text((sx + 20, cy + 88), "Received: ₹ 8.1L", fill=C_SUCCESS, font=_font(14))

    rounded_rect(draw, (sx, cy + 170, area[2], cy + 320), fill=C_WHITE, outline=C_BORDER)
    draw.text((sx + 20, cy + 186), "Quick Actions", fill=C_TEXT, font=_font(16, bold=True))
    rounded_rect(draw, (sx + 20, cy + 230, sx + 180, cy + 270), fill=C_ORANGE, radius=10)
    draw.text((sx + 110, cy + 248), "Add Ticket", fill=C_TEXT, font=_font(13, bold=True), anchor="mm")

    return img


def mock_kpi_dashboard() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Dashboard — KPI (Shreyasi)", "Week 3", C_PRIMARY, active_nav=0)

    # Filter bar
    rounded_rect(draw, (area[0], area[1], area[2], area[1] + 48), fill=C_WHITE, outline=C_BORDER)
    for i, chip in enumerate(["May 2026", "Week 3", "Shreyasi"]):
        rounded_rect(draw, (area[0] + 16 + i * 130, area[1] + 10, area[0] + 16 + i * 130 + 110, area[1] + 38), fill=(232, 240, 254), radius=14)
        draw.text((area[0] + 71 + i * 130, area[1] + 24), chip, fill=C_PRIMARY, font=_font(12, bold=True), anchor="mm")

    y = area[1] + 64
    kpis = ["Checklist %", "Delegation %", "Support FMS", "Overall %"]
    for i, k in enumerate(kpis):
        bx = area[0] + i * 248
        rounded_rect(draw, (bx, y, bx + 228, y + 90), fill=C_WHITE, outline=C_BORDER)
        draw.text((bx + 16, y + 14), k, fill=C_MUTED, font=_font(12))
        draw.text((bx + 16, y + 40), f"{72 + i * 5}%", fill=C_TEXT, font=_font(26, bold=True))

    cy = y + 110
    rounded_rect(draw, (area[0], cy, area[2], cy + 280), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, cy + 16), "Weekly Performance Chart", fill=C_TEXT, font=_font(16, bold=True))
    draw.line((area[0] + 40, cy + 240, area[2] - 40, cy + 120), fill=C_ORANGE, width=4)
    draw.line((area[0] + 40, cy + 260, area[2] - 40, cy + 180), fill=C_PRIMARY, width=4)

    return img


def mock_tickets() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Chores & Bugs", "+ New", C_ORANGE, active_nav=1)

    rounded_rect(draw, (area[0], area[1], area[2], area[1] + 52), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, area[1] + 16), "Filters: Status | Priority | Assignee | Search...", fill=C_MUTED, font=_font(13))

    ty = area[1] + 68
    rounded_rect(draw, (area[0], ty, area[2], area[3]), fill=C_WHITE, outline=C_BORDER)
    rounded_rect(draw, (area[0] + 12, ty + 12, area[2] - 12, ty + 48), fill=C_HEADER_BG, radius=8)
    cols = ["Ref", "Title", "Company", "Status", "Priority", "Assignee"]
    cx = area[0] + 28
    for c in cols:
        draw.text((cx, ty + 26), c, fill=C_TEXT, font=_font(12, bold=True))
        cx += 160 if c != "Title" else 280

    rows = [
        ("CB-1042", "Login page slow on mobile", "Open", "High"),
        ("CB-1038", "Export CSV missing column", "In Progress", "Med"),
        ("CB-1031", "Email template alignment", "Open", "Low"),
        ("CB-1025", "Dashboard KPI mismatch", "Blocked", "High"),
    ]
    ry = ty + 58
    for ref, title, status, pri in rows:
        draw.line((area[0] + 12, ry + 44, area[2] - 12, ry + 44), fill=C_BORDER)
        draw.text((area[0] + 28, ry + 14), ref, fill=C_TEXT, font=_font(12, bold=True))
        draw.text((area[0] + 120, ry + 14), title, fill=C_TEXT, font=_font(12))
        st_color = C_DANGER if status == "Blocked" else C_PRIMARY
        rounded_rect(draw, (area[2] - 320, ry + 8, area[2] - 220, ry + 34), fill=(232, 240, 254), radius=10)
        draw.text((area[2] - 270, ry + 20), status, fill=st_color, font=_font(11, bold=True), anchor="mm")
        ry += 48

    return img


def mock_support_dashboard() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Support Dashboard", "Add New", C_ORANGE, active_nav=1)

    stats = [("Open Queue", "56"), ("Staging", "12"), ("Features", "23"), ("Resolved (7d)", "89")]
    for i, (lbl, val) in enumerate(stats):
        bx = area[0] + i * 248
        rounded_rect(draw, (bx, area[1], bx + 228, area[1] + 100), fill=C_WHITE, outline=C_BORDER)
        draw.text((bx + 20, area[1] + 18), lbl, fill=C_MUTED, font=_font(13))
        draw.text((bx + 20, area[1] + 48), val, fill=C_TEXT, font=_font(28, bold=True))

    ty = area[1] + 120
    rounded_rect(draw, (area[0], ty, area[2], area[3]), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, ty + 16), "Feature Tickets Overview", fill=C_TEXT, font=_font(16, bold=True))
    for i in range(5):
        ry = ty + 56 + i * 52
        rounded_rect(draw, (area[0] + 16, ry, area[2] - 16, ry + 42), fill=C_BG, radius=8)
        draw.text((area[0] + 32, ry + 12), f"FEAT-{200 + i}  Approval pending — Client rollout", fill=C_TEXT, font=_font(12))

    return img


def mock_checklist() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Checklist", "Add Task", C_ORANGE, active_nav=2)

    tabs = ["Today", "Completed", "Overdue", "Upcoming"]
    tx = area[0]
    for i, t in enumerate(tabs):
        bg = C_PRIMARY if i == 0 else C_WHITE
        fg = C_WHITE if i == 0 else C_MUTED
        rounded_rect(draw, (tx, area[1], tx + 110, area[1] + 36), fill=bg, outline=C_BORDER, radius=8)
        draw.text((tx + 55, area[1] + 18), t, fill=fg, font=_font(12, bold=True), anchor="mm")
        tx += 118

    ty = area[1] + 52
    rounded_rect(draw, (area[0], ty, area[2], area[3]), fill=C_WHITE, outline=C_BORDER)
    tasks = ["Daily backup verification", "Review open tickets", "KPI data check", "Client call follow-up"]
    ry = ty + 20
    for task in tasks:
        rounded_rect(draw, (area[0] + 16, ry, area[2] - 16, ry + 56), fill=C_BG, radius=10)
        draw.rectangle((area[0] + 28, ry + 18, area[0] + 48, ry + 38), outline=C_PRIMARY, width=2)
        draw.text((area[0] + 64, ry + 18), task, fill=C_TEXT, font=_font(14))
        rounded_rect(draw, (area[2] - 120, ry + 14, area[2] - 32, ry + 42), fill=C_SUCCESS, radius=8)
        draw.text((area[2] - 76, ry + 28), "Done", fill=C_WHITE, font=_font(11, bold=True), anchor="mm")
        ry += 68

    return img


def mock_client_payment() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Payment Management", "Export", C_PRIMARY, active_nav=4)

    rounded_rect(draw, (area[0], area[1], area[0] + 400, area[1] + 120), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, area[1] + 20), "Total Due", fill=C_MUTED, font=_font(13))
    draw.text((area[0] + 20, area[1] + 52), "₹ 24.6 L", fill=C_TEXT, font=_font(30, bold=True))

    rounded_rect(draw, (area[0] + 420, area[1], area[2], area[1] + 120), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 440, area[1] + 20), "Received (FY Qtr)", fill=C_MUTED, font=_font(13))
    draw.text((area[0] + 440, area[1] + 52), "₹ 18.2 L", fill=C_SUCCESS, font=_font(30, bold=True))

    ty = area[1] + 140
    rounded_rect(draw, (area[0], ty, area[2], area[3]), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, ty + 16), "Open Invoices", fill=C_TEXT, font=_font(16, bold=True))
    headers = ["Invoice", "Client", "Amount", "Ageing"]
    cx = area[0] + 28
    for h in headers:
        draw.text((cx, ty + 52), h, fill=C_TEXT, font=_font(12, bold=True))
        cx += 200

    return img


def mock_settings() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Settings — System Control", "", C_ORANGE, active_nav=5)

    rounded_rect(draw, (area[0], area[1], area[2], area[1] + 200), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 24, area[1] + 20), "System Access Lock", fill=C_TEXT, font=_font(18, bold=True))
    draw.text((area[0] + 24, area[1] + 56), "Master Admin only — blocks all User & Admin accounts", fill=C_MUTED, font=_font(13))

    rounded_rect(draw, (area[0] + 24, area[1] + 90, area[2] - 24, area[1] + 150), fill=(254, 242, 242), outline=C_DANGER, radius=10)
    draw.text((area[0] + 44, area[1] + 108), "Lock ON — Reason: Scheduled maintenance until 6 PM", fill=C_DANGER, font=_font(13, bold=True))

    draw.text((area[0] + 24, area[1] + 168), "Toggle:", fill=C_TEXT, font=_font(14, bold=True))
    rounded_rect(draw, (area[0] + 100, area[1] + 158, area[0] + 160, area[1] + 188), fill=C_DANGER, radius=14)

    ty = area[1] + 220
    rounded_rect(draw, (area[0], ty, area[2], area[3]), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 24, ty + 20), "Audit Log", fill=C_TEXT, font=_font(16, bold=True))
    draw.text((area[0] + 24, ty + 60), "SYSTEM_LOCK_ENABLED  |  aman@...  |  Maintenance window", fill=C_MUTED, font=_font(12))

    return img


def mock_login() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)

    draw.rectangle((0, 0, W, 100), fill=C_WHITE)
    rounded_rect(draw, (60, 30, 120, 70), fill=C_PRIMARY, radius=10)
    rounded_rect(draw, (130, 30, 280, 70), fill=C_ORANGE, radius=10)
    draw.text((60, 110), "Industryprime", fill=C_TEXT, font=_font(22, bold=True))

    cx, cy = W // 2, H // 2 + 40
    rounded_rect(draw, (cx - 260, cy - 200, cx + 260, cy + 200), fill=C_WHITE, outline=C_BORDER, radius=16)
    draw.text((cx, cy - 160), "Sign In", fill=C_TEXT, font=_font(28, bold=True), anchor="mm")

    rounded_rect(draw, (cx - 220, cy - 100, cx + 220, cy - 48), fill=C_BG, outline=C_BORDER, radius=10)
    draw.text((cx - 200, cy - 82), "Email address", fill=C_MUTED, font=_font(14))

    rounded_rect(draw, (cx - 220, cy - 32, cx + 220, cy + 20), fill=C_BG, outline=C_BORDER, radius=10)
    draw.text((cx - 200, cy - 14), "Password", fill=C_MUTED, font=_font(14))

    rounded_rect(draw, (cx - 220, cy + 48, cx + 220, cy + 100), fill=C_ORANGE, radius=12)
    draw.text((cx, cy + 74), "Login", fill=C_TEXT, font=_font(16, bold=True), anchor="mm")

    draw.text((cx, cy + 130), "Forgot password?", fill=C_PRIMARY, font=_font(13), anchor="mm")

    return img


def mock_system_lock() -> Image.Image:
    img = Image.new("RGB", (W, H), (2, 6, 23))
    draw = ImageDraw.Draw(img)

    cx, cy = W // 2, H // 2
    rounded_rect(draw, (cx - 280, cy - 180, cx + 280, cy + 180), fill=C_WHITE, radius=16)
    draw.text((cx, cy - 120), "System under maintance", fill=C_TEXT, font=_font(24, bold=True), anchor="mm")
    draw.text((cx - 220, cy - 50), "Reason:", fill=C_TEXT, font=_font(14, bold=True))
    draw.text((cx - 220, cy - 20), "Scheduled database upgrade — back by 6 PM IST", fill=C_MUTED, font=_font(13))
    draw.text((cx - 220, cy + 30), "Please wait.", fill=C_MUTED, font=_font(14))
    rounded_rect(draw, (cx - 200, cy + 70, cx + 200, cy + 120), fill=C_ORANGE, radius=12)
    draw.text((cx, cy + 95), "Refresh Status", fill=C_TEXT, font=_font(15, bold=True), anchor="mm")

    return img


def mock_release_bar() -> Image.Image:
    img = Image.new("RGB", (W, H), C_BG)
    draw = ImageDraw.Draw(img)
    area = draw_shell(draw, "Dashboard", "Export", C_PRIMARY, active_nav=0)

    rounded_rect(draw, (area[0], area[1], area[0] + 400, area[1] + 110), fill=C_WHITE, outline=C_BORDER)
    draw.text((area[0] + 20, area[1] + 40), "(Page content behind bar)", fill=C_MUTED, font=_font(14))

    # Bottom release bar
    draw.rectangle((0, H - 72, W, H), fill=C_SIDEBAR)
    draw.text((48, H - 50), "New features are live", fill=C_WHITE, font=_font(16, bold=True))
    draw.text((48, H - 28), "A new version is available. Refresh to load the latest features.", fill=(148, 163, 184), font=_font(12))
    rounded_rect(draw, (W - 280, H - 56, W - 48, H - 20), fill=C_ORANGE, radius=10)
    draw.text((W - 164, H - 38), "Refresh for new feature", fill=C_TEXT, font=_font(13, bold=True), anchor="mm")

    return img


MOCKUP_BUILDERS: list[tuple[str, str, callable]] = [
    ("01_palette", "Color palette & design tokens", mock_palette),
    ("02_dashboard", "Main Dashboard", mock_dashboard),
    ("03_kpi_dashboard", "Dashboard KPI (person view)", mock_kpi_dashboard),
    ("04_support_dashboard", "Support Dashboard", mock_support_dashboard),
    ("05_tickets", "Tickets — Chores & Bugs list", mock_tickets),
    ("06_checklist", "Checklist", mock_checklist),
    ("07_client_payment", "Client Payment", mock_client_payment),
    ("08_settings", "Settings — System Control", mock_settings),
    ("09_login", "Login page", mock_login),
    ("10_system_lock", "System lock overlay", mock_system_lock),
    ("11_release_bar", "New feature refresh bar", mock_release_bar),
]


def img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_pdf(sections: list[tuple[str, str, str]]) -> None:
    parts = [
        """<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
@page { size: A4 landscape; margin: 1.2cm; }
body { font-family: Helvetica, Arial, sans-serif; color: #0f172a; }
h1 { font-size: 20pt; color: #2563eb; border-bottom: 3px solid #f59e0b; padding-bottom: 8px; }
h2 { font-size: 14pt; color: #1e3a5f; margin-top: 18px; page-break-before: always; }
p.note { font-size: 10pt; color: #64748b; margin: 8px 0 12px; }
img.mock { width: 960px; border: 1px solid #e5e7eb; }
.cover { page-break-after: always; padding-top: 120px; text-align: center; }
.cover h1 { border: none; font-size: 28pt; }
</style></head><body>
<div class="cover">
<h1>Industrial UI</h1>
<p style="font-size:14pt;">Industrial UI Design — Visual Mockups</p>
<p class="note">Review these screens before implementation. Same colors & layout apply to all sections.</p>
</div>
"""
    ]
    for _file_id, title, b64 in sections:
        parts.append(f'<h2>{title}</h2>')
        parts.append('<p class="note">Proposed look after theme update (not live yet).</p>')
        parts.append(f'<img class="mock" src="data:image/png;base64,{b64}" />')

    parts.append("</body></html>")
    html = "\n".join(parts)

    with PDF_PATH.open("wb") as out:
        status = pisa.CreatePDF(html.encode("utf-8"), dest=out, encoding="utf-8")
    if status.err:
        raise SystemExit(f"PDF failed with {status.err} errors")


def main() -> None:
    MOCKUPS.mkdir(parents=True, exist_ok=True)
    sections: list[tuple[str, str, str]] = []
    for file_id, title, builder in MOCKUP_BUILDERS:
        img = builder()
        png_path = MOCKUPS / f"{file_id}.png"
        img.save(png_path, "PNG", optimize=True)
        sections.append((file_id, title, img_to_b64(img)))
        print(f"Wrote {png_path}")

    build_pdf(sections)
    print(f"Wrote {PDF_PATH}")


if __name__ == "__main__":
    main()
