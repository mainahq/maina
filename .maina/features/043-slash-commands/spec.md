# Feature: Slash commands parser for PR comments

## Problem Statement

Users want to interact with Maina from PR comments: retry verification, get explanations for specific findings, or approve warnings. A slash command parser extracts `/maina <cmd>` from comment text and returns structured command data.

## Target User

- Primary: Developers reviewing PRs who want to interact with Maina inline
- Secondary: CI automation triggering actions from PR comments

## Success Criteria

- [ ] `parseSlashCommand(text)` extracts command from comment text
- [ ] Supports: `retry`, `explain`, `approve`
- [ ] Returns null for non-matching comments
- [ ] Handles `/maina` with no subcommand gracefully
- [ ] Handles extra whitespace and case variations
- [ ] Unit tests for all commands and edge cases

## Scope

### In Scope
- Command parser (pure function: text → parsed command or null)
- Command types and validation
- ACL check helper (PR author + write permission)

### Out of Scope
- Webhook handler (maina-cloud repo)
- GitHub API calls (separate module)
- Bot emoji reactions (maina-cloud repo)
