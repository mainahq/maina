import type { BenchmarkMetrics, BenchmarkReport, StoryConfig } from "./types";

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
