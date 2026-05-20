# Client Payment (Raised Invoices) – production checklist

## Why local works but production shows “No data” + “Not Found” on Save

| Environment | What happens |
|-------------|----------------|
| **Local** | `VITE_API_BASE_URL=http://127.0.0.1:8000` → browser talks to **your FastAPI** → same DB as Supabase → data shows ✅ |
| **Production (wrong)** | If `VITE_API_BASE_URL` is **`https://industryprime.vercel.app`** (the **frontend** URL), every API call hits **Vercel**, not Render. Vercel has no `/onboarding/client-payment` → **404 Not Found**. List fails silently → empty table; Save shows **Not Found**. **Data in Supabase is irrelevant** until the browser calls the real backend. |

**Fixes in the app (after redeploy)**

1. **Same-origin guard** — If the API base URL is the same site as the page (e.g. both `industryprime.vercel.app`), the app **automatically uses** `https://ip-internal-manage-software.onrender.com` instead.
2. **`fms-frontend/.env.production`** — default Render URL at build time.
3. **Emergency override** — In `index.html`, set `window.__FMS_API_BASE_URL__ = 'https://YOUR-RENDER.onrender.com'` before the app loads (if your API host is not the default).

**You should still set Vercel correctly**

- **Vercel → Environment Variables → `VITE_API_BASE_URL`** = your **Render** URL only, e.g. `https://ip-internal-manage-software.onrender.com`  
- **Never** set it to `https://industryprime.vercel.app`.

Then **Redeploy Vercel** after changing env or pulling the fixes above.

---

## Why you see **“Not Found”** on Save (Vercel)

The toast **“Not Found”** is almost always **HTTP 404** from your API: the URL your frontend calls does **not** exist on the server that Vercel uses.

Common causes:

1. **Backend (e.g. Render) is an old deploy** – it does not include the routes:
   - `GET/POST /onboarding/client-payment`
   - Same paths work with `/api` prefix: `/api/onboarding/client-payment`
2. **Wrong API URL on Vercel** – `VITE_API_BASE_URL` (or `VITE_API_URL`) must be the **live FastAPI base URL** (no path suffix like `/api` required in env; the app calls `/onboarding/client-payment` on that host).

### Fix (deploy) — **required if you see 404 on Render**

Your screenshot shows:

`POST https://ip-internal-manage-software.onrender.com/onboarding/client-payment → 404`

So the **frontend is correct**; **Render is running an old build** (or wrong service) **without** Client Payment routes.

1. **Check the live API:** open  
   `https://ip-internal-manage-software.onrender.com/openapi.json`  
   and search for **`client-payment`**. If it’s missing, the deployed backend is outdated.
2. **Render → your Web Service → Manual Deploy** from the branch that includes the latest **`backend/app/main.py`** (with `@api_router.post("/onboarding/client-payment")` and `GET` list).
3. Wait until deploy finishes, then try Save again.

The frontend will also **retry once** under `/api/onboarding/client-payment` if the root path returns 404 (some proxies). If both 404, only a new Render deploy fixes it.
3. On **Vercel** → Project → **Environment Variables**:
   - `VITE_API_BASE_URL` = `https://YOUR-BACKEND.onrender.com` (example; **no** trailing slash)
4. **Redeploy Vercel** after changing env vars (they are baked in at build time).

### Quick verification

In the browser (while logged in, or with a token), open:

`https://YOUR-BACKEND.onrender.com/onboarding/client-payment?status=open`

- **200 + JSON `{ "items": [...] }`** → routes are live; if the app still fails, check Vercel API URL.
- **404 Not Found** → backend deploy is still old; redeploy backend.

---

## Why the table is empty

- **No rows yet** – normal after first setup.
- **List always empty** – if `onboarding_client_payment` table is **missing**, the backend catches errors and returns `{ "items": [] }`, so the UI shows no data and Save may also fail differently.
- **All rows “completed”** – open list only shows rows **without** `payment_received_date`. Completed invoices appear under Q-Comp / M-Comp / HF-Comp routes.

---

## What to run in Supabase (order matters)

Run in **SQL Editor**, in this order:

| Step | File | Purpose |
|------|------|---------|
| **1** | `docs/SUPABASE_CLIENT_PAYMENT_CORE.sql` | `onboarding_client_payment`, `onboarding_client_payment_sent`, `onboarding_client_payment_followup1` |
| **2** | `docs/supabase_client_payment_followup_flow.sql` | Follow-ups 1–10, Intercept, Discontinuation, Payment Receive |

After step 1, **Add Raised Invoice** and **list open invoices** should work (with a deployed backend).

---

## Payment Management KPI cards (Quarterly / Monthly / Overall) show **0 / 0**

The three cards at the top of **Payment Management** load from:

`GET /onboarding/client-payment/payment-summary`  
(fallback: `GET /onboarding/client-payment/payment-ageing-report` → `kpis`)

| Symptom | Cause | Fix |
|--------|--------|-----|
| Cards show **0 / 0** but invoices exist | Old Render deploy (no `payment-summary`) or API URL points at Vercel | Redeploy **backend**; set **VITE_API_BASE_URL** to Render; redeploy **frontend** |
| Yellow **Payment summary unavailable** / **Network Error** | Render closes idle connections ~**30s**; old backend scanned the whole invoice table | Redeploy **latest** backend (`payment-summary` uses one combined aggregate scan + capped pages + 60s cache). Frontend timeout **28s**. |
| Request timed out | `payment-summary` still slower than Render limit | Confirm `openapi.json` has `payment-summary`; check row count; redeploy Render + Vercel |
| Works locally, not production | Frontend calling wrong host | See table at top of this doc |

Quick check (logged in): open  
`https://YOUR-BACKEND.onrender.com/onboarding/client-payment/payment-summary`  
→ JSON with `"kpis": { "overall_in_quarter": { "received": …, "raised": … }, … }`.

---

## CORS (if browser blocks API)

Backend must allow your Vercel origin, e.g. in `backend/.env` on Render:

```env
CORS_ORIGIN=https://industryprime.vercel.app
```

(or `CORS_ORIGINS` comma-separated list including that URL)

Restart/redeploy backend after changing env.

---

## Payment Action (Master Admin dashboard → Client Payment drawer)

Run **`docs/SUPABASE_CLIENT_PAYMENT_PAYMENT_ACTION.sql`** in Supabase so the intercept table has `payment_action_person`, `payment_action_remarks`, `payment_action_submitted_at`, `payment_action_submitted_by`. Without this, dashboard **Payment Action** or **Submit** may fail against the database.
