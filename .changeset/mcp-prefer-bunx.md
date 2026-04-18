---
"@mainahq/cli": patch
"@mainahq/core": patch
---

fix(mcp): auto-prefer `bunx` over `npx` when Bun is installed

`maina mcp add` now detects whether [Bun](https://bun.sh) is on the user's PATH at install time and writes `bunx @mainahq/cli --mcp` (5-10× faster startup) when it is, falling back to `npx @mainahq/cli --mcp` (universally available via npm) otherwise.

Surfaced from real-world dogfooding: a developer's existing entries used `bunx` (faster on their machine), and the v1.4.0 hard-coded `npx` would have regressed their config. Detection at install time fixes this without forcing a launcher choice on users who don't have Bun.

Implementation:

- New `packages/core/src/mcp/launcher.ts` with `detectLauncher({ which?, noCache? })` — single-shot `which("bunx")` probe with cache and a test-injectable lookup.
- `entry.ts` and every client's `buildEntry` (including the wrapper shapes for Continue and Zed) now call the detector.
- Existing apply tests pin the launcher to `npx` in `beforeEach` so assertions stay stable across CI (no Bun) and developer machines (has Bun). 6 new launcher tests cover detection, fallback, caching, and reset.
