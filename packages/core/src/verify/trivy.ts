/**
 * Trivy Integration for the Verify Engine.
 *
 * Runs Trivy for dependency CVE scanning.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if trivy is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface TrivyOptions {
	scanType?: "fs" | "repo";
	cwd?: string;
}

export interface TrivyResult {
	findings: Finding[];
	skipped: boolean;
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
 * If trivy fails, returns `{ findings: [], skipped: false }`.
 */
export async function runTrivy(options?: TrivyOptions): Promise<TrivyResult> {
	const available = await isToolAvailable("trivy");
	if (!available) {
		return { findings: [], skipped: true };
	}

	const scanType = options?.scanType ?? "fs";
	const cwd = options?.cwd ?? process.cwd();

	const args = [
		"trivy",
		scanType,
		"--format",
		"json",
		"--scanners",
		"vuln",
		".",
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

		const findings = parseTrivyJson(stdout);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
