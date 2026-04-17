# Feature: Ship Maina as a Playwright MCP interop partner

## Problem Statement

Playwright MCP (`@playwright/mcp`, Microsoft, Apache-2.0) is gaining traction. Maina's verify engine can consume Playwright results. Publishing "Maina works with Playwright MCP" gives free distribution via Microsoft's MCP directory.

## Success Criteria

- [ ] Docs page: "Using Maina with Playwright MCP" in cookbooks
- [ ] Example flow: Claude Code agent → Playwright MCP → Maina verify → report

## Scope

### In Scope
- Cookbook docs page showing the interop flow
- Example MCP config combining both servers

### Out of Scope
- Direct Playwright MCP SDK dependency (they're independent MCP servers)
- MCP registry submission (future marketing task)
