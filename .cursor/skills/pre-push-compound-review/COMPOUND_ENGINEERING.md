# Compound Engineering integration

Open-source plugin: **[EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)** (MIT).

## Install in Cursor

1. Open Cursor Settings → Features → Plugins (or follow plugin README).
2. Install **Compound Engineering** from the marketplace / plugin repo.
3. Confirm skill **`ce:review`** is available.

Docs: [ce-review SKILL](https://github.com/EveryInc/compound-engineering-plugin/blob/main/plugins/compound-engineering/skills/ce-review/SKILL.md)

## Use with pre-push (this repo)

Before `git push`, run **both**:

| Step | Tool | Mode |
|------|------|------|
| 1 | `pre-push-compound-review` (this skill) | Full repo + stack context + memory |
| 2 | `ce:review` | **`mode:report-only`** + `base:origin/fix/production-frontend-cache` (or your tracking branch) |

**Why report-only:** Pre-push must not auto-edit files. CE findings merge into the pre-push report; P0 still blocks push.

Example CE invocation (Cursor agent):

```text
ce:review mode:report-only base:origin/fix/production-frontend-cache
```

## Optional: GitPreflight hook

For hook-based reminders (no AI), see [un/gitPreflight](https://github.com/un/gitPreflight).
This project relies on **Cursor agent + this skill** as the primary gate.

## Artifacts

CE may write under `.context/compound-engineering/ce-review/` — add to `.gitignore` if not already.

## Day-by-day training

CE findings + your journal → [memory.md](memory.md). See [TRAINING.md](TRAINING.md).
