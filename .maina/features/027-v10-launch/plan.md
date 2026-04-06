# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

No architecture changes. This is community infrastructure + bug fix + repo migration.

## Tasks

### Phase 1: Bug fix
- [ ] T001: Fix brainstorm --no-interactive to generate real content instead of placeholders (#47)
- [ ] T002: Write test for brainstorm --no-interactive output

### Phase 2: Community files (maina repo)
- [ ] T003: Create CONTRIBUTING.md (dev setup, PR guidelines, commit conventions, testing)
- [ ] T004: Create .github/ISSUE_TEMPLATE/bug_report.yml
- [ ] T005: Create .github/ISSUE_TEMPLATE/feature_request.yml
- [ ] T006: Create .github/PULL_REQUEST_TEMPLATE.md
- [ ] T007: Create CODEOWNERS (map packages to maintainers)

### Phase 3: Repo transfers
- [ ] T008: Transfer beeeku/maina → mainahq/maina
- [ ] T009: Transfer beeeku/maina-cloud → mainahq/maina-cloud
- [ ] T010: Update all internal references (package.json homepage, README, docs, CLAUDE.md)
- [ ] T011: Enable GitHub Discussions on mainahq/maina
- [ ] T012: Set up branch protection on mainahq repos

### Phase 4: Launch content
- [ ] T013: Write Show HN post draft
- [ ] T014: Write dev.to article draft
- [ ] T015: Update docs landing page with v1.0 messaging

### Phase 5: Release
- [ ] T016: Create changeset for v1.0.0 (major bump)
- [ ] T017: Version bump + npm publish
- [ ] T018: Close issue #46

## Dependencies

```
T001-T002 (bug fix) — independent
T003-T007 (community files) — independent
T001-T007 → T008-T012 (transfers after code changes)
T008-T012 → T013-T015 (launch content needs final URLs)
T015 → T016-T018 (release after everything)
```

Parallelizable: Phase 1 || Phase 2

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| packages/cli/src/commands/brainstorm.ts | Fix --no-interactive stub output | Modified |
| CONTRIBUTING.md | Contributor guide | New |
| .github/ISSUE_TEMPLATE/bug_report.yml | Bug report template | New |
| .github/ISSUE_TEMPLATE/feature_request.yml | Feature request template | New |
| .github/PULL_REQUEST_TEMPLATE.md | PR template | New |
| CODEOWNERS | Package maintainer mapping | New |
| package.json | Update homepage URL | Modified |
| README.md | Update repo URLs | Modified |
| CLAUDE.md | Update repo URLs | Modified |

## Definition of Done

- [ ] All tests pass
- [ ] Bug #47 fixed and tested
- [ ] Community files in place
- [ ] Repos at mainahq org
- [ ] GitHub Discussions enabled
- [ ] Show HN draft ready
- [ ] v1.0.0 published to npm
