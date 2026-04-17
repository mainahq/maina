# Feature: Source map + release tracking in CI

## Problem Statement

Without source maps, stack traces from error reporting (PostHog) are unreadable minified garbage. Without release tracking, errors can't be bucketed by Maina version.

## Target User

- Primary: Maina maintainers debugging crash reports
- Secondary: Contributors investigating error patterns across releases

## Success Criteria

- [ ] GitHub Actions workflow step uploads source maps on tag push
- [ ] Release version tag in every error event matches package.json
- [ ] Stack traces link back to GitHub source at the exact commit
- [ ] Covers @mainahq/cli, MCP server, any TS/Node modules
- [ ] CI workflow added to `.github/workflows/release.yml`

## Scope

### In Scope
- CI workflow for source map upload on release tags
- Version extraction from package.json in CI
- Source map generation enabled in build config

### Out of Scope
- PostHog source map processing (PostHog handles this server-side)
- Python components (no Python in maina)
