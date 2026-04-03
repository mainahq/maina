/**
 * Secretlint Integration for the Verify Engine.
 *
 * Runs Secretlint for secrets detection in source files.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if secretlint is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SecretlintOptions {
	files?: string[];
	cwd?: string;
}

export interface SecretlintResult {
	findings: Finding[];
	skipped: boolean;
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
 * If secretlint fails, returns `{ findings: [], skipped: false }`.
 */
export async function runSecretlint(
	options?: SecretlintOptions,
): Promise<SecretlintResult> {
	const available = await isToolAvailable("secretlint");
	if (!available) {
		return { findings: [], skipped: true };
	}

	const cwd = options?.cwd ?? process.cwd();

	const args = ["secretlint", "--format", "json"];

	if (options?.files && options.files.length > 0) {
		args.push(...options.files);
	} else {
		args.push("**/*");
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

		const findings = parseSecretlintOutput(stdout);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
