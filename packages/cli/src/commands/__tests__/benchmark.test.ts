import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Mocks ───────────────────────────────────────────────────────────────────

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
}));

afterAll(() => {
	mock.restore();
});

// ── Import after mocks ──────────────────────────────────────────────────────

const { benchmarkAction } = await import("../benchmark");
type BenchmarkDepsType = import("../benchmark").BenchmarkDeps;

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function mockDeps(overrides?: Partial<BenchmarkDepsType>): BenchmarkDepsType {
	return {
		listStories: () => ({
			ok: true,
			value: [
				{
					name: "mitt",
					description: "Event emitter",
					tier: 1,
					source: "s",
					testFiles: ["tests/mitt.test.ts"],
					metrics: {
						expectedTests: 18,
						originalLOC: 80,
						complexity: "easy" as const,
					},
				},
			],
		}),
		loadStory: (_dir: string, name: string) => ({
			ok: true,
			value: {
				config: {
					name,
					description: "Event emitter",
					tier: 1,
					source: "s",
					testFiles: ["tests/mitt.test.ts"],
					metrics: {
						expectedTests: 18,
						originalLOC: 80,
						complexity: "easy" as const,
					},
				},
				specContent: "# Spec",
				testFiles: [{ name: "tests/mitt.test.ts", content: "" }],
				storyDir: tmpDir,
			},
		}),
		runBenchmark: async () => ({
			ok: true,
			value: {
				pipeline: "maina" as const,
				storyName: "mitt",
				wallClockMs: 1200,
				tokensInput: 5000,
				tokensOutput: 2000,
				testsTotal: 18,
				testsPassed: 16,
				testsFailed: 2,
				verifyFindings: 3,
				specQualityScore: 83,
			},
		}),
		buildReport: (story, maina, speckit) => ({
			story,
			maina,
			speckit,
			timestamp: new Date().toISOString(),
			winner: "incomplete" as const,
		}),
		formatComparison: () => "## Benchmark: mitt\n  Winner: maina",
		...overrides,
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("benchmarkAction", () => {
	test("--list returns available stories", async () => {
		const result = await benchmarkAction(
			{ list: true, cwd: tmpDir },
			mockDeps(),
		);

		expect(result.listed).toBe(true);
	});

	test("--story runs benchmark and returns report", async () => {
		const result = await benchmarkAction(
			{ story: "mitt", cwd: tmpDir },
			mockDeps(),
		);

		expect(result.ran).toBe(true);
		expect(result.reportJson).toBeDefined();
		expect(result.reportText).toContain("mitt");
	});

	test("missing story returns error", async () => {
		const result = await benchmarkAction({ cwd: tmpDir }, mockDeps());

		expect(result.ran).toBe(false);
		expect(result.reason).toContain("No story");
	});

	test("story not found returns error", async () => {
		const result = await benchmarkAction(
			{ story: "nonexistent", cwd: tmpDir },
			mockDeps({
				loadStory: () => ({
					ok: false,
					error: "Story not found: nonexistent",
				}),
			}),
		);

		expect(result.ran).toBe(false);
		expect(result.reason).toContain("not found");
	});
});
