# Implementation Plan: Wiki Foundation (Sprint 0)
> HOW only — see MAINA_WIKI_PRODUCT_SPEC_FINAL.md for WHAT and WHY.

## Architecture
- Pattern: Extractors + Types + State (foundation layer for wiki compiler)
- Integration: Adapts existing Semantic layer (tree-sitter, PageRank), Feature analyzer, ADR parser, Workflow context
- Location: `packages/core/src/wiki/`

## Key Technical Decisions
- All types follow existing `Result<T, E>` error handling pattern
- State persisted to `.maina/wiki/.state.json` (gitignored)
- Code extractor is thin adapter over existing Semantic layer — no re-implementation
- Feature/Decision/Workflow extractors parse structured markdown deterministically
- Schema.md co-evolves with compilation prompts

## Files
| File | Purpose | Status |
|------|---------|--------|
| `packages/core/src/wiki/types.ts` | WikiArticle, WikiLink, WikiState, ExtractedFeature, ExtractedDecision, ExtractedWorkflowTrace, WikiLintResult | new |
| `packages/core/src/wiki/state.ts` | .state.json management — SHA-256 hashing, change detection, round-trip | new |
| `packages/core/src/wiki/schema.ts` | Default schema.md, article structure rules, linking conventions | new |
| `packages/core/src/wiki/extractors/code.ts` | Thin adapter over Semantic layer for entities + PageRank + deps | new |
| `packages/core/src/wiki/extractors/feature.ts` | Parse .maina/features/*/plan.md, spec.md, tasks.md | new |
| `packages/core/src/wiki/extractors/decision.ts` | Parse adr/*.md into ExtractedDecision | new |
| `packages/core/src/wiki/extractors/workflow.ts` | Parse .maina/workflow/ into ExtractedWorkflowTrace | new |
| `packages/core/src/wiki/__tests__/types.test.ts` | Type serialization/deserialization tests | new |
| `packages/core/src/wiki/__tests__/state.test.ts` | State round-trip, SHA-256, change detection tests | new |
| `packages/core/src/wiki/__tests__/schema.test.ts` | Schema validation tests | new |
| `packages/core/src/wiki/__tests__/extractors/code.test.ts` | Code extractor tests (dogfood on maina's own repo) | new |
| `packages/core/src/wiki/__tests__/extractors/feature.test.ts` | Feature extractor tests | new |
| `packages/core/src/wiki/__tests__/extractors/decision.test.ts` | Decision extractor tests | new |
| `packages/core/src/wiki/__tests__/extractors/workflow.test.ts` | Workflow extractor tests | new |

## Tasks
- [ ] T001: Define all wiki types in types.ts
- [ ] T002: Implement state management with SHA-256 hashing (depends on T001)
- [ ] T003: Implement schema management (depends on T001)
- [ ] T004: Implement code entity extractor (depends on T001)
- [ ] T005: Implement feature extractor (depends on T001)
- [ ] T006: Implement decision extractor (depends on T001)
- [ ] T007: Implement workflow trace extractor (depends on T001)

## Testing Strategy
- TDD: Write tests first for each ticket
- All extractors tested against maina's own repo (dogfood)
- Edge cases: missing files, empty dirs, malformed markdown
- State management: 100% test coverage on round-trip serialization

## Definition of Done
- All 6 extractors produce structured data from maina's own repo
- State management with full round-trip coverage
- `maina verify` passes
- All types properly exported from packages/core/src/index.ts
