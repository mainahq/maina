# Feature: Implementation Plan

## Scope

### In Scope - 3 fixed interview questions - Rejected rules persistence in `.maina/rejected.yml` - Filtering logic for `maina learn --update` - Non-TTY mode support ### Out of Scope - Interactive UI (clack prompts) — that's in the CLI command layer - AI-generated follow-up questions

## Tasks

Progress: 6/6 (100%)

- [x] T1: Write TDD test stubs from spec (18 red, confirmed failing)
- [x] T2: Implement `getInterviewQuestions()` — 3 fixed questions
- [x] T3: Implement `loadRejectedRules()` / `saveRejectedRules()` — persistence with dedup
- [x] T4: Implement `filterProposals()` — remove rejected from proposals
- [x] T5: Implement `buildRulesFromAnswers()` — answers → ConstitutionRule[] (12 tests green)
- [x] T6: `maina verify` + `maina review` + `maina analyze`

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
