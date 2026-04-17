# Decision: GitHub Checks API integration

> Status: **accepted**

## Context

Maina's verify-action posts inline review comments on findings. But there's no GitHub Check Run — teams can't use "required status checks" to gate merges, and there's no pass/fail summary in the PR status box.

## Decision

Create a GitHub Check Run via `POST /repos/{owner}/{repo}/check-runs` with:
- **Conclusion**: `success` (no errors), `failure` (errors found), `neutral` (warnings only)
- **Summary**: "18/20 passed · 2 warnings"
- **Annotations**: up to 50 line-level annotations from verify findings
- **Details URL**: `mainahq.com/r/<run-id>` when available

Use `fetch` directly — no Octokit dependency. Same pattern as `sticky-comment.ts`.

## Rationale

### Positive
- Teams can gate merges on Maina verification
- Quick pass/fail visible in PR status box
- Annotations link to exact file:line in the diff

### Negative
- Requires `checks:write` permission (GitHub App or PAT)
- 50-annotation limit may truncate large finding sets
