import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import type { Result } from "@mainahq/core";
import {
	type ComparisonReport,
	getComparison,
	getSkipRate,
	getStats,
	getTrends,
	type QualityScore,
	type StatsReport,
	scoreSpec,
	type TrendsReport,
} from "@mainahq/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StatsActionOptions {
	json?: boolean;
	last?: number;
	compare?: boolean;
	specs?: boolean;
	cwd?: string;
}

export interface SpecScore {
	feature: string;
	score: QualityScore;
}

export interface SpecsResult {
	scores: SpecScore[];
	average: number;
	skipRate?: { total: number; skipped: number; rate: number };
}

export interface WikiMetrics {
	totalArticles: number;
	modules: number;
	entities: number;
	features: number;
	decisions: number;
	architecture: number;
	lastCompile: string;
	compilationTimeMs: number;
}

export interface StatsActionResult {
	displayed: boolean;
	reason?: string;
	stats?: StatsReport;
	trends?: TrendsReport;
	jsonOutput?: string;
	specsResult?: SpecsResult;
	wikiMetrics?: WikiMetrics;
}

export interface StatsDeps {
	getStats: typeof getStats;
	getTrends: typeof getTrends;
	scoreSpec?: (specPath: string) => Result<QualityScore>;
	getSkipRate?: (
		mainaDir: string,
	) => Result<{ total: number; skipped: number; rate: number }>;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: StatsDeps = { getStats, getTrends, scoreSpec, getSkipRate };

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

// ── Wiki Metrics ────────────────────────────────────────────────────────────

function countMdInDir(dir: string): number {
	if (!existsSync(dir)) return 0;
	try {
		return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
	} catch {
		return 0;
	}
}

function gatherWikiMetrics(mainaDir: string): WikiMetrics | null {
	const wikiDir = join(mainaDir, "wiki");
	if (!existsSync(wikiDir)) return null;

	const modules = countMdInDir(join(wikiDir, "modules"));
	const entities = countMdInDir(join(wikiDir, "entities"));
	const features = countMdInDir(join(wikiDir, "features"));
	const decisions = countMdInDir(join(wikiDir, "decisions"));
	const architecture = countMdInDir(join(wikiDir, "architecture"));
	const totalArticles =
		modules + entities + features + decisions + architecture;

	let lastCompile = "never";
	let compilationTimeMs = 0;
	const stateFile = join(wikiDir, ".state.json");
	if (existsSync(stateFile)) {
		try {
			const state = JSON.parse(readFileSync(stateFile, "utf-8"));
			lastCompile = state.lastCompile ?? "never";
			compilationTimeMs =
				typeof state.compilationTimeMs === "number"
					? state.compilationTimeMs
					: 0;
		} catch {
			// ignore parse errors
		}
	}

	return {
		totalArticles,
		modules,
		entities,
		features,
		decisions,
		architecture,
		lastCompile,
		compilationTimeMs,
	};
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

	// ── Specs mode ─────────────────────────────────────────────────────
	if (options.specs) {
		const scoreFn = deps.scoreSpec ?? scoreSpec;
		const skipFn = deps.getSkipRate ?? getSkipRate;

		const featuresDir = join(mainaDir, "features");
		if (!existsSync(featuresDir)) {
			return { displayed: false, reason: "No features found" };
		}

		let featureDirs: string[];
		try {
			featureDirs = readdirSync(featuresDir)
				.filter((f) => {
					const specPath = join(featuresDir, f, "spec.md");
					return existsSync(specPath);
				})
				.sort();
		} catch {
			return { displayed: false, reason: "No features found" };
		}

		if (featureDirs.length === 0) {
			return { displayed: false, reason: "No features found" };
		}

		const scores: SpecScore[] = [];
		for (const dir of featureDirs) {
			const specPath = join(featuresDir, dir, "spec.md");
			const result = scoreFn(specPath);
			if (result.ok) {
				scores.push({ feature: dir, score: result.value });
			}
		}

		const average =
			scores.length > 0
				? Math.round(
						scores.reduce((sum, s) => sum + s.score.overall, 0) / scores.length,
					)
				: 0;

		let skipRate: { total: number; skipped: number; rate: number } | undefined;
		const skipResult = skipFn(mainaDir);
		if (skipResult.ok) {
			skipRate = skipResult.value;
		}

		return {
			displayed: true,
			specsResult: { scores, average, skipRate },
		};
	}

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

	// ── Wiki metrics ───────────────────────────────────────────────────
	const wikiMetrics = gatherWikiMetrics(mainaDir) ?? undefined;

	// ── JSON output ────────────────────────────────────────────────────
	if (options.json) {
		const jsonOutput = JSON.stringify({ stats, trends, wikiMetrics }, null, 2);
		return { displayed: true, stats, trends, jsonOutput, wikiMetrics };
	}

	// ── Formatted display ──────────────────────────────────────────────
	return { displayed: true, stats, trends, wikiMetrics };
}

// ── Specs Display Helper ────────────────────────────────────────────────────

function displaySpecs(result: SpecsResult): void {
	log.info("Feature Specs Quality:\n");

	// Column headers
	const header = `  ${"Feature".padEnd(26)} ${"Score".padEnd(7)} ${"Measurability".padEnd(15)} ${"Testability".padEnd(13)} ${"Ambiguity".padEnd(11)} ${"Completeness"}`;
	const separator = `  ${"─".repeat(26)} ${"─".repeat(7)} ${"─".repeat(15)} ${"─".repeat(13)} ${"─".repeat(11)} ${"─".repeat(12)}`;

	log.info(header);
	log.info(separator);

	for (const entry of result.scores) {
		const s = entry.score;
		const row = `  ${entry.feature.padEnd(26)} ${String(s.overall).padStart(3).padEnd(7)} ${String(s.measurability).padStart(3).padEnd(15)} ${String(s.testability).padStart(3).padEnd(13)} ${String(s.ambiguity).padStart(3).padEnd(11)} ${String(s.completeness).padStart(3)}`;
		log.info(row);
	}

	log.info("");
	log.info(`  Average: ${result.average}/100`);

	if (result.skipRate) {
		const pct = `${Math.round(result.skipRate.rate * 100)}%`;
		log.info(
			`  Skip rate: ${pct} (${result.skipRate.skipped}/${result.skipRate.total} commits)`,
		);
	}
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

function displayWikiMetrics(metrics: WikiMetrics): void {
	log.step("Wiki:");
	const parts = [
		`${metrics.modules} modules`,
		`${metrics.entities} entities`,
		`${metrics.features} features`,
		`${metrics.decisions} decisions`,
		`${metrics.architecture} architecture`,
	];
	log.message(`  Articles: ${metrics.totalArticles} (${parts.join(", ")})`);
	log.message(`  Last compile: ${metrics.lastCompile}`);
	log.message(`  Compilation time: ${metrics.compilationTimeMs}ms`);
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
		.option("--specs", "Show feature spec quality scores")
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
				specs: options.specs,
			});

			if (!result.displayed) {
				log.warning(result.reason ?? "Unknown error");
				outro("Done.");
				return;
			}

			if (result.specsResult) {
				displaySpecs(result.specsResult);
			} else if (result.jsonOutput) {
				// biome-ignore lint/suspicious/noConsole: JSON output goes to stdout
				console.log(result.jsonOutput);
			} else if (result.stats && result.trends) {
				displayStats(result.stats, result.trends);
			}

			if (result.wikiMetrics) {
				displayWikiMetrics(result.wikiMetrics);
			}

			outro("Done.");
		});
}
