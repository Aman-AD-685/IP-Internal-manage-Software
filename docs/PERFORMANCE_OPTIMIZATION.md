# Performance Optimization Guide

Target: **Sub-1 second** load for key pages (small DB ~0.03 GB). Stack: FastAPI (Render), Supabase PostgreSQL, React/Vite frontend (Vercel).

---

## 1. Backend Bottlenecks Addressed

| Issue | Fix |
|-------|-----|
| `list_client_payment` fetched all rows with `SELECT *` | Server-side filter by `status`/`section`, explicit column list, `.limit(500)` |
| List waited on **two** Supabase lookups **sequentially** + huge `.in_(ids)` | **Parallel** `sent` + `max_followup` lookups; **batched** `IN` lists (120 ids/chunk); `max_followup` loads followups + legacy followup1 **in parallel** |
| Raised Invoices page blocked on **`GET /companies`** (full table) | **Lazy-load** companies only when **Add Raised Invoice** modal opens |
| Client Payment drawer = 4 separate API calls | Single **batch endpoint** `GET /onboarding/client-payment/{id}/drawer` returns sent + followups + intercept + discontinuation |
| Tickets list uses `select("*", count="exact")` | Kept; pagination and range already applied. Enrichment does 4 batched lookups (companies, pages, divisions, approvers) — acceptable |
| `_build_ref_no_to_company()` loads all tickets | Cached globally; first request per process can be slow — consider short TTL or removing if not critical |
| No DB indexes on hot filters | See `docs/supabase_performance_indexes.sql` |

---

## 2. SQL / Indexing Strategy

- **tickets**: `created_at`, `status`, `type`, `company_id`, `section`-related filters.
- **onboarding_client_payment**: `timestamp` (order), `payment_received_date` + `genre` (list filter).
- **onboarding_client_payment_sent / followups / followup1 / intercept / discontinuation**: index on `client_payment_id` (FK lookups).

Run the statements in `docs/supabase_performance_indexes.sql` in Supabase SQL Editor (once).

---

## 3. N+1 and Extra Round-Trips

- **List client payment**: One filtered list query + **two parallel** batch lookups (sent ids, max followup), each **chunked** to avoid huge PostgREST URLs. Max followup runs **followups table + legacy followup1** in parallel.
- **Drawer**: Was 4 requests per open; now 1 request to `/drawer` (backend runs 4 queries in parallel and returns one JSON).

---

## 4. Caching (Optional)

- **In-memory (no Redis)**  
  - Cache idempotent GET responses with short TTL (e.g. 30–60 s):  
    - `GET /onboarding/client-payment?status=open`  
    - `GET /dashboard/metrics`  
  - Invalidate on write (e.g. after create/update client-payment or ticket).

- **Redis**  
  - Use for multi-instance Render or shared cache: same keys and TTLs; invalidate on write.

- **FastAPI**  
  - Example: `@lru_cache` on a helper that returns metrics, or `cachetools.TTLCache` keyed by `(path, query_string)`.

---

## 5. Frontend Optimizations

- **Client Payment page**  
  - Load drawer with **one** call: `GET /onboarding/client-payment/{id}/drawer` instead of 4 parallel GETs.
  - Keep list request as-is (already one call with optional `status`/`section`).

- **Dashboard**  
  - Already uses `Promise.allSettled([getMetrics(), ticketsApi.list(...)])` for first paint; separate `useEffect` for Payment Actions and Active Leads is acceptable (non-blocking). Optionally run all four in one `Promise.all`/`Promise.allSettled` so everything loads in parallel.

- **General**  
  - Lazy-load heavy sections (e.g. open drawer only when user clicks a row).  
  - Use loading/skeleton states; avoid blocking whole page on a single slow request.

---

## 6. Render Cold Start

- **Problem**: Free/low-tier Render sleeps after inactivity; first request after idle can take 10–50+ seconds.
- **Mitigations**:
  1. **Keep-alive**: Cron (e.g. cron-job.org, Render cron) hitting `GET /health` every 5–10 minutes so the service stays warm.
  2. **Upgrade**: Paid plan with always-on instance removes cold starts.
  3. **Document**: Add a `/health` or `/ping` endpoint that returns 200 and use it only for keep-alive (no heavy logic).

---

## 7. Checklist

- [x] `list_client_payment`: server-side filter, explicit columns, limit 500.
- [x] `list_client_payment`: parallel sent + max-followup lookups; batched `IN`; parallel followups vs legacy followup1 inside max-followup.
- [x] Client Payment: lazy-load `/companies` on Add Invoice modal.
- [x] Batch drawer endpoint: `GET /onboarding/client-payment/{id}/drawer`.
- [x] Frontend uses drawer endpoint in Client Payment page.
- [x] Indexes script: `docs/supabase_performance_indexes.sql`.
- [ ] Run index script in Supabase (manual).
- [ ] Optional: in-memory or Redis cache for list_client_payment and dashboard metrics.
- [ ] Optional: Keep-alive cron for Render.

---

## 8. Why the app feels slow (common causes)

| Cause | What you see | Mitigation in repo |
|-------|----------------|-------------------|
| **Render cold start** | First request after idle takes 10–50s | Keep-alive cron on `GET /health`; paid always-on plan |
| **Post-login API storm** | Spinners everywhere right after login | Throttled idle prefetch (`prefetchConcurrency.ts`), fewer warm routes, no KPI prefetch until opened |
| **Dashboard KPI fan-out** | Main dashboard waits on 5× `/dashboard/kpi` | Batched loads (2 at a time) + 4 min session cache |
| **Heavy aggregates** | Payment KPI / payment-summary slow | Server cache 60s, paginated scans; rate limit prevents retry storms |
| **Rate limit (429)** | “Too many requests” after rapid navigation | Back off; limits are per-IP (auth 20/min, expensive 18/min, global 150/min) |

Tune via env: `RATE_LIMIT_EXPENSIVE_MAX_REQUESTS`, `RATE_LIMIT_GLOBAL_MAX_REQUESTS`, `RATE_LIMIT_ENABLED=0` (disable).

---

## 9. Verifying

- After deploying: open Client Payment list → open a row (drawer). Network tab should show one list request and one drawer request (instead of 4 for drawer).
- Measure time-to-first-byte (TTFB) for list and drawer; aim &lt; 1 s each on a warm instance.
- If first load after long idle is slow, confirm cold start and add keep-alive or upgrade plan.
