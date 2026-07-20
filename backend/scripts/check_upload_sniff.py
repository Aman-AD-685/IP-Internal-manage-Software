"""Self-check for attachment magic-byte sniffing (app/main.py helpers).

Run: cd backend && python scripts/check_upload_sniff.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import only the sniff helpers without booting the full FastAPI app graph if possible.
# main.py is heavy; load via importlib after setting a dummy env so supabase client won't crash hard.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x")
os.environ.setdefault("RATE_LIMIT_ENABLED", "0")

from fastapi import HTTPException  # noqa: E402
from app.main import (  # noqa: E402
    _sniff_attachment_type,
    _validate_upload_contents,
)


assert _sniff_attachment_type(b"%PDF-1.4\n%") == "application/pdf"
assert _sniff_attachment_type(b"\xff\xd8\xff\xe0\x00\x10JFIF") == "image/jpeg"
assert _sniff_attachment_type(b"\x89PNG\r\n\x1a\n\x00\x00") == "image/png"
assert _sniff_attachment_type(b"GIF89a\x01\x00") == "image/gif"
assert _sniff_attachment_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
assert _sniff_attachment_type(b"hello world\nplain text") == "text/plain"
assert _sniff_attachment_type(b"MZ\x90\x00") is None  # PE executable header

# Accept PDF named .pdf
assert _validate_upload_contents("doc.pdf", "application/pdf", b"%PDF-1.4\n%") == "application/pdf"

# Reject content/extension mismatch
try:
    _validate_upload_contents("photo.png", "image/png", b"%PDF-1.4\n%")
    raise SystemExit("expected mismatch reject")
except HTTPException as e:
    assert e.status_code == 400

# Reject executable extension
try:
    _validate_upload_contents("evil.exe", "application/octet-stream", b"MZ\x90\x00" + b"\x00" * 100)
    raise SystemExit("expected exe reject")
except HTTPException as e:
    assert e.status_code == 400

print("OK: upload sniff self-check passed")
