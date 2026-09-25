import { readFileSync } from "node:fs";
import { defineConfig } from "bunup";

/**
 * Line 2 of the sh/JS header src/index.ts starts with. The bundler keeps the
 * `#!/bin/sh` hashbang but drops comments, so the line is re-added as a
 * banner right below the hashbang. Read from the source: one definition.
 */
const LAUNCH_HEADER = readFileSync(
	new URL("./src/index.ts", import.meta.url),
	"utf-8",
).split("\n")[1];

// Compiled bin (#294). `target: "node"` so `maina --version` / `--help` run
// under Node; the header prefers Bun (which most commands still need) and
// falls back to Node.
export default defineConfig({
	banner: LAUNCH_HEADER,
	entry: ["src/index.ts"],
	format: "esm",
	target: "node",
	dts: false,
	clean: true,
	splitting: false,
	sourcemap: "external",
	external: ["@mainahq/core", "@mainahq/mcp"],
});
