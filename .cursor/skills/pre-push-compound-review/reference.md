# Pre-Push Audit Reference (full checklist)

Use during step 3 of [SKILL.md](SKILL.md). Severity: **P0** = block push, **P1** = should fix, **P2/P3** = document.

## Security

- Exposed `.env` / API keys / service role in client bundle
- Hardcoded secrets in `main.py`, frontend, SQL seeds
- CORS `*` or missing origin allowlist in production
- SQL injection via string-built queries (prefer parameterized Supabase/ORM)
- XSS: `dangerouslySetInnerHTML`, unsanitized user HTML in emails
- Missing `Depends(get_current_user)` on new routes
- Public admin routes; RBAC only checked client-side
- Sensitive data in logs (`backend_errors.log` committed)
- Open redirects in auth/email links
- Missing rate limits on expensive endpoints
- Supabase RLS gaps on new tables
- Unsafe file uploads; missing validation

## Frontend performance (`fms-frontend/`)

- Large sync imports; missing `React.lazy` / route splitting
- Waterfall API calls on page mount
- Missing pagination on large tables
- `useEffect` chains without deps discipline → loops
- Unmemoized heavy lists (TicketList, dashboards)
- No request timeout on slow KPI endpoints
- Wrong production API base URL
- Blocking images/assets; layout shift

## Backend performance (`backend/app/`)

- Full-table `select("*")` without limit on tickets/payments
- N+1 Supabase calls in enrichment loops
- Missing DB indexes (see `database/migrations/`)
- Sync blocking in async routes
- Large JSON payloads; no pagination
- Cache stampede / stale cache after mutations (invalidate keys)
- Cron/reminder jobs without idempotency

## Code quality

- Dead code, unused imports, `console.log` in production paths
- Duplicate filter logic (extract shared helper — but avoid over-abstraction)
- Functions >150 lines touched by change
- Circular imports
- Unreachable branches

## Dependencies

- Run `npm audit` / `pip audit` when lockfiles change
- Unused heavy packages
- Duplicate libraries (two date libs, etc.)

## DevOps & production

- Render: env vars documented; not pointing frontend URL as API
- Vercel: `VITE_*` set for production
- Supabase: migrations run; PostgREST schema reload after column adds
- GitHub Actions: no secrets in logs; least privilege tokens
- Cron safety: duplicate sends, timezone

## Repository-specific landmines (verify on touch)

- Payment summary: aggregate timeouts on Render (~30s)
- Performance Monitoring / Support NA: exclude filters in KPI + list APIs
- Ticket `status_2='na'`: must not appear in default KPI counts
- Escalation emails: demo company exclusion still applied

## Auto-cleanup

Suggest deletion only when:

- No imports/references (grep confirmed)
- Not referenced by routes, SQL, or docs
- User workflow unchanged

Explain: why unused, impact of removal, dependencies.
