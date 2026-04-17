# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/constitution/pattern-sampler.ts`. Uses regex-based pattern detection on file content (not tree-sitter AST — simpler and sufficient for these patterns). Samples files deterministically using sorted directory listing. Reuses `ConstitutionRule` type from `git-analyzer.ts`.

## Key Technical Decisions

- Regex over tree-sitter for V1: async/await, arrow functions, import style are reliably detectable with regex. Tree-sitter adds complexity for marginal accuracy gain at this stage.
- Deterministic sampling: sort files alphabetically, take first 100. Same repo → same sample → same output.
- Confidence = prevalence ratio × 0.7 (capped). 90% async/await → confidence 0.63.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/constitution/pattern-sampler.ts` | Pattern detection + sampling | New |
| `packages/core/src/constitution/__tests__/pattern-sampler.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs from spec (red phase)
- [ ] T2: Implement `sampleFiles()` — deterministic file sampling
- [ ] T3: Implement `detectAsyncStyle()` — async/await vs .then
- [ ] T4: Implement `detectFunctionStyle()` — arrow vs declaration
- [ ] T5: Implement `detectImportStyle()` — named vs default
- [ ] T6: Implement `detectErrorHandling()` — try/catch vs .catch
- [ ] T7: Implement `samplePatterns()` — combined runner
- [ ] T8: `maina verify` + `maina review` + `maina analyze`

## Testing Strategy

- Use the maina repo itself as a real-world test fixture
- Create temp dirs with known patterns for deterministic tests
- Verify confidence scores match expected prevalence
