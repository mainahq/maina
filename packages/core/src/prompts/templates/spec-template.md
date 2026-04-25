# Verification Specification: [FEATURE NAME]

**Branch**: `[###-feature-name]`
**Created**: [DATE]
**Status**: Draft
**Receipt target**: this spec is what `maina verify` checks the diff against

> Maina's spec template. WHAT a feature must do (and what it must hold true)
> in language a verification pipeline can grade against. The plan template
> handles HOW; the tasks template handles WHEN. Keep them separated — the
> separation is what makes receipts trustworthy.

## User journeys *(mandatory)*

> Each journey is **independently verifiable** — implementing one alone
> still ships a viable slice. Prioritise from P1 (most critical) downward.
> Maina's verify pipeline traces each task back to a P-numbered journey, so
> a journey that doesn't appear here is unverifiable by definition.

### Journey 1 — [Brief title] (Priority: P1)

[Plain-language description of the journey.]

**Why P1**: [The user value and why this is most critical.]

**Independent verification**: [How a single deployable slice of this journey
can be verified in isolation. Name the user action and the observable
outcome.]

**Acceptance scenarios**:

1. **Given** [initial state], **When** [action], **Then** [outcome]
2. **Given** [initial state], **When** [action], **Then** [outcome]

---

### Journey 2 — [Brief title] (Priority: P2)

[Plain-language description.]

**Why P2**: [Value rationale.]

**Independent verification**: [How this slice can be verified alone.]

**Acceptance scenarios**:

1. **Given** [initial state], **When** [action], **Then** [outcome]

---

[Add P3, P4, … as needed. Each journey must stand on its own.]

### Edge cases

> Concrete failure / boundary scenarios the verifier should exercise. Avoid
> vague "what if X" — write them as testable cases.

- [Boundary or unusual input — what the system MUST do]
- [Failure mode — what the system MUST NOT do]

## Requirements *(mandatory)*

> Each requirement is one MUST or MUST NOT statement. The verifier maps
> requirement → check → finding. If a requirement can't be expressed as a
> check, it's underspecified — mark it `[NEEDS CLARIFICATION: …]` and
> resolve before implementation begins.

### Functional requirements

- **FR-001**: System MUST [specific capability]
- **FR-002**: System MUST [specific capability]
- **FR-003**: Users MUST be able to [interaction]
- **FR-004**: System MUST [data requirement]
- **FR-005**: System MUST [observable behaviour]

*Example of a clarification marker (resolve before merging):*

- **FR-006**: System MUST authenticate via [NEEDS CLARIFICATION: SSO,
  email+password, OAuth, or device code?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION:
  retention period in days]

### Key entities *(only if the feature handles data)*

- **[Entity 1]**: [What it represents and its key attributes — *no*
  implementation hints; the spec is technology-agnostic.]
- **[Entity 2]**: [Same shape. Note relationships, not foreign keys.]

## Success criteria *(mandatory)*

> Technology-agnostic, measurable, observable in production. The verifier
> uses these as the success oracle when the receipt is rendered.

### Measurable outcomes

- **SC-001**: [Metric, e.g. "p95 task completion time under 90 s"]
- **SC-002**: [Metric, e.g. "system handles 1k concurrent users with no
  degradation in p95 latency"]
- **SC-003**: [Adoption metric, e.g. "≥ 90% of users complete the primary
  task on first attempt"]
- **SC-004**: [Business metric, e.g. "support volume on topic X drops by
  ≥ 50% within four weeks"]

## Assumptions

> Defaults Maina chose because the input didn't specify. Each assumption
> becomes a check the verifier evaluates against the running system.

- [Assumption about users — e.g. "stable internet connectivity"]
- [Scope boundary — e.g. "mobile is out of scope for v1"]
- [Environment dependency — e.g. "reuses the existing auth system"]
- [External system contract — e.g. "depends on the user-profile API at v2"]

## Out of scope

> Explicit "this spec does NOT cover" list. Without an out-of-scope list,
> ambiguous additions creep in and the verifier has nothing to push back on.

- [What this spec is intentionally not promising]
