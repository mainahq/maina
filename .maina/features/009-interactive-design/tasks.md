# Task Breakdown

## Tasks

### Part B: Interactive Spec Questions

- [ ] Task 1: Create spec-questions.md prompt template for clarifying questions (AC-6)
- [ ] Task 2: Write failing tests for generateSpecQuestions() — clarifying questions from plan (AC-1, AC-6)
- [ ] Task 3: Implement generateSpecQuestions() — derive questions from plan content (AC-1, AC-6)
- [ ] Task 4: Write failing tests for spec clarifying questions flow, --no-interactive skip, answers recorded in Clarifications (AC-1, AC-2, AC-7)
- [ ] Task 5: Add question phase to specAction() — ask questions, record answers in Clarifications (AC-1, AC-7)
- [ ] Task 6: Add --no-interactive flag to spec command — skip questions, preserve current behavior (AC-2)
- [ ] Task 7: Update MCP suggestTests to include questions when ambiguities detected (AC-5)

### Part C: Multi-Approach Design

- [ ] Task 8: Create design-approaches.md prompt template for approaches with tradeoffs (AC-3)
- [ ] Task 9: Write failing tests for generateDesignApproaches() — propose approaches with pros/cons (AC-3, AC-8)
- [ ] Task 10: Implement generateDesignApproaches() — approaches with recommendation (AC-3)
- [ ] Task 11: Write failing tests for design approaches with pros/cons, --no-interactive skip, selection recorded in ADR Alternatives Considered (AC-3, AC-4, AC-8)
- [ ] Task 12: Add approach phase to designAction() — propose approaches, record in ADR Alternatives Considered (AC-3, AC-8)
- [ ] Task 13: Add --no-interactive flag to design command — skip proposals, preserve current behavior (AC-4)

### Integration

- [ ] Task 14: Export clarifying questions and design approaches functions for spec and design commands (AC-1, AC-3)
- [ ] Task 15: Verify spec quality score improves — run full verification, fix findings (AC-9)
- [ ] Task 16: Verify spec quality score improves above 67/100 baseline — run analyze for consistency (AC-9)

## Dependencies

- Tasks 2-3 depend on Task 1 (prompt template needed for AI generation)
- Tasks 4-6 depend on Task 3 (question generation needed for interactive flow)
- Task 7 depends on Task 3
- Tasks 9-10 depend on Task 8
- Tasks 11-13 depend on Task 10
- Task 14 depends on Tasks 3, 10
- Tasks 15-16 depend on all others

## Definition of Done

- [ ] All tests pass (803+ tests)
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] maina analyze shows no errors
- [ ] `maina spec` asks 3-5 questions from plan.md before generating stubs
- [ ] `maina spec --no-interactive` preserves current behavior
- [ ] `maina design` proposes 2-3 approaches before writing ADR
- [ ] `maina design --no-interactive` preserves current behavior
- [ ] Answers recorded in spec.md under ## Clarifications
- [ ] Approach selection recorded in ADR under ## Alternatives Considered
