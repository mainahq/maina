import type {
	BenchmarkMetrics,
	BenchmarkReport,
	StepMetrics,
	StoryConfig,
	Tier3Results,
	Tier3Totals,
} from "./types";

/**
 * Build a comparison report from two pipeline runs.
 */
export function buildReport(
	story: StoryConfig,
	maina: BenchmarkMetrics | null,
	speckit: BenchmarkMetrics | null,
): BenchmarkReport {
	let winner: BenchmarkReport["winner"] = "incomplete";

	if (maina && speckit) {
		if (maina.testsPassed > speckit.testsPassed) {
			winner = "maina";
		} else if (speckit.testsPassed > maina.testsPassed) {
			winner = "speckit";
		} else {
			winner = "tie";
		}
	}

	return {
		story,
		maina,
		speckit,
		timestamp: new Date().toISOString(),
		winner,
	};
}

function metricValue(
	metrics: BenchmarkMetrics | null,
	key: keyof BenchmarkMetrics,
): string {
	if (!metrics) return "—";
	const val = metrics[key];
	if (typeof val === "number") return String(val);
	return String(val);
}

/**
 * Format a comparison report as a readable terminal table.
 */
export function formatComparison(report: BenchmarkReport): string {
	const rows: Array<[string, string, string]> = [
		["Metric", "maina", "speckit"],
		["─".repeat(24), "─".repeat(12), "─".repeat(12)],
		[
			"Tests Passed",
			metricValue(report.maina, "testsPassed"),
			metricValue(report.speckit, "testsPassed"),
		],
		[
			"Tests Failed",
			metricValue(report.maina, "testsFailed"),
			metricValue(report.speckit, "testsFailed"),
		],
		[
			"Tests Total",
			metricValue(report.maina, "testsTotal"),
			metricValue(report.speckit, "testsTotal"),
		],
		[
			"Wall Clock (ms)",
			metricValue(report.maina, "wallClockMs"),
			metricValue(report.speckit, "wallClockMs"),
		],
		[
			"Tokens In",
			metricValue(report.maina, "tokensInput"),
			metricValue(report.speckit, "tokensInput"),
		],
		[
			"Tokens Out",
			metricValue(report.maina, "tokensOutput"),
			metricValue(report.speckit, "tokensOutput"),
		],
		[
			"Verify Findings",
			metricValue(report.maina, "verifyFindings"),
			metricValue(report.speckit, "verifyFindings"),
		],
		[
			"Spec Quality",
			metricValue(report.maina, "specQualityScore"),
			metricValue(report.speckit, "specQualityScore"),
		],
		[
			"Impl LOC",
			metricValue(report.maina, "implLOC"),
			metricValue(report.speckit, "implLOC"),
		],
		[
			"Attempts to Pass",
			metricValue(report.maina, "attemptsToPass"),
			metricValue(report.speckit, "attemptsToPass"),
		],
		[
			"Bugs Introduced",
			metricValue(report.maina, "bugsIntroduced"),
			metricValue(report.speckit, "bugsIntroduced"),
		],
	];

	const lines = [
		`\n## Benchmark: ${report.story.name} (tier ${report.story.tier})\n`,
	];

	for (const [label, m, s] of rows) {
		lines.push(`  ${label.padEnd(24)} ${m.padStart(12)} ${s.padStart(12)}`);
	}

	lines.push("");
	lines.push(`  Winner: ${report.winner}`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Compute totals from a record of per-step metrics plus bug/test metadata.
 */
function computeTotals(
	steps: Record<string, StepMetrics>,
	meta: {
		bugsIntroduced: number;
		bugsCaught: number;
		testsPassed: number;
		testsTotal: number;
	},
): Tier3Totals {
	let durationMs = 0;
	let tokensInput = 0;
	let tokensOutput = 0;
	for (const step of Object.values(steps)) {
		durationMs += step.durationMs;
		tokensInput += step.tokensInput;
		tokensOutput += step.tokensOutput;
	}
	return {
		durationMs,
		tokensInput,
		tokensOutput,
		bugsIntroduced: meta.bugsIntroduced,
		bugsCaught: meta.bugsCaught,
		testsPassed: meta.testsPassed,
		testsTotal: meta.testsTotal,
	};
}

/**
 * Determine winner for tier 3 based on:
 * 1. Test pass rate (higher wins)
 * 2. Bugs caught (higher wins)
 * 3. Duration (lower wins)
 */
function determineTier3Winner(
	maina: Tier3Totals,
	speckit: Tier3Totals,
): Tier3Results["winner"] {
	const mainaPassRate =
		maina.testsTotal > 0 ? maina.testsPassed / maina.testsTotal : 0;
	const speckitPassRate =
		speckit.testsTotal > 0 ? speckit.testsPassed / speckit.testsTotal : 0;

	if (mainaPassRate !== speckitPassRate) {
		return mainaPassRate > speckitPassRate ? "maina" : "speckit";
	}

	if (maina.bugsCaught !== speckit.bugsCaught) {
		return maina.bugsCaught > speckit.bugsCaught ? "maina" : "speckit";
	}

	if (maina.durationMs !== speckit.durationMs) {
		return maina.durationMs < speckit.durationMs ? "maina" : "speckit";
	}

	return "tie";
}

/**
 * Build a tier 3 report from per-step metrics for both pipelines.
 */
export function buildTier3Report(
	story: StoryConfig,
	mainaSteps: Record<string, StepMetrics>,
	speckitSteps: Record<string, StepMetrics>,
	learnings: string[],
	meta?: {
		maina: {
			bugsIntroduced: number;
			bugsCaught: number;
			testsPassed: number;
			testsTotal: number;
		};
		speckit: {
			bugsIntroduced: number;
			bugsCaught: number;
			testsPassed: number;
			testsTotal: number;
		};
	},
): Tier3Results {
	const mainaMeta = meta?.maina ?? {
		bugsIntroduced: 0,
		bugsCaught: 0,
		testsPassed: 0,
		testsTotal: 0,
	};
	const speckitMeta = meta?.speckit ?? {
		bugsIntroduced: 0,
		bugsCaught: 0,
		testsPassed: 0,
		testsTotal: 0,
	};

	const mainaTotals = computeTotals(mainaSteps, mainaMeta);
	const speckitTotals = computeTotals(speckitSteps, speckitMeta);

	const hasMainaSteps = Object.keys(mainaSteps).length > 0;
	const hasSpeckitSteps = Object.keys(speckitSteps).length > 0;

	const winner =
		hasMainaSteps && hasSpeckitSteps
			? determineTier3Winner(mainaTotals, speckitTotals)
			: "incomplete";

	return {
		story,
		timestamp: new Date().toISOString(),
		maina: { steps: mainaSteps, totals: mainaTotals },
		speckit: { steps: speckitSteps, totals: speckitTotals },
		winner,
		learnings,
	};
}

/**
 * Format a tier 3 comparison report as a readable terminal table
 * with per-step breakdown.
 */
export function formatTier3Comparison(results: Tier3Results): string {
	const allStepKeys = new Set<string>([
		...Object.keys(results.maina.steps),
		...Object.keys(results.speckit.steps),
	]);

	const header: [string, string, string, string, string] = [
		"Step",
		"Maina (ms)",
		"Maina (tokens)",
		"SpecKit (ms)",
		"SpecKit (tokens)",
	];
	const separator: [string, string, string, string, string] = [
		"─".repeat(24),
		"─".repeat(14),
		"─".repeat(16),
		"─".repeat(14),
		"─".repeat(16),
	];

	const rows: Array<[string, string, string, string, string]> = [
		header,
		separator,
	];

	for (const key of allStepKeys) {
		const ms = results.maina.steps[key];
		const ss = results.speckit.steps[key];
		rows.push([
			ms?.name ?? ss?.name ?? key,
			ms ? String(ms.durationMs) : "—",
			ms ? String(ms.tokensInput + ms.tokensOutput) : "—",
			ss ? String(ss.durationMs) : "—",
			ss ? String(ss.tokensInput + ss.tokensOutput) : "—",
		]);
	}

	// Totals row
	const mt = results.maina.totals;
	const st = results.speckit.totals;
	rows.push(separator);
	rows.push([
		"TOTAL",
		String(mt.durationMs),
		String(mt.tokensInput + mt.tokensOutput),
		String(st.durationMs),
		String(st.tokensInput + st.tokensOutput),
	]);

	const lines = [`\n## Tier 3 Benchmark: ${results.story.name}\n`];

	for (const [step, mMs, mTok, sMs, sTok] of rows) {
		lines.push(
			`  ${step.padEnd(24)} ${mMs.padStart(14)} ${mTok.padStart(16)} ${sMs.padStart(14)} ${sTok.padStart(16)}`,
		);
	}

	// Findings/bugs summary
	lines.push("");
	lines.push("  Findings / Bugs:");
	lines.push(
		`    Maina  — bugs introduced: ${mt.bugsIntroduced}, bugs caught: ${mt.bugsCaught}, tests: ${mt.testsPassed}/${mt.testsTotal}`,
	);
	lines.push(
		`    SpecKit — bugs introduced: ${st.bugsIntroduced}, bugs caught: ${st.bugsCaught}, tests: ${st.testsPassed}/${st.testsTotal}`,
	);

	lines.push("");
	lines.push(`  Winner: ${results.winner}`);

	if (results.learnings.length > 0) {
		lines.push("");
		lines.push("  Learnings:");
		for (const learning of results.learnings) {
			lines.push(`    - ${learning}`);
		}
	}

	lines.push("");

	return lines.join("\n");
}
