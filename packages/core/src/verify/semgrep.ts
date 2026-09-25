/**
 * Semgrep Integration for the Verify Engine.
 *
 * Runs Semgrep with auto rules + optional custom rules directory.
 * Parses SARIF output into the unified Finding type.
 * Gracefully skips if semgrep is not installed.
 */

import type { Finding } from "./diff-filter";
import {
	exitFailureNotice,
	failedWithoutOutput,
	resolveTool,
	spawnFailureNotice,
	spawnTool,
} from "./tool-spawn";

// ─── Types ────────────────────────────────────────────────────────────────

interface SemgrepOptions {
	files?: string[];
	rulesDir?: string;
	config?: string;
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
}

export interface SemgrepResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── SARIF Parsing ────────────────────────────────────────────────────────

/**
 * Map SARIF level to unified severity.
 */
function mapSarifLevel(level: string): "error" | "warning" | "info" {
	switch (level) {
		case "error":
			return "error";
		case "warning":
			return "warning";
		case "note":
		case "none":
			return "info";
		default:
			return "warning";
	}
}

/**
 * Parse SARIF JSON output (from semgrep --sarif) into Finding[].
 *
 * Handles malformed JSON and unexpected structures gracefully by
 * returning an empty array.
 */
export function parseSarif(sarifJson: string): Finding[] {
	let sarif: Record<string, unknown>;
	try {
		sarif = JSON.parse(sarifJson) as Record<string, unknown>;
	} catch {
		return [];
	}

	const runs = sarif.runs;
	if (!Array.isArray(runs)) {
		return [];
	}

	const findings: Finding[] = [];

	for (const run of runs) {
		const results = (run as Record<string, unknown>).results;
		if (!Array.isArray(results)) {
			continue;
		}

		for (const result of results) {
			const r = result as Record<string, unknown>;
			const ruleId = (r.ruleId as string) ?? undefined;
			const messageObj = r.message as Record<string, unknown> | undefined;
			const message = (messageObj?.text as string) ?? "";
			const level = (r.level as string) ?? "warning";

			const locations = r.locations as Array<Record<string, unknown>>;
			let file = "";
			let line = 0;
			let column: number | undefined;

			if (Array.isArray(locations) && locations.length > 0) {
				const loc = locations[0] as Record<string, unknown>;
				const physicalLocation = loc?.physicalLocation as
					| Record<string, unknown>
					| undefined;

				if (physicalLocation) {
					const artifactLocation = physicalLocation.artifactLocation as
						| Record<string, unknown>
						| undefined;
					file = (artifactLocation?.uri as string) ?? "";

					const region = physicalLocation.region as
						| Record<string, unknown>
						| undefined;
					if (region) {
						line = (region.startLine as number) ?? 0;
						const startColumn = region.startColumn as number | undefined;
						column = startColumn ?? undefined;
					}
				}
			}

			findings.push({
				tool: "semgrep",
				file,
				line,
				column,
				message,
				severity: mapSarifLevel(level),
				ruleId,
			});
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Semgrep and return parsed findings.
 *
 * If semgrep is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runSemgrep(
	options: SemgrepOptions,
): Promise<SemgrepResult> {
	const resolved = await resolveTool("semgrep", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const config = options.config ?? "auto";
	const cwd = options.cwd;

	const args: [string, ...string[]] = [
		resolved.command,
		"scan",
		"--sarif",
		`--config=${config}`,
	];

	if (options.rulesDir) {
		args.push(`--config=${options.rulesDir}`);
	}

	if (options.files && options.files.length > 0) {
		args.push(...options.files);
	}

	const run = await spawnTool(args, cwd);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("semgrep", run.error),
		};
	}
	if (failedWithoutOutput(run.value)) {
		return {
			findings: [],
			skipped: true,
			notice: exitFailureNotice("semgrep", run.value),
		};
	}
	return { findings: parseSarif(run.value.stdout), skipped: false };
}
