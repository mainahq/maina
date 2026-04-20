# Implementation Plan — Wiki lint accuracy & status freshness fixes

> HOW only — see spec.md for WHAT and WHY.

## Architecture

All fixes are localized. Three files, one new helper, per-constraint flag, and a compile-time hash-population pass.

- Pattern: **targeted bugfix** — no new abstractions, extend existing skip-list and constraint shape.
- Integration points:
  - `packages/core/src/verify/tools/wiki-lint.ts` — the lint engine.
  - `packages/core/src/wiki/compiler.ts` — populate `state.fileHashes`.
  - `packages/cli/src/commands/wiki/status.ts` — fix path join.

## Key Technical Decisions

- **Hardcoded skip list, not `.gitignore`.** `.gitignore` parsing is a future refactor; for this PR we just add `.claude`, `.maina`, `coverage`, `build`, `out`, `.next`, `.turbo`, `.cache` next to the existing `node_modules`/`dist`/`.git`. Rationale: 4 lines vs. pulling in a gitignore parser; behavior matches 99% of repos.
- **Per-constraint `skipTests` flag.** Tests should still be scanned for `bun:test` (catches a jest import in a test) but not for `result<` (tests legitimately throw). A flag on `TechConstraint` lets each rule declare its policy.
- **Import-form ESLint detection.** Replace the content regex `/\.eslintrc|eslint\.config/` — which matches any string occurrence — with `/from\s+["']eslint[\w\-\/"']/` + `/require\s*\(\s*["']eslint[\w\-\/"']\s*\)/`. The existing filename-level check at repo root (wiki-lint.ts:508-523) already catches real `.eslintrc` / `eslint.config.*` files, so this tightens without regression.
- **Populate `fileHashes` during compile.** `WikiState.fileHashes` is declared but never written. Iterate over the source files already enumerated during compile and write `hashFile(path)` into state. That makes coverage = `articleHashCount / fileHashCount` meaningful.
- **Fix path join in `countStaleArticles`.** Article keys are stored as `wiki/modules/foo.md`; `wikiDir` is `.maina/wiki`. `join(wikiDir, key)` produces `.maina/wiki/wiki/modules/foo.md` which never exists, so every article lands in the `existsSync === false` branch. Strip the leading `wiki/` before joining.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/verify/tools/wiki-lint.ts` | Skip-list expansion, `skipTests` flag, ESLint regex | Modified |
| `packages/core/src/verify/tools/__tests__/wiki-lint.test.ts` | Tests for all three lint fixes | Modified |
| `packages/core/src/wiki/compiler.ts` | Write `state.fileHashes` on compile | Modified |
| `packages/core/src/wiki/__tests__/compiler.test.ts` | Test `fileHashes` populated after compile | Modified |
| `packages/cli/src/commands/wiki/status.ts` | Fix path join, coverage calc | Modified |
| `packages/cli/src/commands/__tests__/wiki.test.ts` | Test stale count + coverage with realistic state | Modified |

## Tasks

TDD: tests before impl.

- [ ] Add failing test: `collectSourceFiles` skips `.claude/worktrees/agent-*` and `.maina/features/*`.
- [ ] Impl: extend skip list in `collectSourceFiles`.
- [ ] Add failing test: `checkDecisionViolations` does NOT flag `*.test.ts` files against `result<` constraint.
- [ ] Impl: add `skipTests?: boolean` to `TechConstraint`, default true for `result<` / `never throw`, apply filter at scan site.
- [ ] Add failing test: `constitution/config-parsers.ts`-style content (string mention of `eslint.config`) is NOT flagged; content with `from "eslint"` IS flagged.
- [ ] Impl: replace `/\.eslintrc|eslint\.config/` with import/require-form regexes.
- [ ] Add failing test: after a compile, `state.fileHashes` has at least one entry; `wiki status` reports coverage > 0 and stale < total.
- [ ] Impl (compiler): populate `state.fileHashes` from the file list already traversed during extraction.
- [ ] Impl (status): fix `countStaleArticles` path join (strip leading `wiki/` or join against `cwd` instead of `wikiDir`).

## Failure Modes

- **Skip list too aggressive** — if a user has legitimate source under `.maina/` or `coverage/`, it's silently skipped. Mitigation: skip list only covers well-known tool-output dirs; document in changelog.
- **`skipTests` regex false positives/negatives** — pattern `/\.(test|spec)\.[jt]sx?$|\/__tests__\/|\/__mocks__\//` should be tight. Add tests for edge cases (`something.test.utils.ts` shouldn't be skipped).
- **ESLint regex misses real violations** — the new pattern requires import-form, so a project using eslint via `package.json` scripts with no JS import won't be caught. Acceptable: the repo-root filename check still catches `.eslintrc*` / `eslint.config.*`, which is the real config surface.
- **`fileHashes` perf regression** — hashing all source files adds IO. Already done in some form for change detection; we're just persisting it. Measure in test.
- **Path-prefix fix breaks other code** — grep for other consumers of `state.articleHashes` keys before changing key format; safer to strip at read-time (in `countStaleArticles`) than to rewrite state format.

## Testing Strategy

- **Unit** tests in the same `__tests__` dirs as the files changed. bun:test.
- **Regression** check: run `bun packages/cli/dist/index.js wiki lint` on this repo after build. Expect ≤ 25 findings, zero under `.claude/worktrees/` or `.maina/`.
- **Regression** check: run `wiki compile` then `wiki status`; expect `Coverage: > 0%`, `Stale: < total`, `Last compile: <today>`.
- No mocks for the lint code — it reads real files. Use `tmpdir` fixtures.

## Wiki Context

(Context block from `maina plan` preserved below for reference.)

### Related Decisions

- 0019-no-fern-no-sdk — "requires biome" keyword — the rule this PR makes more accurate.
- 0012-v050-cloud-client-maina-cloud — "requires result<" keyword — the rule this PR restricts to non-test files.
- 0022-wiki-is-a-view — wiki is a view of the Context engine; coverage/staleness signals feed it.
