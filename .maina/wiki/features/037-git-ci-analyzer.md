# Feature: Implementation Plan

## Scope

### In Scope - `analyzeCommitConventions()`, `analyzeHotPaths()`, `analyzeCiWorkflows()`, `analyzeCodeowners()` - Combined `analyzeGitAndCi()` running all in parallel - Each rule has `{ text, confidence, source }` ### Out of Scope - Interactive propose/accept flow (separate issue #117) - Writing rules to constitution.md (consumer responsibility)

## Tasks

Progress: 6/6 (100%)

- [x] T1: Implement analyzeCommitConventions (conventional commit regex, scope extraction)
- [x] T2: Implement analyzeHotPaths (git log --name-only, top N churn)
- [x] T3: Implement analyzeCiWorkflows (read .github/workflows/*.yml)
- [x] T4: Implement analyzeCodeowners (check 3 paths: root, .github/, docs/)
- [x] T5: Implement analyzeGitAndCi (parallel combination)
- [x] T6: Write tests (9 tests: CI workflows, CODEOWNERS, commit conventions, hot paths, combined)

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
