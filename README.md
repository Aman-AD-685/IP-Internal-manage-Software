# Industry Prime — IP Internal Management Software (FMS)

**Industryprime** (search: **industryprime**, **IP Internal Management**) is a cloud internal-operations platform: client onboarding, raised invoices and payments, payment-ageing reporting, KPI dashboards, training workflows, support tickets, and role-based access. This repository powers the **IP Internal Management** web app used by Industry Prime teams.

| What searchers look for | What this repo is |
|-------------------------|-------------------|
| industryprime | Industry Prime’s internal management / FMS-style software (this codebase) |
| Industry Prime software | React (Vite) frontend + FastAPI backend + Supabase (PostgreSQL, Auth, Storage) |
| IP Internal Management | Same product — deployed frontend (e.g. Vercel) + API (e.g. Render) |

**Live app (replace with your canonical URL if different):** production frontend is commonly deployed at `https://industryprime.vercel.app` with API at `https://ip-internal-manage-software.onrender.com` (see `fms-frontend/.env.production`). For **Google Search**: verify that domain in [Google Search Console](https://search.google.com/search-console), submit the homepage and `sitemap.xml` for indexing, and keep the deployed site **public** (login pages still allow Google to see titles/meta). Ranking position (e.g. page 1) depends on competition and time; strong titles, meta, README, and backlinks (Product Hunt, DEV.to, etc.) improve discoverability when people type **industryprime** or **Industry Prime**.

---

## Crawler-friendly summary (copy for listings / articles)

**Name:** Industry Prime — IP Internal Management Software  
**Also known as:** industryprime, IP Internal Management, FMS onboarding platform  
**One line:** Internal web app for manufacturing / operations teams: onboarding, payments, ageing, KPIs, training, and support — **React + TypeScript (Vite)**, **FastAPI (Python)**, **Supabase**.  
**Public code:** [GitHub repository](https://github.com/amandey688-png/IP-Internal-manage-Software) (this repo).  
**Tech keywords:** FastAPI, Supabase, PostgreSQL, Row Level Security, React, Vite, Ant Design, REST API, multi-role RBAC.

---

## Tech stack (actual)

- **Frontend:** React 18 + TypeScript + Vite + Ant Design (`fms-frontend/`)
- **Backend:** FastAPI (`backend/app/main.py`, `uvicorn app.main:app`)
- **Database / Auth / Storage:** Supabase
- **SEO assets:** `fms-frontend/index.html` (meta + JSON-LD), `fms-frontend/public/robots.txt`, `fms-frontend/public/sitemap.xml` — update URLs if your production domain is not `industryprime.vercel.app`.

---

## Documentation structure

1. **[High-Level Architecture](./01_HIGH_LEVEL_ARCHITECTURE.md)** — Overview, stack, deployment patterns  
2. **[Module Breakdown](./02_MODULE_BREAKDOWN.md)** — Modules and dependencies  
3. **[API Layer Overview](./03_API_LAYER_OVERVIEW.md)** — Endpoints and formats  
4. **[Database Schema](./04_DATABASE_SCHEMA.md)** — Tables, RLS, views  
5. **[Security & RLS Strategy](./05_SECURITY_RLS_STRATEGY.md)** — RBAC and Supabase security  

---

## Key features (high level)

- **Role-based access:** user, approver, admin, master_admin (and feature-specific allowlists where configured)  
- **Onboarding / client payment:** raised invoices, payment tracking, payment ageing report, invoice-sent details  
- **Dashboards & KPIs:** operational KPIs (e.g. daily work log, social KPI views where enabled)  
- **Training & support:** training stages, support forms, tickets / SLA patterns per module docs  
- **Integrations:** Supabase Auth, email flows, file storage as documented in `docs/` and backend  

---

## Quick start

### Prerequisites

- Node.js 18+  
- Python 3.11+ (3.12+ works; match your environment)  
- Supabase project (URL + keys in `backend/.env`)

### Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
# Copy backend/.env.example → backend/.env and fill Supabase + secrets
uvicorn app.main:app --reload --host 127.0.0.1 --port 8020
```

### Frontend

```bash
cd fms-frontend
npm install
# Copy fms-frontend/.env.example → fms-frontend/.env
# Set VITE_API_BASE_URL=http://127.0.0.1:8020 for local API
npm run dev
```

### Environment (minimal)

**Backend (`backend/.env`):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, SMTP or mail provider if used, `CORS_ORIGINS` including your Vercel frontend URL.

**Frontend (`fms-frontend/.env`):** `VITE_API_BASE_URL` pointing at the FastAPI origin (local or Render/production).

---

## Architecture (short)

1. Browser loads the Vite SPA (Industry Prime / IP Internal Management).  
2. Authenticated calls go to FastAPI (direct or via dev proxy `/api`).  
3. FastAPI uses Supabase (PostgREST patterns, service role where appropriate) and documented RLS for user-scoped data.  
4. Real-time and storage features follow module-specific docs under `docs/`.

---

## Universal Dashboard Permissions

The main dashboard is driven by role + section permission flags, not email allowlists. To grant a user a new dashboard section, update `user_section_permissions` for that user and set `can_view=true` for the matching section key, such as `client_payment`, `training`, `db_client`, `success_performance`, `client_to_lead`, or `task`.

`master_admin` receives all dashboard permissions from the backend. `admin` receives management/global-filter capabilities plus the section flags assigned in the permission matrix. Normal users only see their own scoped data and the sections explicitly granted. Do not add new `if email === ...` dashboard access rules.

---

## Contributing & license

Follow patterns in `01_`–`05_` docs; respect RLS and role checks on new endpoints.  
License: specify in this file when you publish publicly.

## Support

Use internal team channels or repository issues. For **SEO**: keep README and deployed `index.html` aligned with your final **canonical domain**, then use Search Console → URL Inspection → **Request indexing** for the homepage after each important release.
