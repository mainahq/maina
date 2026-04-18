---
"@mainahq/cli": patch
"@mainahq/core": patch
---

fix(mcp): prefer installed maina binary over bunx (avoids cold-start cache races)

`maina mcp add` now writes the **direct path to the installed `maina` binary** when one is on PATH (e.g. `/Users/x/.bun/bin/maina --mcp`), falling back to `bunx`/`npx` only when the global install is absent.

**Why:** real Cursor MCP logs against the v1.4.2 entry showed:

```
[error] Resolved, downloaded and extracted [24]
[error] Unexpected: failed copying files from cache to destination for package drizzle-orm
[warning] Connection failed: MCP error -32000: Connection closed
```

The previous default — `bunx @mainahq/cli` on every spawn — re-resolved the package each time Cursor (re)connected. Concurrent connection attempts during editor restart raced on `~/.bun/install/cache` and one would error mid-extraction, killing the spawned process before it could complete the MCP handshake. Going through the installed binary path skips the package manager entirely: zero downloads, zero cache, zero race.

**Fallback chain (each tier resolves to absolute path via `Bun.which`):**

1. **`maina` binary** — preferred. No package manager spawn.
2. **`bunx @mainahq/cli@<version> --mcp`** — version-pinned so the bunx cache hits reliably across spawns even on cold start.
3. **`npx @mainahq/cli@<version> --mcp`** — universally available fallback.
4. Bare `npx` last-resort fallback so the entry stays syntactically valid on machines without Bun or Node.

When `mcp add` falls back to a package-manager invocation (no global install present), the CLI prints a one-line tip pointing at `bun install -g @mainahq/cli` so users can opt into the fastest path.

5 new launcher tests lock in the priority order and the absolute-path contract. All existing apply tests continue to pass under the version-pinned shape.
