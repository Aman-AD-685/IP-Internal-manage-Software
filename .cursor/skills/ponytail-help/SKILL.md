---
name: ponytail-help
description: >-
  Ponytail quick reference (DietrichGebert/ponytail). Display when user says
  ponytail help, what ponytail commands, or how do I use ponytail.
---

# Ponytail Help — Cursor (this repo)

> Upstream: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) · full README install section for Claude Code / Codex / etc.

## Installed (Cursor instruction-only adapter)

| File | Role |
|------|------|
| `.cursor/rules/ponytail.mdc` | Always-on lazy dev rule (full mode) |
| `AGENTS.md` | Compact rules for Codex / other instruction agents |
| `.cursor/skills/ponytail/SKILL.md` | Main mode skill |
| `.cursor/skills/ponytail-review/SKILL.md` | Diff over-engineering review |
| `.cursor/skills/ponytail-audit/SKILL.md` | Whole-repo audit |
| `.cursor/skills/pre-push-compound-review/PONYTAIL.md` | Pre-push + implementation hooks |

**Cursor has no `/ponytail` slash menu** — say commands in chat (see below).

## The ladder

1. Does this need to exist? → no: skip (YAGNI)
2. Already in this codebase? → reuse
3. Stdlib does it? → use it
4. Native platform feature? → use it
5. Installed dependency? → use it
6. One line? → one line
7. Only then: minimum that works

## Say in chat

| Phrase | Action |
|--------|--------|
| `ponytail lite` / `full` / `ultra` / `off` | Change intensity |
| `stop ponytail` / `normal mode` | Disable |
| `ponytail review` | Diff review |
| `ponytail audit` | Repo-wide audit |
| `ponytail help` | This card |

## Levels

| Level | What changes |
|-------|----------------|
| **lite** | Build asked; note lazier alt in one line |
| **full** | Ladder enforced (default) |
| **ultra** | YAGNI extremist |

## Pre-push & implementation

- **Pre-push:** ponytail-review on push diff (step 2b in pre-push skill)
- **After fix/build/write/create:** ponytail-review on session diff before done

## Update from upstream

```powershell
git clone --depth 1 https://github.com/DietrichGebert/ponytail.git $env:TEMP\ponytail
# Refresh: .cursor/rules/ponytail.mdc, AGENTS.md, .cursor/skills/ponytail*/SKILL.md
```

More: https://github.com/DietrichGebert/ponytail
