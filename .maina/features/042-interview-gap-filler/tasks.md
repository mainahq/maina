# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs from spec (18 red, confirmed failing)
- [x] T2: Implement `getInterviewQuestions()` — 3 fixed questions
- [x] T3: Implement `loadRejectedRules()` / `saveRejectedRules()` — persistence with dedup
- [x] T4: Implement `filterProposals()` — remove rejected from proposals
- [x] T5: Implement `buildRulesFromAnswers()` — answers → ConstitutionRule[] (12 tests green)
- [x] T6: `maina verify` + `maina review` + `maina analyze`

## Dependencies

- Reuses `ConstitutionRule` type from `git-analyzer.ts`

## Definition of Done

- [ ] All tests pass (red → green)
- [ ] Biome lint + TypeScript clean
- [ ] maina verify + slop + review + analyze pass
