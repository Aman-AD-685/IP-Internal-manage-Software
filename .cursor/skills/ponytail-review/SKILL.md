---
name: ponytail-review
description: >-
  Over-engineering diff review from DietrichGebert/ponytail. Finds what to delete:
  reinvented stdlib, unneeded deps, speculative abstractions, dead flexibility.
  MANDATORY after any user-requested fix, build, implement, add, update, create,
  write, wire, or refactor that changes code — review the session diff before
  finishing. Also use for pre-push, PR review, or when the user asks ponytail-review,
  simplify review, what can we delete, or is this over-engineered. Complements
  ce-code-review (correctness/security); this skill hunts complexity only.
---

# Ponytail review

> Upstream: [DietrichGebert/ponytail — skills/ponytail-review](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-review/SKILL.md) (MIT).

Review diffs for unnecessary complexity. One line per finding: location, what to cut, what replaces it. The diff's best outcome is getting shorter.

**While writing, climb the ladder** (`.cursor/rules/ponytail.mdc`): exist? → reuse codebase → stdlib → native → installed dep → one line → minimum.

## When to run

- **After implementation (mandatory):** user asked to fix, build, implement, add, update, create, write, wire, refactor, or change code — review **your session diff** before marking the task done.
- User asks: ponytail review, over-engineering review, what can we delete, simplify this diff.
- **Pre-push:** after `collect-push-scope.ps1`, on the same diff as `ce-code-review` (report-only; do not auto-apply cuts unless user preference below).
- **PR / branch review:** `git diff origin/<base>...HEAD` or staged + unstaged scope.

**Skip only when:** pure Q&A with no code edits, user said report-only / skip ponytail, or diff is empty.

**After implementation:** apply obvious safe cuts in the same session (dead code, one-off helpers, duplicate util). Larger refactors → list in review, ask before applying.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary..."

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with: `net: -<N> lines possible.`

If nothing to cut: `Lean already. Ship.` and stop.

## Boundaries

- Scope: over-engineering and complexity **only**. Correctness, security, and performance → route to `ce-code-review` or native pre-push audit.
- A single smoke test or `assert`-based self-check is the ponytail minimum — never flag it for deletion.
- **Does not apply fixes** — lists findings only (unless user explicitly asks to implement cuts).
- Pre-push: Ponytail findings are **advisory (P2/P3)** unless the user asked to block on bloat. Do not block push on ponytail alone.
- **After implementation:** include review in the final reply; apply small safe cuts without asking.

## Implementation reply block (required after fix/build/write/create)

Append to your final message when you changed code:

```markdown
### Ponytail review
- Status: ran | skipped (no diff) | skipped (Q&A only)
- Net removable: -<N> lines possible | Lean already. Ship.
- Cuts applied: <none | brief list>
- Remaining (optional): up to 3 one-liners if not applied
```

## Pre-push report block (required when run)

```markdown
## Ponytail review (over-engineering)
- Status: ran | skipped (no diff) | skipped (user asked journal-only)
- Findings: <count>
- Net removable: -<N> lines possible | Lean already. Ship.
- Top cuts: (up to 5 one-liners)
```
