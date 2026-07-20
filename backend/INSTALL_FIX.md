# Fix for pip install error (pyroaring C++ build tools)

## Problem
The `supabase` package requires `pyroaring` which needs Microsoft Visual C++ Build Tools to compile.

## Solution Options

### Option 1: Install without storage (RECOMMENDED - Quick Fix)

Since we only need Supabase Auth (not storage), install minimal packages:

```bash
cd backend
pip install fastapi uvicorn[standard] python-dotenv pydantic[email]
pip install supabase-auth==2.27.2 httpx postgrest==2.27.2 gotrue==2.11.0
```

Then update `supabase_client.py` to use only auth:

```python
from supabase import create_client, Client
import os

SUPABASE_URL = os.getenv("SUPABASE_URL")  # required — no hardcoded fallback
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")  # required — set in backend/.env

# Create client (will work with minimal packages)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
```

### Option 2: Install Visual C++ Build Tools (Full Fix)

1. Download and install: https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. During installation, select "C++ build tools" workload
3. Then run: `pip install -r requirements.txt`

### Option 3: Use pre-built wheel (if available)

Try installing with pre-built wheels only:

```bash
pip install --only-binary :all: -r requirements.txt
```

If that fails, use Option 1.

## Recommended: Use Option 1

Run these commands:

```bash
cd backend
pip install fastapi uvicorn[standard] python-dotenv pydantic[email]
pip install supabase-auth==2.27.2 httpx postgrest==2.27.2 gotrue==2.11.0
```

Then test if backend works:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If you see "Uvicorn running on http://127.0.0.1:8000", it's working!
