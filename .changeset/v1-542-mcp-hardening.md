---
"@mainahq/mcp": patch
"@mainahq/cli": patch
---

MCP server hardening (#542): an allow-list that names no known tool now serves an empty `tools/list` (with a stderr notice) instead of answering method-not-found; `maina --mcp` and `maina mcp` log a stray async throw or unhandled rejection on stderr and keep serving instead of exiting (a failure to start stays fatal); a prompt whose render throws answers a `failed` error naming the prompt, like a tool.
