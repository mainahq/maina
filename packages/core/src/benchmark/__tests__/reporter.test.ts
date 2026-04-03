import { describe, expect, test } from "bun:test";
import {
	buildReport,
	buildTier3Report,
	formatComparison,
	formatTier3Comparison,
} from "../reporter";
import type { BenchmarkMetrics, StepMetrics, StoryConfig } from "../types";

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

// --- Tier 3 fixtures ---

const tier3Story: StoryConfig = {
	name: "auth-flow",
	description: "Full auth lifecycle",
	tier: 3,
	source: "internal",
	testFiles: ["tests/auth.test.ts"],
	metrics: { expectedTests: 25, originalLOC: 400, complexity: "hard" },
};

function makeStep(
	overrides: Partial<StepMetrics> & { name: string },
): StepMetrics {
	return {
		durationMs: 100,
		tokensInput: 500,
		tokensOutput: 200,
		artifacts: [],
		...overrides,
	};
}

const mainaSteps: Record<string, StepMetrics> = {
	clarify: makeStep({
		name: "Clarify",
		durationMs: 200,
		tokensInput: 1000,
		tokensOutput: 500,
		questionsAsked: 3,
	}),
	spec: makeStep({
		name: "Spec",
		durationMs: 300,
		tokensInput: 2000,
		tokensOutput: 1000,
	}),
	plan: makeStep({
		name: "Plan",
		durationMs: 150,
		tokensInput: 800,
		tokensOutput: 400,
		approachesProposed: 2,
	}),
	implement: makeStep({
		name: "Implement",
		durationMs: 500,
		tokensInput: 3000,
		tokensOutput: 2000,
		loc: 120,
		attempts: 2,
	}),
	test: makeStep({
		name: "Test",
		durationMs: 400,
		tokensInput: 1500,
		tokensOutput: 800,
		testsGenerated: 25,
	}),
	verify: makeStep({
		name: "Verify",
		durationMs: 250,
		tokensInput: 1200,
		tokensOutput: 600,
		findings: 4,
		findingsBySeverity: { high: 1, medium: 3 },
	}),
	fix: makeStep({
		name: "Fix",
		durationMs: 180,
		tokensInput: 900,
		tokensOutput: 500,
	}),
	review: makeStep({
		name: "Review",
		durationMs: 300,
		tokensInput: 1400,
		tokensOutput: 700,
		issuesFound: 2,
	}),
	final: makeStep({
		name: "Final Check",
		durationMs: 120,
		tokensInput: 600,
		tokensOutput: 300,
		passed: true,
	}),
};

const speckitSteps: Record<string, StepMetrics> = {
	clarify: makeStep({
		name: "Clarify",
		durationMs: 250,
		tokensInput: 1200,
		tokensOutput: 600,
		questionsAsked: 2,
	}),
	spec: makeStep({
		name: "Spec",
		durationMs: 400,
		tokensInput: 2500,
		tokensOutput: 1200,
	}),
	plan: makeStep({
		name: "Plan",
		durationMs: 200,
		tokensInput: 1000,
		tokensOutput: 500,
	}),
	implement: makeStep({
		name: "Implement",
		durationMs: 600,
		tokensInput: 3500,
		tokensOutput: 2500,
		loc: 150,
		attempts: 3,
	}),
	test: makeStep({
		name: "Test",
		durationMs: 350,
		tokensInput: 1800,
		tokensOutput: 900,
		testsGenerated: 22,
	}),
	verify: makeStep({
		name: "Verify",
		durationMs: 200,
		tokensInput: 1000,
		tokensOutput: 500,
		findings: 2,
	}),
	fix: makeStep({
		name: "Fix",
		durationMs: 220,
		tokensInput: 1100,
		tokensOutput: 600,
	}),
	review: makeStep({
		name: "Review",
		durationMs: 280,
		tokensInput: 1300,
		tokensOutput: 650,
	}),
	final: makeStep({
		name: "Final Check",
		durationMs: 150,
		tokensInput: 700,
		tokensOutput: 350,
		passed: true,
	}),
};

const mainaMeta = {
	bugsIntroduced: 1,
	bugsCaught: 3,
	testsPassed: 24,
	testsTotal: 25,
};
const speckitMeta = {
	bugsIntroduced: 2,
	bugsCaught: 2,
	testsPassed: 20,
	testsTotal: 25,
};

describe("buildTier3Report", () => {
	test("computes totals by summing step durations and tokens", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: mainaMeta,
			speckit: speckitMeta,
		});

		// Maina duration: 200+300+150+500+400+250+180+300+120 = 2400
		expect(report.maina.totals.durationMs).toBe(2400);
		// Maina tokensInput: 1000+2000+800+3000+1500+1200+900+1400+600 = 12400
		expect(report.maina.totals.tokensInput).toBe(12400);
		// Maina tokensOutput: 500+1000+400+2000+800+600+500+700+300 = 6800
		expect(report.maina.totals.tokensOutput).toBe(6800);

		// SpecKit duration: 250+400+200+600+350+200+220+280+150 = 2650
		expect(report.speckit.totals.durationMs).toBe(2650);
	});

	test("carries bug/test metadata into totals", () => {
		const report = buildTier3Report(
			tier3Story,
			mainaSteps,
			speckitSteps,
			["learning 1"],
			{
				maina: mainaMeta,
				speckit: speckitMeta,
			},
		);

		expect(report.maina.totals.bugsIntroduced).toBe(1);
		expect(report.maina.totals.bugsCaught).toBe(3);
		expect(report.maina.totals.testsPassed).toBe(24);
		expect(report.speckit.totals.bugsIntroduced).toBe(2);
		expect(report.speckit.totals.testsPassed).toBe(20);
	});

	test("determines winner by test pass rate first", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: mainaMeta,
			speckit: speckitMeta,
		});
		// Maina 24/25 > SpecKit 20/25
		expect(report.winner).toBe("maina");
	});

	test("breaks tie on bugs caught", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: {
				bugsIntroduced: 1,
				bugsCaught: 5,
				testsPassed: 20,
				testsTotal: 25,
			},
			speckit: {
				bugsIntroduced: 1,
				bugsCaught: 2,
				testsPassed: 20,
				testsTotal: 25,
			},
		});
		// Same pass rate, maina caught more bugs
		expect(report.winner).toBe("maina");
	});

	test("breaks second tie on duration (lower wins)", () => {
		// mainaSteps total = 2400, speckitSteps total = 2650
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: {
				bugsIntroduced: 0,
				bugsCaught: 3,
				testsPassed: 20,
				testsTotal: 25,
			},
			speckit: {
				bugsIntroduced: 0,
				bugsCaught: 3,
				testsPassed: 20,
				testsTotal: 25,
			},
		});
		// Same pass rate, same bugs caught, maina is faster
		expect(report.winner).toBe("maina");
	});

	test("returns tie when all tiebreakers are equal", () => {
		const sameSteps: Record<string, StepMetrics> = {
			step1: makeStep({
				name: "Step 1",
				durationMs: 100,
				tokensInput: 500,
				tokensOutput: 200,
			}),
		};
		const report = buildTier3Report(
			tier3Story,
			sameSteps,
			{ ...sameSteps },
			[],
			{
				maina: {
					bugsIntroduced: 0,
					bugsCaught: 1,
					testsPassed: 10,
					testsTotal: 10,
				},
				speckit: {
					bugsIntroduced: 0,
					bugsCaught: 1,
					testsPassed: 10,
					testsTotal: 10,
				},
			},
		);
		expect(report.winner).toBe("tie");
	});

	test("returns incomplete when one pipeline has no steps", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, {}, [
			"partial run",
		]);
		expect(report.winner).toBe("incomplete");
	});

	test("defaults meta to zeros when not provided", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, []);
		expect(report.maina.totals.bugsIntroduced).toBe(0);
		expect(report.maina.totals.bugsCaught).toBe(0);
		expect(report.maina.totals.testsPassed).toBe(0);
		expect(report.speckit.totals.testsPassed).toBe(0);
	});

	test("includes story, timestamp, and learnings", () => {
		const report = buildTier3Report(
			tier3Story,
			mainaSteps,
			speckitSteps,
			["insight A", "insight B"],
			{
				maina: mainaMeta,
				speckit: speckitMeta,
			},
		);

		expect(report.story.name).toBe("auth-flow");
		expect(report.timestamp).toBeTruthy();
		expect(report.learnings).toEqual(["insight A", "insight B"]);
	});

	test("preserves per-step data in the result", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: mainaMeta,
			speckit: speckitMeta,
		});

		expect(report.maina.steps.clarify?.questionsAsked).toBe(3);
		expect(report.maina.steps.implement?.loc).toBe(120);
		expect(report.speckit.steps.verify?.findings).toBe(2);
	});
});

describe("formatTier3Comparison", () => {
	test("produces a table with per-step breakdown", () => {
		const report = buildTier3Report(
			tier3Story,
			mainaSteps,
			speckitSteps,
			["Maina faster on verify"],
			{
				maina: mainaMeta,
				speckit: speckitMeta,
			},
		);
		const output = formatTier3Comparison(report);

		// Header
		expect(output).toContain("Tier 3 Benchmark: auth-flow");
		expect(output).toContain("Step");
		expect(output).toContain("Maina (ms)");
		expect(output).toContain("SpecKit (ms)");
		expect(output).toContain("Maina (tokens)");
		expect(output).toContain("SpecKit (tokens)");

		// Step rows — check a few step names appear
		expect(output).toContain("Clarify");
		expect(output).toContain("Implement");
		expect(output).toContain("Verify");
		expect(output).toContain("Final Check");

		// Totals
		expect(output).toContain("TOTAL");
		expect(output).toContain("2400"); // maina total ms
		expect(output).toContain("2650"); // speckit total ms

		// Findings summary
		expect(output).toContain("bugs introduced: 1");
		expect(output).toContain("bugs caught: 3");
		expect(output).toContain("tests: 24/25");
		expect(output).toContain("tests: 20/25");

		// Winner
		expect(output).toContain("Winner: maina");

		// Learnings
		expect(output).toContain("Learnings:");
		expect(output).toContain("Maina faster on verify");
	});

	test("shows dash for missing steps", () => {
		const partialSpeckit: Record<string, StepMetrics> = {
			clarify: makeStep({
				name: "Clarify",
				durationMs: 250,
				tokensInput: 1200,
				tokensOutput: 600,
			}),
			// Missing all other steps that maina has
		};
		const report = buildTier3Report(
			tier3Story,
			mainaSteps,
			partialSpeckit,
			[],
			{
				maina: mainaMeta,
				speckit: {
					bugsIntroduced: 0,
					bugsCaught: 0,
					testsPassed: 0,
					testsTotal: 0,
				},
			},
		);
		const output = formatTier3Comparison(report);

		// Speckit should show dashes for steps it doesn't have
		// The Implement row should have speckit values as "—"
		// We check that "—" appears in the output (for missing speckit steps)
		expect(output).toContain("—");
	});

	test("omits learnings section when empty", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, speckitSteps, [], {
			maina: mainaMeta,
			speckit: speckitMeta,
		});
		const output = formatTier3Comparison(report);

		expect(output).not.toContain("Learnings:");
	});

	test("formats incomplete report correctly", () => {
		const report = buildTier3Report(tier3Story, mainaSteps, {}, []);
		const output = formatTier3Comparison(report);

		expect(output).toContain("Winner: incomplete");
	});
});
