# Verification Tasks: [FEATURE NAME]

**Spec**: [link to spec.md]
**Plan**: [link to plan.md]
**Branch**: `[###-feature-name]`

> Maina's task list. WHEN — the order in which the spec + plan get
> implemented. Each task traces to a journey from the spec and to a module
> from the plan; if it doesn't trace, the task isn't justified yet.
>
> Mark tasks `[x]` as you complete them. Reviewers (and future
> contributors reading the receipt walkthrough) lean on the checkbox
> state to gauge completeness; gating `maina pr` on full task
> completion is a follow-up automation, not a current enforcement
> guarantee.

## TDD discipline

Every implementation task in this list is paired with a test task that
**lands first** and **fails first**. Red, then green, then refactor.
Skipping the failing-test step is a slop signal — Maina's pipeline catches
it as a tasks-vs-implementation drift.

## Phases

> Run phases in order. Within a phase, tasks may be parallelised if marked
> `[parallel]`. The verifier reports phase-by-phase progress on the
> receipt walkthrough.

### Phase 1 — Foundation (P1 only)

> Just enough to make P1 demoable. No P2 or later until P1 is verifiable
> end-to-end.

- [ ] **T-001** Test (red): [what the test asserts] — covers FR-001
  - File: `packages/core/src/[area]/__tests__/[file].test.ts`
- [ ] **T-002** Implement: [the smallest module that makes T-001 green]
  - File: `packages/core/src/[area]/[file].ts`
- [ ] **T-003** [parallel] Test (red): [boundary case] — covers FR-001 edge
- [ ] **T-004** [parallel] Implement: [boundary handling]
- [ ] **T-005** Wire into CLI / public surface
  - File: `packages/cli/src/commands/[name].ts`

### Phase 2 — P2 journey

- [ ] **T-101** Test (red): [P2 journey assertion] — covers FR-002
- [ ] **T-102** Implement: [smallest module making T-101 green]
- [ ] **T-103** Documentation: surface in `maina --help` + relevant docs page
- [ ] **T-104** Receipt impact (if any): name the field + add a render test

### Phase 3 — Hardening + polish

- [ ] **T-201** Slop guard: ensure all AI output paths have a slop check
- [ ] **T-202** Copy review: every user-facing string passes the C2 grep
- [ ] **T-203** Performance smoke: p95 [stays under N ms / matches SC-002]
- [ ] **T-204** Cross-platform smoke: Bun + Node (where the package
  declares Node compatibility)

## Out-of-band tasks

> Tasks that require something `maina` can't do for the contributor —
> DNS, secrets, publish. Track them here so they don't fall off the
> bottom of the list when the implementation tasks are all `[x]`.

- [ ] **OB-1** [User action — e.g. "create CNAME `schemas.…` →
  `mainahq.github.io`"]
- [ ] **OB-2** [User action — e.g. "set NPM_TOKEN secret on repo"]
- [ ] **OB-3** [User action — e.g. "tag `v1.0.0` to publish"]

## Verification rollup

> When every task in Phases 1–3 is `[x]` and every OB- task either
> completes or is explicitly deferred, the feature is `maina pr`-ready.
> Receipt reviewers can scan the checkbox state to assess completeness.
> Automated checkbox-gating in the `maina pr` flow is a follow-up; for
> now this section is the social-contract scoreboard, not a hard gate.
