# Feature: Interview gap-filler + interactive confirm

## Problem Statement

After scanning configs, git history, and code patterns, some conventions can't be auto-detected — they need human input. Questions like "Files AI should never touch?", "Deploy-time gotchas?", "What does every new contributor get wrong?" fill gaps that scanners miss. Rejected rules should persist so subsequent scans don't re-propose them.

## Target User

- Primary: Developers running `maina learn` to build their constitution
- Secondary: Teams onboarding new repos

## User Stories

- As a developer, I want `maina learn` to ask me about things it couldn't detect so the constitution is complete.
- As a team lead, I want rejected rules remembered so I'm not asked the same question twice.

## Success Criteria

- [ ] `interviewGapFiller()` returns 3 fixed questions with structured answers
- [ ] `loadRejectedRules()` reads from `.maina/rejected.yml`
- [ ] `saveRejectedRules()` persists rejected rules
- [ ] `filterProposals()` removes previously rejected rules from new proposals
- [ ] Non-TTY mode writes draft without interaction (returns questions + defaults)
- [ ] Unit tests for all functions

## Scope

### In Scope
- 3 fixed interview questions
- Rejected rules persistence in `.maina/rejected.yml`
- Filtering logic for `maina learn --update`
- Non-TTY mode support

### Out of Scope
- Interactive UI (clack prompts) — that's in the CLI command layer
- AI-generated follow-up questions
