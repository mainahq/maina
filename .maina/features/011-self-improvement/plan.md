# Implementation Plan — Feature 011: Self-Improvement

> HOW only — see spec.md for WHAT and WHY.

## Architecture

No new modules. All changes are wiring existing code that's already written but not connected.

## Files

| File | Purpose | Change |
|------|---------|--------|
| `packages/core/src/context/semantic.ts` | Semantic index population | Wire `indexProject()` into context assembly |
| `packages/core/src/context/engine.ts` | Context assembly | Call semantic indexing on first assembly per session |
| `packages/core/src/feedback/compress.ts` | Episodic compression | Fix trigger — compress accepted reviews into episodic entries |
| `packages/core/src/feedback/collector.ts` | Feedback collection | Trigger compression after accepted commit review |
| `packages/core/src/verify/pipeline.ts` | Slop filtering | Respect preferences.json FP threshold |
| `packages/core/src/prompts/defaults/review.md` | Review prompt | Create A/B candidate with clearer instructions |
| `packages/core/src/cache/manager.ts` | Cache keys | Verify key stability after host delegation fix |
| `packages/cli/src/program.ts` | CLI entrypoint | Wire benchmark command |
| `packages/core/src/feedback/learn.ts` | Learn command | Output prompt diff, not just stats |

## Tasks

TDD: every implementation task must have a preceding test task.

### Part A: Semantic Index Hydration (SC-1)

- [ ] Task 1: Write failing test — `assembleContext()` populates semantic entities on first call (SC-1)
- [ ] Task 2: Wire `indexProject()` call in `engine.ts` when semantic entities are empty (SC-1)
- [ ] Task 3: Verify entities + edges populated after context assembly (SC-1)

### Part B: Episodic Hydration (SC-2)

- [ ] Task 4: Write failing test — accepted commit feedback triggers episodic compression
- [ ] Task 5: Wire compression trigger in `collector.ts` after accepted commit review
- [ ] Task 6: Verify episodic entries created with <500 token compression

### Part C: Review Prompt Evolution (SC-3)

- [ ] Task 7: Analyze 36 review samples — extract rejection patterns (SC-3)
- [ ] Task 8: Create A/B candidate review prompt addressing top 3 rejection reasons (SC-3)
- [ ] Task 9: Register candidate in prompt versioning system (SC-3)

### Part D: Cache & Slop Fixes (SC-4, SC-5)

- [ ] Task 10: Write test — verify cache key stability across sessions (SC-4)
- [ ] Task 11: Fix cache key generation if unstable, verify hit rate >0% (SC-4)
- [ ] Task 12: Write test — slop pipeline skips rules where FP rate >50% in preferences.json (SC-5)
- [ ] Task 13: Wire preferences check into slop detection pipeline (SC-5)

### Part E: Wiring & Polish (SC-6, SC-7)

- [ ] Task 14: Register benchmark command in `program.ts`
- [ ] Task 15: Enhance `maina learn` to output prompt diff suggestion
- [ ] Task 16: Run maina verify + review on all changes

## Testing Strategy

- Unit tests for semantic index population (mock tree-sitter, verify DB writes)
- Unit tests for episodic compression trigger (mock feedback, verify entry created)
- Unit tests for slop FP threshold (mock preferences, verify rule skipped)
- Integration test for cache hit rate (same query twice → hit)
- Manual test for review prompt A/B (run maina review, compare old vs new)
