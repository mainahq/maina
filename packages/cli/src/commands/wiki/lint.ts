/**
 * `maina wiki lint` — standalone wiki lint command.
 *
 * Runs wiki lint checks (stale, orphan, broken links, coverage gaps)
 * and displays findings as a table.
 */

import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import type { Command } from "commander";
import { EXIT_FINDINGS, EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiLintCommandResult {
	passed: boolean;
	findings: Array<{
		check: string;
		severity: string;
		article: string;
		message: string;
	}>;
	coveragePercent: number;
	totalFindings: number;
}

export interface WikiLintCommandOptions {
	json?: boolean;
	cwd?: string;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiLintAction(
	options: WikiLintCommandOptions = {},
): Promise<WikiLintCommandResult> {
	const cwd = options.cwd ?? process.cwd();
	const wikiDir = join(cwd, ".maina", "wiki");

	// Dynamic import to avoid circular dependency issues at CLI layer
	const { runWikiLint } = await import(
		"@mainahq/core/src/verify/tools/wiki-lint"
	);

	const result = runWikiLint({ wikiDir, repoRoot: cwd });

	// Flatten all findings
	const allFindings = [
		...result.stale,
		...result.orphans,
		...result.gaps,
		...result.brokenLinks,
		...result.contradictions,
		...result.specDrift,
		...result.decisionViolations,
		...result.missingRationale,
	];

	const hasErrors = allFindings.some(
		(f: { severity: string }) => f.severity === "error",
	);

	return {
		passed: !hasErrors,
		findings: allFindings.map(
			(f: {
				check: string;
				severity: string;
				article: string;
				message: string;
			}) => ({
				check: f.check,
				severity: f.severity,
				article: f.article,
				message: f.message,
			}),
		),
		coveragePercent: result.coveragePercent,
		totalFindings: allFindings.length,
	};
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatFindingsTable(result: WikiLintCommandResult): string {
	const lines: string[] = [];

	if (result.findings.length === 0) {
		lines.push("  No findings. Wiki is healthy.");
		lines.push("");
		lines.push(`  Coverage: ${result.coveragePercent}%`);
		return lines.join("\n");
	}

	lines.push(
		`  ${"Severity".padEnd(10)} ${"Check".padEnd(18)} ${"Article".padEnd(30)} Message`,
	);
	lines.push(
		`  ${"─".repeat(10)} ${"─".repeat(18)} ${"─".repeat(30)} ${"─".repeat(40)}`,
	);

	for (const finding of result.findings) {
		const severity = finding.severity.padEnd(10);
		const check = finding.check.padEnd(18);
		const article = (finding.article || "-").padEnd(30);
		lines.push(`  ${severity} ${check} ${article} ${finding.message}`);
	}

	lines.push("");
	lines.push(
		`  Total: ${result.totalFindings} finding(s) | Coverage: ${result.coveragePercent}%`,
	);

	return lines.join("\n");
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiLintCommand(parent: Command): void {
	parent
		.command("lint")
		.description("Run wiki lint checks")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki lint");
			}

			const result = await wikiLintAction({ json: jsonMode });

			if (!jsonMode) {
				log.step("Wiki Lint Results:");
				log.message(formatFindingsTable(result));
				if (result.passed) {
					outro("Passed.");
				} else {
					outro("Failed — errors found.");
				}
			} else {
				outputJson(result, result.passed ? EXIT_PASSED : EXIT_FINDINGS);
			}
		});
}
