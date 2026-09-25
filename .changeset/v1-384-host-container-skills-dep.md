---
"@mainahq/cli": patch
---

Host config edits fail closed on a wrong-typed container (#384). When a config already holds the container key with the other shape, such as `"mcpServers": []` or Continue's legacy object `modelContextProtocolServers`, `setEntry` and `deleteEntry` now report the mismatch and name the offending key. Before, they replaced the user's value with an empty container, or silently did nothing. `@mainahq/skills` is now a dependency of `@mainahq/cli`, so a global install ships the skills `maina setup` deploys. The deployer looks in the CLI's own `node_modules` first (npm's global layout), so a stale separately installed `@mainahq/skills` cannot shadow it, then next to the CLI, and resolves from the CLI's own location, not the user's cwd.
