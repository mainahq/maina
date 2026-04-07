# Decision: Visual verification with Playwright

> Status: **proposed**

## Context

Maina verifies code correctness but not visual correctness. Web projects can pass all gates and still ship broken layouts. This is the last verification gap.

## Decision

Add visual verification using Playwright for screenshots and pixelmatch for pixel comparison. Opt-in via `maina verify --visual`. Baselines stored in `.maina/visual-baselines/` and committed to git. Configurable threshold and URLs in preferences.json.

## Rationale

### Positive

- Visual regressions caught before merge
- Baselines as source of truth — reviewable in PRs
- No external service dependency (all local)

### Negative

- Requires Playwright installed (graceful skip if missing)
- Slower than static analysis (~5-10s per page)
- Baselines add to repo size (PNG files)

### Neutral

- Opt-in only — doesn't slow default verify
- Chromium-only for v1, expandable later
