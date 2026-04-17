# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/constitution/git-analyzer.ts`. Uses `Bun.spawn` for git commands, `fs` for CI/CODEOWNERS. All analyzers run in parallel via `Promise.all`.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/constitution/git-analyzer.ts` | All 4 analyzers + combined runner | New |
| `packages/core/src/constitution/__tests__/git-analyzer.test.ts` | 9 tests | New |

## Tasks

- [x] T1: Implement `analyzeCommitConventions()` with conventional commit regex
- [x] T2: Implement `analyzeHotPaths()` with git log --name-only
- [x] T3: Implement `analyzeCiWorkflows()` reading .github/workflows/*.yml
- [x] T4: Implement `analyzeCodeowners()` checking 3 possible paths
- [x] T5: Implement `analyzeGitAndCi()` combining all in parallel
- [x] T6: Write 9 tests covering real repo + temp dir scenarios
