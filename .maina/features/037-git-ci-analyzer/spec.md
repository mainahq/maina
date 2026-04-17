# Feature: Git-log + CI analyzer for constitution rules

## Problem Statement

Constitution rules today are manually authored. Git history and CI config contain implicit conventions (commit format, CI checks, code ownership) that should be auto-detected and proposed as rules.

## Success Criteria

- [x] Detects conventional commit usage rate + common scopes
- [x] Finds top 20 churn files from recent history
- [x] Extracts CI workflow names from `.github/workflows/*.yml`
- [x] Detects CODEOWNERS rules
- [x] Runs in under 5 seconds on repos up to 10k commits
- [x] Graceful degradation on non-git directories and shallow clones

## Scope

### In Scope
- `analyzeCommitConventions()`, `analyzeHotPaths()`, `analyzeCiWorkflows()`, `analyzeCodeowners()`
- Combined `analyzeGitAndCi()` running all in parallel
- Each rule has `{ text, confidence, source }`

### Out of Scope
- Interactive propose/accept flow (separate issue #117)
- Writing rules to constitution.md (consumer responsibility)
