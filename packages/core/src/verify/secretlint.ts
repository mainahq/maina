/**
 * Secretlint Integration for the Verify Engine.
 *
 * Runs Secretlint for secrets detection in source files.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if secretlint is not installed, or if the repository has
 * no secretlint config: secretlint refuses to run without one.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

interface SecretlintOptions {
	files?: string[];
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
	/** Spawns the tool; the system process adapter by default. */
	process?: ProcessPort;
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

// ─── Config ───────────────────────────────────────────────────────────────

/** The config files secretlint looks for (`rc-config-loader` names). */
const SECRETLINT_CONFIG_FILES = [
	".secretlintrc",
	".secretlintrc.json",
	".secretlintrc.yaml",
	".secretlintrc.yml",
	".secretlintrc.js",
	".secretlintrc.cjs",
] as const;

/** True when `dir` itself has a secretlint config file or a non-empty `secretlint` field in package.json. */
function dirHasSecretlintConfig(dir: string): boolean {
	if (SECRETLINT_CONFIG_FILES.some((name) => existsSync(join(dir, name)))) {
		return true;
	}
	try {
		const pkg: unknown = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		);
		// rc-config-loader skips a falsy field, as secretlint then does.
		return (
			typeof pkg === "object" &&
			pkg !== null &&
			Boolean((pkg as Record<string, unknown>).secretlint)
		);
	} catch {
		return false;
	}
}

/**
 * True when secretlint run in `root` finds a config: in `root` or any
 * directory above it, the way its `rc-config-loader` looks.
 */
function hasSecretlintConfig(root: string): boolean {
	let dir = resolve(root);
	for (;;) {
		if (dirHasSecretlintConfig(dir)) return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Secretlint and return parsed findings.
 *
 * If secretlint is not installed, or no secretlint config is found from the root up
 * (secretlint then exits with an error), returns
 * `{ findings: [], skipped: true }` without spawning it. Spawns the command
 * detection resolved (it may be root-local); if it cannot be started,
 * returns `{ findings: [], skipped: true, notice }`.
 */
export async function runSecretlint(
	options: SecretlintOptions,
): Promise<SecretlintResult> {
	const resolved = await resolveTool("secretlint", options);
	if (!resolved.available || !hasSecretlintConfig(options.cwd)) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;

	const args: [string, ...string[]] = [resolved.command, "--format", "json"];

	if (options.files && options.files.length > 0) {
		args.push(...options.files);
	} else {
		args.push("**/*");
	}

	const run = await spawnTool(args, cwd, options.process);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("secretlint", run.error),
		};
	}
	if (failedWithoutResults(run.value)) {
		return {
			findings: [],
			skipped: true,
			notice: exitFailureNotice("secretlint", run.value),
		};
	}
	return { findings: parseSecretlintOutput(run.value.stdout), skipped: false };
}
