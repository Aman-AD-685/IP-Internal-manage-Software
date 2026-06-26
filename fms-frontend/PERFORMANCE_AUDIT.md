# Performance Audit — Why pages take 10+ seconds (and how to hit <555 ms)

**App:** Industry Prime FMS — React (Vite) frontend on Vercel + FastAPI backend on Render + Supabase
**Reviewed:** June 2026 · production slowness
**Target:** any page / dashboard interactive in under 555 ms

---

## Bottom line first

Your frontend and backend code are **already well-optimized**. The 10+ second loads are *not* caused by bad
React or slow queries — they are caused almost entirely by **where the backend is hosted**.

The production backend runs on **Render's free tier** (`ip-internal-manage-software.onrender.com`). On that
tier the container is **put to sleep after ~15 minutes of inactivity**, and the next request has to **cold-start
it — which takes 10–60 seconds**. Every dashboard waits on that first API call, so the whole page feels frozen
for 10+ seconds. Once the server is warm, the same pages load in well under a second.

So this is a **hosting / keep-warm problem, not a code problem.** The single change that gets you from "10+ s
sometimes" to "consistently fast" is making sure the backend never sleeps. Everything else below is a smaller,
secondary win.

---

## What I confirmed is already done well (no action needed)

- **Routes are code-split / lazy-loaded** — each page is its own JS chunk, loaded on demand.
- **Auth is stale-while-revalidate** — the app paints from the stored session immediately and validates in the
  background; it does **not** block dashboards on `/users/me`.
- **Data fetching is deferred and parallel** — dashboards use `requestIdleCallback`, staggered timers,
  `Promise.all`, and a consolidated `/dashboard/bootstrap` endpoint instead of a request waterfall.
- **React Query caching** — `staleTime` 120 s, `gcTime` 600 s, no refetch on focus/mount.
- **Backend caching + batching** — endpoints use in-memory TTL caches (`@cached`), batched `.in_()` lookups
  (not N+1), and parallel lookups via a thread pool.
- **Static asset caching** — `vercel.json` already sets `Cache-Control: immutable` on `/assets/*`.
- **Gzip on the API** (`GZipMiddleware`) and a lightweight `/health` endpoint (no DB) already exist.

The takeaway: there is very little low-hanging fruit left *in the code*. The remaining latency is infrastructure.

---

## Root causes, ranked by impact

### 1. Render free-tier cold start — THE problem (≈ 90% of the 10 s)

Free Render services sleep after ~15 min idle and take **10–60 s to wake**. The in-memory caches on the backend
are also wiped on every wake, so the first load after a sleep re-runs all the heavy queries too. Your own
`RENDER_CRON_503_FIX.md` already documents this exact behavior.

**Fixes (do at least one of the first two):**

| Option | Effort | Result | Notes |
|---|---|---|---|
| **A. Upgrade Render to a paid Starter instance** (~$7/mo) | 2 min, dashboard | **Permanent fix** — no sleep, no cold start | The clean, reliable answer for an internal business tool. |
| **B. Keep it awake with an external pinger** | 5 min, free | Mostly fixes it on free tier | Free tier still has monthly run-hour limits; a pinger keeps it warm during work hours. |
| C. Move backend to a no-cold-start host (Railway, Fly.io) | ~1 hr | Permanent fix | You already have `railway.toml` — Railway doesn't sleep paid services. |

**Option B, step by step (free):**
1. Sign up at **uptimerobot.com** (or **cron-job.org**).
2. Add an **HTTP(s) monitor** → URL `https://ip-internal-manage-software.onrender.com/health` → interval **5 min**.
3. That's it — it keeps the container warm so users never hit a cold start during the day.

> Note: the keep-alive must hit `/health` (it's DB-free and instant). Do **not** point it at a dashboard or
> reminder endpoint.

### 2. Single backend worker

The container runs one `uvicorn` worker. FastAPI runs your sync route handlers in a thread pool, so there's
some concurrency, but under load a few slow requests can queue behind each other. After moving off the free tier
(Option A/C), run **2 workers** (e.g. `uvicorn app.main:app --workers 2`) if the instance has ≥1 GB RAM. Don't do
this on a 512 MB free instance — it can run out of memory.

### 3. Cold caches after every wake

The `@cached` results live in process memory, so a cold start = empty cache = the first user pays full query
cost. Keeping the server warm (#1) largely removes this. A longer-term option is a shared cache (e.g. Redis), but
that's only worth it once the server stops sleeping.

### 4. Front-end bundle (minor — already cached after first visit)

The `antd` JS chunk is **1.2 MB raw (~350 KB gzipped)** and `vendor-charts` is **499 KB**. On a *first* visit
this adds maybe 1–2 s on a slow connection; on repeat visits it's served from cache (`immutable` headers already
set), so it's **not** your 10 s problem. Leave the `antd` chunk as-is — it's already split, and further splitting
risks the circular-chunk issue noted in `vite.config.ts`. The charts chunk only loads on pages that draw charts.

---

## Fix applied in this review (safe, in-repo)

**`fms-frontend/index.html`** — two changes, both non-breaking:

1. **`preconnect` / `dns-prefetch`** to the Render API and Supabase origins, so the DNS + TLS handshake happens
   while the JS bundle is still downloading (saves ~100–300 ms on the first API call).
2. **An ultra-early backend warm-up ping** to `/health`, fired *before the JS bundle even parses*. This starts the
   Render cold-start clock several seconds earlier — overlapping the wake-up with bundle download and auth — so
   the backend is already warming by the time the dashboard asks for data. It's fire-and-forget, `no-cors`, and
   skipped on localhost (dev uses a local backend).

This is a perceived-latency win that complements the real fix (#1). On its own it does **not** make a cold
backend instant — only keeping the server warm does that.

---

## Realistic path to the <555 ms target

| Step | Who | Expected effect |
|---|---|---|
| 1. Keep backend warm (Render Starter **or** UptimeRobot on `/health`) | You (dashboard) | 10 s → ~1 s. **This is 90% of the win.** |
| 2. Warm-up ping + preconnect | ✅ Done in this review | Shaves a few hundred ms off the first call |
| 3. After leaving free tier, run 2 uvicorn workers | You (deploy config) | Smoother under concurrent use |
| 4. (Optional) shared cache so caches survive restarts | Later | Faster first load after any deploy |

With the server kept warm, your already-optimized frontend (cached assets + stale-while-revalidate auth +
deferred fetches) will routinely paint pages in the sub-second range. The 555 ms goal is achievable for *warm*
loads on a good connection; the thing standing between you and it today is purely the sleeping backend.

---

## One thing to double-check yourself

I diagnosed the cold start from the hosting setup and your own `RENDER_CRON_503_FIX.md`. To confirm with your
own eyes: open the site's **DevTools → Network tab**, hard-reload, and look at the **first `/health` or
`/dashboard/bootstrap` request**. If its "Waiting (TTFB)" time is several seconds, that's the cold start — and
keeping the server warm will remove it. If TTFB is fast but the page is still slow, send me that screenshot and
I'll dig into the next layer.
