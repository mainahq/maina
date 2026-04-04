# Feature 016: Post-Workflow RL Self-Improvement Loop

## Problem

`maina learn` shows per-command metrics (review: 44%, commit: 83%) but has no visibility into per-workflow-step performance. Feature 015 added `workflow_step` and `workflow_id` to feedback records, but nothing reads them yet. There's no way to see which workflow steps consistently underperform or which workflow runs produced the best outcomes.

## Success Criteria

- **SC-1:** `analyseWorkflowFeedback(mainaDir)` returns per-step metrics (samples, accept rate, needs improvement) using the `workflow_step` column
- **SC-2:** `analyseWorkflowRuns(mainaDir)` returns per-workflow-run metrics grouped by `workflow_id` (how many steps passed, overall success rate)
- **SC-3:** `maina learn` shows a workflow steps table alongside the existing tasks table
- **SC-4:** `maina learn` shows workflow run summaries (last 5 runs: X/Y steps passed)
- **SC-5:** A/B test resolution considers workflow step context — a prompt that performs well in the "review" step should be promoted for that step

## Out of Scope

- Correlation analysis (spec quality → implementation findings) — future
- Auto-generating improved prompts from workflow trace — future
- Per-file language-specific learning — future

## Design

### New Analysis Functions

In `packages/core/src/prompts/evolution.ts`, add:

```typescript
interface WorkflowStepAnalysis {
  step: string;
  totalSamples: number;
  acceptRate: number;
  needsImprovement: boolean;
}

interface WorkflowRunSummary {
  workflowId: string;
  totalSteps: number;
  passedSteps: number;
  successRate: number;
  createdAt: string;
}

function analyseWorkflowFeedback(mainaDir: string): WorkflowStepAnalysis[]
function analyseWorkflowRuns(mainaDir: string, limit?: number): WorkflowRunSummary[]
```

### SQL Queries

Per-step analysis:
```sql
SELECT workflow_step, COUNT(*) as total,
       SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
FROM feedback
WHERE workflow_step IS NOT NULL
GROUP BY workflow_step
```

Per-run summary:
```sql
SELECT workflow_id, COUNT(*) as total_steps,
       SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as passed_steps,
       MIN(created_at) as created_at
FROM feedback
WHERE workflow_id IS NOT NULL
GROUP BY workflow_id
ORDER BY created_at DESC
LIMIT ?
```

### Learn Command Enhancement

`packages/cli/src/commands/learn.ts` adds two new sections after the existing tasks table:

1. **Workflow Steps table** — same format as tasks table but grouped by `workflow_step`
2. **Recent Workflow Runs** — last 5 runs with step pass rates

```
Workflow Steps:
  Step              Samples  Accept  Status
  ──────────────── ──────── ──────── ────────
  plan                  12     92%  healthy
  design                 8     75%  needs improvement
  design-review         10     80%  healthy
  commit                84     83%  healthy
  verify                45     95%  healthy
  pr                     6    100%  healthy

Recent Workflow Runs:
  Workflow ID   Steps  Passed  Rate
  ──────────── ────── ─────── ──────
  a3f8b2c1d4e5   6/6    100%  ✓
  b7d2e9f0a1c3   5/6     83%  —
```

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/prompts/evolution.ts` | Add `analyseWorkflowFeedback`, `analyseWorkflowRuns`, new types |
| `packages/core/src/prompts/__tests__/evolution.test.ts` | Tests for new functions |
| `packages/cli/src/commands/learn.ts` | Show workflow steps + runs tables |
| `packages/core/src/index.ts` | Export new functions + types |
