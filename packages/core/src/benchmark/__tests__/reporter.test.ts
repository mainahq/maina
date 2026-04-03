import { describe, expect, test } from "bun:test";
import { buildReport, formatComparison } from "../reporter";
import type { BenchmarkMetrics, StoryConfig } from "../types";

const storyConfig: StoryConfig = {
	name: "mitt",
	description: "Tiny event emitter",
	tier: 1,
	source: "https://github.com/developit/mitt",
	testFiles: ["tests/mitt.test.ts"],
	metrics: { expectedTests: 18, originalLOC: 80, complexity: "easy" },
};

const mainaMetrics: BenchmarkMetrics = {
	pipeline: "maina",
	storyName: "mitt",
	wallClockMs: 1200,
	tokensInput: 5000,
	tokensOutput: 2000,
	testsTotal: 18,
	testsPassed: 16,
	testsFailed: 2,
	verifyFindings: 3,
	specQualityScore: 83,
	implLOC: 85,
	attemptsToPass: 1,
	bugsIntroduced: 0,
	toolsUsed: ["getContext", "verify", "reviewCode"],
};

const speckitMetrics: BenchmarkMetrics = {
	pipeline: "speckit",
	storyName: "mitt",
	wallClockMs: 1800,
	tokensInput: 7000,
	tokensOutput: 3000,
	testsTotal: 18,
	testsPassed: 14,
	testsFailed: 4,
	verifyFindings: 0,
	specQualityScore: 70,
	implLOC: 112,
	attemptsToPass: 2,
	bugsIntroduced: 1,
	toolsUsed: ["specify init", "constitution", "specs", "plans", "tasks"],
};

describe("buildReport", () => {
	test("creates comparison report with both pipeline results", () => {
		const report = buildReport(storyConfig, mainaMetrics, speckitMetrics);

		expect(report.story.name).toBe("mitt");
		expect(report.maina?.testsPassed).toBe(16);
		expect(report.speckit?.testsPassed).toBe(14);
		expect(report.timestamp).toBeTruthy();
	});

	test("determines winner based on test pass rate", () => {
		const report = buildReport(storyConfig, mainaMetrics, speckitMetrics);
		expect(report.winner).toBe("maina");
	});

	test("returns tie when both have same pass count", () => {
		const tied = { ...speckitMetrics, testsPassed: 16, testsFailed: 2 };
		const report = buildReport(storyConfig, mainaMetrics, tied);
		expect(report.winner).toBe("tie");
	});

	test("returns incomplete when one pipeline is null", () => {
		const report = buildReport(storyConfig, mainaMetrics, null);
		expect(report.winner).toBe("incomplete");
		expect(report.speckit).toBeNull();
	});
});

describe("formatComparison", () => {
	test("produces a readable terminal table", () => {
		const report = buildReport(storyConfig, mainaMetrics, speckitMetrics);
		const output = formatComparison(report);

		expect(output).toContain("mitt");
		expect(output).toContain("maina");
		expect(output).toContain("speckit");
		expect(output).toContain("16");
		expect(output).toContain("14");
		expect(output).toContain("Winner");
	});

	test("handles incomplete report gracefully", () => {
		const report = buildReport(storyConfig, mainaMetrics, null);
		const output = formatComparison(report);

		expect(output).toContain("maina");
		expect(output).toContain("—");
	});
});
