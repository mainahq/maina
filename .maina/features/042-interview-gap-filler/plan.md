# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/constitution/interview.ts`. Pure functions for question generation, rejected rule persistence (YAML-like format in `.maina/rejected.yml`), and proposal filtering. No interactive UI — that's the CLI layer's job.

## Key Technical Decisions

- Simple key-value YAML format for rejected.yml (no external YAML parser needed)
- 3 fixed questions — not AI-generated (deterministic, fast)
- `ConstitutionRule` type reused from git-analyzer.ts with confidence 0.8 (human-provided)

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/constitution/interview.ts` | Interview questions + rejected rules | New |
| `packages/core/src/constitution/__tests__/interview.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs from spec (red phase)
- [ ] T2: Implement `getInterviewQuestions()` — 3 fixed questions
- [ ] T3: Implement `loadRejectedRules()` / `saveRejectedRules()` — persistence
- [ ] T4: Implement `filterProposals()` — remove rejected from proposals
- [ ] T5: Implement `buildRulesFromAnswers()` — answers → ConstitutionRule[]
- [ ] T6: `maina verify` + `maina review` + `maina analyze`
