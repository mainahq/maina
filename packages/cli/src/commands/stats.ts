import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	type ComparisonReport,
	getComparison,
	getStats,
	getTrends,
	type StatsReport,
	type TrendsReport,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StatsActionOptions {
	json?: boolean;
	last?: number;
	compare?: boolean;
	cwd?: string;
}

export interface StatsActionResult {
	displayed: boolean;
	reason?: string;
	stats?: StatsReport;
	trends?: TrendsReport;
	jsonOutput?: string;
}

export interface StatsDeps {
	getStats: typeof getStats;
	getTrends: typeof getTrends;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: StatsDeps = { getStats, getTrends };

// ── Formatting Helpers ───────────────────────────────────────────────────────

function trendArrow(direction: "up" | "down" | "stable"): string {
	switch (direction) {
		case "up":
			return "\u2191"; // ↑
		case "down":
			return "\u2193"; // ↓
		case "stable":
			return "\u2192"; // →
	}
}

function formatDurationSec(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatUtilization(tokens: number, budget: number): string {
	const pct = budget > 0 ? ((tokens / budget) * 100).toFixed(1) : "0.0";
	const budgetK =
		budget >= 1000 ? `${Math.round(budget / 1000)}k` : `${budget}`;
	return `${tokens}/${budgetK} (${pct}%)`;
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core stats logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function statsAction(
	options: StatsActionOptions,
	deps: StatsDeps = defaultDeps,
): Promise<StatsActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const last = options.last ?? 10;

	// ── Fetch stats ────────────────────────────────────────────────────
	const statsResult = deps.getStats(mainaDir, { last });
	if (!statsResult.ok) {
		return { displayed: false, reason: statsResult.error };
	}
	const stats = statsResult.value;

	// ── No commits case ────────────────────────────────────────────────
	if (stats.totalCommits === 0) {
		return { displayed: false, reason: "No commits tracked yet" };
	}

	// ── Fetch trends ───────────────────────────────────────────────────
	const trendsResult = deps.getTrends(mainaDir, { window: last });
	if (!trendsResult.ok) {
		return { displayed: false, reason: trendsResult.error };
	}
	const trends = trendsResult.value;

	// ── JSON output ────────────────────────────────────────────────────
	if (options.json) {
		const jsonOutput = JSON.stringify({ stats, trends }, null, 2);
		return { displayed: true, stats, trends, jsonOutput };
	}

	// ── Formatted display ──────────────────────────────────────────────
	return { displayed: true, stats, trends };
}

// ── Display Helper ───────────────────────────────────────────────────────────

function displayStats(stats: StatsReport, trends: TrendsReport): void {
	log.info(`maina stats \u2014 ${stats.totalCommits} commits tracked`);

	// Last commit
	if (stats.latest) {
		const l = stats.latest;
		const shortHash = l.commitHash.slice(0, 7);
		const verify = formatDurationSec(l.verifyDurationMs);
		const tokens = formatUtilization(l.contextTokens, l.contextBudget);
		const cache = `${l.cacheHits}/${l.cacheHits + l.cacheMisses}`;
		const findings = String(l.findingsTotal);

		log.info("");
		log.info(`  Last commit (${shortHash}):`);
		log.info(
			`    Verify: ${verify} | Tokens: ${tokens} | Cache: ${cache} | Findings: ${findings}`,
		);
	}

	// Rolling averages
	const a = stats.averages;
	const avgVerify = formatDurationSec(a.verifyDurationMs);
	const avgTokens = Math.round(a.contextTokens);
	const avgCacheHit = `${(a.cacheHitRate * 100).toFixed(0)}%`;
	const avgFindings = `${a.findingsPerCommit.toFixed(1)}/commit`;

	log.info("");
	log.info(`  Rolling average (last ${trends.window}):`);
	log.info(
		`    Verify: ${avgVerify} | Tokens: ${avgTokens} | Cache hit: ${avgCacheHit} | Findings: ${avgFindings}`,
	);

	// Trends
	const vArrow = trendArrow(trends.verifyDuration);
	const tArrow = trendArrow(trends.contextTokens);
	const cArrow = trendArrow(trends.cacheHitRate);
	const qArrow = trendArrow(trends.findingsPerCommit);

	log.info("");
	log.info("  Trends:");
	log.info(
		`    verify ${vArrow} | tokens ${tArrow} | cache ${cArrow} | quality ${qArrow}`,
	);
}

// ── Commander Command ────────────────────────────────────────────────────────

function displayComparison(report: ComparisonReport): void {
	log.info("maina vs raw git — what maina adds:\n");
	log.message(
		[
			`  With maina (${report.totalCommits} commits):`,
			`    Findings caught:     ${report.findingsCaught}`,
			`    Verify time:         ${(report.totalVerifyTimeMs / 1000).toFixed(1)}s total (${(report.avgVerifyTimeMs / 1000).toFixed(1)}s avg)`,
			`    Context assembled:   ${report.totalContextTokens} tokens`,
			`    Episodic memory:     ${report.episodicEntries} entries`,
			`    Semantic entities:   ${report.semanticEntities} indexed`,
			`    Dependency graph:    ${report.dependencyEdges} edges`,
			`    Cache hits:          ${report.cacheHits}`,
			"",
			"  Without maina (raw git commit):",
			"    Findings caught:     0",
			"    Verification:        none",
			"    Context:             none (manual CLAUDE.md only)",
			"    Memory:              none (ephemeral)",
			"    Codebase index:      none",
			"    Cache:               none",
		].join("\n"),
	);
}

export function statsCommand(): Command {
	return new Command("stats")
		.description("Show commit verification metrics and trends")
		.option("--json", "Output raw snapshots as JSON")
		.option("--last <n>", "Number of commits to analyze", "10")
		.option("--compare", "Show maina vs raw git comparison")
		.action(async (options) => {
			intro("maina stats");

			if (options.compare) {
				const cwd = process.cwd();
				const mainaDir = join(cwd, ".maina");
				const compareResult = getComparison(mainaDir);
				if (compareResult.ok) {
					displayComparison(compareResult.value);
				} else {
					log.warning(compareResult.error);
				}
				outro("Done.");
				return;
			}

			const last = Number.parseInt(options.last, 10);
			const result = await statsAction({
				json: options.json,
				last: Number.isNaN(last) ? 10 : last,
			});

			if (!result.displayed) {
				log.warning(result.reason ?? "Unknown error");
				outro("Done.");
				return;
			}

			if (result.jsonOutput) {
				// biome-ignore lint/suspicious/noConsole: JSON output goes to stdout
				console.log(result.jsonOutput);
			} else if (result.stats && result.trends) {
				displayStats(result.stats, result.trends);
			}

			outro("Done.");
		});
}
