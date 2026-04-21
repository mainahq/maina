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
- [ ] After `wiki compile`, `wiki status` reports `Coverage > 0%`, `Stale == 0`, and a `Last compile` timestamp from the run. Staleness is computed by hashing each on-disk article and comparing against the hash recorded in `state.articleHashes` at compile time (mismatches / missing files count as stale); coverage is `articleCount / fileHashCount`, where `fileHashCount` is populated by the compile run. `Last compile` is the last successful compile's ISO timestamp from `state.lastFullCompile` / `state.lastIncrementalCompile`.
- [ ] Unit tests cover: worktree/`.claude`/`.maina` exclusion, test-file exclusion for production-code constraints, ESLint detection requires import-form or real config filename, status reports non-zero coverage and zero stale immediately after compile.

## Scope

### In Scope

- `packages/core/src/verify/tools/wiki-lint.ts`:
  - Extend `collectSourceFiles` skip list to cover `.claude`, `.maina`, `coverage`, `build`, `out`, `.next`, `.turbo`, `.cache`.
  - Skip test files (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`) for constraints whose `keyword` implies production-code semantics (`result<`, `never throw`).
  - Rewrite the `biome`-vs-ESLint content regex to match only real usage signals (import/require of `eslint*` packages), not any occurrence of the string.
  - Keep the root-config filename check (already correct at ~L508-523).
- Wiki compile/status freshness:
  - Populate `state.fileHashes` on a full compile — the field exists in the schema but was never written, so coverage was stuck at 0%. Skip on sample compiles so a truncated file set doesn't overwrite a prior full compile's canonical state.
  - Fix `countStaleArticles`'s path join: article keys in state are `wiki/modules/foo.md` but `wikiDir` is `.maina/wiki`, so `join(wikiDir, key)` produced `.maina/wiki/wiki/modules/foo.md` — a path that never exists. Strip the leading `wiki/` before joining.
  - `wiki status` reads the last compile timestamp from `state.lastFullCompile` / `state.lastIncrementalCompile`, which compile already writes.
- Tests for each fix (TDD).

### Out of Scope

- Redesigning the `TechConstraint` schema beyond adding a `skipTests` flag.
- Fixing unrelated checks (spec_drift, orphan_entity, etc.) — only the four reported bugs.
- The count-mismatch between compile (287 modules) and status (441 modules) beyond what fixing worktree-scan fixes automatically. If the discrepancy persists after the fix, leave a follow-up note in #211 rather than widening scope here.

## Design Decisions

- **Skip list over `.gitignore` parsing.** Hardcoded skip list is boring and correct; honoring `.gitignore` is better long-term but out of scope — single-PR constraint.
- **Per-constraint `skipTests` flag** (default `true` for `result<` / `never throw`, `false` for import-form checks like `bun:test`). This preserves existing catches where tests *should* be scanned (e.g. a test importing jest is still a violation).
- **ESLint detection: require import-form.** Switch `/\.eslintrc|eslint\.config/` content regex to `/from\s+["']eslint(["']|\/)/` + `/require\s*\(\s*["']eslint(["']|\/)\s*\)/`. Filename-level check at root already catches real eslint config files — no regression.
- **Compile populates `state.fileHashes` + status reads existing `state.lastFullCompile`/`state.lastIncrementalCompile`.** The last-compile timestamp fields already exist and are written by compile; status just had the wrong path join and the coverage denominator (`fileHashCount`) was always 0 because compile never wrote `fileHashes`. Populate the field on full compile and fix the path join — no new state fields needed.

## Open Questions

None — all four issues are well-characterized and the root causes are in code I've already read.
