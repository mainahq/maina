# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Add a `release-sourcemaps` job to the existing CI workflow that runs on tag pushes. Generates source maps during build, uploads them alongside the release. Version extracted from package.json via `jq`.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `.github/workflows/release-sourcemaps.yml` | CI workflow for sourcemap upload on tag | New |
| `packages/cli/bunup.config.ts` or build config | Enable sourcemap generation | Modified (if needed) |

## Tasks

- [ ] T1: Create release-sourcemaps workflow
- [ ] T2: Enable sourcemap generation in build
- [ ] T3: Add version extraction + tagging step
- [ ] T4: Verify workflow syntax with actionlint
