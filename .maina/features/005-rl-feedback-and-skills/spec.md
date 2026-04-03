# Feature: RL Feedback Loop + Skills Package

## Problem Statement

AI-generated outputs (reviews, commit messages, explanations) have no feedback mechanism. We can't tell if prompts are improving or degrading. And maina's verification workflow can't be used by other AI agents (Cursor, Codex) without the CLI installed.

## Target User

- Primary: Developer using maina who wants prompts to get smarter over time based on their accept/reject behavior
- Secondary: AI agent (Claude Code, Cursor, Codex) that needs maina's workflow without installing the CLI

## User Stories

- As a developer, I want every AI output to ask me if it was helpful so prompts improve over time
- As a developer, I want `maina learn` to propose better prompts when accept rates drop
- As a developer, I want accepted reviews to become few-shot examples for future reviews
- As a Cursor user, I want to drop a SKILL.md file and get maina's verification workflow

## Success Criteria

- [ ] Every tryAIGenerate call records prompt hash, task, accepted/rejected, and optional modification to feedback.db
- [ ] Per-rule false positive tracking: when a verification finding is dismissed, record it in preferences.json to reduce noise
- [ ] `maina learn` proposes improved prompts via createCandidate when accept rate drops below 60%
- [ ] Accepted AI reviews are compressed and stored as episodic few-shot examples for future context
- [ ] Skills package ships with SKILL.md files for: verification-workflow, context-generation, plan-writing, code-review, tdd
- [ ] Skills use progressive disclosure: metadata under 100 tokens, full content under 5k tokens
- [ ] Skills work cross-platform: Claude Code, Cursor, Codex, Gemini CLI

## Scope

### In Scope

- Feedback collection wired into tryAIGenerate and commit flow
- Preference learning from dismissed findings
- Episodic compression of accepted reviews
- Skills SKILL.md files in packages/skills/

### Out of Scope

- Online learning (real-time prompt updates) — batch only via `maina learn`
- Custom model fine-tuning
- Skills marketplace or registry

## Design Decisions

- Feedback is append-only to feedback.db — never delete, always accumulate
- Preferences.json is a simple JSON file, not a DB — easy to edit manually
- Skills use markdown with frontmatter — works in any tool that reads .md files
- A/B testing uses 80/20 split: 80% new candidate, 20% incumbent
