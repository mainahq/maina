---
"@mainahq/mcp": minor
"@mainahq/cli": patch
"@mainahq/skills": patch
---

Agent files, skills and docs now name the v1 MCP tools (#465). `maina setup` renders the tool list in CLAUDE.md, `.cursor/rules/maina.mdc`, `.github/copilot-instructions.md` and `.windsurf/rules/maina.md` from the MCP catalog instead of hand-typing it, so they no longer tell agents to call the retired 1.x tools (`getContext`, `reviewCode`, `checkSlop`, `getConventions`, `explainModule`, `suggestTests`, `analyzeFeature`, `wikiQuery`, `wikiStatus`). The skills point at `context`, `review_triage`, `spec_check`, `verify` and the allow-listed DeepWiki tools. `@mainahq/mcp` adds a dependency-free `@mainahq/mcp/catalog` entry that exports the tool names, one line of guidance per tool (`TOOL_USAGE`), `RETIRED_TOOLS`, `renderToolList` and `findRetiredTools`. In this repo, markdown tool lists sit between `maina:mcp-tools` markers: `bun run docs:tools` renders them, and `bun run docs:check` fails on a stale list or a retired tool name.
