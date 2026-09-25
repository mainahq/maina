import { defineConfig } from "bunup";

// Published as compiled JS + declarations (#294). `target: "node"` keeps the
// bundle loadable without Bun; Bun-only drivers are loaded lazily at use.
export default defineConfig({
	entry: ["src/index.ts"],
	format: "esm",
	target: "node",
	dts: true,
	clean: true,
	sourcemap: "external",
});
