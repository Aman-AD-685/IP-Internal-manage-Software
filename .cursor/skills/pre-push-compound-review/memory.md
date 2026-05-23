# Pre-Push Review — Self-Learning Memory

The agent **reads this file + [daily-journal/](daily-journal/) (today + last 3 days)** at the start of every pre-push audit and **appends** after user feedback.
Do not remove entries; add dated bullets.

**Raw timeline:** `daily-journal/YYYY-MM-DD.md` — what you did day by day.  
**Distilled rules:** this file — what the reviewer must always follow.

## Accepted patterns

- 2026-05: Payment summary — cap pagination, cache GET aggregates, CORS from env list; frontend 28s timeout on KPI cards.
- 2026-05: Performance Monitoring NA — `marked_na` on `performance_monitoring`; `na_filter` API; exclude NA companies from Success KPI.
- 2026-05: Support tickets NA — `status_2='na'`; `ticket_na.apply_exclude_ticket_na`; NA only via `status_2_filter=na`.
- 2026-05: Post-migration — `NOTIFY pgrst, 'reload schema'` in Supabase SQL verify scripts.
- 2026-05-21: Supabase batch seeds — `BEGIN`/`COMMIT`, temp resolve table, `RAISE` on missing FKs, idempotent `NOT EXISTS` (company_id + description + type), explicit `created_by` in config table.
- 2026-05-21: Slow load — throttle idle prefetch; batch dashboard KPI (2 concurrent); session cache KPI 4 min; `app/rate_limit.py` tiers (auth / expensive / global).
- 2026-05-21: Sub-2s paint — `GET /dashboard/bootstrap`; 60s metrics / 120s trends server cache; auth stale-while-revalidate; defer KPI/leads/tickets; 12s prefetch delay; NGINX only for multi-instance Docker (not Render single service).
- 2026-05-21: Render cold start — `.github/workflows/render-keepalive.yml` (5 min) + `docs/RENDER_KEEPALIVE_SETUP.md` (cron-job.org steps); not fixed by app code alone.
- 2026-05-21: Rate limit — do not put `/tickets` on expensive tier; bypass limits for `127.0.0.1` / `RATE_LIMIT_DEV_BYPASS=1` in local dev.
- 2026-05-22: Cross-tab auth — JWT in `localStorage`; sync hydrate via `readStoredAuthSession()`; `buildLoginUrl` / `?redirect=`; `normalizeReturnPath` blocks open redirects.
- 2026-05-22: Open in new tab — `data-open-href` + global context menu; modal actions use `?open=` deep links (`openActions.ts`, `useDeepLinkAction`).
- 2026-05-22: **1–2s paint target** — defer `/users/me` with `scheduleWhenIdle`; defer header activity count 2.5s; login `warmupAfterLogin` (bootstrap + prefetch); tickets list cache-first (no `skipCache` on initial); checklist/delegation/support-dashboard session cache instant paint; AppLayout prefetch stays 12s after mount.
- 2026-05-22: **Dashboard KPI 7–10s** — `/dashboard/kpi` is expensive-tier; use cache-first paint (`sessionApiCacheGet`), `prefetchDashboardKpiPerson` on chooser hover/click + header menu; session TTL 8m; backend `@cached(ttl=120)` for `/dashboard/kpi` and soumya-kpi. First open per person/week still ~3–7s (DB work); repeat open should be &lt;2s.
- 2026-05-22: **1–3s load budget (production)** — Never full-scan `tickets` for dashboard/support metrics; use `_count_open_queue_tickets` + filtered date windows; `_ref_no_to_company_for_rows` only (not all refs); ticket list `_TICKET_LIST_SELECT` not `*`; `_SUPPORT_DASH_CACHE` 120s; bootstrap/metrics **not** on expensive rate-limit tier; run `database/TICKETS_OPEN_QUEUE_INDEXES.sql` in Supabase after deploy.
- 2026-05-22: **Regression checklist** — After perf change: (1) Dashboard bootstrap &lt;3s cached, (2) Chores & Bugs list first page, (3) Approval Status features, (4) Support Dashboard stats; hard refresh + repeat navigation; cold Render start is separate (keepalive cron).
- 2026-05-22: **Dashboard KPI 10s+** — `/dashboard/kpi` must NOT load all tickets; use `_fetch_kpi_chore_bug_tickets(month)` + `_enrich_kpi_ticket_slices` only; one month checklist completion query; `@cached(ttl=300)`; KPI/soumya on **global** rate-limit tier; frontend cache-first + stagger prefetch on chooser (400ms apart).
- 2026-05-22: **I-1 board 5s+** — backend `_I1_LIST_CACHE` 120s + narrow columns; frontend `improvement-i1:list` session cache 5m + cache-first modal + Header idle prefetch 3.5s; invalidate on mutate.

## Rejected suggestions

- (Add when user declines a review recommendation)

## Repository landmines

- `backend/app/main.py` is huge — prefer minimal diffs; reuse existing helpers.
- Never commit: `.env`, `backend_errors.log`, `**/__pycache__/**`.
- Production API must be Render backend URL, not Vercel frontend URL.
- Branch `fix/production-frontend-cache` is active deploy branch (verify before merging to main).

## Coding style (learned)

- Commit messages: short imperative (`Add …`, `Fix …`), 1–2 sentences why.
- Match existing naming; minimal scope; no drive-by refactors.
- PowerShell: use `;` not `&&` for chained shell commands on Windows.

## Training synthesis

> Merged from daily journals (last 7 days). Agent updates weekly or on "sync training".

- 2026-05: User ships on `fix/production-frontend-cache`; production fixes need Render + Vercel + Supabase SQL together.
- 2026-05: NA exclusion pattern is standard — apply at query + KPI + reminder layers, not UI-only.
- 2026-05: User wants pre-push gate + day-by-day journal so reviewer learns from real work, not generic advice.
- 2026-05-21: **Fix in same session** — when `ce:review` / pre-push reports P1+ issues, implement fixes (don't stop at report-only unless user asked for report-only only).
- 2026-05-21: Supabase seed scripts — idempotent insert (`NOT EXISTS` on natural key), `BEGIN`/`COMMIT`, fail-fast `RAISE` on missing FKs, explicit `created_by` UUID in config (no `LIMIT 1` actor).
- 2026-05-22: User expects **all pages + Dashboard 1–3s** in production after warm cache; if slow again, check full-table scans, rate-limit on bootstrap, missing Supabase indexes, Render sleep — fix code + update this memory/journal same session.
