# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Both features (B: interactive spec, C: multi-approach design) follow the same pattern:

1. AI analyzes existing artifacts (plan.md or context) to generate questions/approaches
2. @clack/prompts presents them interactively in the terminal
3. User answers are recorded back into artifacts (spec.md or ADR)
4. Existing generation continues with enriched context

**Integration points:**
- `specAction()` in `packages/cli/src/commands/spec.ts` — insert question phase before `generateTestStubs()`
- `designAction()` in `packages/cli/src/commands/design.ts` — insert approach phase before ADR write
- `tryAIGenerate()` for question/approach generation (new tasks: `spec-questions`, `design-approaches`)
- MCP `suggestTests` tool — include questions in response
- `--no-interactive` flag on both commands to skip for CI/subagents

## Key Technical Decisions

- **AI generates questions from plan content** — not templates. Uses `tryAIGenerate("spec-questions", ...)` with plan.md as input. Returns structured JSON (array of questions with type: text|select).
- **@clack/prompts for interaction** — consistent with existing CLI UX (maina plan, maina design already use it). `text()` for open questions, `select()` for multiple choice.
- **Answers appended to spec.md** — under a `## Clarifications` section. This enriches future spec runs.
- **Approaches rendered as numbered options** — 2-3 approaches with pros/cons. User selects via `select()`. Decision recorded in ADR under `## Alternatives Considered`.
- **New default prompt files** — `spec-questions.md` and `design-approaches.md` in `packages/core/src/prompts/defaults/`.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/prompts/defaults/spec-questions.md` | Prompt for generating clarifying questions from plan | New |
| `packages/core/src/prompts/defaults/design-approaches.md` | Prompt for generating approaches with tradeoffs | New |
| `packages/core/src/ai/spec-questions.ts` | `generateSpecQuestions()` — parse plan, return questions | New |
| `packages/core/src/ai/design-approaches.ts` | `generateDesignApproaches()` — parse context, return approaches | New |
| `packages/core/src/index.ts` | Export new functions | Modified |
| `packages/cli/src/commands/spec.ts` | Add interactive question phase | Modified |
| `packages/cli/src/commands/design.ts` | Add approach proposal phase | Modified |
| `packages/mcp/src/tools/suggest-tests.ts` | Include questions in MCP response | Modified |
| `packages/core/src/ai/__tests__/spec-questions.test.ts` | Tests for question generation | New |
| `packages/core/src/ai/__tests__/design-approaches.test.ts` | Tests for approach generation | New |
| `packages/cli/src/commands/__tests__/spec.test.ts` | Tests for interactive spec flow | Modified |
| `packages/cli/src/commands/__tests__/design.test.ts` | Tests for interactive design flow | Modified |

## Tasks

TDD: every implementation task must have a preceding test task.

### Part B: Interactive Spec Questions

- [ ] Task 1: Create `spec-questions.md` prompt template for clarifying questions (AC-6)
- [ ] Task 2: Write failing tests for `generateSpecQuestions()` — clarifying questions from plan (AC-1, AC-6)
- [ ] Task 3: Implement `generateSpecQuestions()` in `core/ai/spec-questions.ts` — derive questions from plan content (AC-1, AC-6)
- [ ] Task 4: Write failing tests for spec clarifying questions flow, --no-interactive skip, answers recorded in Clarifications (AC-1, AC-2, AC-7)
- [ ] Task 5: Add question phase to `specAction()` — ask clarifying questions, record answers in spec.md Clarifications (AC-1, AC-7)
- [ ] Task 6: Add `--no-interactive` flag to spec command — skip questions, preserve current behavior (AC-2)
- [ ] Task 7: Update MCP `suggestTests` to include questions when ambiguities detected (AC-5)

### Part C: Multi-Approach Design

- [ ] Task 8: Create `design-approaches.md` prompt template for design approaches with tradeoffs (AC-3)
- [ ] Task 9: Write failing tests for `generateDesignApproaches()` — propose approaches with pros/cons (AC-3, AC-8)
- [ ] Task 10: Implement `generateDesignApproaches()` in `core/ai/design-approaches.ts` — approaches with recommendation (AC-3)
- [ ] Task 11: Write failing tests for design approaches with pros/cons, --no-interactive skip, selection recorded in ADR Alternatives Considered (AC-3, AC-4, AC-8)
- [ ] Task 12: Add approach phase to `designAction()` — propose approaches, select, record in ADR Alternatives Considered (AC-3, AC-8)
- [ ] Task 13: Add `--no-interactive` flag to design command — skip proposals, preserve current behavior (AC-4)

### Integration

- [ ] Task 14: Export clarifying questions and design approaches functions for spec and design commands (AC-1, AC-3)
- [ ] Task 15: Verify spec quality score improves — run full verification, fix findings (AC-9)
- [ ] Task 16: Verify spec quality score improves above 67/100 baseline — run `maina analyze` for consistency (AC-9)

## Failure Modes

- **No API key / host delegation**: `generateSpecQuestions()` returns empty array → skip question phase, generate stubs directly (current behavior). Same for approaches.
- **AI returns malformed JSON**: Parse with try/catch, fall back to empty array. Log warning.
- **User cancels interactive prompt**: @clack/prompts returns `isCancel(value)` → exit gracefully, don't write partial answers.
- **plan.md is empty**: Return 0 questions with info message "Plan is empty — fill in plan.md first."

## Testing Strategy

- **Unit tests** for `generateSpecQuestions()` and `generateDesignApproaches()` — mock AI responses, test JSON parsing, test fallback on empty/error.
- **Integration tests** for `specAction()` and `designAction()` — mock deps including the new AI functions, verify questions are asked and answers written.
- **No interactive tests** — verify `--no-interactive` skips question/approach phase entirely.
- **MCP test** — verify `suggestTests` includes questions array in response.
