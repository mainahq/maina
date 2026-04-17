# Decision: Kill decision — Passmark adoption

> Status: **accepted**

## Context

Passmark was considered as a browser automation tool for visual verification. Evaluation:

- Passmark wraps Playwright — it's not a replacement, it's a layer on top
- FSL license has a "Competing Use" clause — risky for a verification tool
- 185 GitHub stars — not battle-tested
- Stagehand (MIT, larger community) does the same thing without the Redis requirement

## Decision

Do not adopt Passmark. Evaluate Stagehand instead (gated by ADR 0014 experiment criteria).

## Rationale

- Stagehand evaluation scheduled as #126 (feature-flagged spike)
- Playwright remains the baseline for scripted browser verification
- No licensing risk from FSL
