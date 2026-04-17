# Feature: Progressive MCP tool disclosure

## Problem Statement

MCP handshake exposes all 10 tools upfront, consuming ~20K tokens of the host's context window just for tool descriptions. Most sessions only use 2-3 tools. Exposing all 10 wastes context budget.

## Success Criteria

- [x] Default MCP handshake returns 3 core tools (verify, getContext, reviewCode)
- [x] `list_tools` meta-tool returns all 10 with short descriptions
- [x] `--all-tools` CLI flag opts out of progressive mode
- [x] Config key `mcp.allTools: true` in `.maina/config.yml` for persistent opt-out

## Scope

### In Scope
- Split tool registration into core (3) and extended (7)
- `list_tools` meta-tool that returns descriptions of all tools
- `--all-tools` flag on `maina --mcp`
- Config support

### Out of Scope
- Dynamic tool loading based on project type
- Per-session tool negotiation
