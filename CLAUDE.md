@AGENTS.md

# Support FMS — Claude Code notes

Everything in AGENTS.md above applies (ponytail ladder). This file adds what is specific
to running Claude Code in this repo.

## Layout

- `backend/` — FastAPI (Python) on Supabase (supabase client + psycopg2).
- `fms-frontend/` — Vite + React + Ant Design, TanStack Query, axios.
- `supabase/`, `database/` — SQL schema and migrations.
- `deploy/`, `docker-compose.nginx.yml` — deployment config.
- `ponytail/` — local copy of the ponytail ruleset.
- Root `*.md` files are working notes, not specifications — prefer the code and the
  numbered docs (`01_HIGH_LEVEL_ARCHITECTURE.md` … `05_SECURITY_RLS_STRATEGY.md`).

## Commands

- Frontend dev: `cd fms-frontend && npm run dev`
- Frontend lint: `cd fms-frontend && npm run lint`
- Frontend format check: `cd fms-frontend && npm run format:check`
- Frontend tests: `cd fms-frontend && npm run test`
- Frontend build: `cd fms-frontend && npm run build`
- Backend: see `backend/START_BACKEND.md` (FastAPI + uvicorn)

## Workflow

- Always work on a feature branch — never commit directly to the default branch.
- Ask me before writing or running any SQL migration under `supabase/` or `database/`.
- Row-level security matters here: read `05_SECURITY_RLS_STRATEGY.md` before touching
  policies, auth, or anything that decides who can see which rows.
- Ask me before adding a dependency.

## Never

- Never read or print `backend/.env`, `fms-frontend/.env`, `fms-frontend/.env.production`,
  or any real `.env` file. Read the matching `.env.example` instead.
- Never read or modify `supabase_backup*.sql` / `*.dump` — they are database dumps that
  may contain live customer data.
- Never run destructive SQL (drop, truncate, or delete without a filter) against Supabase.
- Never run `git push --force`.
- Never commit a secret, key, or token — if you find one committed, report the file and line only.
