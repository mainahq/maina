# Feature: GitHub Checks API integration

## Problem Statement

Maina's verify-action posts inline review comments but doesn't create a GitHub Check Run. Without a Check Run, teams can't use GitHub's "required status checks" to gate merges on Maina verification. There's also no summary view — users must scroll through individual comments.

## Target User

- Primary: Teams using Maina CI who want merge gating
- Secondary: Developers wanting a quick pass/fail summary in the PR status box

## User Stories

- As a team lead, I want Maina verification as a required check so broken code can't merge.
- As a developer, I want a quick "18/20 passed · 2 warnings" summary without reading every comment.

## Success Criteria

- [ ] `createCheckRun(options)` creates a GitHub Check Run with conclusion, summary, annotations
- [ ] Conclusion: success / failure / neutral based on findings
- [ ] Summary format: "18/20 passed · 2 warnings"
- [ ] Details URL points to `mainahq.com/r/<run-id>` when available
- [ ] Up to 50 line annotations for failing assertions
- [ ] Works under both GITHUB_TOKEN and GitHub App auth
- [ ] Unit tests cover all conclusion states, annotation formatting, auth handling

## Scope

### In Scope
- `packages/core/src/github/checks.ts` — Check Run creation
- Annotation formatting from verify findings
- Auth header handling (token vs app)

### Out of Scope
- Re-run action button (needs workflow_dispatch, separate issue)
- Required-check rule configuration docs (separate)
- Actual GitHub Action changes (verify-action repo)

## Design Decisions

See plan.md and ADR 0025 for implementation decisions.
