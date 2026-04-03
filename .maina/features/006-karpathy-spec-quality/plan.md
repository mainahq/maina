# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- Pattern: New quality module + integration into existing commands
- Integration points: features/quality.ts (new), features/traceability.ts (new), stats/tracker.ts (skip tracking), cli/spec.ts (red-green), cli/stats.ts (--specs flag)

## Key Technical Decisions

- Verb-based measurability scoring — regex pattern matching, no NLP dependencies
- Skip tracking reuses existing stats.db commit_snapshots table (add skipped column)
- Traceability uses git log parsing + file glob matching — deterministic

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| packages/core/src/features/quality.ts | scoreSpec() with measurability, testability, ambiguity, completeness | New |
| packages/core/src/features/traceability.ts | traceability() maps task → test + code + commit | New |
| packages/core/src/stats/tracker.ts | Add skip tracking to recordSnapshot | Modified |
| packages/cli/src/commands/spec.ts | Add red-green enforcement (run stubs, verify all fail) | Modified |
| packages/cli/src/commands/stats.ts | Add --specs flag for spec quality evolution | Modified |

## Tasks

- [ ] T001: Write tests and implement spec quality scoring in packages/core/src/features/quality.ts
- [ ] T002: Write tests and implement skip event tracking in stats/tracker.ts
- [ ] T003: Add red-green enforcement to maina spec — auto-run stubs and verify all fail
- [ ] T004: Write tests and implement plan-to-code traceability in packages/core/src/features/traceability.ts
- [ ] T005: Add --specs flag to maina stats showing spec quality evolution over time

## Failure Modes

- Spec with no acceptance criteria → score 0, warning
- Skip tracking write failure → silently skip, never block commit
- Red-green enforcement: stubs that pass → warning, not blocking (user may have partially implemented)
- Traceability: missing git history → skip tracing, report what's available

## Testing Strategy

- Quality scoring: unit tests with sample specs (good vs bad), verify score ranges
- Skip tracking: unit test with temp DB, verify skip flag recorded
- Red-green: integration test that runs actual bun test on generated stubs
- Traceability: unit test with temp feature dir + mock git log
