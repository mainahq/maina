import { describe, expect, test } from "bun:test";
import type { StatusDeps } from "../status";
import { statusAction } from "../status";

// ── Mock deps factory ──────────────────────────────────────────────────────

function createMockDeps(overrides?: Partial<StatusDeps>): StatusDeps {
	return {
		loadWorkingContext:
			overrides?.loadWorkingContext ??
			(async (_mainaDir: string, _repoRoot: string) => ({
				branch: "feature/003-pr-and-init",
				touchedFiles: ["src/index.ts", "src/cli.ts"],
				lastVerification: {
					passed: true,
					checks: [
						{ name: "slop", passed: true },
						{ name: "semgrep", passed: true },
						{ name: "trivy", passed: true },
						{ name: "secretlint", passed: true },
					],
					timestamp: "2026-04-03T10:02:01Z",
				},
				updatedAt: "2026-04-03T10:02:01Z",
			})),
		assembleContext:
			overrides?.assembleContext ??
			(async (
				_command: string,
				_options: { repoRoot: string; mainaDir: string },
			) => ({
				tokens: 2605,
				layers: [
					{ name: "working", tokens: 222, included: true },
					{ name: "semantic", tokens: 2328, included: true },
					{ name: "episodic", tokens: 66, included: true },
					{ name: "retrieval", tokens: 0, included: false },
				],
			})),
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("statusAction", () => {
	test("no working context shows 'no data yet' message", async () => {
		const deps = createMockDeps({
			loadWorkingContext: async () => ({
				branch: "main",
				touchedFiles: [],
				lastVerification: null,
				updatedAt: new Date().toISOString(),
			}),
		});

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.branch).toBe("main");
		expect(result.verificationPassed).toBeUndefined();
		expect(result.noVerificationData).toBe(true);
	});

	test("with verification data shows branch, checks, timestamp", async () => {
		const deps = createMockDeps();

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.branch).toBe("feature/003-pr-and-init");
		expect(result.verificationPassed).toBe(true);
		expect(result.checks).toEqual([
			{ name: "slop", passed: true },
			{ name: "semgrep", passed: true },
			{ name: "trivy", passed: true },
			{ name: "secretlint", passed: true },
		]);
		expect(result.timestamp).toBe("2026-04-03T10:02:01Z");
	});

	test("failed verification shows failed status", async () => {
		const deps = createMockDeps({
			loadWorkingContext: async () => ({
				branch: "feature/buggy",
				touchedFiles: ["src/bug.ts"],
				lastVerification: {
					passed: false,
					checks: [
						{ name: "slop", passed: true },
						{ name: "semgrep", passed: false },
						{ name: "trivy", passed: true },
					],
					timestamp: "2026-04-03T11:00:00Z",
				},
				updatedAt: "2026-04-03T11:00:00Z",
			}),
		});

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.verificationPassed).toBe(false);
		expect(result.checks).toBeDefined();
		const failedCheck = result.checks?.find((c) => c.name === "semgrep");
		expect(failedCheck?.passed).toBe(false);
	});

	test("context summary shows token counts per layer", async () => {
		const deps = createMockDeps();

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.contextTokens).toBe(2605);
		expect(result.contextLayers).toEqual([
			{ name: "working", tokens: 222, included: true },
			{ name: "semantic", tokens: 2328, included: true },
			{ name: "episodic", tokens: 66, included: true },
			{ name: "retrieval", tokens: 0, included: false },
		]);
	});

	test("touched files count is reported", async () => {
		const deps = createMockDeps();

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		expect(result.touchedFilesCount).toBe(2);
	});

	test("uses cwd option for mainaDir and repoRoot", async () => {
		let capturedMailDir = "";
		let capturedRepoRoot = "";
		let capturedContextOptions:
			| { repoRoot: string; mainaDir: string }
			| undefined;

		const deps = createMockDeps({
			loadWorkingContext: async (mainaDir: string, repoRoot: string) => {
				capturedMailDir = mainaDir;
				capturedRepoRoot = repoRoot;
				return {
					branch: "main",
					touchedFiles: [],
					lastVerification: null,
					updatedAt: new Date().toISOString(),
				};
			},
			assembleContext: async (
				_command: string,
				options: { repoRoot: string; mainaDir: string },
			) => {
				capturedContextOptions = options;
				return {
					tokens: 0,
					layers: [],
				};
			},
		});

		await statusAction({ cwd: "/my/project" }, deps);

		expect(capturedMailDir).toBe("/my/project/.maina");
		expect(capturedRepoRoot).toBe("/my/project");
		expect(capturedContextOptions?.repoRoot).toBe("/my/project");
		expect(capturedContextOptions?.mainaDir).toBe("/my/project/.maina");
	});

	test("handles assembleContext failure gracefully", async () => {
		const deps = createMockDeps({
			assembleContext: async () => {
				throw new Error("context assembly failed");
			},
		});

		const result = await statusAction({ cwd: "/tmp/test-status" }, deps);

		// Should still display branch and verification info even if context fails
		expect(result.displayed).toBe(true);
		expect(result.branch).toBe("feature/003-pr-and-init");
		expect(result.contextTokens).toBeUndefined();
	});
});
