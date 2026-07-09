# Ponytail integration

Open-source: **[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)** (MIT).

## Cursor install (this repo — done)

Cursor uses the **instruction-only adapter** (no `/plugin` install; no Node hooks required):

| Artifact | Path |
|----------|------|
| Always-on rule (full mode) | [`.cursor/rules/ponytail.mdc`](../../rules/ponytail.mdc) |
| Compact rules (Codex / others) | [`AGENTS.md`](../../../AGENTS.md) |
| Main skill | [`.cursor/skills/ponytail/SKILL.md`](../ponytail/SKILL.md) |
| Diff review | [`.cursor/skills/ponytail-review/SKILL.md`](../ponytail-review/SKILL.md) |
| Repo audit | [`.cursor/skills/ponytail-audit/SKILL.md`](../ponytail-audit/SKILL.md) |
| Help card | [`.cursor/skills/ponytail-help/SKILL.md`](../ponytail-help/SKILL.md) |

Upstream pin: `8e69b4a` (refresh via clone — see ponytail-help).

### The ladder (always apply before writing code)

1. Does this need to exist? → no: skip (YAGNI)
2. Already in this codebase? → reuse, don't rewrite
3. Stdlib does it? → use it
4. Native platform feature? → use it
5. Installed dependency? → use it
6. One line? → one line
7. Only then: the minimum that works

### Say in chat (Cursor has no slash commands)

| Phrase | Skill |
|--------|--------|
| `ponytail review` | ponytail-review |
| `ponytail audit` | ponytail-audit |
| `ponytail help` | ponytail-help |
| `ponytail lite` / `ultra` / `off` | ponytail mode |

Other hosts (Claude Code, Codex, Copilot CLI, etc.): see [upstream README Install](https://github.com/DietrichGebert/ponytail#install).

## Use with pre-push (mandatory on push)

| Step | Tool | Mode |
|------|------|------|
| 2b | **ponytail-review** | report-only on push diff |

Advisory P2/P3 — does not block push alone.

## Use after any implementation (mandatory)

When user asks to **fix / build / implement / add / update / create / write / wire / refactor / change** code:

1. Climb the ladder while writing (`.cursor/rules/ponytail.mdc`).
2. Before finishing, run **ponytail-review** on session diff.
3. Include Implementation reply block; apply small safe cuts.

## Uninstall (Cursor)

Delete:

- `.cursor/rules/ponytail.mdc`
- `AGENTS.md` (only if added solely for Ponytail)
- `.cursor/skills/ponytail/`, `ponytail-review/`, `ponytail-audit/`, `ponytail-help/`
- Remove Ponytail steps from pre-push skill/rule

## Training

Accepted cuts → [memory.md](memory.md) `## Accepted patterns`. Rejected → `## Rejected suggestions`.
