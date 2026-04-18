---
"@mainahq/cli": patch
"@mainahq/core": patch
---

fix(mcp): write absolute launcher path so Cursor / Zed can spawn it

`maina mcp add` now writes the **resolved absolute path** of `bunx` / `npx` (e.g. `/opt/homebrew/bin/bunx`) into client configs, instead of the bare binary name.

**Why:** GUI-launched AI clients on macOS (Cursor, Zed, Claude Code app) inherit a stripped PATH that does NOT include `/opt/homebrew/bin` or `~/.bun/bin`. A bare `command: "bunx"` therefore fails with `Connection failed: spawn bunx ENOENT` — even though the binary is installed for the user. Surfaced from real Cursor logs against an entry written by v1.4.1.

The detector now probes both `bunx` and `npx` via `Bun.which`, prefers the absolute `bunx` path when available, falls back to absolute `npx`, and only emits a bare name as a last-resort fallback when neither resolves on the install machine.

Five new launcher tests lock in the absolute-path contract and the prefer-bunx-over-npx priority. Existing apply tests still pin to the bare `npx` fallback for snapshot stability.

This is a strict bug fix on top of v1.4.1 — same `maina mcp add` interface, just produces working entries on real machines.
