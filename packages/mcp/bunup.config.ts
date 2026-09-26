import { defineConfig } from "bunup";

// Published as compiled JS + declarations (#294). Core stays an external
// dependency so the CLI, MCP server and core share one copy. The catalog
// entry is dependency-free, so the CLI can read tool names without loading
// the server (#465).
export default defineConfig({
	entry: ["src/index.ts", "src/catalog.ts"],
	format: "esm",
	target: "node",
	dts: true,
	clean: true,
	sourcemap: "external",
	external: ["@mainahq/core"],
});
