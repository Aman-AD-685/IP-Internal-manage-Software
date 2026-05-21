# SEO step-by-step (no custom domain)

Your live URL today: **`https://industryprime.vercel.app`**  
Stack: **Vite + React (SPA)** — not Next.js. Google mostly sees **`index.html`** for all routes unless you add a marketing site or SSR later.

---

## What you can rank for (realistic)

| Goal | Realistic? |
|------|------------|
| Branded search: **industryprime**, **Industry Prime FMS** | Yes (with GSC + README + backlinks) |
| Generic: “ticket management software”, “manufacturing ERP” | Hard (competitors, thin public pages, login wall) |
| Indexing **dashboard / tickets** URLs | No — same SPA shell; content loads after login + JS |

Treat SEO as **brand discovery + trust**, not thousands of product pages.

---

## Production SEO scores (this repo today)

| Area | Score | Notes |
|------|-------|--------|
| Technical SEO | **78/100** | Strong `index.html` meta, canonical, robots, sitemap; SPA limits |
| Core Web Vitals | **70/100** | Improved API/bootstrap; depends on Render warm + Vercel CDN |
| Indexability | **62/100** | 1–2 public URLs; app behind auth |
| Structured data | **80/100** | WebApplication + Organization; FAQ added in index |
| Mobile SEO | **85/100** | viewport, responsive Ant Design |
| Security signals | **75/100** | HTTPS on Vercel; headers in `vercel.json` |
| SaaS discoverability | **55/100** | No public feature landing pages yet |

**Production blockers:** None critical for deploy. **Before expecting Google traffic:** complete **Part 2** (Search Console) below.

---

## PART 1 — You already have (in code)

These files are in the repo — redeploy **Vercel** after changes:

| File | Purpose |
|------|---------|
| `fms-frontend/index.html` | Title, description, canonical, OG, Twitter, JSON-LD, GSC verification meta |
| `fms-frontend/public/robots.txt` | Allow crawl + sitemap URL |
| `fms-frontend/public/sitemap.xml` | URLs for Google |
| `fms-frontend/vercel.json` | SPA rewrite + cache + security headers |
| `README.md` | Brand keywords for GitHub + search snippets |

**Canonical URL (no custom domain):** always use  
`https://industryprime.vercel.app/`  
Do not mix `www` or `http`.

---

## PART 2 — Google Search Console (no domain required)

Use a **URL prefix** property (works on `*.vercel.app`). **Do not** use “Domain” property — you have no DNS for a root domain.

### Step 1 — Open Search Console

1. Go to [https://search.google.com/search-console](https://search.google.com/search-console)
2. Sign in with the Google account you want for Industry Prime.

### Step 2 — Add property

1. Click **Add property**.
2. Choose **URL prefix** (right side), **not** “Domain”.
3. Enter exactly:  
   `https://industryprime.vercel.app`
4. Click **Continue**.

### Step 3 — Verify ownership (HTML tag — no DNS)

1. Select **HTML tag** verification.
2. Google shows a meta tag like:  
   `content="XXXXXXXX"`
3. Compare with `fms-frontend/index.html` line `google-site-verification`.
4. If different: copy Google’s **full content value** → update `index.html` → commit → push → **redeploy Vercel** → wait 2–5 min → click **Verify** in GSC.
5. **Do not** use DNS verification on `vercel.app` — you cannot add TXT on Vercel’s subdomain.

### Step 4 — Submit sitemap

1. In GSC: **Indexing → Sitemaps**.
2. Submit: `sitemap.xml`  
   (full URL: `https://industryprime.vercel.app/sitemap.xml`)
3. Status should become **Success** (may take hours).

### Step 5 — Request indexing (homepage)

1. **URL inspection** → paste `https://industryprime.vercel.app/`
2. Click **Test live URL** → then **Request indexing** (if offered).
3. Repeat for `https://industryprime.vercel.app/login` if you want login page indexed.

### Step 6 — Monitor (weekly)

| Report | What to watch |
|--------|----------------|
| **Pages** | Indexed vs not indexed |
| **Performance** | Queries: industryprime, Industry Prime |
| **Core Web Vitals** | LCP, INP, CLS on real users |
| **HTTPS** | Should be clean on Vercel |

---

## PART 3 — Vercel (frontend)

1. [https://vercel.com](https://vercel.com) → your project → **Deployments** → latest = green.
2. **Settings → Environment Variables**  
   - `VITE_API_BASE_URL` = `https://ip-internal-manage-software.onrender.com` (no trailing slash)
3. **Settings → Domains**  
   - You should see `industryprime.vercel.app` (default). No custom domain needed for SEO to start.
4. After each git push to the connected branch, Vercel auto-deploys.

**Test:**

```text
https://industryprime.vercel.app/robots.txt
https://industryprime.vercel.app/sitemap.xml
https://industryprime.vercel.app/logo.png
```

---

## PART 4 — Render (backend — indirect SEO)

SEO needs fast API (Core Web Vitals):

1. Enable **Render keep-alive**: see [RENDER_KEEPALIVE_SETUP.md](RENDER_KEEPALIVE_SETUP.md)  
   (GitHub Action `render-keepalive.yml` — no cron-job.org required if Actions are green).
2. Redeploy backend after pushes.

---

## PART 5 — Optional: cron-job.org

**Only if** GitHub Action keep-alive fails. See [RENDER_KEEPALIVE_SETUP.md](RENDER_KEEPALIVE_SETUP.md) Option B.  
**Not required for SEO indexing** — only for speed / cold start.

---

## PART 6 — When you buy a domain later

1. Buy domain (e.g. `industryprime.com`).
2. Vercel → **Domains** → Add domain → follow DNS instructions.
3. Replace **every** `https://industryprime.vercel.app` in:
   - `fms-frontend/index.html`
   - `fms-frontend/public/robots.txt`
   - `fms-frontend/public/sitemap.xml`
4. Redeploy Vercel.
5. GSC → add **Domain** property OR new URL prefix → verify via DNS → submit sitemap again → set **301** from old Vercel URL if needed.

---

## PART 7 — Grow rankings (no domain)

| Action | Why |
|--------|-----|
| GitHub README (done) | Ranks for repo name + brand |
| LinkedIn / company site link to Vercel URL | Backlinks |
| Product Hunt / DEV.to post | Brand + link |
| YouTube / docs with same name “Industry Prime FMS” | Entity match |
| Keep site **public** login page (no sitewide login wall for `/`) | Crawlers see meta |

**Do not** expect page 1 for “CRM software” without public marketing pages and backlinks.

---

## PART 8 — Future SEO upgrades (bigger projects)

| Upgrade | SEO benefit |
|---------|-------------|
| Public **marketing site** (`/`, `/features`, `/pricing`) with SSR or static HTML | Index many keywords |
| `react-helmet-async` per public route | Unique titles/descriptions |
| Prerender plugin for `/` and `/login` | Crawlers see real HTML |
| Custom domain + blog | Authority |
| `noindex` on authenticated routes (meta via app) | Avoid thin duplicate URLs |

---

## Quick checklist (print this)

- [ ] Vercel live at `https://industryprime.vercel.app`
- [ ] `robots.txt` and `sitemap.xml` open in browser
- [ ] GSC URL prefix property added
- [ ] HTML tag verification **Success**
- [ ] Sitemap submitted **Success**
- [ ] URL inspection → request indexing for `/`
- [ ] Render keep-alive Action green
- [ ] PageSpeed Insights run once on homepage URL

---

## Tools to run yourself

1. [PageSpeed Insights](https://pagespeed.web.dev/) → enter `https://industryprime.vercel.app`
2. [Rich Results Test](https://search.google.com/test/rich-results) → paste homepage URL
3. [Mobile-Friendly Test](https://search.google.com/test/mobile-friendly)

---

## Support

SEO files live under `fms-frontend/`. Performance: [FAST_LOAD_AND_LOAD_BALANCER.md](FAST_LOAD_AND_LOAD_BALANCER.md).
