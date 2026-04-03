/**
 * Stryker Mutation Testing Integration for the Verify Engine.
 *
 * Runs Stryker and parses the JSON report for survived mutants.
 * Survived mutants indicate untested code paths.
 * Gracefully skips if stryker is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface MutationOptions {
	cwd?: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
}

export interface MutationResult {
	findings: Finding[];
	skipped: boolean;
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
 * If stryker fails, returns `{ findings: [], skipped: false }`.
 */
export async function runMutation(
	options?: MutationOptions,
): Promise<MutationResult> {
	const toolAvailable =
		options?.available ?? (await isToolAvailable("stryker"));
	if (!toolAvailable) {
		return { findings: [], skipped: true };
	}

	const cwd = options?.cwd ?? process.cwd();

	const args = ["stryker", "run", "--reporters", "json"];

	try {
		const proc = Bun.spawn(args, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		await new Response(proc.stdout).text();
		await new Response(proc.stderr).text();
		await proc.exited;

		// Read the generated report file
		const reportPath = `${cwd}/reports/mutation/mutation.json`;
		const reportFile = Bun.file(reportPath);
		const exists = await reportFile.exists();
		if (!exists) {
			return { findings: [], skipped: false };
		}

		const reportJson = await reportFile.text();
		const findings = parseStrykerReport(reportJson);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
