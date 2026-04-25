# Verification Plan: [FEATURE NAME]

**Spec**: [link to spec.md]
**Branch**: `[###-feature-name]`
**Status**: Draft
**Receipt section**: drives the "policy compliance" checks on the receipt

> Maina's plan template. **HOW** a feature is built (the spec answered WHAT).
> Keep planning concerns out of the spec and verification concerns out of
> the plan; the separation is what lets the receipt grade each layer
> independently.

## Constitution gate

> Before any line of code, the plan must pass the constitution gate. Every
> rule below is non-negotiable for this feature; if a rule is violated the
> plan goes back, not forward.

- [ ] **Stack alignment** — feature uses the constitution's locked stack
      (Bun, TypeScript strict, Biome, bun:test, bunup, Commander).
- [ ] **Result<T, E> error model** — no thrown errors at module
      boundaries.
- [ ] **Single LLM call per command** — exception requires explicit note.
- [ ] **Diff-only filter** — verifier reports findings on changed lines
      only.
- [ ] **Copy discipline (C2)** — no vague-absence framing in any
      user-facing string this plan adds (see the constitution for
      affirmative wording examples).
- [ ] **Retry policy (C3)** — agent retries are recorded; receipt status
      goes `partial` at cap.
- [ ] **Cross-agent rules (C4)** — `.maina/constitution.md` is canonical;
      derived agent rule files are emitted, not hand-edited.

If any box is unchecked, the plan must say *why* and capture a
`[NEEDS CLARIFICATION: …]` marker until the gap is resolved.

## Architecture summary

[2-4 sentences. Where this feature lives in the codebase, which layer it
extends, what it does NOT touch.]

## Module map

> One row per file you'll add or change. Each row's "purpose" must trace
> back to a spec FR-### or success criterion. If it doesn't trace, the
> module is unjustified.

| Path | Add/Edit | Purpose | Traces to |
|---|---|---|---|
| `packages/core/src/[area]/[file].ts` | add | [why] | FR-001, FR-003 |
| `packages/cli/src/commands/[file].ts` | add | [why] | FR-002 |
| `packages/core/src/[area]/__tests__/[file].test.ts` | add | unit coverage | FR-001, SC-001 |

## Data + API contracts

> Types, schemas, error envelopes — anything Maina or downstream consumers
> will key off of. Lock them here; spec stays implementation-agnostic.

```ts
// Sketch the public API the feature exposes.
interface FeatureContract {
  // ...
}
```

[List of breaking-change risks, if any. Each risk gets a mitigation.]

## Verification approach

> The pipeline already runs Biome + Semgrep + Trivy + Secretlint + diff-cover
> + slop + two-stage AI review. List anything *additional* this feature
> requires.

- **Unit tests**: [what categories — happy / edge / error / security /
  integration]
- **Bench tests**: [if perf-sensitive — what story / metric / threshold]
- **AI review prompts**: [if the feature changes how reviews work, name the
  prompt files touched]
- **Receipt fields**: [if the feature affects what lands on the receipt,
  list the fields]

## Out-of-band steps

> Things a contributor can't run from `maina commit` — DNS records, npm
> publish, secret rotation, manual database migration. Surface them so
> they're not silently forgotten.

- [Step 1 — who runs it, prerequisites, rollback]
- [Step 2 — same shape]

## Open questions

> Anything the plan cannot answer without more info. Each gets a
> `[NEEDS CLARIFICATION: …]` marker so it's grep-able. Plans don't ship
> with markers; the spec might.

- [NEEDS CLARIFICATION: open question 1 — describe the ambiguity]
- [NEEDS CLARIFICATION: open question 2 — describe the ambiguity]
