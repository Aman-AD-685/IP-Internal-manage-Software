# Performance Audit Report - 2026-06-22

Scope: React/Vite frontend, FastAPI backend, Supabase/Postgres query patterns, dashboard pages, routing, caching, and security-sensitive auth/RBAC paths.

Targets requested: initial page load under 555 ms, dashboard load under 555 ms, API response under 200 ms, DB query under 100 ms, navigation under 100 ms, Lighthouse Performance over 95.

## Executive Verdict

The app already has several good performance foundations: route-level lazy loading, dashboard bootstrap API, server-side pagination on major list endpoints, short-lived in-process caches, gzip responses, and session API caching in the browser.

The main blockers to the requested targets are:

- Large shared frontend chunks, especially Ant Design and chart libraries.
- Background prefetch warming too many routes and APIs immediately after login/session restore.
- Protected-route auth was performing synchronous Supabase Auth validation inside async dependencies.
- Dashboard and payment pages still have all-pages/client-side aggregation paths.
- Some backend endpoints still perform multiple Supabase round trips per request.
- WebSocket broadcast was sequential, so a slow client could delay all later clients.
- Supabase needs composite/partial indexes for the exact hot filters used by tickets, dashboard, client payment, checklist, delegation, KPI, and DB-client views.
- Render cold starts can dominate TTFB and make sub-555 ms impossible on cold instances.

## Top 20 Bottlenecks

| Rank | Severity | Area | Issue | Impact | Recommended Fix |
|---:|---|---|---|---|---|
| 1 | P1 | Frontend bundle | `antd` production chunk is about 1,161 kB minified / 360 kB gzip. | Initial JS parse/eval cost; slower login and protected shell. | Long term: replace broad AntD page imports with route-isolated component imports or lighter app shell; audit components that pull large AntD subtrees. |
| 2 | P1 | Frontend bundle | `vendor-charts` is about 511 kB minified / 145 kB gzip. | Dashboard/chart routes pay heavy load cost when charts are reached. | Keep charts lazy; avoid importing chart pages from shared components; split map/chart libraries separately if both are not needed together. |
| 3 | P1 | Frontend prefetch | `startIdleRoutePrefetch` warmed data for every authorized route after layout mount. | API storm and chunk downloads compete with active page load. | Fixed: top data prefetch reduced; remaining routes now warm chunks only. |
| 4 | P1 | Login warmup | `warmupAfterLogin` could call dashboard bootstrap twice for dashboard/default flows. | Duplicate API requests during the most sensitive post-login window. | Fixed: route prefetch is now the single primary warmup; dashboard fallback delayed. |
| 5 | P1 | Backend auth | Auth validation used synchronous `httpx.get` with a 30s timeout inside async dependencies. | Can block FastAPI event-loop workers and amplify latency across protected API calls. | Fixed: moved validation to a worker thread and reduced auth HTTP timeout. |
| 6 | P1 | Backend dashboard | `/dashboard/bootstrap` created a new `ThreadPoolExecutor` on every request. | Thread creation overhead and avoidable pressure under concurrency. | Fixed: shared dashboard executor. |
| 7 | P1 | Database | Tickets hot filters rely on several single-column indexes, but compound filters sort by `created_at`. | Planner can scan/filter too much data for tickets and dashboard sections. | Run `docs/SUPABASE_PERFORMANCE_OPTIMIZATION_2026_06_22.sql`. |
| 8 | P1 | Tickets page | Stage/company/reference filter options can fetch all pages in 200-row loops. | Slow on larger ticket datasets; more API calls and memory pressure. | Add backend facet endpoint for distinct company/reference/stage counts scoped to current filters. |
| 9 | P1 | Client Payment page | Open payment list loads all pages up to 100 pages x 200 rows. | Future data growth will degrade page load and memory. | Convert open list to paginated/virtual table and backend aggregate/facet endpoints. |
| 10 | P1 | Dashboard detail | `/dashboard/detail` loads broad ticket datasets before filtering by metric. | Detail modal can become slow as tickets grow. | Push per-metric filters into Supabase queries and paginate details. |
| 11 | P1 | Dashboard metrics | Payment metrics fetch payment rows and receive rows into Python for aggregation. | CPU and payload growth with invoice history. | Move heavy payment aggregates to SQL view/RPC with indexes on payment/invoice dates. |
| 12 | P2 | WebSocket fanout | Broadcast sent to each websocket sequentially. | One slow/dead client can delay every later client. | Fixed: concurrent fanout with per-send timeout and dead-client cleanup. |
| 13 | P2 | Frontend app shell | WebSocket, release prompt, system lock, context menu, and layout providers are mounted broadly. | Public/auth pages carry provider overhead. | Split public auth routes from protected app shell so live providers mount only after auth. |
| 14 | P2 | Frontend route config | `App.tsx` is large and declares all route elements inline. | Entry parse cost and harder maintainability. | Extract protected route definitions into route modules; keep public entry minimal. |
| 15 | P2 | Tables | AntD tables render non-virtual lists on several pages. | Large row counts can block UI thread. | Use server pagination everywhere; enable virtual scrolling for wide/large lists. |
| 16 | P2 | Charts/maps | `DbDashPage` imports both Recharts and `react-simple-maps`. | Heavy route chunk and parse cost. | Lazy-render map section after first paint or behind viewport intersection. |
| 17 | P2 | API caching | In-process caches are per Render instance. | Multi-instance deployments lose cache locality. | Use Redis/Upstash for shared hot GET cache if scaling horizontally. |
| 18 | P2 | Supabase text search | Multiple `ilike` filters on tickets can require sequential scans. | Search degrades as ticket text grows. | Add trigram indexes from SQL script; consider dedicated search RPC. |
| 19 | P2 | RLS/index coupling | User/profile/permission lookups depend on repeated auth checks. | Parallel page API calls amplify auth DB load. | Existing role TTL helps; add indexes on profile/permission user IDs if not already present. |
| 20 | P3 | Observability | No automated Lighthouse/API/query benchmark committed. | Before/after numbers are hard to prove continuously. | Add perf smoke script for key routes and API timing budget checks. |

## Security Notes

- Auth and RBAC checks were preserved. No role logic, route allowlists, token handling, or Supabase keys were changed.
- Existing role caching uses a short TTL. This improves performance but means role changes may take up to `ROLE_CACHE_TTL_SEC` to apply unless caches are invalidated.
- SQL recommendations are indexes only; they do not relax RLS or expose data.

## Safe Fixes Applied

- Removed static production import path for React Query Devtools in `fms-frontend/src/main.tsx`.
- Reduced post-login/restored-session route data prefetch fan-out in `fms-frontend/src/utils/routePrefetch.ts`.
- Removed duplicate dashboard bootstrap warmup from `fms-frontend/src/utils/warmupAfterLogin.ts`.
- Reduced background prefetch concurrency in `fms-frontend/src/utils/prefetchConcurrency.ts`.
- Moved Supabase Auth token validation off the event loop and reduced auth HTTP timeout in `backend/app/auth_middleware.py`.
- Reused a shared dashboard executor in `backend/app/main.py`.
- Made websocket broadcast concurrent with per-send timeout in `backend/app/ws_hub.py`.
- Added Supabase SQL index script in `docs/SUPABASE_PERFORMANCE_OPTIMIZATION_2026_06_22.sql`.

## Deferred Fixes

These are high-impact but need product validation or database measurement before implementation:

- Replace all-pages client payment loading with paginated/virtual table behavior.
- Add backend facet endpoints for ticket filters instead of fetching all pages.
- Move payment dashboard aggregation to SQL/RPC.
- Split protected app shell from public auth shell.
- Rework AntD usage to shrink first-load dependencies.
