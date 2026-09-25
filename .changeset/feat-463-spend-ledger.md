---
"@mainahq/core": minor
"@mainahq/mcp": patch
---

`budget.dailyUsd` and `budget.perTaskUsd` are now enforced across calls. Every model call `generate()` makes is recorded in a spend ledger in `.maina/stats.db` (token usage × the tier's price, or the routing estimate when the provider reports no usage), and routing reads today's and the running task's spend from it. Routing decisions and their savings estimates are kept in the same store instead of being dropped. A cached answer is served before routing, so it is never blocked by the budget and never charged. The MCP server runs each tool call as its own spend task (`runAsSpendTask`), so the per-task cap counts one call, not the whole session.
