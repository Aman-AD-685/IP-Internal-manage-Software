# How day-by-day data trains the reviewer

Three layers work together:

```
daily-journal/YYYY-MM-DD.md  →  raw timeline (what you did each day)
memory.md                    →  distilled rules (accepted / rejected / landmines)
pre-push audit               →  uses both + git diff every push
```

## Layer 1 — Daily journal (raw)

- **Path:** [daily-journal/](daily-journal/)
- **Updated:** After pushes, deploys, big fixes, or end of Cursor session
- **Contains:** Tasks, files, your feedback, deploy notes, lessons

Run for git facts:

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/summarize-day.ps1
```

Quick append:

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/append-daily-log.ps1 -Section "Work completed" -Message "Fixed payment KPI timeout on Render"
```

## Layer 2 — Memory (distilled)

- **Path:** [memory.md](memory.md)
- **Updated:** When patterns repeat or user accepts/rejects advice
- **Sections:** Accepted patterns, Rejected suggestions, Repository landmines, Coding style, **Training synthesis**

**Training synthesis** = weekly merge from last 7 journal files (agent does this proactively on Mondays or when user says "sync training").

## Layer 3 — Pre-push audit (enforcement)

Reads **today + last 3 journal days** + **memory.md** before scoring and blocking push.

### Automatic 7-step gate (every `git push` — no skips)

| Step | What runs | Train / document |
|------|-----------|------------------|
| **0** | Read **memory.md** + **SKILL.md** + today’s journal + last 3 days | Apply accepted patterns; never repeat rejected advice |
| **1** | `collect-push-scope.ps1` | Know exact diff |
| **2** | `ce-status.ps1` → **`ce-code-review mode:report-only`** `base:origin/<branch>` | CE findings merged into report |
| **3** | Native audit ([reference.md](reference.md)) | Security, perf, maintainability, scalability |
| **4** | Production smoke ([memory.md](memory.md) table) | `npm run build`, backend import, KPI smoke if KPI touched |
| **5** | Print **Pre-Push Report** (scores + test table + verdict) | User sees production-level proof |
| **6** | Append **daily-journal** + update **memory.md** if new lesson | Next push learns from this session |
| **7** | `git push` only if **Production Push Safe** | Block on P0 / staged secrets |

Agent must complete steps 0–6 before step 7. After push, remind Supabase index SQL if deploy-related.

## What gets learned

| Signal in journal | Becomes in memory |
|-------------------|-------------------|
| User accepted fix | Accepted pattern |
| User rejected suggestion | Rejected suggestion |
| Same mistake twice | Repository landmine |
| Preferred branch/deploy flow | Coding style / DevOps note |
| New module you own often | Audit priority in reference.md touch list |

## Your part

Add bullets anytime under **User feedback** in today's journal, e.g.:

- `Accepted: use 28s timeout on payment KPI`
- `Rejected: split main.py now — too large a refactor`

The agent must honor these on the next review.
