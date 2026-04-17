# Feature: Error ID surface (CLI, MCP, PR comments)

## Problem Statement

When maina crashes, users have no quick way to reference the error in a bug report. Maintainers can't correlate "it didn't work" with a specific stack trace. Error IDs give every captured error a short, unique, user-quotable identifier.

## Success Criteria

- [ ] IDs are 6-8 chars, no ambiguous chars (O/0, I/l)
- [ ] `generateErrorId()` is deterministic for the same error (same class + message = same ID)
- [ ] `formatErrorForCli()` and `formatErrorForMcp()` produce CLI-ready and MCP-ready output
- [ ] Unit tests cover ID generation, formatting, and ambiguous char exclusion

## Scope

### In Scope
- Error ID generation function
- CLI stderr format: `Error ERR-ab12cd. Report at github.com/mainahq/maina/issues`
- MCP error format: `{ "error": "...", "error_id": "ERR-ab12cd" }`
- Recent error ID storage (last 5, for `maina doctor`)

### Out of Scope
- Wiring into every CLI command (incremental, per-command)
- PostHog integration (separate issue)
- GitHub issue template (separate issue)
