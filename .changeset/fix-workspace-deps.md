---
"@mainahq/cli": patch
"@mainahq/mcp": patch
---

Fix workspace:* dependencies not resolving on npm install. Changed to workspace:^ so changesets replaces them with ^version during publish.
