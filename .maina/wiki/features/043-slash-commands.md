# Feature: Implementation Plan

## Scope

### In Scope - Command parser (pure function: text → parsed command or null) - Command types and validation - ACL check helper (PR author + write permission) ### Out of Scope - Webhook handler (maina-cloud repo) - GitHub API calls (separate module) - Bot emoji reactions (maina-cloud repo)

## Tasks

Progress: 5/5 (100%)

- [x] T1: Write TDD test stubs (15 red confirmed)
- [x] T2: Define `SlashCommand` type with retry/explain/approve variants
- [x] T3: Implement `parseSlashCommand(text)` — regex parser (13 tests green)
- [x] T4: Implement `isAuthorized()` — PR author + write perm ACL
- [x] T5: `maina verify` + `maina review` + `maina analyze`

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
