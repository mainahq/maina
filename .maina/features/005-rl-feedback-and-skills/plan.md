# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- Pattern: Event-driven feedback pipeline — every AI output is an event that flows through collection → storage → analysis → evolution
- Integration points: tryAIGenerate (feedback collection), commitAction (finding dismissal), maina learn (analysis), episodic layer (few-shot), packages/skills/ (SKILL.md files)

## Key Technical Decisions

- Wire feedback into existing tryAIGenerate helper — single integration point for all AI calls
- Preferences stored as JSON not DB — human-readable, git-trackable
- Skills are standalone markdown files — no build step, no dependencies

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| packages/core/src/feedback/collector.ts | Wire feedback collection into AI calls | New |
| packages/core/src/feedback/preferences.ts | Track per-rule false positive rates | New |
| packages/core/src/feedback/compress.ts | Compress accepted reviews into episodic few-shot | New |
| packages/core/src/ai/try-generate.ts | Add feedback recording after each AI call | Modified |
| packages/skills/verification-workflow/SKILL.md | Verification workflow skill | New |
| packages/skills/context-generation/SKILL.md | Context generation skill | New |
| packages/skills/plan-writing/SKILL.md | Plan writing skill | New |
| packages/skills/code-review/SKILL.md | Code review skill | New |
| packages/skills/tdd/SKILL.md | TDD skill | New |

## Tasks

- [ ] T001: Write tests and implement feedback collector — wire into tryAIGenerate to record every AI interaction
- [ ] T002: Write tests and implement preference learning — track dismissed findings, write preferences.json
- [ ] T003: Enhance maina learn to propose improved prompts with A/B testing when accept rate drops
- [ ] T004: Write tests and implement episodic compression — accepted reviews become few-shot examples
- [ ] T005: Create skills package with 5 SKILL.md files using progressive disclosure
- [ ] T006: Test skills work in Claude Code context — verify metadata scanning and activation

## Failure Modes

- feedback.db write failure → silently skip, never block AI output
- preferences.json parse error → reset to defaults
- A/B test with insufficient data → keep incumbent, don't promote
- Skill file missing → agent continues without maina workflow

## Testing Strategy

- Feedback collector: unit tests with temp DB, verify records created
- Preferences: unit tests with temp JSON, verify dismiss/restore
- Learn: existing tests plus new A/B promotion tests
- Episodic compression: unit test with sample review, verify token count < 500
- Skills: file existence + content structure tests (frontmatter, sections, token count)
