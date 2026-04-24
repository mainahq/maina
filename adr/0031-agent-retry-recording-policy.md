# 0031. Agent-retry recording policy

Date: 2026-04-25

## Status

Accepted

## Context

When an AI coding agent can see its own verification receipt and iterate on failed checks, the receipt loses meaning as a trust signal — the agent grinds until it passes, then publishes "passed" like the first attempt worked. This is Risk 3 in the 2026-04-25 direction doc. We need an explicit policy before Wave 2 ships the receipt generator, or implementation inherits an ambiguous guarantee.

Options considered:

1. **Pure record** — log every retry; no cap. Preserves audit trail but lets adversarial loops run indefinitely.
2. **Pure cap** — block after N attempts; no retry count on receipt. Prevents loops but leaves no audit trail for reviewers.
3. **Record + cap** — both. Every receipt carries `retries: N`; default cap at 3, configurable in constitution. At cap, status forces `partial`.

## Decision

**Option 3: record + cap at 3 default, configurable.**

- Every receipt has a `retries: number` field (non-negative integer; v1 schema, see sibling ADR in [mainahq/maina#232](https://github.com/mainahq/maina/pull/232) as `adr/0030-receipt-v1-field-schema.md`).
- Default cap: `3`. Configurable via `.maina/constitution.md` Retry section.
- At cap: receipt is emitted with `status: "partial"` regardless of underlying check outcomes. Downstream UI (receipt page, GitHub App check) renders a visible "retried N times, capped" badge.
- Under cap with `retries > 0`: receipt emits its true status, but renders a "retried N times" badge so reviewers can weigh the signal accordingly.

### Configuration

```markdown
## Retry Policy

- max_retries: 3
- partial_status_at_cap: true
```

### What counts as a retry

A retry is a new `maina verify` or `maina pr` invocation on the same branch + same HEAD agent-delta (the set of files the agent has touched since last commit by a human). Manual human commits reset the counter; pure agent-driven iterations increment.

## Consequences

### Positive

- Audit trail preserved — every retry is durably recorded on the final receipt
- Adversarial grinding capped — agent can't loop its way to green after 3 failed attempts without human intervention
- Tunable per-team — high-trust teams can raise the cap; strict-compliance teams can lower it
- Copy discipline (C2) respects the signal — "retried 2 times" is honest, not adversarial

### Negative

- Legitimate edge case: a human-directed retry (user says "fix and try again") counts against the cap. Mitigated by the human-commit-resets-counter rule, but a stubborn agent-driven fix can still hit the cap on a genuinely-tricky real bug. Accepted: at cap, status becomes `partial`, which is a softer signal than `failed` and doesn't block merging — just flags it.
- Retry count can be spoofed if an attacker controls both the agent and the receipt generator. Out of scope for v1 (integrity-only hashing per sibling ADR 0030); mitigated in v2 by keypair-signed receipts tied to the CI runner identity.

## References

- Direction doc (private): `mainahq/maina-cloud:strategy/DIRECTION_AND_BUILD_PLAN_2026_04_25.md` Risk 3
- Tracking issue: [mainahq/maina#230](https://github.com/mainahq/maina/issues/230)
- Sibling schema ADR: ships in [mainahq/maina#232](https://github.com/mainahq/maina/pull/232) as `adr/0030-receipt-v1-field-schema.md` (defines the `retries` field)
- Constitution update ticket: [mainahq/maina#231](https://github.com/mainahq/maina/issues/231) (materializes as C3)
