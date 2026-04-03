# Feature: Interactive Design Workflow

## Problem Statement

`maina spec` generates test stubs mechanically from plan.md — it doesn't explore requirements or surface ambiguity before implementation. `maina design` creates ADRs but doesn't help the user think through approaches. When building UI-heavy features (like the docs landing page), we had to use Superpowers brainstorming skill to iterate on design, then manually translate that into maina artifacts. This gap causes:

1. Specs that miss edge cases because requirements weren't explored through questions
2. Designs that pick the first approach without considering alternatives
3. No feedback loop between design exploration and spec/plan artifacts

## Target User

- Primary: Developer using maina for feature development who needs to explore requirements before coding
- Secondary: AI agent (Claude Code, Cursor) using maina MCP tools to plan work

## User Stories

- As a developer, I want `maina spec` to ask me clarifying questions one at a time so that ambiguities are resolved before test stubs are generated.
- As a developer, I want `maina design` to propose 2-3 approaches with tradeoffs so that I make informed architectural decisions.
- As an AI agent, I want the MCP `suggestTests` tool to surface questions before generating stubs so that specs are higher quality.

## Success Criteria

- [ ] `maina spec` in interactive mode asks 3-5 clarifying questions derived from plan.md before generating stubs
- [ ] `maina spec --no-interactive` skips questions and generates stubs directly (current behavior preserved)
- [ ] `maina design` proposes 2-3 approaches with pros/cons/recommendation before writing the ADR
- [ ] `maina design --no-interactive` skips proposals and writes ADR directly (current behavior preserved)
- [ ] MCP `suggestTests` tool returns questions as part of its response when ambiguities are detected
- [ ] Questions are derived from actual plan.md content, not generic templates
- [ ] User answers are recorded in spec.md under a "Clarifications" section
- [ ] Approach selection is recorded in the ADR under "Alternatives Considered"
- [ ] Spec quality score improves (baseline: 67/100 average)

## Scope

### In Scope

- Interactive question-asking in `maina spec` (B)
- Multiple approach proposals in `maina design` (C)
- Recording answers/decisions in spec.md and ADR
- MCP tool integration for `suggestTests`
- `--no-interactive` flag for CI/subagent use

### Out of Scope

- Visual companion / browser mockups (A) — future sprint
- Redesigning existing commands beyond spec and design
- Chat-style multi-turn conversation (questions are one-shot per run)
- Custom question templates (use AI to derive from plan content)

## Design Decisions

- **One question at a time in terminal** (inspired by Superpowers brainstorming): Each question gets its own @clack/prompts `text()` or `select()` call. This prevents overwhelming the user. The AI generates 3-5 questions from the plan, presents them sequentially.
- **AI generates questions, not templates**: Questions come from analyzing plan.md content (what's ambiguous, what has multiple valid interpretations, what edge cases aren't covered). Not from a static checklist.
- **Approaches are ranked with recommendation**: `maina design` proposes 2-3 approaches, each with pros/cons, and highlights a recommendation with reasoning. User picks one or asks for more detail.
- **Answers persist in artifacts**: Clarifications go into spec.md (used by future `maina spec` runs). Approach decisions go into ADR (used by `maina review design`).

## Open Questions

- None — scope is clear. B and C are independent features that share the interactive pattern.
