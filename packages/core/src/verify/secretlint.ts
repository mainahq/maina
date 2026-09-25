/**
 * Secretlint Integration for the Verify Engine.
 *
 * Runs Secretlint for secrets detection in source files.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if secretlint is not installed.
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

interface SecretlintOptions {
	files?: string[];
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
}

export interface SecretlintResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Map secretlint numeric severity to unified severity.
 * secretlint uses: 0 = info, 1 = warning, 2 = error
 */
function mapSecretlintSeverity(severity: number): "error" | "warning" | "info" {
	switch (severity) {
		case 2:
			return "error";
		case 1:
			return "warning";
		default:
			return "info";
	}
}

/**
 * Parse secretlint JSON output into Finding[].
 *
 * Secretlint JSON output is an array of file results:
 * ```json
 * [{
 *   "filePath": "src/config.ts",
 *   "messages": [{
 *     "ruleId": "@secretlint/secretlint-rule-preset-recommend",
 *     "message": "Found AWS Access Key ID",
 *     "loc": {
 *       "start": { "line": 5, "column": 10 },
 *       "end": { "line": 5, "column": 30 }
 *     },
 *     "severity": 2
 *   }]
 * }]
 * ```
 *
 * Handles malformed JSON and unexpected structures gracefully.
 */
export function parseSecretlintOutput(output: string): Finding[] {
	if (!output.trim()) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return [];
	}

	if (!Array.isArray(parsed)) {
		return [];
	}

	const findings: Finding[] = [];

	for (const fileResult of parsed) {
		const fr = fileResult as Record<string, unknown>;
		const filePath = (fr.filePath as string) ?? "";
		const messages = fr.messages;

		if (!Array.isArray(messages)) {
			continue;
		}

		for (const msg of messages) {
			const m = msg as Record<string, unknown>;
			const ruleId = (m.ruleId as string) ?? undefined;
			const message = (m.message as string) ?? "";
			const severity = (m.severity as number) ?? 0;

			const loc = m.loc as Record<string, unknown> | undefined;
			let line = 0;
			let column: number | undefined;

			if (loc) {
				const start = loc.start as Record<string, unknown> | undefined;
				if (start) {
					line = (start.line as number) ?? 0;
					const col = start.column as number | undefined;
					column = col ?? undefined;
				}
			}

			findings.push({
				tool: "secretlint",
				file: filePath,
				line,
				column,
				message,
				severity: mapSecretlintSeverity(severity),
				ruleId,
			});
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Secretlint and return parsed findings.
 *
 * If secretlint is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runSecretlint(
	options: SecretlintOptions,
): Promise<SecretlintResult> {
	const resolved = await resolveTool("secretlint", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;

	const args: [string, ...string[]] = [resolved.command, "--format", "json"];

	if (options.files && options.files.length > 0) {
		args.push(...options.files);
	} else {
		args.push("**/*");
	}

	const run = await spawnTool(args, cwd);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("secretlint", run.error),
		};
	}
	if (failedWithoutOutput(run.value)) {
		return {
			findings: [],
			skipped: true,
			notice: exitFailureNotice("secretlint", run.value),
		};
	}
	return { findings: parseSecretlintOutput(run.value.stdout), skipped: false };
}
