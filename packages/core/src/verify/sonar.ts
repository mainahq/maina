/**
 * SonarQube Integration for the Verify Engine.
 *
 * Runs sonar-scanner and parses the JSON report into unified Findings.
 * Gracefully skips if sonar-scanner is not installed.
 */

import type { Finding } from "./diff-filter";
import { resolveTool, spawnFailureNotice, spawnTool } from "./tool-spawn";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SonarOptions {
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
}

export interface SonarResult {
	findings: Finding[];
	skipped: boolean;
	/** Why the tool was skipped although detected, e.g. it could not be started. */
	notice?: string;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Map SonarQube severity to unified severity.
 */
function mapSonarSeverity(severity: string): "error" | "warning" | "info" {
	switch (severity.toUpperCase()) {
		case "BLOCKER":
		case "CRITICAL":
			return "error";
		case "MAJOR":
		case "MINOR":
			return "warning";
		case "INFO":
			return "info";
		default:
			return "warning";
	}
}

/**
 * Parse SonarQube JSON report into Finding[].
 *
 * Expected format:
 * ```json
 * {
 *   "issues": [{
 *     "rule": "typescript:S1854",
 *     "severity": "MAJOR",
 *     "component": "src/app.ts",
 *     "line": 42,
 *     "message": "Description of the issue"
 *   }]
 * }
 * ```
 *
 * Handles malformed JSON and unexpected structures gracefully.
 */
export function parseSonarReport(json: string): Finding[] {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}

	const issues = parsed.issues;
	if (!Array.isArray(issues)) {
		return [];
	}

	const findings: Finding[] = [];

	for (const issue of issues) {
		const i = issue as Record<string, unknown>;
		const rule = (i.rule as string) ?? undefined;
		const severity = (i.severity as string) ?? "MAJOR";
		const component = (i.component as string) ?? "";
		const line = (i.line as number) ?? 0;
		const message = (i.message as string) ?? "";

		findings.push({
			tool: "sonarqube",
			file: component,
			line,
			message,
			severity: mapSonarSeverity(severity),
			ruleId: rule,
		});
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run SonarQube scanner and return parsed findings.
 *
 * If sonar-scanner is not installed, returns `{ findings: [], skipped: true }`.
 * Spawns the command detection resolved (it may be root-local); if it cannot
 * be started, returns `{ findings: [], skipped: true, notice }`.
 */
export async function runSonar(options: SonarOptions): Promise<SonarResult> {
	const resolved = await resolveTool("sonarqube", options);
	if (!resolved.available) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;

	const args: [string, ...string[]] = [
		resolved.command,
		"-Dsonar.analysis.mode=issues",
		"-Dsonar.report.export.path=sonar-report.json",
	];

	const run = await spawnTool(args, cwd);
	if (!run.ok) {
		return {
			findings: [],
			skipped: true,
			notice: spawnFailureNotice("sonarqube", run.error),
		};
	}

	try {
		// Read the generated report file
		const reportPath = `${cwd}/.scannerwork/sonar-report.json`;
		const reportFile = Bun.file(reportPath);
		const exists = await reportFile.exists();
		if (!exists) {
			return { findings: [], skipped: false };
		}

		const reportJson = await reportFile.text();
		const findings = parseSonarReport(reportJson);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
