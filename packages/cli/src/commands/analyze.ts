import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { analyze, getCurrentBranch } from "@mainahq/core";
import { Command } from "commander";
import { EXIT_FINDINGS, EXIT_PASSED, outputJson } from "../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnalyzeActionOptions {
	featureDir?: string; // Explicit feature dir, or auto-detect from branch
	all?: boolean; // Analyze all features
	json?: boolean; // Output JSON for CI
	cwd?: string;
}

export interface AnalyzeActionResult {
	analyzed: boolean;
	reason?: string;
	reports?: Array<{
		featureDir: string;
		findings: number;
		errors: number;
		warnings: number;
	}>;
	passed?: boolean; // true if no errors
}

export interface AnalyzeDeps {
	getCurrentBranch: (cwd: string) => Promise<string>;
	analyze: (featureDir: string) =>
		| {
				ok: true;
				value: {
					featureDir: string;
					findings: Array<{
						severity: string;
						category: string;
						message: string;
						file?: string;
						line?: number;
					}>;
					summary: { errors: number; warnings: number; info: number };
				};
		  }
		| { ok: false; error: string };
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: AnalyzeDeps = { getCurrentBranch, analyze };

// ── Feature Directory Resolution ─────────────────────────────────────────────

/**
 * Extract feature name from branch (e.g. "feature/001-user-auth" -> "001-user-auth").
 * Returns null if the branch doesn't match the feature pattern.
 */
function extractFeatureFromBranch(branch: string): string | null {
	const match = branch.match(/^feature\/(.+)$/);
	return match?.[1] ?? null;
}

/**
 * Find a matching feature directory in .maina/features/ given a feature name.
 */
function findFeatureDir(cwd: string, featureName: string): string | null {
	const featuresDir = join(cwd, ".maina", "features");

	if (!existsSync(featuresDir)) {
		return null;
	}

	const entries = readdirSync(featuresDir);
	for (const entry of entries) {
		if (entry === featureName) {
			return join(featuresDir, entry);
		}
	}

	return null;
}

/**
 * Scan .maina/features/ and return all subdirectory paths.
 */
function scanAllFeatureDirs(cwd: string): string[] {
	const featuresDir = join(cwd, ".maina", "features");

	if (!existsSync(featuresDir)) {
		return [];
	}

	const entries = readdirSync(featuresDir);
	const dirs: string[] = [];

	for (const entry of entries) {
		const full = join(featuresDir, entry);
		if (statSync(full).isDirectory()) {
			dirs.push(full);
		}
	}

	return dirs.sort();
}

// ── Severity Icons ───────────────────────────────────────────────────────────

function severityIcon(severity: string): string {
	switch (severity) {
		case "error":
			return "\u2717"; // ✗
		case "warning":
			return "\u26A0"; // ⚠
		case "info":
			return "\u25CF"; // ●
		default:
			return "-";
	}
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core analyze logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function analyzeAction(
	options: AnalyzeActionOptions,
	deps: AnalyzeDeps = defaultDeps,
): Promise<AnalyzeActionResult> {
	const cwd = options.cwd ?? process.cwd();

	// ── Determine which feature dirs to analyze ─────────────────────────
	let featureDirs: string[];

	if (options.all) {
		featureDirs = scanAllFeatureDirs(cwd);

		if (featureDirs.length === 0) {
			return {
				analyzed: false,
				reason: "No feature directories found in .maina/features/",
			};
		}
	} else if (options.featureDir) {
		featureDirs = [options.featureDir];
	} else {
		// Auto-detect from branch
		const branch = await deps.getCurrentBranch(cwd);
		const featureName = extractFeatureFromBranch(branch);

		if (!featureName) {
			return {
				analyzed: false,
				reason: `Not on a feature branch (current: "${branch}"). Use --feature-dir to specify explicitly.`,
			};
		}

		const detected = findFeatureDir(cwd, featureName);
		if (!detected) {
			return {
				analyzed: false,
				reason: `Feature directory not found for "${featureName}" in .maina/features/`,
			};
		}

		featureDirs = [detected];
	}

	// ── Run analyze on each feature dir ─────────────────────────────────
	const reports: Array<{
		featureDir: string;
		findings: number;
		errors: number;
		warnings: number;
	}> = [];

	for (const dir of featureDirs) {
		const result = deps.analyze(dir);

		if (!result.ok) {
			return {
				analyzed: false,
				reason: result.error,
			};
		}

		const { value } = result;
		reports.push({
			featureDir: value.featureDir,
			findings: value.findings.length,
			errors: value.summary.errors,
			warnings: value.summary.warnings,
		});
	}

	// ── Determine overall pass/fail ─────────────────────────────────────
	const totalErrors = reports.reduce((sum, r) => sum + r.errors, 0);
	const passed = totalErrors === 0;

	return {
		analyzed: true,
		reports,
		passed,
	};
}

// ── Display Helpers ──────────────────────────────────────────────────────────

function formatFindings(
	featureDir: string,
	findings: Array<{
		severity: string;
		category: string;
		message: string;
		file?: string;
		line?: number;
	}>,
	summary: { errors: number; warnings: number; info: number },
): void {
	const dirName = featureDir.split("/").pop() ?? featureDir;
	log.info(`Feature: ${dirName}`);

	for (const finding of findings) {
		const icon = severityIcon(finding.severity);
		const location =
			finding.file && finding.line
				? ` (${finding.file}:${finding.line})`
				: finding.file
					? ` (${finding.file})`
					: "";
		const line = `  ${icon} [${finding.severity}] ${finding.category}: ${finding.message}${location}`;

		switch (finding.severity) {
			case "error":
				log.error(line);
				break;
			case "warning":
				log.warning(line);
				break;
			default:
				log.info(line);
				break;
		}
	}

	const parts: string[] = [];
	if (summary.errors > 0)
		parts.push(`${summary.errors} error${summary.errors !== 1 ? "s" : ""}`);
	if (summary.warnings > 0)
		parts.push(
			`${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""}`,
		);
	if (summary.info > 0) parts.push(`${summary.info} info`);

	if (parts.length > 0) {
		log.info(`Summary: ${parts.join(", ")}`);
	} else {
		log.success("No findings");
	}
}

// ── Commander Command ────────────────────────────────────────────────────────

export function analyzeCommand(): Command {
	return new Command("analyze")
		.description("Check spec \u2194 plan \u2194 tasks consistency")
		.option("--feature-dir <dir>", "Feature directory path")
		.option("--all", "Analyze all features")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina analyze");
			}

			const result = await analyzeAction({
				featureDir: options.featureDir,
				all: options.all,
				json: jsonMode,
			});

			if (jsonMode) {
				const exitCode = result.analyzed
					? result.passed
						? EXIT_PASSED
						: EXIT_FINDINGS
					: EXIT_FINDINGS;
				outputJson(result, exitCode);
				return;
			}

			if (!result.analyzed) {
				log.error(result.reason ?? "Unknown error");
				outro("Aborted");
				return;
			}

			// Display detailed findings for each feature
			if (result.reports) {
				for (const report of result.reports) {
					// Re-run analyze to get full findings for display
					const full = defaultDeps.analyze(report.featureDir);
					if (full.ok) {
						formatFindings(
							full.value.featureDir,
							full.value.findings,
							full.value.summary,
						);
					}
				}
			}

			if (result.passed) {
				outro("All checks passed");
			} else {
				const totalErrors =
					result.reports?.reduce((sum, r) => sum + r.errors, 0) ?? 0;
				const totalWarnings =
					result.reports?.reduce((sum, r) => sum + r.warnings, 0) ?? 0;
				outro(
					`Failed: ${totalErrors} error${totalErrors !== 1 ? "s" : ""}, ${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`,
				);
			}
		});
}
