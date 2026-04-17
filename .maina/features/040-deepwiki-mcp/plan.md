# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New tool registration file `packages/mcp/src/tools/deepwiki.ts`. Each tool delegates to existing wiki engine functions in `@mainahq/core`. Registered in server.ts alongside existing tools.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/mcp/src/tools/deepwiki.ts` | 3 DeepWiki-compatible tools | New |
| `packages/mcp/src/server.ts` | Register deepwiki tools | Modified |
| `packages/mcp/src/__tests__/server.test.ts` | Update tool count tests | Modified |

## Tasks

- [x] T1: Implement `ask_question` — delegates to wiki query
- [x] T2: Implement `read_wiki_structure` — returns article index
- [x] T3: Implement `read_wiki_contents` — returns article content
- [x] T4: Register in server.ts
- [x] T5: Update tests
