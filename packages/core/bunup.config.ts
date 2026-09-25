import { defineConfig } from "bunup";

// Published as compiled JS + declarations (#294). `target: "node"` keeps the
// bundle loadable without Bun; Bun-only drivers are loaded lazily at use.
export default defineConfig({
	entry: ["src/index.ts"],
	format: "esm",
	target: "node",
	// Declarations via tsc inference, not isolated declarations: exports like
	// the drizzle tables have inferred types, which isolated mode emits as
	// `unknown` (and fails the build under CI=true, as in the release job).
	dts: { inferTypes: true },
	clean: true,
	sourcemap: "external",
});
