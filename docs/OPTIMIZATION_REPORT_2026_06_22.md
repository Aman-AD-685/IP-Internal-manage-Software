# Optimization Report - 2026-06-22

## Baseline Measurement

Command:

```bash
npm run build
```

Baseline build result:

- Build: passed.
- Build time: 18.64 s.
- Entry CSS: 23.97 kB / 5.42 kB gzip.
- Entry JS: 381.85 kB / 113.60 kB gzip.
- React chunk: 142.42 kB / 45.67 kB gzip.
- AntD chunk: 1,161.02 kB / 360.46 kB gzip.
- Charts chunk: 510.74 kB / 145.40 kB gzip.
- Largest page chunks: `DashboardKPIPage` 71.77 kB / 17.92 kB gzip, `PaymentStatusPage` 63.60 kB / 11.42 kB gzip, `ClientPaymentPage` 47.05 kB / 11.12 kB gzip.

## After Optimization Measurement

Command:

```bash
npm run build
```

After build result:

- Build: passed.
- Build time: 16.11 s.
- Entry CSS: 23.97 kB / 5.42 kB gzip.
- Entry JS: 381.83 kB / 113.67 kB gzip.
- React chunk: 142.42 kB / 45.67 kB gzip.
- AntD chunk: 1,161.02 kB / 360.46 kB gzip.
- Charts chunk: 510.74 kB / 145.40 kB gzip.
- Largest page chunks remain essentially unchanged.

## Before vs After

| Metric | Before | After | Result |
|---|---:|---:|---|
| Frontend build time | 18.64 s | 16.11 s | 13.6% faster build in this run |
| Entry JS gzip | 113.60 kB | 113.67 kB | No material bundle change |
| AntD gzip | 360.46 kB | 360.46 kB | Unchanged |
| Charts gzip | 145.40 kB | 145.40 kB | Unchanged |
| Immediate route data prefetch count | 6 routes | 2 routes | Less startup network contention |
| Background data prefetch for all routes | Yes | No, chunks only | Lower API storm risk |
| Prefetch concurrency | 3 | 2 | Lower background API pressure |
| Duplicate dashboard warmup after login | Possible | Removed | Fewer duplicate calls |
| Dashboard bootstrap executor | Per request | Shared | Lower backend per-request overhead |
| Protected-route auth validation | Sync network call in async dependency, 30s timeout | Worker-thread validation, 5s total / 2s connect timeout | Avoids event-loop blocking on auth |
| WebSocket broadcast | Sequential sends | Concurrent sends with 2s per-client timeout | Slow clients no longer block later clients |

## Expected Runtime Impact

- Initial page load: improved mainly by lower background contention after login/session restore. Bundle bytes did not materially change in this pass.
- Dashboard load: fewer duplicate and competing warmup calls should improve warm dashboard load stability; backend executor reuse removes thread creation overhead.
- API response: protected endpoints should be less vulnerable to event-loop blocking during Supabase Auth validation; `/dashboard/bootstrap` should be more stable under concurrent requests because it no longer creates a fresh executor per request.
- Database query time: expected to improve after applying `docs/SUPABASE_PERFORMANCE_OPTIMIZATION_2026_06_22.sql`, especially for ticket sections, text search, payment lists, and dashboard/payment queries.
- Navigation: likely improves for the first one or two likely routes through targeted data prefetch; broad cross-app navigation may now fetch data on demand instead of consuming startup bandwidth.

## Files Modified

- `fms-frontend/src/main.tsx`
- `fms-frontend/src/utils/routePrefetch.ts`
- `fms-frontend/src/utils/warmupAfterLogin.ts`
- `fms-frontend/src/utils/prefetchConcurrency.ts`
- `backend/app/auth_middleware.py`
- `backend/app/main.py`
- `backend/app/ws_hub.py`
- `docs/SUPABASE_PERFORMANCE_OPTIMIZATION_2026_06_22.sql`
- `docs/PERFORMANCE_AUDIT_REPORT_2026_06_22.md`
- `docs/OPTIMIZATION_REPORT_2026_06_22.md`

## Remaining Work To Hit Requested Targets

The requested sub-555 ms page/dashboard target is not realistic on cold Render instances or with the current AntD/charts payload unless the deployment is warm, indexed, and measured from a low-latency region. The next highest-impact work is:

- Apply and verify Supabase indexes with `EXPLAIN ANALYZE`.
- Add a backend ticket facets endpoint to remove all-page filter option loading.
- Convert open Client Payment to server-paginated/virtualized rendering.
- Move payment/dashboard aggregates into SQL views or RPC functions.
- Split the public auth bundle from the protected app shell.
- Add automated Lighthouse and API timing smoke checks.
