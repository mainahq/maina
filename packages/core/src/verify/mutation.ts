/**
 * Stryker Mutation Testing Integration for the Verify Engine.
 *
 * Runs Stryker and parses the JSON report for survived mutants.
 * Survived mutants indicate untested code paths.
 * Gracefully skips if stryker is not installed.
 */

import type { Finding } from "./diff-filter";
import {
	exitFailureNotice,
	isFreshReport,
	resolveTool,
	spawnFailureNotice,
	spawnTool,
} from "./tool-spawn";

// ─── Types ────────────────────────────────────────────────────────────────

export interface MutationOptions {
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
}

export interface MutationResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Parse Stryker JSON report into Finding[].
 * Only survived mutants become findings — killed/timeout/no-coverage are ignored.
 *
 * Expected format:
 * ```json
 * {
 *   "files": {
 *     "src/app.ts": {
 *       "mutants": [{
 *         "id": "1",
 *         "mutatorName": "ConditionalExpression",
 *         "status": "Survived",
 *         "location": { "start": { "line": 10, "column": 5 } },
 *         "description": "Replaced x > 0 with false"
 *       }]
 *     }
 *   }
 * }
 * ```
 */
export function parseStrykerReport(json: string): Finding[] {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}

	const files = parsed.files;
	if (!files || typeof files !== "object") {
		return [];
	}

	const findings: Finding[] = [];

	for (const [filePath, fileData] of Object.entries(
		files as Record<string, unknown>,
	)) {
		const data = fileData as Record<string, unknown>;
		const mutants = data.mutants;
		if (!Array.isArray(mutants)) continue;

		for (const mutant of mutants) {
			const m = mutant as Record<string, unknown>;
			const status = (m.status as string) ?? "";

			// Only report survived mutants — they indicate untested code
			if (status !== "Survived") continue;

			const mutatorName = (m.mutatorName as string) ?? "Unknown";
			const description = (m.description as string) ?? "";
			const location = m.location as Record<string, unknown> | undefined;
			const start = location?.start as Record<string, unknown> | undefined;
			const line = (start?.line as number) ?? 0;

			findings.push({
				tool: "stryker",
				file: filePath,
				line,
				message: `Survived mutant: ${description} (${mutatorName})`,
				severity: "warning",
				ruleId: `stryker/${mutatorName}`,
			});
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Stryker mutation testing and return parsed findings.
 *
 * If stryker is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runMutation(
	options: MutationOptions,
): Promise<MutationResult> {
	const resolved = await resolveTool("stryker", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;

	const args: [string, ...string[]] = [
		resolved.command,
		"run",
		"--reporters",
		"json",
	];

	const run = await spawnTool(args, cwd);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("stryker", run.error),
		};
	}

	try {
		// Read the generated report file
		const reportPath = `${cwd}/reports/mutation/mutation.json`;
		const reportFile = Bun.file(reportPath);
		// A report older than this run is a leftover, not this run's result.
		const fresh =
			(await reportFile.exists()) &&
			isFreshReport(reportFile.lastModified, run.value);
		if (!fresh) {
			// A failed run that left no report produced nothing to trust.
			if (run.value.exitCode !== 0) {
				return {
					findings: [],
					skipped: true,
					notice: exitFailureNotice("stryker", run.value),
				};
			}
			return { findings: [], skipped: false };
		}

		const reportJson = await reportFile.text();
		const findings = parseStrykerReport(reportJson);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
