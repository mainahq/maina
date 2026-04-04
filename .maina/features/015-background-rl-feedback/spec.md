# Feature 015: Background Non-Blocking RL Feedback at Each Workflow Step

## Problem

The RL feedback loop only records accept/reject on commit messages and reviews. It misses workflow-level data — which specs led to clean implementations, which design reviews caught real issues. The `recordFeedback` calls are synchronous, adding latency. There's no workflow step identifier, so `maina learn` can't analyze per-step performance.

## Success Criteria

- **SC-1:** `recordFeedbackAsync(mainaDir, record)` fires async and never blocks the calling command (<1ms overhead)
- **SC-2:** Feedback records include `workflowStep` field (plan, spec, design, review, commit, verify, pr)
- **SC-3:** Feedback records include `workflowId` field (hash of feature branch name — links all steps in a workflow run)
- **SC-4:** Every CLI command that appends a workflow step also records feedback async
- **SC-5:** `maina learn` shows per-workflow-step accept rates (not just per-command)
- **SC-6:** Existing synchronous `recordFeedback` still works (backward compatible)

## Out of Scope

- Workflow-level correlation analysis (that's #16)
- Prompt evolution changes (that's #16)
- New DB schema — extend existing feedback table with nullable columns

## Design

### Async Feedback Recording

New function in `packages/core/src/feedback/collector.ts`:

```typescript
export function recordFeedbackAsync(
  mainaDir: string,
  record: FeedbackRecord & { workflowStep?: string; workflowId?: string },
): void {
  // Fire and forget — use queueMicrotask to avoid blocking
  queueMicrotask(() => {
    try {
      recordFeedback(mainaDir, record);
    } catch {
      // Never throw from background feedback
    }
  });
}
```

### Extended Feedback Schema

Add nullable columns to existing feedback table:
- `workflow_step TEXT` — "plan", "design", "commit", etc.
- `workflow_id TEXT` — hash of branch name (links all steps in one workflow)

### Workflow ID

Derived from the current branch name: `hash(branchName)`. Every command in the same feature branch gets the same workflow ID, linking them.

### CLI Integration

Each command that already calls `appendWorkflowStep` also calls `recordFeedbackAsync` with the step name and workflow ID. The feedback is the command's outcome (passed/failed, accepted/rejected).

### Learn Enhancement

`maina learn` queries feedback grouped by `workflow_step` in addition to `command`. Shows:
```
Step         Samples  Accept  Status
──────────── ──────── ──────── ────────
plan              12     92%  healthy
design             8     75%  needs improvement
review            36     44%  needs improvement
commit            84     83%  healthy
verify            45     95%  healthy
```

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/feedback/collector.ts` | Add `recordFeedbackAsync`, extend `FeedbackRecord` |
| `packages/core/src/db/index.ts` | Add workflow_step + workflow_id columns to feedback table |
| `packages/cli/src/commands/plan.ts` | Record async feedback |
| `packages/cli/src/commands/design.ts` | Record async feedback |
| `packages/cli/src/commands/review-design.ts` | Record async feedback |
| `packages/cli/src/commands/commit.ts` | Record async feedback |
| `packages/cli/src/commands/verify.ts` | Record async feedback |
| `packages/cli/src/commands/pr.ts` | Record async feedback |
| `packages/cli/src/commands/learn.ts` | Show per-step metrics |
| `packages/core/src/index.ts` | Export new function |
