# Feature: Wiki lint accuracy & status freshness fixes

Closes #208, #209, #210, #211.

## Problem Statement

`maina wiki lint` reports 77 decision-violation errors on our own repo — roughly 65 of them are false positives. `maina wiki status` reports 100% stale articles and 0% coverage immediately after a successful compile. Users cannot trust either signal, and CI/pre-push gates built on them would block on noise. This is a credibility bug: the wiki tooling actively fails on its own codebase.

## Target User

- Primary: any maina user running `wiki lint` or `wiki status` in a repo that has agent worktrees, test files that `throw`, or code that parses ESLint configs (i.e. most repos using maina).
- Secondary: CI/pre-push automation that gates merges on lint severity and coverage.

## User Stories

- As a developer, I want `wiki lint` to report only real decision violations, so the output is trustworthy.
- As a developer, I want `wiki status` to reflect reality right after I compile, so I can tell when the wiki is actually stale.
- As a CI author, I want lint counts to be stable and meaningful, so I can gate on them without flakes.

## Success Criteria

- [ ] Running `wiki lint` on this repo produces ≤ 25 findings (vs. 77 today), and **zero** findings come from paths under `.claude/worktrees/` or `.maina/`.
- [ ] No `*.test.ts` / `*.spec.ts` / `__tests__/` file is flagged by the `result<` (throw-based) constraint.
- [ ] `packages/core/src/constitution/config-parsers.ts` and `packages/core/src/verify/tools/wiki-lint.ts` are **not** flagged as "uses ESLint configuration".
- [ ] After `wiki compile`, `wiki status` shows `Last compile` ≥ the compile run's timestamp, and `Stale` reflects only articles whose source mtime is newer than the compile timestamp.
- [ ] Unit tests cover: worktree/`.claude`/`.maina` exclusion, test-file exclusion for production-code constraints, ESLint detection requires import-form or real config filename, status freshness updated on compile success.

## Scope

### In Scope

- `packages/core/src/verify/tools/wiki-lint.ts`:
  - Extend `collectSourceFiles` skip list to cover `.claude`, `.maina`, `coverage`, `build`, `out`, `.next`, `.turbo`, `.cache`.
  - Skip test files (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`) for constraints whose `keyword` implies production-code semantics (`result<`, `never throw`).
  - Rewrite the `biome`-vs-ESLint content regex to match only real usage signals (import/require of `eslint*` packages), not any occurrence of the string.
  - Keep the root-config filename check (already correct at ~L508-523).
- Wiki compile/status freshness:
  - On successful compile, persist a `lastCompile` timestamp to `.maina/wiki/.state.json` (or wherever the state lives).
  - `wiki status` computes staleness against that timestamp.
- Tests for each fix (TDD).

### Out of Scope

- Redesigning the `TechConstraint` schema beyond adding a `skipTests` flag.
- Fixing unrelated checks (spec_drift, orphan_entity, etc.) — only the four reported bugs.
- The count-mismatch between compile (287 modules) and status (441 modules) beyond what fixing worktree-scan fixes automatically. If the discrepancy persists after the fix, leave a follow-up note in #211 rather than widening scope here.

## Design Decisions

- **Skip list over `.gitignore` parsing.** Hardcoded skip list is boring and correct; honoring `.gitignore` is better long-term but out of scope — single-PR constraint.
- **Per-constraint `skipTests` flag** (default `true` for `result<` / `never throw`, `false` for import-form checks like `bun:test`). This preserves existing catches where tests *should* be scanned (e.g. a test importing jest is still a violation).
- **ESLint detection: require import-form.** Switch `/\.eslintrc|eslint\.config/` content regex to `/from\s+["']eslint(["']|\/)/` + `/require\s*\(\s*["']eslint(["']|\/)\s*\)/`. Filename-level check at root already catches real eslint config files — no regression.
- **Compile writes `lastCompile` timestamp.** Simplest fix — existing state file already has fields; add one more and read it from status.

## Open Questions

None — all four issues are well-characterized and the root causes are in code I've already read.
