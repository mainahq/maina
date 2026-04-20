# Task Breakdown

## Tasks

All tests precede implementation — each `T*` below was a failing test before the corresponding `I*`.

- [x] **T1** — Tests for `.claude/worktrees/` and `.maina/` exclusion in `collectSourceFiles`.
- [x] **I1** — Extend `SKIP_DIRS` set in `packages/core/src/verify/tools/wiki-lint.ts` to cover `.claude`, `.maina`, `coverage`, `build`, `out`, `.next`, `.turbo`, `.cache`.
- [x] **T2** — Test that `*.test.ts` / `__tests__/` / `tests/` files are NOT flagged by the `result<` constraint, plus a regression guard that a test file importing `jest` IS still flagged.
- [x] **I2** — Add `skipTests?: boolean` on `TechConstraint`; set true for `result<` and `never throw`. Add `isTestFile()` helper matching `*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`, `test/`, `tests/`.
- [x] **T3** — Test that files mentioning `eslint.config` in a string literal are NOT flagged; static import, side-effect import, top-level `await import(...)`, and bare `require("eslint")` ARE flagged.
- [x] **I3** — Replace `biome` constraint's content regex with line-anchored import/require-form patterns. Move repo-root config-file detection to `configFilenameRules` keyed by constraint keyword.
- [x] **T4** — Test that `wiki status` after compile reports `coverage > 0` and `staleCount == 0`.
- [x] **I4** — Populate `state.fileHashes` on a full compile (skip on sample compiles). Strip leading `wiki/` prefix from article keys in `countStaleArticles` before joining against `wikiDir`.

## Dependencies

- Independent tasks: `T1/I1`, `T2/I2`, `T3/I3`, `T4/I4` don't block each other.
- Within each pair: `T*` must fail before `I*` lands.
- Smoke: after all `I*` merged, run `maina wiki compile` + `wiki status` + `wiki lint` on this repo to confirm the success criteria in `spec.md`.

## Definition of Done

- [x] All tests pass (`bun test packages/core/src/verify/tools/__tests__/wiki-lint.test.ts`, `bun test packages/cli/src/commands/__tests__/wiki.test.ts`).
- [x] `bun run check` (Biome) clean on touched files.
- [x] `bun run typecheck` clean.
- [x] `maina wiki lint` on this repo drops from 77 → ≤ 5 decision-violation findings, with zero under `.claude/worktrees/` or `.maina/`.
- [x] `maina wiki status` on this repo reports `Coverage > 0%`, `Stale == 0`, `Last compile` populated from the most recent compile run.
- [x] `packages/core/src/verify/tools/wiki-lint.ts` no longer self-flags against ADR 0002/0019.
