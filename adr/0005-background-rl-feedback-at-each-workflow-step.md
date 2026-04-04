# 0005. Background RL feedback at each workflow step

Date: 2026-04-04

## Status

Proposed

## Context

The RL feedback loop only captures commit message and review outcomes. Workflow-level data (which specs led to clean code, which reviews caught issues) is lost. Feedback calls are synchronous, adding latency.

## Decision

Add `recordFeedbackAsync` that fires via `queueMicrotask` — zero blocking. Extend feedback records with `workflowStep` and `workflowId` fields. Every CLI command that appends workflow context also records async feedback. `maina learn` shows per-step accept rates.

## Consequences

### Positive

- Full workflow trace captured for every feature
- Zero latency impact — async recording never blocks commands
- `maina learn` can analyze per-step patterns (which steps have low accept rates)

### Negative

- Slightly more data in feedback.db (one row per workflow step per feature)
- Async recording means feedback might be lost if process exits immediately

### Neutral

- Backward compatible — existing `recordFeedback` unchanged
- Uses `queueMicrotask` (Bun native) instead of setTimeout
