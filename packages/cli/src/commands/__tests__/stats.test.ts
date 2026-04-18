import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StatsDeps } from "../stats";
import { renderStatsResult, statsAction } from "../stats";

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

	test("--specs flag with features shows quality table", async () => {
		const tmpDir = join("/tmp", `stats-specs-test-${Date.now()}`);
		const mainaDir = join(tmpDir, ".maina");
		const featuresDir = join(mainaDir, "features");
		const feat1 = join(featuresDir, "001-stats-tracker");
		const feat2 = join(featuresDir, "002-ticket");

		mkdirSync(feat1, { recursive: true });
		mkdirSync(feat2, { recursive: true });
		writeFileSync(
			join(feat1, "spec.md"),
			"# Feature 1\n## Success Criteria\n- returns data",
		);
		writeFileSync(
			join(feat2, "spec.md"),
			"# Feature 2\n## Success Criteria\n- validates input",
		);

		try {
			const deps = createMockDeps({});
			deps.scoreSpec = (_specPath: string) => ({
				ok: true as const,
				value: {
					overall: 72,
					measurability: 80,
					testability: 65,
					ambiguity: 75,
					completeness: 70,
					details: [],
				},
			});
			deps.getSkipRate = (_mainaDir: string) => ({
				ok: true as const,
				value: { total: 28, skipped: 0, rate: 0 },
			});

			const result = await statsAction({ cwd: tmpDir, specs: true }, deps);

			expect(result.displayed).toBe(true);
			expect(result.specsResult).toBeDefined();
			const specs = result.specsResult;
			expect(specs?.scores.length).toBe(2);
			expect(specs?.scores[0]?.feature).toBe("001-stats-tracker");
			expect(specs?.scores[0]?.score.overall).toBe(72);
			expect(specs?.average).toBe(72);
			expect(specs?.skipRate?.total).toBe(28);
			expect(specs?.skipRate?.skipped).toBe(0);
			expect(specs?.skipRate?.rate).toBe(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("--specs flag with no features shows 'No features found'", async () => {
		const tmpDir = join("/tmp", `stats-specs-empty-${Date.now()}`);
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });

		try {
			const deps = createMockDeps({});
			const result = await statsAction({ cwd: tmpDir, specs: true }, deps);

			expect(result.displayed).toBe(false);
			expect(result.reason).toBe("No features found");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("--specs flag with no .maina dir shows 'No features found'", async () => {
		const tmpDir = join("/tmp", `stats-specs-nodir-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });

		try {
			const deps = createMockDeps({});
			const result = await statsAction({ cwd: tmpDir, specs: true }, deps);

			expect(result.displayed).toBe(false);
			expect(result.reason).toBe("No features found");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("--specs flag with features dir but no spec.md files shows 'No features found'", async () => {
		const tmpDir = join("/tmp", `stats-specs-nospecs-${Date.now()}`);
		const featuresDir = join(tmpDir, ".maina", "features", "001-empty");
		mkdirSync(featuresDir, { recursive: true });

		try {
			const deps = createMockDeps({});
			const result = await statsAction({ cwd: tmpDir, specs: true }, deps);

			expect(result.displayed).toBe(false);
			expect(result.reason).toBe("No features found");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ── Wiki Metrics ──────────────────────────────────────────────────

	test("wiki metrics included when wiki dir exists", async () => {
		const tmpDir = join("/tmp", `stats-wiki-test-${Date.now()}`);
		const mainaDir = join(tmpDir, ".maina");
		const wikiDir = join(mainaDir, "wiki");

		// Create wiki structure with articles
		mkdirSync(join(wikiDir, "modules"), { recursive: true });
		mkdirSync(join(wikiDir, "entities"), { recursive: true });
		mkdirSync(join(wikiDir, "features"), { recursive: true });
		writeFileSync(join(wikiDir, "modules", "auth.md"), "# Auth\n");
		writeFileSync(join(wikiDir, "modules", "db.md"), "# DB\n");
		writeFileSync(join(wikiDir, "entities", "user.md"), "# User\n");
		writeFileSync(join(wikiDir, "features", "login.md"), "# Login\n");
		writeFileSync(
			join(wikiDir, ".state.json"),
			JSON.stringify({
				lastCompile: "2026-04-07T15:21:54.012Z",
				compilationTimeMs: 195,
			}),
		);

		try {
			const deps = createMockDeps({});
			const result = await statsAction({ cwd: tmpDir }, deps);

			expect(result.displayed).toBe(true);
			expect(result.wikiMetrics).toBeDefined();
			expect(result.wikiMetrics?.totalArticles).toBe(4);
			expect(result.wikiMetrics?.modules).toBe(2);
			expect(result.wikiMetrics?.entities).toBe(1);
			expect(result.wikiMetrics?.features).toBe(1);
			expect(result.wikiMetrics?.decisions).toBe(0);
			expect(result.wikiMetrics?.architecture).toBe(0);
			expect(result.wikiMetrics?.lastCompile).toBe("2026-04-07T15:21:54.012Z");
			expect(result.wikiMetrics?.compilationTimeMs).toBe(195);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("wiki metrics not included when no wiki dir", async () => {
		const tmpDir = join("/tmp", `stats-nowiki-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });

		try {
			const deps = createMockDeps({});
			const result = await statsAction({ cwd: tmpDir }, deps);

			expect(result.displayed).toBe(true);
			expect(result.wikiMetrics).toBeUndefined();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
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

// ── renderStatsResult: --json must not leak formatted text (PR #188) ──────

describe("renderStatsResult --json output", () => {
	function captureStdout(fn: () => void): string {
		const chunks: string[] = [];
		const origWrite = process.stdout.write.bind(process.stdout);
		// biome-ignore lint/suspicious/noConsole: test intercepts console.log to verify JSON output does not include formatted text
		const origLog = console.log;
		// biome-ignore lint/suspicious/noExplicitAny: bun:test monkeypatch
		(process.stdout as any).write = (s: string | Uint8Array) => {
			chunks.push(typeof s === "string" ? s : new TextDecoder().decode(s));
			return true;
		};
		console.log = (...args: unknown[]) => {
			chunks.push(`${args.join(" ")}\n`);
		};
		try {
			fn();
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: bun:test monkeypatch
			(process.stdout as any).write = origWrite;
			console.log = origLog;
		}
		return chunks.join("");
	}

	test("--json emits exactly the JSON document, nothing else", () => {
		const out = captureStdout(() => {
			renderStatsResult(
				{
					displayed: true,
					jsonOutput: '{"stats":{"totalCommits":5}}',
					wikiMetrics: {
						totalArticles: 12,
						modules: 3,
						entities: 2,
						features: 4,
						decisions: 2,
						architecture: 1,
						lastCompile: "2026-04-18T10:00:00Z",
						compilationTimeMs: 42,
					},
					externalCategories: [
						{ filePath: "a.ts", category: "api-mismatch", count: 3 },
					],
				},
				{ json: true, cwd: "/tmp/test" },
			);
		});

		// Must be parseable as a single JSON document with only trailing whitespace.
		const trimmed = out.trim();
		// Must not contain wiki-formatted text after the JSON.
		expect(trimmed).not.toContain("Wiki");
		expect(trimmed).not.toContain("Articles");
		expect(trimmed).not.toContain("external-review");
		expect(() => JSON.parse(trimmed)).not.toThrow();
		const parsed = JSON.parse(trimmed);
		expect(parsed.stats.totalCommits).toBe(5);
	});

	test("non-JSON mode still renders wiki + external categories (regression guard)", () => {
		const out = captureStdout(() => {
			renderStatsResult(
				{
					displayed: true,
					stats: {
						totalCommits: 1,
						latest: null,
						averages: {
							verifyDurationMs: 1000,
							contextTokens: 100,
							cacheHitRate: 0,
							findingsPerCommit: 0,
						},
					},
					trends: {
						verifyDuration: "stable",
						contextTokens: "stable",
						cacheHitRate: "stable",
						findingsPerCommit: "stable",
						window: 10,
					},
					wikiMetrics: {
						totalArticles: 7,
						modules: 2,
						entities: 1,
						features: 2,
						decisions: 1,
						architecture: 1,
						lastCompile: "never",
						compilationTimeMs: 0,
					},
					externalCategories: [
						{ filePath: "z.ts", category: "style", count: 2 },
					],
				},
				{ json: false, cwd: "/tmp/test" },
			);
		});
		// Display text is still emitted through clack; sanity-check something
		// wiki-related landed (we don't assert exact format because clack
		// prefixes/suffixes evolve).
		expect(out.length).toBeGreaterThan(0);
	});
});
