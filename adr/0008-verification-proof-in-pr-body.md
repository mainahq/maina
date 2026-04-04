# 0008. Verification proof in PR body

Date: 2026-04-04

## Status

Proposed

## Context

PRs include no evidence that verification ran. Reviewers must trust claims like "tests pass" without proof.

## Decision

Add `buildVerificationProof` to gather pipeline, test, review, slop, and visual results into a formatted markdown section. `maina pr` appends this proof to the PR body automatically using collapsible `<details>` blocks.

## Consequences

### Positive

- Every PR carries auditable verification evidence
- Reviewers can expand sections to see per-tool results
- Visual regression data visible in PR without leaving GitHub

### Negative

- PR body becomes longer (mitigated by collapsible sections)
- Adds ~5-10s to PR creation (runs verification pipeline)

### Neutral

- Does not block PR creation on failure — just reports
