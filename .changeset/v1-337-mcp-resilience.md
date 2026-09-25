---
"@mainahq/mcp": patch
---

MCP error isolation and real version (FR-MCP-5): a tool whose capability throws (or rejects) now answers with a structured `{ data: null, error: { kind: "failed", message }, meta }` result instead of an unstructured SDK error, and the server keeps serving the next call. `serverInfo.version`, `meta.version` and `status.version` all report maina's own `VERSION` from `@mainahq/core`; the injectable runtime no longer carries a version of its own. While serving, every console method is routed to stderr so stdout carries protocol frames only.
