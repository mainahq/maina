# 0004. Workflow context forwarding

Date: 2026-04-04

## Status

Proposed

## Context

Each maina workflow step is stateless. Step N has no knowledge of steps 1 through N-1. This causes AI calls to miss spec decisions, design review flags, and prior verification results.

## Decision

Add a rolling workflow context file (`.maina/workflow/current.md`) that each maina command appends to. The context engine includes this in the working layer, making it available to all AI calls. `maina plan` resets it for new features.

## Consequences

### Positive

- Every workflow step has full context from prior steps
- AI calls (review, commit, design) make better decisions with workflow history
- Human-readable markdown — easy to inspect and debug

### Negative

- File grows with each step (~100 tokens per step, ~1000 tokens for a full workflow)
- Must be reset correctly on new features to avoid stale context

### Neutral

- Follows the same file-based pattern as working.json
