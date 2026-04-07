# Decision: v0.5.0 Cloud Client + maina-cloud

> Status: **accepted**

## Context

Maina is local-only. Teams need shared prompts, feedback, and A/B testing coordination. The cloud infrastructure must be private (business logic), while the CLI client stays open source.

## Decision

Split into two repos: open-source CLI client in mainahq/maina, private Workers service repo (mainahq/maina-cloud). Shared types ensure API contract consistency. GitHub OAuth device flow for auth. Workkit packages power the cloud service.

## Rationale

### Positive

- Cloud business logic stays private
- CLI client is open source — community can see how sync works
- Shared types prevent API drift
- Workkit dogfooding starts immediately

### Negative

- Two repos to maintain
- Shared types need manual sync (mitigated by shared types package later)
- OAuth device flow is more complex than simple API key

### Neutral

- Cloud repo is standard Cloudflare Workers project
- API client follows existing Result<T, E> pattern

## Affected Entities

- `packages/core/src/cloud/types.ts`
