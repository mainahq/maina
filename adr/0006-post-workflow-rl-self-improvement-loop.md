# 0006. Post-workflow RL self-improvement loop

Date: 2026-04-04

## Status

Proposed

## Context

Feature 015 added `workflow_step` and `workflow_id` columns to feedback records, but nothing reads them. `maina learn` only shows per-command metrics, missing workflow-level patterns.

## Decision

Add `analyseWorkflowFeedback` and `analyseWorkflowRuns` functions to the evolution module. Enhance `maina learn` to show per-step accept rates and recent workflow run summaries. This completes the RL feedback loop: record → analyze → improve.

## Consequences

### Positive

- Per-step visibility: which workflow phases underperform
- Per-run tracking: see if overall workflow quality is trending up
- Data foundation for future correlation analysis

### Negative

- More output in `maina learn` — could feel overwhelming
- Workflow data sparse until enough features go through full lifecycle

### Neutral

- Builds on existing feedback.db schema (no new tables)
- Same A/B testing mechanism, just more data to inform decisions
