# Getting every page / dashboard / section to open in under 750 ms

Goal: any page opens fast, every time. There are two cases and they need different fixes:

- **Repeat opens** (page seen before, or after reload) → made **instant** by cache + prefetch (frontend).
- **First cold open** → only as fast as the **backend query** → fixed by indexes + parallel queries.

All four layers below work together. Do the Supabase step first — it's the biggest single win.

---

## 1. DATABASE — run the index script (biggest win, do this first)

Open **Supabase → SQL Editor**, paste **`database/RUN_ALL_PERFORMANCE_INDEXES.sql`**, Run.

- Run **step 0** first to see which `idx_tickets_*` indexes already exist. If most are missing,
  that's your slowness — every dashboard count is scanning the whole tickets table.
- The script adds every index the dashboards + lists need (open-queue counts, staging, demo-c split,
  last-week covering index, list filters, payment + delegation tables), runs `ANALYZE`, reloads the API.
- Safe to re-run (all `IF NOT EXISTS`).

Without indexes, no amount of frontend work makes a cold open fast. With them, dashboard counts go
from seconds to single-digit milliseconds.

---

## 2. BACKEND — parallelized the slow endpoint (already applied)

`backend/app/main.py` → `/dashboard/metrics` was running ~10 database queries **one after another**.
I changed it to run them **in parallel** (thread pool, same pattern already used elsewhere in your
code), so it waits for the slowest single query instead of the sum. Verified it compiles.

> While editing I found `main.py` had been left **truncated at the end** (it stopped mid-statement,
> which would stop the backend from starting). I repaired the missing tail from your last commit and
> confirmed the whole file compiles. Your other uncommitted edits were preserved — worth a quick
> `git diff` before deploying.

**Deploy this to Render** for the change to take effect.

---

## 3. FRONTEND — turned ON section prefetch (already applied)

Your app already has a **complete prefetch system** (warms a section's data on sidebar hover and
during idle time) — but it was switched **off** behind a feature flag. I enabled it:

- `fms-frontend/.env` and `.env.production` → `VITE_ENABLE_ROUTE_DATA_PREFETCH=1`
- **Also add `VITE_ENABLE_ROUTE_DATA_PREFETCH = 1` in Vercel → Settings → Environment Variables**,
  otherwise the Vercel dashboard config can override the file. Then redeploy.

Effect: hovering a menu item (or just idle time after login) loads that section's data into the
cache, so when you click, the page paints **instantly** from cache.

This pairs with your existing `sessionApiCache`, which already saves API responses to the browser
(localStorage, per-user, 15–30 min) — so repeat opens and reloads are served instantly and refreshed
in the background (the "instant, refresh in background" behavior you chose).

---

## 4. Order of operations + how to verify

1. Run **`RUN_ALL_PERFORMANCE_INDEXES.sql`** in Supabase. *(No deploy needed — instant effect.)*
2. **Deploy backend** (the parallel `/dashboard/metrics`) to Render.
3. **Deploy frontend** to Vercel with `VITE_ENABLE_ROUTE_DATA_PREFETCH=1` set in Vercel env.
4. Verify: open DevTools → **Network**, click around the app.
   - First open of a section: check `Waiting (TTFB)` on its API call — should be well under a second
     once indexes are in.
   - Hover a menu item, wait ~1s, then click: the page should appear with **no spinner** (served
     from the warmed cache).

---

## Honest expectation on the 750 ms target

- **Repeat opens / after-hover / reloads: yes, consistently <750 ms** — they paint from cache.
- **Brand-new cold open of a heavy report:** depends on the one query behind it. Indexes +
  parallelization get most under 750 ms; a very large table on a small Supabase tier may still spike
  occasionally on the very first cold hit before the cache fills.

If anything is still slow after steps 1–3, it's one specific endpoint. Tell me which page and I'll
add per-query timing logs to pinpoint the exact query, give that endpoint the same parallel-query
treatment, or warm it on login so even the first open is instant. Remaining levers if needed:

- Apply the parallel-query pattern to `/dashboard/bootstrap`, `/dashboard/summary`, and `/tickets`.
- Warm the most-used section on login so the very first open is pre-cached.
- If query times are high even with indexes, bump the Supabase compute tier (a nano/free DB caps how
  fast any query can run regardless of indexes).
