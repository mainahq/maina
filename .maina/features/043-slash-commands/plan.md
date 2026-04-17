# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New module `packages/core/src/github/slash-commands.ts`. Pure parser function — no GitHub API calls, no side effects. The actual webhook handler lives in maina-cloud.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/core/src/github/slash-commands.ts` | Command parser + types | New |
| `packages/core/src/github/__tests__/slash-commands.test.ts` | TDD tests | New |

## Tasks

- [ ] T1: Write TDD test stubs (red phase)
- [ ] T2: Define `SlashCommand` type with command variants
- [ ] T3: Implement `parseSlashCommand(text)` — regex parser
- [ ] T4: Implement `isAuthorized(author, permissions)` — ACL helper
- [ ] T5: `maina verify` + `maina review` + `maina analyze`
