# Render keep-alive setup (fix cold start)

Render **free / sleep-enabled** services stop after ~15 minutes of no traffic. The first request after sleep can take **30–60 seconds**. Pinging **`/health` every 5–10 minutes** keeps the instance warm.

**Production backend URL (this repo):**

```text
https://ip-internal-manage-software.onrender.com/health
```

Expected response: `{"status":"ok",...}` with HTTP **200**.

---

## Option A — GitHub Action (recommended, already in repo)

### What it does

Workflow file: [`.github/workflows/render-keepalive.yml`](../.github/workflows/render-keepalive.yml)

- Runs **every 5 minutes** on GitHub’s servers
- `GET` your Render `/health` endpoint
- Also runnable manually: **Actions → Render keep-alive → Run workflow**

### One-time setup (2 minutes)

1. Push this repo to GitHub (workflow must be on **`main`** or your default branch).
2. Open the repo on GitHub → **Settings** → **Actions** → **General**.
3. Under **Workflow permissions**, allow actions (read is enough; no secrets required).
4. Confirm **Actions** tab shows **Render keep-alive** (first run may take up to 5 minutes).
5. Optional: **Settings → Secrets and variables → Actions → Variables**
   - Name: `RENDER_HEALTH_URL`
   - Value: `https://YOUR-SERVICE.onrender.com/health`  
   (Use this if your Render URL is not the default above.)

### Verify it works

1. **Actions** → **Render keep-alive** → latest run → green check.
2. Leave the app idle 20 minutes, then open the FMS dashboard — first API call should be **fast** (not 30–60s).

### Notes

| Topic | Detail |
|--------|--------|
| Forks | Scheduled workflows may be disabled until enabled in **Actions**. |
| Private repos | Scheduled workflows need GitHub plan that includes Actions minutes. |
| Cost | One lightweight `curl` every 5 min ≈ negligible. |
| Render logs | You will see periodic `GET /health` from GitHub IPs — normal. |

---

## Option B — cron-job.org (no GitHub Actions)

Use this if you prefer an external cron or GitHub Actions are disabled.

### One-click style setup

1. Open **[https://cron-job.org](https://cron-job.org)** and create a free account.
2. **Cronjobs** → **Create cronjob**.
3. Fill in:

| Field | Value |
|--------|--------|
| **Title** | `FMS Render keep-alive` |
| **URL** | `https://ip-internal-manage-software.onrender.com/health` |
| **Schedule** | Every **5** minutes (or “Every 5 minutes” preset) |
| **Request method** | **GET** |
| **Timeout** | **90** seconds (cold wake can be slow once) |
| **Enabled** | On |

4. Save → **Run now** once → check **History** shows **200** and body contains `"status":"ok"`.

### Optional alerts

- Enable **Notify on failure** (email) if a ping returns non-200 for several runs.

---

## Option C — UptimeRobot (monitoring + keep-alive)

1. [https://uptimerobot.com](https://uptimerobot.com) → Add monitor.
2. Type: **HTTP(s)**.
3. URL: `https://ip-internal-manage-software.onrender.com/health`.
4. Interval: **5 minutes** (free tier).
5. Save.

---

## Option D — Render always-on (paid)

Upgrade the Render web service to a plan that **does not spin down** on idle. No external ping needed. This is the only option that guarantees **zero** sleep without periodic traffic.

---

## Which option to pick?

| Situation | Use |
|-----------|-----|
| Code already on GitHub | **Option A** (workflow in repo) |
| No Actions / fork restrictions | **Option B** cron-job.org |
| Want downtime alerts too | **Option C** UptimeRobot |
| Production SLA / budget | **Option D** paid Render |

You can run **A + B** together (redundant pings are harmless).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| First load still 30–60s | Confirm pings every **≤10 min**; check Render **Logs** for `GET /health`. |
| 404 on `/health` | Redeploy latest `backend/app/main.py` (routes `/health` and `/api/health`). |
| 502 / timeout on ping | Render waking — increase cron timeout to **90s**; retry. |
| GitHub Action fails | Set variable `RENDER_HEALTH_URL` to exact health URL; run workflow manually once. |

---

## Related docs

- [FAST_LOAD_AND_LOAD_BALANCER.md](FAST_LOAD_AND_LOAD_BALANCER.md) — bootstrap API + load balancer
- [PERFORMANCE_OPTIMIZATION.md](PERFORMANCE_OPTIMIZATION.md) — DB indexes and backend optimizations
- [CONNECTION_FAILED_FIX.md](../CONNECTION_FAILED_FIX.md) — mentions free-tier sleep
