# Feature: MCP install badges on mainahq.com hero

## Problem Statement

The hero shows a curl install command but no one-click MCP setup for agent-native users (Claude Code, Cursor, Windsurf). These users want to add Maina to their IDE in one click, not copy-paste JSON.

## Success Criteria

- [ ] Three badges next to the curl command: "Add to Claude Code", "Add to Cursor", "Add to Windsurf"
- [ ] Each badge works end-to-end on a clean machine
- [ ] Snippets reference the `@mainahq/cli`-installed `maina` binary
- [ ] Badges render above the fold on mobile (<=375px width)
- [ ] No layout shift on badge render

## Scope

### In Scope
- Three badge components in the Hero
- Claude Code: `claude mcp add-json maina '{"command":"maina","args":["--mcp"]}'`
- Cursor: deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=maina&config=<base64>`
- Windsurf: copy MCP config to clipboard with toast notification

### Out of Scope
- Other IDEs (Cline, Roo, etc.) — future issue
- Badge click analytics (needs telemetry first)
