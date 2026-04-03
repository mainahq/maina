# Feature: AI Verify Review + HLD/LLD in Design

## Problem

1. **Verify pipeline is static-only.** Regex slop detection and external tools (semgrep, trivy, secretlint) catch syntax and pattern issues but miss semantic bugs. Tier 3 benchmark proved this: SpecKit's 58s AI self-review caught 4 issues, maina's verify caught 0.

2. **`maina design` only produces ADRs.** Architecture Decision Records capture WHAT and WHY but not HOW. No high-level or low-level design documents are generated, forcing developers to either skip design or write it manually.

## Why Now

The 42→0 verify cleanup made the pipeline honest. Now it needs to be _effective_. The benchmark gap (97.9% vs 100%) was entirely due to missing AI review. HLD/LLD fills the last gap in the spec→design→implement→verify lifecycle.

## Success Criteria

- **SC-1:** Mechanical AI review runs on every `maina verify` in <3s, catches cross-function consistency and missing edge cases
- **SC-2:** Standard AI review via `--deep` flag performs full semantic review against spec/plan in <15s
- **SC-3:** AI review findings use existing `Finding` interface, cached, never block pipeline on failure
- **SC-4:** `maina design` generates HLD+LLD sections from spec.md using AI (standard tier)
- **SC-5:** `maina review-design` validates HLD/LLD section completeness
- **SC-6:** New prompt template `design-hld-lld.md` registered in prompt engine

## Out of Scope

- Diagram generation (PlantUML, Mermaid) — text-based descriptions only
- ADR relationship tracking (supersedes, depends-on)
- Auto-generating specs from design docs (reverse flow)

---

## Design

### Part 1: AI Verify Review

#### Architecture

New module: `packages/core/src/verify/ai-review.ts`

Two tiers integrated into the existing pipeline:

**Mechanical (always-on):**
- Model tier: `mechanical` (Gemini Flash)
- Input: diff + up to 3 referenced functions per changed file
- Checks: cross-function consistency, missing edge cases, dead branches, API contract violations
- Severity cap: `warning` (never blocks pass)
- Target latency: <3s

**Standard (`--deep`):**
- Model tier: `standard` (Claude Sonnet)
- Input: diff + referenced functions + spec.md + plan.md (if available)
- Checks: everything mechanical does + spec compliance, architecture, test coverage gaps
- Can emit `error` severity (blocks pass)
- Target latency: <15s

#### Pipeline Integration

```
Step 6:  diff filter
Step 7:  noisy rules filter
Step 8:  [NEW] AI review (mechanical always, standard if --deep)
Step 9:  merge AI findings with static findings
Step 10: determine pass/fail
```

#### Referenced Function Resolution

Uses tree-sitter AST (already in codebase via `packages/core/src/context/semantic.ts`) to find function definitions called from changed lines. Capped at 3 functions per file to bound token usage.

#### Caching

Cache key: `hash(diff + referenced_functions + model_tier + prompt_version)`
AI failure → graceful skip, no cache entry.

#### Finding Format

```typescript
{
  tool: "ai-review",
  file: string,
  line: number,
  message: string,
  severity: "warning" | "error",  // mechanical caps at warning
  ruleId: "ai-review/cross-function" | "ai-review/edge-case" | "ai-review/dead-code" | "ai-review/contract"
}
```

### Part 2: HLD/LLD in Design

#### Enhanced ADR Template

```markdown
# NNNN. Title

Date: YYYY-MM-DD

## Status
## Context
## Decision
## Consequences

## High-Level Design
### System Overview
### Component Boundaries
### Data Flow
### External Dependencies

## Low-Level Design
### Interfaces & Types
### Function Signatures
### DB Schema Changes
### Sequence of Operations
### Error Handling
### Edge Cases

## Alternatives Considered
```

#### Flow Change

1. Scaffold ADR with enhanced template (existing + HLD/LLD sections)
2. If spec.md exists for the current feature → call AI (standard tier) to generate HLD/LLD content from spec + codebase context + constitution
3. If no spec.md → scaffold with `[NEEDS CLARIFICATION]` markers
4. Approach proposals (existing interactive phase)

#### AI Generation

- Task: `"design"` → standard tier
- New prompt template: `packages/core/src/prompts/defaults/design-hld-lld.md`
- Input variables: `{{ spec }}`, `{{ context }}`, `{{ constitution }}`, `{{ conventions }}`
- Output: markdown sections for HLD + LLD
- Uses `tryAIGenerate()` for graceful fallback

#### Review Enhancement

`reviewDesign()` in `packages/core/src/design/review.ts` extended to check:
- HLD sections present and non-empty
- LLD sections present and non-empty
- `[NEEDS CLARIFICATION]` count reported as warnings
- Cross-reference: LLD interfaces match HLD component boundaries

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/verify/ai-review.ts` | NEW — AI review module (mechanical + standard) |
| `packages/core/src/verify/pipeline.ts` | Wire AI review as step 8, add `--deep` option |
| `packages/cli/src/commands/verify.ts` | Add `--deep` flag |
| `packages/core/src/prompts/defaults/ai-review.md` | NEW — AI review prompt template |
| `packages/core/src/prompts/defaults/design-hld-lld.md` | NEW — HLD/LLD generation prompt |
| `packages/core/src/design/index.ts` | Enhanced template + AI generation call |
| `packages/core/src/design/review.ts` | HLD/LLD section validation |
| `packages/cli/src/commands/design.ts` | Wire HLD/LLD generation |
| `packages/core/src/ai/tiers.ts` | Register "code-review" → mechanical tier |
