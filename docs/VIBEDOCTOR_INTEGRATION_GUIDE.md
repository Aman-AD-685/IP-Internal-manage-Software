# VibeDoctor integration — step-by-step (IP Internal Management Software)

[VibeDoctor](https://vibedoctor.io/) scans your repo and live app for security, performance, AI-code issues, dependencies, and SEO. It does **not** run inside your FastAPI app as a library. You connect your **GitHub repo** and optionally your **production URL**.

Your stack:

| Layer | This project |
|--------|----------------|
| Frontend | `fms-frontend` (Vite + React) → Vercel (`industryprime.vercel.app`) |
| Backend | `backend` (FastAPI) → Render (`ip-internal-manage-software.onrender.com`) |
| Database | Supabase |
| Repo | `amandey688-png/IP-Internal-manage-Software` |

---

## Choose your path

| Option | Best for | Time |
|--------|----------|------|
| **1. Manual scan** | First test, one-off audit | ~10 min |
| **2. GitHub / CI** | Scan on every push (recommended) | ~20 min |
| **3. Internal health dashboard** | Live status inside your FMS app | Build on existing `/health` APIs |

You can use **1 + 2** together. **3** is your own dashboard (VibeDoctor reports linked manually or via bookmarks).

---

# Option 1 — Simple manual scan (fastest)

### Step 1 — Create account

1. Open [https://vibedoctor.io](https://vibedoctor.io)
2. Click **Run my first scan** or sign up
3. **Login with GitHub** (same account that owns your repo)

### Step 2 — Connect repository

1. In VibeDoctor dashboard, choose **Connect repository**
2. Install the **VibeDoctor GitHub App** when prompted
3. Select repository: **`IP-Internal-manage-Software`**
4. Grant **read-only** access (VibeDoctor does not write to your repo)

### Step 3 — Run first scan

1. Pick branch: **`main`** or **`fix/production-frontend-cache`** (your active branch)
2. Click **Scan** / **Run scan**
3. Wait ~30 seconds for the report

### Step 4 — What gets scanned

VibeDoctor walks your repo and may also probe a live URL if you configure one:

| Area | What it checks in your project |
|------|--------------------------------|
| **Security** | Leaked keys in `backend/.env` examples, hardcoded secrets, CVEs in `package-lock.json` |
| **Performance** | Lighthouse-style checks if you add production frontend URL |
| **Vibe coding health** | Huge files (e.g. `backend/app/main.py`), empty catches, TODOs |
| **Dependencies** | npm + Python packages |
| **SEO** | Mainly relevant if you scan the public Vercel site |

### Step 5 — Scan production URLs (optional)

Add these in VibeDoctor (website / deployment scan), if the product supports URL scan:

- Frontend: `https://industryprime.vercel.app`
- Backend health: `https://ip-internal-manage-software.onrender.com/health`
- Backend DB check: `https://ip-internal-manage-software.onrender.com/health/supabase`

### Step 6 — Fix findings

1. Open each **Critical** / **High** item in the report
2. Copy the suggested fix prompt into **Cursor** if offered
3. Fix in repo → commit → push → rescan

---

# Option 2 — CI/CD / automated scans (recommended)

VibeDoctor’s main automation is the **GitHub App**, not a custom npm package in your repo.

### Step 1 — Connect repo (same as Option 1)

1. [vibedoctor.io](https://vibedoctor.io) → GitHub login
2. Install GitHub App on **`IP-Internal-manage-Software`**
3. Enable the repo in VibeDoctor settings

### Step 2 — Enable scan triggers (VibeDoctor dashboard)

In VibeDoctor project settings (wording may vary by plan):

| Trigger | What it does |
|---------|----------------|
| **On manual scan** | Free / always available |
| **On commit** | Rescan after each push (paid “Watch” tier on their site) |
| **On PR** | Comments on pull requests (paid “Guard” tier) |
| **Scheduled** | Weekly rescans |

Start with **manual + on push** if your plan includes it.

### Step 3 — GitHub branch workflow (your repo)

Use a stable branch for production scans:

```text
main  OR  fix/production-frontend-cache  →  merge when ready  →  VibeDoctor scans main
```

### Step 4 — Optional reminder workflow in GitHub Actions

VibeDoctor does not require a special CLI in Actions today; the **GitHub App** runs scans on their infrastructure. You can still add a small workflow that documents the process and fails if critical local checks break.

Create file: **`.github/workflows/vibedoctor-reminder.yml`**

```yaml
name: Pre-deploy checks (VibeDoctor + health)

on:
  push:
    branches: [main, fix/production-frontend-cache]
  pull_request:
    branches: [main]

jobs:
  local-sanity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reminder — run VibeDoctor on GitHub
        run: |
          echo "Run a VibeDoctor scan at https://vibedoctor.io for this commit."
          echo "Repo should be connected via GitHub App (read-only)."

      - name: Frontend install (lint)
        working-directory: fms-frontend
        run: |
          npm ci
          npm run lint || true

      - name: Backend syntax check
        working-directory: backend
        run: |
          python -m pip install -r requirements.txt
          python -c "import app.main; print('backend imports ok')"
```

Push this file to GitHub. It does **not** replace VibeDoctor; it keeps CI aware of quality checks.

### Step 5 — After each deploy

| Deploy target | Check |
|---------------|--------|
| **Render** | Manual Deploy → open `/health` and `/health/supabase` |
| **Vercel** | Redeploy → open app login page |
| **VibeDoctor** | Run scan or wait for auto scan on push |

### Step 6 — PR process (recommended)

1. Push feature branch
2. Open PR on GitHub
3. Run VibeDoctor scan on that branch (manual or PR integration)
4. Fix Critical/High before merge
5. Merge → deploy Render + Vercel → optional production URL scan

---

# Option 3 — Internal health dashboard (inside your FMS)

You already have health endpoints in **`backend/app/main.py`**. Use them for uptime tools and a future Settings card.

### Step 1 — Know your health URLs

**Local (uvicorn port 8020):**

| Endpoint | Purpose |
|----------|---------|
| `http://127.0.0.1:8020/health` | Backend alive (lightweight) |
| `http://127.0.0.1:8020/health/db` | Supabase `roles` table reachable |
| `http://127.0.0.1:8020/health/supabase` | Full Supabase auth + DB diagnostic |

**Production (Render):**

| Endpoint | Purpose |
|----------|---------|
| `https://ip-internal-manage-software.onrender.com/health` | Uptime ping |
| `https://ip-internal-manage-software.onrender.com/health/supabase` | DB / keys diagnostic |

### Step 2 — UptimeRobot (free external monitor)

1. Sign up at [https://uptimerobot.com](https://uptimerobot.com)
2. Add monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://ip-internal-manage-software.onrender.com/health`
   - **Interval:** 5 minutes
3. Add alert email if down

This prevents Render cold-start surprises (your `/health` already supports Snitch if `DEADMANS_SNITCH_URL` is set).

### Step 3 — Map “VibeDoctor-like” cards (build in app later)

| Card | Data source today |
|------|-------------------|
| API health | `GET /health` → `{ "ok": true }` |
| Database | `GET /health/db` or `/health/supabase` |
| Email / cron | Feature Approval logs in Settings; Postmark via your cron URL |
| Frontend | Manual: VibeDoctor Lighthouse or Vercel Analytics |
| Security | **VibeDoctor report** (link from Settings) |
| Deployment | Render + Vercel dashboards (manual links) |

### Step 4 — Quick test from browser (logged in not required)

```text
https://ip-internal-manage-software.onrender.com/health
https://ip-internal-manage-software.onrender.com/health/supabase
```

Expect JSON, not HTML errors.

### Step 5 — Optional: Settings page “System health” card (future dev)

Add under **Settings** (Master Admin):

- Call `/health` and `/health/supabase` from `fms-frontend` using `VITE_API_BASE_URL`
- Show green/red status
- Link: **Open VibeDoctor report** → your latest scan URL from VibeDoctor dashboard

No VibeDoctor API is required for basic health; only for embedding scores if they offer API on paid plans.

---

# Recommended combo for your team

```text
VibeDoctor (GitHub App)     →  security + AI-code + dependency scans on repo
UptimeRobot                 →  /health every 5 min on Render
Existing /health/supabase   →  login/DB issues after deploy
Manual Vercel check         →  frontend after each Vercel deploy
```

Optional later:

| Tool | Purpose |
|------|---------|
| [Sentry](https://sentry.io) | Frontend/backend error tracking |
| [PostHog](https://posthog.com) | Product analytics |
| [Better Stack](https://betterstack.com) | Logs + uptime |

---

# Checklist — first-time setup

- [ ] VibeDoctor account + GitHub login
- [ ] GitHub App installed on `IP-Internal-manage-Software`
- [ ] First scan completed; Critical/High reviewed
- [ ] `PERFORMANCE_MONITORING_MARKED_NA.sql` and other SQL migrations applied in **same** Supabase project as backend `.env`
- [ ] Render `/health` returns OK
- [ ] Vercel frontend loads; `VITE_API_BASE_URL` points to Render
- [ ] UptimeRobot (or similar) pinging `/health`
- [ ] (Optional) `.github/workflows/vibedoctor-reminder.yml` committed

---

# Troubleshooting

| Problem | Fix |
|---------|-----|
| VibeDoctor cannot see repo | Re-install GitHub App; grant access to org `amandey688-png` |
| Scan shows wrong stack | Monorepo: ensure scan includes `backend/` and `fms-frontend/` |
| `/health` OK but app broken | Check `/health/supabase` and Vercel `VITE_API_BASE_URL` |
| Too many findings on `main.py` | Expected for large FastAPI files; fix Critical first (secrets, SQL injection) |
| NA button disabled (unrelated) | Run `database/PERFORMANCE_MONITORING_MARKED_NA.sql` + `NOTIFY pgrst, 'reload schema';` |

---

# Related docs in this repo

- `backend/STEP_BY_STEP_INSTALL.md` — local backend
- `docs/CLIENT_PAYMENT_PRODUCTION.md` — Render + Vercel env
- `DEPLOYMENT_STATUS_FULL.md` — deploy checklist
- `database/STEP_BY_STEP_COMPANY_DIVISION.md` — Supabase company master
