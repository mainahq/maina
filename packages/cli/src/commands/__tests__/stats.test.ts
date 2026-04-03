import { describe, expect, test } from "bun:test";
import type { StatsDeps } from "../stats";
import { statsAction } from "../stats";

// ── Mock deps factory ──────────────────────────────────────────────────────

function makeSnapshot(
	overrides?: Partial<{
		id: string;
		timestamp: string;
		branch: string;
		commitHash: string;
		verifyDurationMs: number;
		totalDurationMs: number;
		contextTokens: number;
		contextBudget: number;
		contextUtilization: number;
		cacheHits: number;
		cacheMisses: number;
		findingsTotal: number;
		findingsErrors: number;
		findingsWarnings: number;
		toolsRun: number;
		syntaxPassed: boolean;
		pipelinePassed: boolean;
		skipped: boolean;
	}>,
) {
	return {
		id: "snap-1",
		timestamp: "2026-04-03T10:00:00.000Z",
		branch: "main",
		commitHash: "64f0b3f",
		verifyDurationMs: 7700,
		totalDurationMs: 9000,
		contextTokens: 2487,
		contextBudget: 200000,
		contextUtilization: 0.012,
		cacheHits: 0,
		cacheMisses: 0,
		findingsTotal: 0,
		findingsErrors: 0,
		findingsWarnings: 0,
		toolsRun: 3,
		syntaxPassed: true,
		pipelinePassed: true,
		skipped: false,
		...overrides,
	};
}

function createMockDeps(overrides?: {
	getStats?: StatsDeps["getStats"];
	getTrends?: StatsDeps["getTrends"];
}): StatsDeps {
	return {
		getStats:
			overrides?.getStats ??
			((_mainaDir, _options) => ({
				ok: true as const,
				value: {
					totalCommits: 1,
					latest: makeSnapshot(),
					averages: {
						verifyDurationMs: 7700,
						contextTokens: 2487,
						cacheHitRate: 0,
						findingsPerCommit: 0,
					},
				},
			})),
		getTrends:
			overrides?.getTrends ??
			((_mainaDir, _options) => ({
				ok: true as const,
				value: {
					verifyDuration: "stable" as const,
					contextTokens: "stable" as const,
					cacheHitRate: "stable" as const,
					findingsPerCommit: "stable" as const,
					window: 10,
				},
			})),
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("statsAction", () => {
	test("no commits displays 'No commits tracked yet'", async () => {
		const deps = createMockDeps({
			getStats: () => ({
				ok: true,
				value: {
					totalCommits: 0,
					latest: null,
					averages: {
						verifyDurationMs: 0,
						contextTokens: 0,
						cacheHitRate: 0,
						findingsPerCommit: 0,
					},
				},
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(false);
		expect(result.reason).toBe("No commits tracked yet");
	});

	test("single commit shows last commit stats", async () => {
		const snapshot = makeSnapshot({
			commitHash: "64f0b3f",
			verifyDurationMs: 7700,
			contextTokens: 2487,
			contextBudget: 200000,
			findingsTotal: 0,
		});

		const deps = createMockDeps({
			getStats: () => ({
				ok: true,
				value: {
					totalCommits: 1,
					latest: snapshot,
					averages: {
						verifyDurationMs: 7700,
						contextTokens: 2487,
						cacheHitRate: 0,
						findingsPerCommit: 0,
					},
				},
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.stats).toBeDefined();
		expect(result.stats?.totalCommits).toBe(1);
		expect(result.stats?.latest?.commitHash).toBe("64f0b3f");
	});

	test("multiple commits shows averages", async () => {
		const deps = createMockDeps({
			getStats: () => ({
				ok: true,
				value: {
					totalCommits: 13,
					latest: makeSnapshot(),
					averages: {
						verifyDurationMs: 8400,
						contextTokens: 2300,
						cacheHitRate: 0,
						findingsPerCommit: 1.2,
					},
				},
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.stats?.totalCommits).toBe(13);
		expect(result.stats?.averages.verifyDurationMs).toBe(8400);
		expect(result.stats?.averages.contextTokens).toBe(2300);
		expect(result.stats?.averages.findingsPerCommit).toBe(1.2);
	});

	test("trends displayed with correct arrows", async () => {
		const deps = createMockDeps({
			getTrends: () => ({
				ok: true,
				value: {
					verifyDuration: "down",
					contextTokens: "stable",
					cacheHitRate: "up",
					findingsPerCommit: "stable",
					window: 10,
				},
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.trends).toBeDefined();
		expect(result.trends?.verifyDuration).toBe("down");
		expect(result.trends?.contextTokens).toBe("stable");
		expect(result.trends?.cacheHitRate).toBe("up");
		expect(result.trends?.findingsPerCommit).toBe("stable");
	});

	test("--json flag outputs valid JSON", async () => {
		const snapshot = makeSnapshot();
		const deps = createMockDeps({
			getStats: () => ({
				ok: true,
				value: {
					totalCommits: 5,
					latest: snapshot,
					averages: {
						verifyDurationMs: 8000,
						contextTokens: 2000,
						cacheHitRate: 0.5,
						findingsPerCommit: 1.0,
					},
				},
			}),
			getTrends: () => ({
				ok: true,
				value: {
					verifyDuration: "down",
					contextTokens: "stable",
					cacheHitRate: "up",
					findingsPerCommit: "stable",
					window: 10,
				},
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test", json: true }, deps);

		expect(result.displayed).toBe(true);
		expect(result.jsonOutput).toBeDefined();

		// Should be valid JSON
		const parsed = JSON.parse(result.jsonOutput ?? "{}");
		expect(parsed.stats.totalCommits).toBe(5);
		expect(parsed.trends.verifyDuration).toBe("down");
	});

	test("--last N passes correct value to getStats and getTrends", async () => {
		let capturedStatsLast: number | undefined;
		let capturedTrendsWindow: number | undefined;

		const deps = createMockDeps({
			getStats: (_mainaDir, options) => {
				capturedStatsLast = options?.last;
				return {
					ok: true,
					value: {
						totalCommits: 5,
						latest: makeSnapshot(),
						averages: {
							verifyDurationMs: 8000,
							contextTokens: 2000,
							cacheHitRate: 0,
							findingsPerCommit: 0,
						},
					},
				};
			},
			getTrends: (_mainaDir, options) => {
				capturedTrendsWindow = options?.window;
				return {
					ok: true,
					value: {
						verifyDuration: "stable",
						contextTokens: "stable",
						cacheHitRate: "stable",
						findingsPerCommit: "stable",
						window: 5,
					},
				};
			},
		});

		await statsAction({ cwd: "/tmp/test", last: 5 }, deps);

		expect(capturedStatsLast).toBe(5);
		expect(capturedTrendsWindow).toBe(5);
	});

	test("handles getStats error gracefully", async () => {
		const deps = createMockDeps({
			getStats: () => ({
				ok: false,
				error: "Database connection failed",
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(false);
		expect(result.reason).toBe("Database connection failed");
	});

	test("handles getTrends error gracefully", async () => {
		const deps = createMockDeps({
			getTrends: () => ({
				ok: false,
				error: "Trends computation failed",
			}),
		});

		const result = await statsAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(false);
		expect(result.reason).toBe("Trends computation failed");
	});

	test("defaults last to 10 when not specified", async () => {
		let capturedStatsLast: number | undefined;
		let capturedTrendsWindow: number | undefined;

		const deps = createMockDeps({
			getStats: (_mainaDir, options) => {
				capturedStatsLast = options?.last;
				return {
					ok: true,
					value: {
						totalCommits: 1,
						latest: makeSnapshot(),
						averages: {
							verifyDurationMs: 7700,
							contextTokens: 2487,
							cacheHitRate: 0,
							findingsPerCommit: 0,
						},
					},
				};
			},
			getTrends: (_mainaDir, options) => {
				capturedTrendsWindow = options?.window;
				return {
					ok: true,
					value: {
						verifyDuration: "stable",
						contextTokens: "stable",
						cacheHitRate: "stable",
						findingsPerCommit: "stable",
						window: 10,
					},
				};
			},
		});

		await statsAction({ cwd: "/tmp/test" }, deps);

		expect(capturedStatsLast).toBe(10);
		expect(capturedTrendsWindow).toBe(10);
	});
});
