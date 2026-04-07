# Architecture: Three Engines

> Auto-generated architecture article describing the three-engine pattern.

Maina's core is organized around three engines that work together:

1. **Context Engine** (`context/`) — Observes the codebase via 4-layer retrieval (Working, Episodic, Semantic, Retrieval), PageRank scoring, and dynamic token budgets.
2. **Prompt Engine** (`prompts/`) — Learns from project conventions via constitution loading, custom prompts, versioning, and A/B-tested evolution.
3. **Verify Engine** (`verify/`) — Verifies AI-generated code via a multi-stage pipeline: syntax guard, parallel tools, diff filter, AI fix, and two-stage review.

## Context Engine

Source files (`packages/core/src/context/`):

- `budget.ts`
- `engine.ts`
- `episodic.ts`
- `relevance.ts`
- `retrieval.ts`
- `selector.ts`
- `semantic.ts`
- `treesitter.ts`
- `wiki.ts`
- `working.ts`

## Prompts Engine

Source files (`packages/core/src/prompts/`):

- `engine.ts`
- `evolution.ts`
- `loader.ts`

## Verify Engine

Source files (`packages/core/src/verify/`):

- `ai-review.ts`
- `builtin.ts`
- `consistency.ts`
- `coverage.ts`
- `detect.ts`
- `diff-filter.ts`
- `fix.ts`
- `lighthouse.ts`
- `mutation.ts`
- `pipeline.ts`
- `proof.ts`
- `secretlint.ts`
- `semgrep.ts`
- `slop.ts`
- `sonar.ts`
- `syntax-guard.ts`
- `trivy.ts`
- `typecheck.ts`
- `types.ts`
- `visual.ts`
- `zap.ts`
