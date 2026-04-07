# Feature: Implementation Plan

## Scope

### In Scope - Feedback collection wired into tryAIGenerate and commit flow - Preference learning from dismissed findings - Episodic compression of accepted reviews - Skills SKILL.md files in packages/skills/ ### Out of Scope - Online learning (real-time prompt updates) — batch only via `maina learn` - Custom model fine-tuning - Skills marketplace or registry

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Write tests and implement feedback collector — wire into tryAIGenerate to record every AI interaction
- [ ] T002: Write tests and implement preference learning — track dismissed findings, write preferences.json
- [ ] T003: Enhance maina learn to propose improved prompts with A/B testing when accept rate drops
- [ ] T004: Write tests and implement episodic compression — accepted reviews become few-shot examples
- [ ] T005: Create skills package with 5 SKILL.md files using progressive disclosure
- [ ] T006: Test skills work in Claude Code context — verify metadata scanning and activation

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
