/**
 * SonarQube Integration for the Verify Engine.
 *
 * Runs sonar-scanner and parses the JSON report into unified Findings.
 * Gracefully skips if sonar-scanner is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SonarOptions {
	cwd?: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
}

export interface SonarResult {
	findings: Finding[];
	skipped: boolean;
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
 * If sonar-scanner fails, returns `{ findings: [], skipped: false }`.
 */
export async function runSonar(options?: SonarOptions): Promise<SonarResult> {
	const toolAvailable =
		options?.available ?? (await isToolAvailable("sonarqube"));
	if (!toolAvailable) {
		return { findings: [], skipped: true };
	}

	const cwd = options?.cwd ?? process.cwd();

	const args = [
		"sonar-scanner",
		"-Dsonar.analysis.mode=issues",
		"-Dsonar.report.export.path=sonar-report.json",
	];

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
