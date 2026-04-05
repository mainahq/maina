# Implementation Plan — v0.3.x Hardening

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Sequential bottom-up: deterministic checks first (standalone value), then AI-powered features (layers on top), then automation + RL (needs full pipeline). All new modules follow existing patterns: `Finding` interface, `Result<T, E>` error handling, `mock.module()` tests.

- Pattern: Each new verify step is an independent module returning `Finding[]`, registered in `pipeline.ts`
- Integration points: `verify/pipeline.ts` (orchestrator), `design/index.ts` (HLD/LLD), `init/index.ts` (Biome), `feedback/collector.ts` (traces), `ai/try-generate.ts` (delegation)

## Key Technical Decisions

- **tree-sitter for consistency check** — already in stack, gives AST without new deps
- **tsc --noEmit for typecheck** — zero install for TS projects, language-native tools for others
- **AI delegation protocol** — reuse existing `---MAINA_AI_REQUEST---` for host mode, OpenRouter fallback
- **No new DB tables** — workflow traces already stored, trace analysis reads existing data

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/verify/typecheck.ts` | Built-in type checking per language | New |
| `packages/core/src/verify/__tests__/typecheck.test.ts` | Tests for typecheck | New |
| `packages/core/src/verify/consistency.ts` | AST cross-function consistency check | New |
| `packages/core/src/verify/__tests__/consistency.test.ts` | Tests for consistency | New |
| `packages/core/src/verify/pipeline.ts` | Register new steps, 0-tools warning | Modified |
| `packages/core/src/verify/__tests__/pipeline.test.ts` | Update pipeline tests | Modified |
| `packages/core/src/verify/detect.ts` | 0-tools warning logic | Modified |
| `packages/core/src/verify/ai-review.ts` | Mechanical always-on tier | Modified |
| `packages/core/src/verify/__tests__/ai-review.test.ts` | Fix + extend AI review tests | Modified |
| `packages/core/src/init/index.ts` | Biome auto-config during init | Modified |
| `packages/core/src/init/__tests__/init.test.ts` | Tests for Biome init | Modified |
| `packages/core/src/design/index.ts` | HLD/LLD generation from spec | Modified |
| `packages/core/src/design/__tests__/design.test.ts` | Tests for HLD/LLD | Modified |
| `packages/cli/src/commands/spec.ts` | --auto flag | Modified |
| `packages/cli/src/commands/design.ts` | --auto flag | Modified |
| `packages/core/src/feedback/trace-analysis.ts` | Post-workflow RL trace analysis | New |
| `packages/core/src/feedback/__tests__/trace-analysis.test.ts` | Tests for trace analysis | New |
| `packages/core/src/language/profile.ts` | Fix language profile regressions | Modified |
| `packages/core/src/verify/slop.ts` | Fix slop detector regressions | Modified |
| `packages/core/src/index.ts` | Export new modules | Modified |

## Tasks

TDD: every implementation task must have a preceding test task.

### Phase 0: Fix regressions

- [ ] T0.1: Investigate 43 failing tests — categorize root causes by cluster (language profiles, slop, verify, AI review)
- [ ] T0.2: Fix language profile test failures (~28 tests) — likely import/export regressions from feature 023
- [ ] T0.3: Fix slop detector + cache test failures (~7 tests)
- [ ] T0.4: Fix verify pipeline / detect tools / syntax guard test failures (~5 tests)
- [ ] T0.5: Fix AI review test failures (~3 tests)
- [ ] T0.6: Fix `maina ticket` false-positive label matching (substring → exact word match in `detectModules`)
- [ ] T0.7: Run full test suite — confirm 0 failures
- [ ] T0.8: `maina verify` — confirm clean
- [ ] T0.9: `maina commit` — commit all regression fixes

### Phase 1: Deterministic built-in checks

- [ ] T1.1: Write failing tests for `typecheck.ts` — tsc output parsing, Finding[] generation, missing binary skip
- [ ] T1.2: Implement `verify/typecheck.ts` — `runTypecheck(files, cwd)` returns `TypecheckResult`
- [ ] T1.3: Run tests — confirm green
- [ ] T1.4: Write failing tests for `consistency.ts` — spec-based rules, heuristic fallback, no-spec skip
- [ ] T1.5: Implement `verify/consistency.ts` — `checkConsistency(files, cwd, mainaDir)` returns `ConsistencyResult`
- [ ] T1.6: Run tests — confirm green
- [ ] T1.7: Write failing test for 0-tools warning in `pipeline.ts` — when `detectTools()` returns 0 external tools
- [ ] T1.8: Modify `verify/pipeline.ts` — add typecheck + consistency steps, 0-tools warning
- [ ] T1.9: Run tests — confirm green
- [ ] T1.10: Write failing test for Biome auto-config in `init/index.ts`
- [ ] T1.11: Modify `init/index.ts` — detect Biome, offer install + sensible defaults
- [ ] T1.12: Run tests — confirm green
- [ ] T1.13: `maina verify` + `maina commit` — commit Phase 1

### Phase 2: AI-powered verification + HLD/LLD

- [ ] T2.1: Write failing tests for mechanical always-on AI review — delegation protocol, severity cap, graceful failure
- [ ] T2.2: Modify `verify/ai-review.ts` — mechanical tier always runs, uses delegation in host mode
- [ ] T2.3: Run tests — confirm green
- [ ] T2.4: Write failing tests for HLD/LLD generation — spec input, AI delegation, template fill
- [ ] T2.5: Modify `design/index.ts` — generate HLD/LLD from spec via `tryAIGenerate("design-hld-lld", ...)`
- [ ] T2.6: Run tests — confirm green
- [ ] T2.7: `maina verify` + `maina commit` — commit Phase 2

### Phase 3: Automation + RL loop

- [ ] T3.1: Add `--auto` flag to `spec.ts` and `design.ts` CLI commands — skip all interactive prompts
- [ ] T3.2: Test `--auto` flags work end-to-end (no stdin required)
- [ ] T3.3: Write failing tests for `trace-analysis.ts` — trace collection, prompt scoring, improvement generation
- [ ] T3.4: Implement `feedback/trace-analysis.ts` — `analyzeWorkflowTrace()`, `applyImprovements()`
- [ ] T3.5: Run tests — confirm green
- [ ] T3.6: Wire trace analysis into `maina pr` — background run after PR creation
- [ ] T3.7: Run full test suite — confirm 0 failures
- [ ] T3.8: `maina verify` + `maina commit` — commit Phase 3

### Finalize

- [ ] T4.1: Export new modules from `packages/core/src/index.ts`
- [ ] T4.2: Update `IMPLEMENTATION_PLAN.md` Sprint 11 — mark tasks complete
- [ ] T4.3: Update roadmap `packages/docs/src/content/docs/roadmap.mdx`
- [ ] T4.4: `maina verify` — final full verification
- [ ] T4.5: `maina review` — comprehensive review
- [ ] T4.6: Fix any review findings
- [ ] T4.7: `maina commit` — final commit
- [ ] T4.8: `maina pr` — create PR with verification proof

## Failure Modes

- **tsc not found**: Skip typecheck with info note — Finding with severity "info" saying "TypeScript compiler not found"
- **tree-sitter parse failure**: Skip consistency check, log warning
- **AI delegation timeout**: Degrade to deterministic-only, never block pipeline
- **No spec.md for consistency**: Fall back to heuristic patterns
- **Trace analysis fails**: Log warning, don't block PR creation
- **RL improvement degrades prompts**: A/B testing catches it — auto-rollback at <-5%

## Testing Strategy

- **Unit tests**: Each new module (typecheck, consistency, trace-analysis) gets its own test file
- **Mocks**: `mock.module()` for external binaries (tsc, mypy), AI delegation, file system
- **Integration**: Pipeline test updated to verify new steps in sequence
- **Patterns**: Follow existing `describe/it` + `callOrder` tracking + `beforeEach` reset
- **Coverage**: Happy path, missing binary, empty input, malformed output, multi-language
