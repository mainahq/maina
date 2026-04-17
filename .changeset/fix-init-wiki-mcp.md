---
"@mainahq/core": patch
"@mainahq/mcp": patch
---

Fix init, wiki, and MCP issues:

- fix(core): CI workflow template uses actual package.json script names instead of hardcoded `bun run check` (#79)
- feat(core): CI workflow uses `maina verify` with cloud and fallback options (#82)
- feat(core): constitution architecture section includes workspace layout, package names, and project description for monorepos (#83)
- fix(core): wiki architecture article reads descriptions from package.json with README fallback instead of hardcoded dictionary (#81)
- fix(core): wiki module articles use meaningful names derived from file paths instead of generic cluster-N (#80)
- fix(mcp): cap getContext output at 50K characters and use focused budget to prevent MCP token limit errors
