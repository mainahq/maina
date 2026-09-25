import { defineConfig } from "bunup";

// Published as compiled JS + declarations (#294). Core stays an external
// dependency so the CLI, MCP server and core share one copy.
export default defineConfig({
	entry: ["src/index.ts"],
	format: "esm",
	target: "node",
	dts: true,
	clean: true,
	sourcemap: "external",
	external: ["@mainahq/core"],
});
