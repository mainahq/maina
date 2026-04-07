---
"@mainahq/cli": patch
---

Fix MCP server not found: move @mainahq/mcp from devDependencies to dependencies and import by package name instead of relative path. Fixes `maina --mcp` when installed from npm.
