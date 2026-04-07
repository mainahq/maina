# Feature: Implementation Plan

## Spec Assertions

- [ ] `maina ticket` creates a GitHub Issue via the gh CLI
- [ ] Ticket includes a title and body provided by the user via interactive prompts
- [ ] Context Engine semantic layer auto-detects relevant modules and adds them as labels
- [ ] Supports `--title` and `--body` flags for non-interactive use
- [ ] Supports `--label` flag to add custom labels
- [ ] Gracefully handles missing gh CLI with helpful error message
- [ ] Works without AI — module tagging uses tree-sitter entity index, not LLM

## Tasks

Progress: 0/4 (0%)

- [ ] T001: Write tests for core ticket module — detectModules, buildIssueBody, createTicket
- [ ] T002: Implement packages/core/src/ticket/index.ts with gh CLI integration
- [ ] T003: Write tests for maina ticket CLI command — interactive and non-interactive modes
- [ ] T004: Implement packages/cli/src/commands/ticket.ts and register in program.ts

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
