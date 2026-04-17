# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/github/checks.ts`. Uses `fetch` directly against the GitHub Checks API (`POST /repos/{owner}/{repo}/check-runs`). Reuses the `Result<T, E>` pattern from the codebase. Same auth pattern as `sticky-comment.ts`.

## Key Technical Decisions

- Direct `fetch` — no Octokit dependency, consistent with sticky-comment.ts
- `Finding` type from verify pipeline maps to GitHub annotation format
- Max 50 annotations per API call (GitHub limit)
- Conclusion mapping: errors → failure, warnings-only → neutral, clean → success

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/github/checks.ts` | Check Run creation + annotation formatting | New |
| `packages/core/src/github/__tests__/checks.test.ts` | Tests with mock fetch | New |

## Tasks

TDD: write tests first from spec stubs, then implement.

- [ ] T1: Write test stubs from spec criteria (red phase)
- [ ] T2: Implement `formatAnnotations()` — Finding[] → GitHub annotation format
- [ ] T3: Implement `determineConclusion()` — findings → success/failure/neutral
- [ ] T4: Implement `createCheckRun()` — POST to GitHub Checks API
- [ ] T5: Run `maina verify` + `maina review` + `maina analyze`

## Failure Modes

- GitHub token lacks `checks:write` → return error Result with clear message
- More than 50 findings → truncate annotations, note in summary
- API rate limit → return error Result

## Testing Strategy

- Mock `fetch` for all API calls (same pattern as sticky-comment tests)
- Test all 3 conclusion states: success, failure, neutral
- Test annotation formatting with various finding types
- Test auth header handling
