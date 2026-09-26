/**
 * diff-cover Integration for the Verify Engine.
 *
 * Runs diff-cover to find changed lines that lack test coverage.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if diff-cover is not installed.
 */

import { resolveBaseBranch } from "../git/index";
import type { ProcessPort } from "../ports/process";
import type { Finding } from "./diff-filter";
import {
	exitFailureNotice,
	failedWithoutResults,
	resolveTool,
	spawnFailureNotice,
	spawnTool,
} from "./tool-spawn";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CoverageOptions {
	coverageXml?: string;
	baseBranch?: string;
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
	/** Spawns the tool; the system process adapter by default. */
	process?: ProcessPort;
}

export interface CoverageResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Parse diff-cover JSON output into Finding[].
 *
 * Expected format:
 * ```json
 * {
 *   "src_stats": {
 *     "src/app.ts": {
 *       "covered_lines": [10, 11, 12],
 *       "violation_lines": [15, 16],
 *       "percent_covered": 60.0
 *     }
 *   }
 * }
 * ```
 *
 * Each violation line becomes a Finding with warning severity.
 */
export function parseDiffCoverJson(json: string): Finding[] {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}

	const srcStats = parsed.src_stats;
	if (!srcStats || typeof srcStats !== "object") {
		return [];
	}

	const findings: Finding[] = [];

	for (const [filePath, stats] of Object.entries(
		srcStats as Record<string, unknown>,
	)) {
		const s = stats as Record<string, unknown>;
		const violationLines = s.violation_lines;
		const percentCovered = (s.percent_covered as number) ?? 0;

		if (!Array.isArray(violationLines) || violationLines.length === 0) {
			continue;
		}

		for (const line of violationLines) {
			if (typeof line !== "number") continue;

			findings.push({
				tool: "diff-cover",
				file: filePath,
				line,
				message: `Changed line not covered by tests (file: ${Math.round(percentCovered)}% covered)`,
				severity: "warning",
				ruleId: "diff-cover/uncovered-line",
			});
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run diff-cover and return parsed findings.
 *
 * If diff-cover is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runCoverage(
	options: CoverageOptions,
): Promise<CoverageResult> {
	const resolved = await resolveTool("diff-cover", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;
	const coverageXml = options.coverageXml ?? "coverage/cobertura-coverage.xml";
	const baseBranch = await resolveBaseBranch(cwd, options.baseBranch);

	// The JSON report goes to stdout ("-"); --quiet keeps diff-cover's text
	// summary out of it. `--json-report` needs its argument: a bare `--json`
	// is read as `--json-report` without one, a usage error.
	const args: [string, ...string[]] = [
		resolved.command,
		coverageXml,
		`--compare-branch=${baseBranch}`,
		"--json-report",
		"-",
		"--quiet",
	];

	const run = await spawnTool(args, cwd, options.process);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("diff-cover", run.error),
		};
	}
	if (failedWithoutResults(run.value)) {
		return {
			findings: [],
			skipped: true,
			notice: exitFailureNotice("diff-cover", run.value),
		};
	}
	return { findings: parseDiffCoverJson(run.value.stdout), skipped: false };
}
