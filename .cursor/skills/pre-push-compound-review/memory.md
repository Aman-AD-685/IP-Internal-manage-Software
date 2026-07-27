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
- 2026-05-22: Cross-tab auth — JWT mirrored to localStorage while browser session active (tab lease); sessionStorage per-tab + hydrate on new tab; clear mirror when all tabs close; `syncAuthMirrorToSession`.
- 2026-07-20: **Release refresh UI** — compact fixed bottom-left toast; `width: fit-content` so black strip ends with text (not full viewport).
- 2026-07-21: **Delegation list freshness** — `delegationApi.getTasks` always networks (page paints from cache); focus/visibility refetch; paint TTL 60s. Cross-user creates do not clear another user's cache.
- 2026-07-21: **Payment Ageing dedupe** — `normalize_company_name` + letter-compact (`Black Rock`=`BlackRock`) + keyword collapse; no subset/prefix merge (Orissa ≠ Raipur); newest invoice amount. SQL: `database/PAYMENT_AGEING_CANONICALIZE_COMPANY_NAMES.sql`.
- 2026-05-22: Open in new tab — `data-open-href` + global context menu; modal actions use `?open=` deep links (`openActions.ts`, `useDeepLinkAction`).
- 2026-05-22: **1–2s paint target** — defer `/users/me` with `scheduleWhenIdle`; defer header activity count 2.5s; login `warmupAfterLogin` (bootstrap + prefetch); tickets list cache-first (no `skipCache` on initial); checklist/delegation/support-dashboard session cache instant paint; AppLayout prefetch stays 12s after mount.
- 2026-05-22: **Dashboard KPI 7–10s** — `/dashboard/kpi` is expensive-tier; use cache-first paint (`sessionApiCacheGet`), `prefetchDashboardKpiPerson` on chooser hover/click + header menu; session TTL 8m; backend `@cached(ttl=120)` for `/dashboard/kpi` and soumya-kpi. First open per person/week still ~3–7s (DB work); repeat open should be &lt;2s.
- 2026-05-22: **1–3s load budget (production)** — Never full-scan `tickets` for dashboard/support metrics; use `_count_open_queue_tickets` + filtered date windows; `_ref_no_to_company_for_rows` only (not all refs); ticket list `_TICKET_LIST_SELECT` not `*`; `_SUPPORT_DASH_CACHE` 120s; bootstrap/metrics **not** on expensive rate-limit tier; run `database/TICKETS_OPEN_QUEUE_INDEXES.sql` in Supabase after deploy.
- 2026-05-22: **Regression checklist** — After perf change: (1) Dashboard bootstrap &lt;3s cached, (2) Chores & Bugs list first page, (3) Approval Status features, (4) Support Dashboard stats; hard refresh + repeat navigation; cold Render start is separate (keepalive cron).
- 2026-05-22: **Dashboard KPI 10s+** — `/dashboard/kpi` must NOT load all tickets; use `_fetch_kpi_chore_bug_tickets(month)` + `_enrich_kpi_ticket_slices` only; one month checklist completion query; `@cached(ttl=300)`; KPI/soumya on **global** rate-limit tier; frontend cache-first + stagger prefetch on chooser (400ms apart).
- 2026-05-22: **I-1 board 5s+** — backend `_I1_LIST_CACHE` 120s + narrow columns; frontend `improvement-i1:list` session cache 5m + cache-first modal + Header idle prefetch 3.5s; invalidate on mutate.
- 2026-05-22: **100% pre-push bar — Security** — Never UI-only gate for KPI/IP/I-1; use `app/section_permissions_util.py` + `require_dashboard_kpi_person` on `/dashboard/kpi`, `/dashboard/soumya-kpi`, `/dashboard/success-kpi-till-date`; auth **before** cache (wrapper route → cached `_dashboard_kpi_data`); `@cached` must not skip permission checks.
- 2026-05-22: **100% pre-push bar — Performance** — Run `database/TICKETS_OPEN_QUEUE_INDEXES.sql` + `database/DASHBOARD_KPI_INDEXES.sql` in Supabase after deploy; bounded `_fetch_kpi_chore_bug_tickets`; invalidate `dash:` / `dash:soumya:` via `invalidate_dashboard_read_caches()` on ticket + checklist + delegation writes.
- 2026-05-22: **100% pre-push bar — Maintainability** — Section labels: backend `_SECTION_LABELS_BASE` in `main.py` is canonical; frontend `SECTION_LABELS` in `constants.ts` must stay in sync; person KPI keys only in `dashboard_kpi_sections.py`.
- 2026-05-22: **100% pre-push bar — Scalability** — In-process TTL caches OK on single Render service; shared KPI cache keyed by person+week (not per-user) after auth wrapper; multi-instance would need Redis — not required until horizontal scale.
- 2026-05-29: **New person KPI dashboard (Souvik EA tracker)** — append to `DASHBOARD_KPI_DASHBOARDS` (backend) + frontend `DASHBOARD_KPI_PERSON_SECTION_KEY`/`DASHBOARD_KPI_NAMES`/`Dashboard.tsx` Record/`DASHBOARD_OPTIONS`; SECTION_KEYS/LABELS auto-include via `merge_section_keys`. Routes gated by `require_dashboard_kpi_person`; edit gated by role or `can_edit`. Daily scores in `souvik_kpi_daily` (work_date+kpi_key unique, RLS auth-select/service-write). Reuse standard `/dashboard/kpi` layout so Checklist/Delegation + monthly% show like others; place custom section after Delegation. **Perf**: never query per-week in multi-week aggregates — fetch the whole date range once and compute weeks in-memory.
- 2026-05-29: **Admin sees all KPI dashboards** — admin/master_admin bypass the per-person KPI matrix in both `dashboardKpiPermissions.ts` and `section_permissions_util.can_view_dashboard_kpi_person`, so newly added dashboards need no per-person grant or re-login.
- 2026-06-06: **Password reset email** — gotrue Python uses `redirect_to` (snake_case), not `redirectTo`; without it Supabase falls back to Site URL and users land on login with no recovery token. Public `/reset-password` must stay outside ProtectedRoute; recovery token in sessionStorage + early index.html bootstrap.
- 2026-05-30: **Similar tickets production** — Vercel→Render→Supabase path needs `getSimilar` timeout ≥20s (1.2s silently failed); fix loading-state gen race on abort; backend title-only ILIKE first then description fallback; enrich company names only for top N matches.
- 2026-07-17: **Repeat Feature cascade** — Feature `live_status`/`live_review_status=completed` closes linked Chore/Bug Stage 2–4, sets Form `quality_solution=Done`, resolves the ticket, invalidates caches, and broadcasts updates. Cross-type children must not receive the legacy same-field mirror; reference-filter context may add only the linked Feature parent.
- 2026-07-18: **D2 status colours** — use `fms-frontend/src/utils/statusColors.ts` `getStatusTagColor` (same pattern as `ticketPriority.ts`); do not reintroduce local status→Tag colour maps in list/drawer/dashboard pages.

## Pre-push scorecard (target 100/100 — block push if failed)

| Area | Must pass before push |
|------|------------------------|
| **Security** | No staged secrets; KPI/IP/I-1/soumya/success-kpi APIs: server-side section permission; auth before cache; no open redirect regressions |
| **Performance** | No full-table `tickets` scan on dashboard/list/KPI; indexes SQL noted if new query paths; regression checklist &lt;3s cached |
| **Maintainability** | Minimal diff; labels/keys consistent; reuse `section_permissions_util` not copy-paste perm checks |
| **Scalability** | Cache invalidation on writes that affect dashboard/KPI; bounded queries + TTL; document if new global cache |

## Production-level test (mandatory before every `git push`)

**User rule (2026-05-22):** Before **every** push, run production-level checks and **print the Pre-Push Report** (verdict + scores + test results). Do not push without this.

| Step | Command / action | Pass criteria |
|------|------------------|---------------|
| 1 | `collect-push-scope.ps1` + read `memory.md` + today’s journal | Scope known; no rejected advice repeated |
| 2 | `npm run build` in `fms-frontend/` | Exit 0; no TypeScript/build errors |
| 3 | KPI smoke (if `main.py` / KPI touched) | `_dashboard_kpi_data` returns `success: true` for Shreyasi, Rimpa, Akash, Adrija (May 2026 week 3 sample) |
| 4 | `python -c "from app.main import app"` in `backend/` | Imports OK |
| 5 | `git diff` — no `.env`, `backend_errors.log`, `__pycache__` | Clean staging |
| 6 | Print **Pre-Push Report** with Security/Performance/Maintainability/Scalability scores + **Production test results** table | Verdict: Production Push Safe or Push Blocked |
| 7 | After deploy reminder in report | Run `TICKETS_OPEN_QUEUE_INDEXES.sql` + `DASHBOARD_KPI_INDEXES.sql` in Supabase if not yet applied |

**Post-deploy production smoke (user):** Hard refresh → Dashboard bootstrap → each KPI person dashboard → Chores & Bugs list → Support Dashboard.

## Rejected suggestions

- (Add when user declines a review recommendation)
- 2026-07-24: App-wide IndustryPrime color/layout redesign — user kept **Team table only**; revert all other theme/sidebar/header/KPI color parity.

## Repository landmines

- `backend/app/main.py` is huge — prefer minimal diffs; reuse existing helpers.
- 2026-05-22: KPI split wrapper + `_dashboard_kpi_data` — do not use `auth` in cached body; pass `viewer_email`. Delegation KPI query: no `task` column on `delegation_tasks`.
- Never commit: `.env`, `backend_errors.log`, `**/__pycache__/**`.
- Production API must be Render backend URL, not Vercel frontend URL.
- Branch `fix/production-frontend-cache` is active deploy branch (verify before merging to main).
- 2026-07-27: Ant Design Modal `destroyOnClose` + `setFieldsValue` before Form mount fails on slow prod API — load in `afterOpenChange` (or remove destroyOnClose).
- 2026-07-27: Production `FMS_CLIENT_HEADER_REQUIRED` — raw `fetch` must send `X-FMS-Client: web` (axios interceptor does; Success Performance training/followup used fetch without it → 403).

## Coding style (learned)

- Commit messages: short imperative (`Add …`, `Fix …`), 1–2 sentences why.
- Match existing naming; minimal scope; no drive-by refactors.
- PowerShell: use `;` not `&&` for chained shell commands on Windows.

## Training synthesis

> Merged from daily journals (last 7 days). Agent updates weekly or on "sync training".

- 2026-05: User ships on `fix/production-frontend-cache`; production fixes need Render + Vercel + Supabase SQL together.
- 2026-05: NA exclusion pattern is standard — apply at query + KPI + reminder layers, not UI-only.
- 2026-05: User wants pre-push gate + day-by-day journal so reviewer learns from real work, not generic advice.
- 2026-05-21: **Fix in same session** — when `ce-code-review` / pre-push reports P1+ issues, implement fixes (don't stop at report-only unless user asked for report-only only).
- 2026-05-22: **Compound Engineering wired** — plugin enabled in `.cursor/settings.json`; pre-push runs `ce-status.ps1` then **`ce-code-review mode:report-only`**; report line `ran (ce-code-review, report-only)` not `not installed`.
- 2026-07-15: **Delegation Shifted** — auto-bump overdue `submission_date` only (leave `due_date` for KPI); `shift_count`/`shift_history`/`last_assigned_date`; run `database/DELEGATION_SHIFTED.sql` before prod rely.
- 2026-07-09: **Ponytail Cursor install** — official instruction-only adapter: `.cursor/rules/ponytail.mdc`, `AGENTS.md`, skills `ponytail` / `ponytail-review` / `ponytail-audit` / `ponytail-help`; 7-rung ladder; default **full** mode; upstream `8e69b4a`.
- 2026-05-21: Supabase seed scripts — idempotent insert (`NOT EXISTS` on natural key), `BEGIN`/`COMMIT`, fail-fast `RAISE` on missing FKs, explicit `created_by` UUID in config (no `LIMIT 1` actor).
- 2026-05-22: User expects **all pages + Dashboard 1–3s** in production after warm cache; if slow again, check full-table scans, rate-limit on bootstrap, missing Supabase indexes, Render sleep — fix code + update this memory/journal same session.
- 2026-05-22: User wants **100/100 pre-push scores** — server-side KPI auth, SQL indexes, cache invalidation, memory scorecard; block push on UI-only permission gates for sensitive APIs.
- 2026-05-22: **Always production-test before push** — `npm run build` + KPI/API smoke + full Pre-Push Report every time user says push; journal + memory updated after verdict.
- 2026-05-22: **Support FMS KPI lazy details** — `/dashboard/kpi` omits `details` arrays; modal loads `GET /dashboard/kpi/support-fms-details?pillar=`; auth via `require_dashboard_kpi_person`; frontend 60s timeout + session cache 5m.
- 2026-05-22: **Pre-push 7-step gate (user)** — Every push: memory.md + SKILL.md + journal → ce-status + ce-code-review report-only → native audit → production smoke → report → journal/memory → push. See TRAINING.md § Automatic 7-step gate.
