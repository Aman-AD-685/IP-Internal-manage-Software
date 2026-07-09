---
name: ponytail-audit
description: >-
  Whole-repo Ponytail audit for over-engineering (DietrichGebert/ponytail).
  Ranked delete-list across the codebase. Use for ponytail-audit, audit for
  over-engineering, find bloat, what can I delete from this repo.
---

# Ponytail audit

> Upstream: [skills/ponytail-audit/SKILL.md](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-audit/SKILL.md) (MIT).

ponytail-review, repo-wide. Scan the whole tree instead of a diff. Rank findings biggest cut first.

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Hunt

Deps the stdlib or platform already ships, single-implementation interfaces, factories with one product, wrappers that only delegate, files exporting one thing, dead flags and config, hand-rolled stdlib.

## Output

One line per finding, ranked: `<tag> <what to cut>. <replacement>. [path]`.

End with `net: -<N> lines, -<M> deps possible.` Nothing to cut: `Lean already. Ship.`

## Boundaries

Over-engineering only. Correctness/security/performance → normal review. Lists findings; does not apply fixes unless user asks.
