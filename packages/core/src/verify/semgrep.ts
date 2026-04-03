/**
 * Semgrep Integration for the Verify Engine.
 *
 * Runs Semgrep with auto rules + optional custom rules directory.
 * Parses SARIF output into the unified Finding type.
 * Gracefully skips if semgrep is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SemgrepOptions {
	files?: string[];
	rulesDir?: string;
	config?: string;
	cwd?: string;
}

export interface SemgrepResult {
	findings: Finding[];
	skipped: boolean;
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
 * If semgrep fails, returns `{ findings: [], skipped: false }`.
 */
export async function runSemgrep(
	options?: SemgrepOptions,
): Promise<SemgrepResult> {
	const available = await isToolAvailable("semgrep");
	if (!available) {
		return { findings: [], skipped: true };
	}

	const config = options?.config ?? "auto";
	const cwd = options?.cwd ?? process.cwd();

	const args = ["semgrep", "scan", "--sarif", `--config=${config}`];

	if (options?.rulesDir) {
		args.push(`--config=${options.rulesDir}`);
	}

	if (options?.files && options.files.length > 0) {
		args.push(...options.files);
	}

	try {
		const proc = Bun.spawn(args, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		await new Response(proc.stderr).text();
		await proc.exited;

		const findings = parseSarif(stdout);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
