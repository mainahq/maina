/**
 * diff-cover Integration for the Verify Engine.
 *
 * Runs diff-cover to find changed lines that lack test coverage.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if diff-cover is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CoverageOptions {
	coverageXml?: string;
	baseBranch?: string;
	cwd?: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
}

export interface CoverageResult {
	findings: Finding[];
	skipped: boolean;
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
 * If diff-cover fails, returns `{ findings: [], skipped: false }`.
 */
export async function runCoverage(
	options?: CoverageOptions,
): Promise<CoverageResult> {
	const toolAvailable =
		options?.available ?? (await isToolAvailable("diff-cover"));
	if (!toolAvailable) {
		return { findings: [], skipped: true };
	}

	const cwd = options?.cwd ?? process.cwd();
	const coverageXml = options?.coverageXml ?? "coverage/cobertura-coverage.xml";
	const baseBranch = options?.baseBranch ?? "main";

	const args = [
		"diff-cover",
		coverageXml,
		`--compare-branch=${baseBranch}`,
		"--json",
	];

	try {
		const proc = Bun.spawn(args, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		await new Response(proc.stderr).text();
		await proc.exited;

		const findings = parseDiffCoverJson(stdout);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
