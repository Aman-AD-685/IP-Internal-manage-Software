# Compound Engineering integration

Open-source plugin: **[EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)** (MIT).

## Status in this repo

Compound Engineering is **enabled** in [`.cursor/settings.json`](../../settings.json):

```json
"plugins": {
  "compound-engineering": { "enabled": true }
}
```

Pre-push uses the Cursor skill **`ce-code-review`** (not the legacy slash alias `ce:review`).

## Agent: detect before pre-push

From repo root:

```powershell
powershell -NoProfile -File .cursor/skills/pre-push-compound-review/scripts/ce-status.ps1
```

| Output | Meaning |
|--------|---------|
| `CE_STATUS=enabled` | Run **`ce-code-review`** (step 2 of pre-push skill) |
| `CE_STATUS=disabled` | Native audit + production smoke only |

## Use with pre-push (mandatory when enabled)

Before `git push`, run **both**:

| Step | Tool | Mode |
|------|------|------|
| 1 | `pre-push-compound-review` | memory + journal + native audit + production smoke |
| 2 | **`ce-code-review`** | **`mode:report-only`** + `base:origin/<tracking-branch>` |
| 2b | **`ponytail-review`** | report-only on same diff (advisory; see [PONYTAIL.md](PONYTAIL.md)) |

**Why report-only:** Pre-push must not auto-edit files. CE findings merge into the pre-push report; P0 still blocks push.

### Invocation (Cursor agent)

1. Read the **`ce-code-review`** skill (Compound Engineering plugin).
2. Run with arguments (replace branch from `git rev-parse --abbrev-ref --symbolic-full-name @{u}` or use `main`):

```text
mode:report-only base:origin/fix/production-frontend-cache
```

Or ask the user’s current upstream:

```powershell
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>$null
# e.g. origin/fix/production-frontend-cache → base:origin/fix/production-frontend-cache
```

3. Merge CE P0/P1 into the Pre-Push Report (dedupe with native audit).

### Pre-Push Report line (use one of these)

- `Compound Engineering: ran (ce-code-review, report-only)`
- `Compound Engineering: skipped (no diff / user asked journal-only)`
- `Compound Engineering: not available (plugin disabled — see ce-status.ps1)`

Do **not** print `not installed` when `ce-status.ps1` returns `CE_STATUS=enabled`.

## Install / enable (other machines)

1. Cursor → Settings → Plugins → install **Compound Engineering**.
2. Set in `.cursor/settings.json`:

```json
{
  "plugins": {
    "compound-engineering": { "enabled": true }
  }
}
```

3. Confirm **`ce-code-review`** appears in agent skills.

Docs: [ce-code-review SKILL](https://github.com/EveryInc/compound-engineering-plugin/tree/main/plugins/compound-engineering/skills/ce-code-review)

## Artifacts

CE may write under `.context/compound-engineering/` — already in `.gitignore`.

## Day-by-day training

CE findings + journal → [memory.md](memory.md). See [TRAINING.md](TRAINING.md).
