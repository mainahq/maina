# Feature 014: Workflow Context Forwarding

## Problem

Each maina workflow step (plan → spec → design → review → TDD → verify → commit → PR) is stateless. Subagents and AI calls at step N have no visibility into decisions, flags, or outcomes from steps 1 through N-1. This causes:
- Design reviews that miss spec decisions
- Implementation that ignores design review flags
- PRs that don't reference the original ticket context

## Success Criteria

- **SC-1:** `appendWorkflowStep(mainaDir, step, summary)` writes a step entry to `.maina/workflow/current.md`
- **SC-2:** `loadWorkflowContext(mainaDir)` returns the accumulated workflow text
- **SC-3:** `maina plan` resets workflow context (new feature = new workflow)
- **SC-4:** Each maina command (plan, spec, design, review-design, commit, verify, pr) appends a summary after execution
- **SC-5:** Context engine includes workflow context in the working layer (available to all AI calls)
- **SC-6:** Each step summary is concise (<100 tokens, 2-3 lines)
- **SC-7:** Workflow context file is human-readable markdown

## Out of Scope

- Cross-session workflow tracking (workflow context is per-feature-branch)
- Automatic summary generation via AI (summaries are deterministic from command output)
- Background RL feedback recording (that's #15)
- Post-workflow learning (that's #16)

## Design

### Workflow Context File

`.maina/workflow/current.md` — plain markdown, appended by each command:

```markdown
# Workflow: feature/014-workflow-context

## plan (2026-04-04T13:50:00Z)
Feature 014 scaffolded. Branch: feature/014-workflow-context. Files: spec.md, plan.md, tasks.md.

## design (2026-04-04T13:52:00Z)
ADR 0004 created. Design review: passed, 0 errors, 2 warnings (missing HLD/LLD).

## commit (2026-04-04T14:00:00Z)
Verified: 8 tools, 0 findings. Committed: feat(core): add workflow context module.

## verify (2026-04-04T14:01:00Z)
Pipeline passed: 951 tests, 8 tools, 0 findings.
```

### Module

New file: `packages/core/src/workflow/context.ts`

```typescript
interface WorkflowStep {
  step: string;        // "plan" | "spec" | "design" | "commit" | etc.
  timestamp: string;   // ISO 8601
  summary: string;     // 2-3 lines, <100 tokens
}

function appendWorkflowStep(mainaDir: string, step: string, summary: string): void
function loadWorkflowContext(mainaDir: string): string | null
function resetWorkflowContext(mainaDir: string, featureName: string): void
```

### Integration Points

1. `packages/cli/src/commands/plan.ts` — call `resetWorkflowContext()` then `appendWorkflowStep("plan", ...)`
2. `packages/cli/src/commands/design.ts` — call `appendWorkflowStep("design", ...)`
3. `packages/cli/src/commands/review-design.ts` — call `appendWorkflowStep("design-review", ...)`
4. `packages/cli/src/commands/commit.ts` — call `appendWorkflowStep("commit", ...)`
5. `packages/cli/src/commands/verify.ts` — call `appendWorkflowStep("verify", ...)`
6. `packages/cli/src/commands/pr.ts` — call `appendWorkflowStep("pr", ...)`
7. `packages/core/src/context/working.ts` — include workflow context in `loadWorkingContext()`

### Context Engine Integration

`loadWorkingContext()` already reads `.maina/context/working.json` and PLAN.md. Add workflow context as a new field:

```typescript
interface WorkingContext {
  branch: string;
  planContent: string | null;
  workflowContext: string | null;  // NEW — from .maina/workflow/current.md
  touchedFiles: string[];
  lastVerification: VerificationResult | null;
  updatedAt: string;
}
```

This makes workflow context available to every AI call via the context engine's working layer.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/workflow/context.ts` | NEW — appendWorkflowStep, loadWorkflowContext, resetWorkflowContext |
| `packages/core/src/workflow/__tests__/context.test.ts` | NEW — tests |
| `packages/core/src/context/working.ts` | Add workflowContext field, load from .maina/workflow/current.md |
| `packages/cli/src/commands/plan.ts` | Reset + append workflow step |
| `packages/cli/src/commands/design.ts` | Append workflow step |
| `packages/cli/src/commands/review-design.ts` | Append workflow step |
| `packages/cli/src/commands/commit.ts` | Append workflow step |
| `packages/cli/src/commands/verify.ts` | Append workflow step |
| `packages/cli/src/commands/pr.ts` | Append workflow step |
| `packages/core/src/index.ts` | Export new public API |
