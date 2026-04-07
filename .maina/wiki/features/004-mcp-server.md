# Feature: Implementation Plan

## Scope

### In Scope - stdio MCP server with @modelcontextprotocol/sdk - 8 tools delegating to existing engines - Cache-aware responses - `maina --mcp` flag on CLI entrypoint ### Out of Scope - HTTP/SSE transport (stdio only for v1) - MCP resources/prompts (tools only for v1) - Auto-installation into IDE configs

## Tasks

Progress: 0/6 (0%)

- [ ] T001: Install @modelcontextprotocol/sdk, write tests and implement MCP server scaffold with stdio transport
- [ ] T002: Write tests and implement context tools (getContext, getConventions) delegating to Context Engine + Prompt Engine
- [ ] T003: Write tests and implement verify tools (verify, checkSlop) delegating to Verify Engine
- [ ] T004: Write tests and implement feature tools (suggestTests, analyzeFeature) delegating to Features module
- [ ] T005: Write tests and implement explain tool (explainModule) delegating to Explain module
- [ ] T006: Wire --mcp flag into CLI entrypoint and test end-to-end

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
