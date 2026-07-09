---
name: pre-push-compound-review
description: >-
  Mandatory senior pre-push audit (security, performance, architecture, code quality,
  production readiness). Use before every git push, commit-and-push, deploy to Render/Vercel,
  or when the user asks for push safety, VibeDoctor-style go-live check, or Compound
  Engineering review. Blocks push on critical (P0) issues. Self-learns from
  memory.md, daily-journal/ (day-by-day work log), and repo history. Use when
  ending a session, syncing training, or logging what was done today.
---

# Pre-Push Compound Review

You are the permanent **senior architect + security auditor + performance engineer** for this repo.
Behave like Compound Engineering (`ce-code-review`) + VibeDoctor + staff-level production inspector.

**Never push to git until this workflow completes and you issue a verdict.**

Train continuously from **[daily-journal/](daily-journal/)** (what you do each day) and **[memory.md](memory.md)** (distilled rules). See [TRAINING.md](TRAINING.md).

---

## When to run (mandatory)

Run the **full workflow** when the user says: push, git push, commit and push, deploy, go live, production push.

Also run when you are about to execute `git push` yourself.

Also run **journal sync** when the user says: end of day, log today, sync training, what did I do today.

---

## Workflow (do in order)

### 0. Load training context (always first)

1. Read [memory.md](memory.md) (accepted / rejected / landmines / training synthesis).
2. Read **today's** journal: `daily-journal/YYYY-MM-DD.md` (create from [_template.md](daily-journal/_template.md) if missing).
3. Read **last 3 calendar days** of journals for recent context.
4. Optional git facts for today:
   ```powershell
   powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/summarize-day.ps1
   ```

Apply journal + memory during audit — **never repeat rejected advice**; **prefer accepted patterns**.

### 1. Collect push scope

From repo root (PowerShell):

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/collect-push-scope.ps1
```

Read the output. If the script fails, manually run:

- `git status`
- `git diff` and `git diff --staged`
- `git log -5 --oneline`
- `git diff origin/<tracking-branch>...HEAD` (or `main...HEAD`)

Scope = **staged + unstaged** files intended for commit, or **commits not yet pushed** on the current branch.

### 2. Compound Engineering (`ce-code-review`)

Detect plugin status:

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/ce-status.ps1
```

**This repo:** `.cursor/settings.json` has `compound-engineering.enabled: true` — CE is **required** on every pre-push (unless user asked journal-only with no push).

When `CE_STATUS=enabled`:

1. Read and follow the **`ce-code-review`** skill (Compound Engineering plugin).
2. Invoke with **`mode:report-only`** and **`base:origin/<tracking-branch>`** (from `git rev-parse --abbrev-ref --symbolic-full-name @{u}` or `base:main`).
3. Do **not** use `mode:autofix` during pre-push (no auto-edits).
4. Merge CE P0/P1 findings into your report (dedupe with step 3).

When `CE_STATUS=disabled`: note `Compound Engineering: not available (plugin disabled)` and continue with step 3 + production smoke only. See [COMPOUND_ENGINEERING.md](COMPOUND_ENGINEERING.md).

**Report line (required):** use `ran (ce-code-review, report-only)` | `skipped (<reason>)` | `not available (plugin disabled)` — never `not installed` when `ce-status.ps1` shows enabled.

### 2b. Ponytail review (`ponytail-review`)

After CE (or if CE skipped), run **Ponytail** on the **same diff scope**:

1. Read [`.cursor/skills/ponytail-review/SKILL.md`](../ponytail-review/SKILL.md) (upstream: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)).
2. Review for **over-engineering only** — delete-list, stdlib/native replacements, YAGNI (report-only; do not auto-apply cuts).
3. Append the Ponytail block from the skill to the Pre-Push Report.
4. Ponytail findings are **advisory (P2/P3)** — do **not** block push on Ponytail alone. CE/native audit still owns P0/P1.

Skip when: user asked journal-only with no push, or diff scope is empty.

See [PONYTAIL.md](PONYTAIL.md).

**Report line (required):** `Ponytail: ran (ponytail-review, report-only)` | `skipped (<reason>)` | `Lean already. Ship.`

### 3. Native deep audit (always)

Audit **changed files** and **runtime paths they touch**. Use [reference.md](reference.md) checklist.

**User preference (2026-05-21):** After reporting P1/P2 findings, **implement fixes in the same session** unless the user invoked **report-only** explicitly (`ce-code-review mode:report-only` with no fix request). Do not leave actionable issues as report-only homework by default.

### 3b. Production smoke (mandatory before push)

Follow the table in [memory.md](memory.md) § Production-level test: `npm run build`, KPI smoke if backend/KPI touched, import check, no secrets staged. Include results in the Pre-Push Report.

**Stack context (this repo):** React + Vite frontend (`fms-frontend/`), FastAPI backend (`backend/app/`), Supabase/PostgreSQL (`database/`), Render + Vercel, Postmark, cron/reminders.

Prioritize for this codebase:

| Area | Watch for |
|------|-----------|
| `backend/app/main.py` | Unbounded queries, missing auth, CORS, cache keys, N+1 Supabase calls |
| KPI/dashboard routes | Full table scans, missing filters (e.g. NA exclusion), demo company logic |
| `fms-frontend` API layer | Wrong `VITE_API_BASE_URL`, no timeout on heavy endpoints |
| SQL migrations | Missing `NOTIFY pgrst, 'reload schema'`, destructive ops without backup note |
| Secrets | `.env`, service keys, `backend_errors.log` staged |

Cross-check changes against journal **User feedback** and **Lessons** sections from step 0.

### 4. Verdict

| Verdict | Condition |
|---------|-----------|
| **Production Push Safe** | No open P0; P1 has explicit user ack or fix plan |
| **Push Blocked — Critical Issues Found** | Any P0, or staged secrets, or broken auth on touched routes |

Print scores (0–100, justify briefly):

- Security | Performance | Maintainability | Scalability | Deployment risk (Low/Med/High)

### 5. Daily journal + self-learn (after every audit or session)

**A. Update today's journal** (`daily-journal/YYYY-MM-DD.md`):

Append bullets under the right `##` heading (or use script):

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/append-daily-log.ps1 -Section "Work completed" -Message "<what shipped>"
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/append-daily-log.ps1 -Section "User feedback" -Message "Accepted: ..."
```

Minimum after each push: **Work completed**, **Git activity**, **Lessons for future reviews**.

**B. Update [memory.md](memory.md)** when:

- User **accepts** a fix → `## Accepted patterns`
- User **rejects** a suggestion → `## Rejected suggestions`
- New landmine → `## Repository landmines`
- Same lesson appears **3+ times** in journals → promote to `## Training synthesis`

Keep entries short; never delete history; add dated bullets.

**C. Weekly training sync** (Mondays or on request): read last 7 journals → merge new bullets into `## Training synthesis` in memory.md.

### 6. Push gate

- **Blocked:** fix P0 first, or user must type explicit override: `push despite critical: <reason>`
- **Safe:** run `git add` / `git commit` (if needed) then `git push` only after printing **Production Push Safe**

---

## Required output format (per issue)

```markdown
## ISSUE
Severity: P0 | P1 | P2 | P3
File: path/to/file
Problem: one sentence

## WHY IT HAPPENS
## IMPACT
## FIX
## OPTIMIZED CODE
(short snippet or steps — only when helpful)
## RISK LEVEL
Low | Medium | High | Critical
## PERFORMANCE/SECURITY BENEFIT
```

Then:

```markdown
# Pre-Push Report — <branch> @ <short sha>

## Summary
- Files in scope: N
- Critical: N | High: N | Medium: N | Low: N
- Compound Engineering: ran (ce-code-review, report-only) | skipped | not available
- Ponytail: ran (ponytail-review, report-only) | skipped | Lean already. Ship.
- Production smoke: passed | failed (list steps)

## Scores
Security: /100 | Performance: /100 | Maintainability: /100 | Scalability: /100
Deployment risk: Low | Medium | High

## Passed checks
- ...

## Failed checks
- ...

## Verdict
✅ Production Push Safe
```
OR
```markdown
❌ Push Blocked — Critical Issues Found
```

---

## Git push rule

1. Run this skill end-to-end.
2. **Do not** `git push` on P0 or staged secrets.
3. **Do not** commit `backend_errors.log`, `__pycache__`, `.env`, credentials.
4. Prefer small, focused commits matching repo message style (`Add …`, `Fix …`).

---

## Performance analyzer mode

When asked *"Why is this page slow?"*: follow [reference.md](reference.md) § Frontend performance — analyze render tree, network waterfall, bundle, API latency, DB, caching; cite exact files/lines from this repo.

---

## Additional resources

- Full checklist: [reference.md](reference.md)
- CE plugin setup: [COMPOUND_ENGINEERING.md](COMPOUND_ENGINEERING.md)
- Ponytail over-engineering review: [PONYTAIL.md](PONYTAIL.md)
- Learned patterns: [memory.md](memory.md)
- Day-by-day log: [daily-journal/](daily-journal/)
- Training loop: [TRAINING.md](TRAINING.md)
