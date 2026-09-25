/**
 * Trivy Integration for the Verify Engine.
 *
 * Runs Trivy for dependency CVE scanning.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if trivy is not installed.
 */

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

interface TrivyOptions {
	scanType?: "fs" | "repo";
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
	/** Spawns the tool; the system process adapter by default. */
	process?: ProcessPort;
}

export interface TrivyResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Map Trivy severity string to unified severity.
 */
function mapTrivySeverity(severity: string): "error" | "warning" | "info" {
	switch (severity.toUpperCase()) {
		case "CRITICAL":
		case "HIGH":
			return "error";
		case "MEDIUM":
			return "warning";
		default:
			return "info";
	}
}

/**
 * Parse Trivy JSON output into Finding[].
 *
 * Trivy JSON has this structure:
 * ```json
 * {
 *   "Results": [{
 *     "Target": "package-lock.json",
 *     "Type": "npm",
 *     "Vulnerabilities": [{
 *       "VulnerabilityID": "CVE-...",
 *       "PkgName": "lodash",
 *       "InstalledVersion": "4.17.20",
 *       "FixedVersion": "4.17.21",
 *       "Severity": "HIGH",
 *       "Title": "Prototype Pollution"
 *     }]
 *   }]
 * }
 * ```
 *
 * Handles malformed JSON and unexpected structures gracefully.
 */
export function parseTrivyJson(json: string): Finding[] {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}

	const results = parsed.Results;
	if (!Array.isArray(results)) {
		return [];
	}

	const findings: Finding[] = [];

	for (const result of results) {
		const r = result as Record<string, unknown>;
		const target = (r.Target as string) ?? "";
		const vulnerabilities = r.Vulnerabilities;

		if (!Array.isArray(vulnerabilities)) {
			continue;
		}

		for (const vuln of vulnerabilities) {
			const v = vuln as Record<string, unknown>;
			const vulnId = (v.VulnerabilityID as string) ?? "";
			const pkgName = (v.PkgName as string) ?? "";
			const installedVersion = (v.InstalledVersion as string) ?? "";
			const fixedVersion = (v.FixedVersion as string) ?? undefined;
			const severity = (v.Severity as string) ?? "UNKNOWN";
			const title = (v.Title as string) ?? "";

			let message = `${pkgName}@${installedVersion}: ${title}`;
			if (fixedVersion) {
				message += ` (fix: ${fixedVersion})`;
			}

			findings.push({
				tool: "trivy",
				file: target,
				line: 0,
				message,
				severity: mapTrivySeverity(severity),
				ruleId: vulnId || undefined,
			});
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Trivy and return parsed findings.
 *
 * If trivy is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runTrivy(options: TrivyOptions): Promise<TrivyResult> {
	const resolved = await resolveTool("trivy", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const scanType = options.scanType ?? "fs";
	const cwd = options.cwd;

	const args: [string, ...string[]] = [
		resolved.command,
		scanType,
		"--format",
		"json",
		"--scanners",
		"vuln",
		".",
	];

	const run = await spawnTool(args, cwd, options.process);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("trivy", run.error),
		};
	}
	if (failedWithoutResults(run.value)) {
		return {
			findings: [],
			skipped: true,
			notice: exitFailureNotice("trivy", run.value),
		};
	}
	return { findings: parseTrivyJson(run.value.stdout), skipped: false };
}
