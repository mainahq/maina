# Maina Skills

Drop these into your AI agent's skills directory to get maina's verification workflow.

Each skill follows a standard format with frontmatter metadata (name, description, triggers) and progressive disclosure: scan the description in under 100 tokens, read the full skill in under 5000 tokens.

## Available Skills

| Skill | Description |
|-------|-------------|
| `verification-workflow` | Full verify pipeline: syntax guard, parallel tools, diff-only filter |
| `context-generation` | 4-layer context retrieval with dynamic token budgets |
| `plan-writing` | Spec-first planning with consistency validation |
| `code-review` | Two-stage review: spec compliance then code quality |
| `tdd` | Test-driven development from generated stubs |

## Installation

### Claude Code

Copy skill directories to your project or reference via plugin. Claude Code will detect SKILL.md files and use their triggers to activate the appropriate workflow.

### Cursor

Add skill content to `.cursorrules` or reference in settings. The frontmatter triggers help Cursor match user intent to the right workflow.

### Codex

Reference SKILL.md files in `AGENTS.md`. Codex agents will follow the step-by-step instructions when triggered.

### Gemini CLI

Include skill content in your project's context files. Gemini CLI reads the triggers and steps to guide its workflow.
