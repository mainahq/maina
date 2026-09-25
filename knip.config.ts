import type { KnipConfig } from "knip";

/**
 * Dead-code gate. CI runs `bun run knip` and fails on any finding, so the
 * only acceptable state is zero. Delete unused code instead of ignoring it.
 *
 * Tests are entry points: exports used only by tests (DI seams, pure
 * helpers under test) count as used. Production entries carry a `!` suffix
 * so the second pass, `knip --production --include files`, proves every
 * source file is reachable from a real entry point, not just from its own
 * test. Both passes run under `bun run knip`.
 */
const TESTS = "src/**/__tests__/**/*.test.ts";

const config: KnipConfig = {
	workspaces: {
		".": {
			entry: [
				"ci/e2e/simulate-agent.ts!",
				"scripts/*.ts!",
				"scripts/dogfood/*.ts!",
				"scripts/**/__tests__/*.test.ts",
			],
			project: ["ci/e2e/*.ts!", "scripts/**/*.ts!"],
		},
		"packages/cli": {
			entry: [TESTS],
			project: ["src/**/*.ts!"],
		},
		"packages/core": {
			entry: [TESTS, "src/__golden__/**/*.test.ts"],
			// Test-only helpers (scanner, allow-list, port fakes, golden
			// fixtures) are reachable from tests, not from production entries.
			project: [
				"src/**/*.ts!",
				"!src/**/__tests__/**!",
				"!src/__golden__/**!",
				"!src/ports/testing.ts!",
			],
		},
		"packages/runtime": {
			entry: ["src/**/__tests__/**/*.test.ts"],
			project: ["src/**/*.ts"],
		},
		"packages/mcp": {
			entry: [TESTS],
			project: ["src/**/*.ts!"],
		},
		"packages/skills": {
			entry: ["__tests__/**/*.test.ts"],
			project: ["**/*.ts"],
		},
		"packages/docs": {
			// Starlight loads `customCss` by path, which knip cannot follow.
			entry: ["scripts/*.ts!", "src/styles/global.css!", TESTS],
			project: ["src/**!", "scripts/**/*.ts!"],
		},
	},
	// Tailwind v4 is wired through CSS `@import`s, which knip does not parse
	// natively; surface them as imports so the packages count as used.
	compilers: {
		css: (text: string) =>
			[...text.matchAll(/(?<=@)import[^;]+/g)].map(([m]) => m).join("\n"),
	},
};

export default config;
