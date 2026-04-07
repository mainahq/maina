---
"@mainahq/core": patch
"@mainahq/mcp": patch
---

Fix MCP server inside Claude Code: suppress all delegation output in MCP server mode via MAINA_MCP_SERVER env flag. Prevents stderr pollution that breaks MCP JSON-RPC communication.
