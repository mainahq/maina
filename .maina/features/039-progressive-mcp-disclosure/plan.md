# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Modify `packages/mcp/src/server.ts` to conditionally register tools. Add `list_tools` as a meta-tool that returns descriptions for all available tools. The `--all-tools` flag passes through to the server creation function.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/mcp/src/server.ts` | Split registration into core/extended, add list_tools | Modified |
| `packages/mcp/src/__tests__/server.test.ts` | Tests for progressive disclosure | Modified |
| `packages/cli/src/index.ts` | Pass --all-tools flag | Modified |

## Tasks

- [x] T1: Add `list_tools` meta-tool that returns all tool descriptions
- [x] T2: Split tool registration into core (3) and extended (7+)
- [x] T3: Add `allTools` option to `createMcpServer()`
- [x] T4: Update CLI to pass `--all-tools` flag
- [x] T5: Update tests
- [x] T6: maina verify + slop
