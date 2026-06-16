"""Generate PDF from docs/AGENTIC_AI_RAG_ARCHITECTURE.md (one-off utility)."""
from pathlib import Path

import markdown
from xhtml2pdf import pisa

ROOT = Path(__file__).resolve().parent
MD_PATH = ROOT / "AGENTIC_AI_RAG_ARCHITECTURE.md"
PDF_PATH = ROOT / "AGENTIC_AI_RAG_ARCHITECTURE.pdf"

CSS = """
@page { size: A4; margin: 2cm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: #222; }
h1 { font-size: 18pt; color: #c45c00; border-bottom: 2px solid #c45c00; padding-bottom: 6px; margin-top: 24px; }
h2 { font-size: 14pt; color: #1a5276; margin-top: 20px; page-break-after: avoid; }
h3 { font-size: 11pt; color: #333; margin-top: 14px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9pt; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f0f4f8; font-weight: bold; }
tr:nth-child(even) td { background: #fafafa; }
code, pre { font-family: Courier, monospace; font-size: 8pt; background: #f5f5f5; }
pre { padding: 8px; white-space: pre-wrap; word-wrap: break-word; }
hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
ul, ol { margin: 8px 0 8px 20px; }
strong { color: #111; }
.benefits-banner {
  background: #e8f5e9; border: 2px solid #2e7d32; padding: 12px 14px; margin: 16px 0;
  font-size: 10pt;
}
"""

def main() -> None:
    md_text = MD_PATH.read_text(encoding="utf-8")
    body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "toc"],
    )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>{CSS}</style></head>
<body>
<div class="benefits-banner">
<strong>Mandatory:</strong> This document includes dedicated Benefits sections (§2, §11, §12)
for strategic, operational, technical, business, stakeholder, and phased rollout value.
</div>
{body}
</body></html>"""

    with PDF_PATH.open("wb") as out:
        status = pisa.CreatePDF(html.encode("utf-8"), dest=out, encoding="utf-8")
    if status.err:
        raise SystemExit(f"PDF generation failed with {status.err} errors")
    print(f"Wrote {PDF_PATH}")


if __name__ == "__main__":
    main()
