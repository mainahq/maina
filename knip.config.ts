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
				"ci/escape/cases.ts!",
				"ci/escape/**/__tests__/*.test.ts",
				"scripts/*.ts!",
				"scripts/dogfood/*.ts!",
				"scripts/fixtures/*.ts!",
				"scripts/release/*.ts!",
				"scripts/**/__tests__/*.test.ts",
				"integrations/**/__tests__/*.test.ts",
			],
			// Test helpers are reachable from tests only.
			project: [
				"ci/e2e/*.ts!",
				"ci/escape/*.ts!",
				"scripts/**/*.ts!",
				"!scripts/**/__tests__/**!",
			],
		},
		"packages/cli": {
			// The bin entry: package.json points at the compiled dist/ (#294).
			entry: ["src/index.ts!", TESTS],
			project: ["src/**/*.ts!"],
		},
		"packages/core": {
			// Benches are run directly (the graph bench by CI's graph-bench
			// job), so nothing imports them.
			entry: [
				TESTS,
				"src/__golden__/**/*.test.ts",
				"bench/*.bench.ts",
				"bench/__tests__/*.test.ts",
			],
			// Test-only helpers (scanner, allow-list, port fakes, golden
			// fixtures) are reachable from tests, not from production entries.
			project: [
				"src/**/*.ts!",
				"!src/**/__tests__/**!",
				"!src/__golden__/**!",
				"!src/ports/testing.ts!",
				"bench/**/*.ts",
			],
		},
		"packages/runtime": {
			// The daemon and the crash fixtures are spawned or compiled by path,
			// the bench is run directly, and the standalone entry is compiled
			// by path, so none of them is reached by an import. The standalone
			// entry is a production entry too: it is the shipped binary, and it
			// wires CLI modules the CLI's own bin does not (`cli statusline`).
			entry: [
				"src/**/__tests__/**/*.test.ts",
				"src/**/__tests__/fixtures/*.ts",
				"src/daemon.ts",
				"src/standalone/main.ts!",
				"bench/*.bench.ts",
				"build/__tests__/*.test.ts",
				"launcher/__tests__/*.test.ts",
				"launcher/__tests__/fixtures/*.ts",
			],
			project: [
				"src/**/*.ts",
				"bench/**/*.ts",
				"build/**/*.ts",
				"launcher/**/*.ts",
			],
		},
		"packages/harness": {
			// Private until release: the orchestrator, the worker registry,
			// the sandbox (adapter + inner-sandbox configuration) and the
			// session manager (parallel runs, cleanup, PTYs) and the permission
			// bridges (ACP, the Claude hook and its process, Codex approvals)
			// are the entries. The fake ACP agent is spawned by path from the
			// orchestrator tests, the crashing session owner from the cleanup
			// tests.
			entry: [
				"src/orchestrator.ts!",
				"src/workers/registry.ts!",
				"src/sandbox/runtime-adapter.ts!",
				"src/sandbox/nested.ts!",
				"src/sessions/parallel.ts!",
				"src/sessions/cleanup.ts!",
				"src/sessions/pty.ts!",
				"src/permissions/acp-bridge.ts!",
				"src/permissions/claude-sdk-hook.ts!",
				"src/permissions/claude-hook-main.ts!",
				"src/permissions/codex-app-server.ts!",
				TESTS,
				"src/__fixtures__/*.ts",
			],
			project: [
				"src/**/*.ts!",
				"!src/**/__tests__/**!",
				"!src/__fixtures__/**!",
			],
		},
		"packages/mcp": {
			// The stdio fixture is spawned by path from the resilience test.
			entry: [
				"src/index.ts!",
				"src/catalog.ts!",
				TESTS,
				"src/__tests__/stdio-fixture.ts",
			],
			// Test fixtures (the fake runtime) are reachable from tests only.
			project: ["src/**/*.ts!", "!src/**/__tests__/**!"],
		},
		"packages/plugins": {
			// `scripts/generate.ts` writes dist/ (`bun run plugins:generate`).
			entry: ["scripts/*.ts!", TESTS],
			project: [
				"scripts/**/*.ts!",
				"src/**/*.ts!",
				"!src/**/__tests__/**!",
				"!src/__fixtures__/**!",
			],
		},
		"packages/remote": {
			// The service process: the Dockerfile runs it by path.
			entry: ["src/main.ts!", TESTS],
			project: ["src/**/*.ts!", "!src/**/__tests__/**!"],
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
	// Built artifact invoked by workflows after `bun run build`; absent in a
	// fresh CI checkout, so keep it ignored even if knip hints otherwise locally.
	ignoreBinaries: ["packages/cli/dist/index.js"],
};

export default config;
