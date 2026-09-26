/**
 * SonarQube Integration for the Verify Engine.
 *
 * Runs sonar-scanner and parses a local JSON issues report, when the run
 * leaves one, into unified Findings. The scanner's local "issues" preview
 * mode (`sonar.analysis.mode`) was removed in SonarQube 7: a modern scanner
 * uploads its analysis and the issues live on the server, so a run without a
 * local report is a skip with a notice, never a pass.
 *
 * Gracefully skips if sonar-scanner is not installed, or if the repository
 * has no `sonar-project.properties` (the scanner has no project to analyse).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProcessPort } from "../ports/process";
import type { Finding } from "./diff-filter";
import {
	exitFailureNotice,
	isFreshReport,
	resolveTool,
	spawnFailureNotice,
	spawnTool,
} from "./tool-spawn";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SonarOptions {
	/** Repository root the tool runs in; required, core never reads the process cwd. */
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Pre-resolved command path from detection (may be root-local node_modules/.bin). */
	command?: string;
	/** Spawns the tool; the system process adapter by default. */
	process?: ProcessPort;
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

const NO_LOCAL_REPORT_NOTICE =
	"sonarqube ran but left no local issues report (the analysis is on the SonarQube server). Skipped, no results from this tool.";

const UNREADABLE_REPORT_NOTICE =
	"sonarqube left a local issues report that could not be read. Skipped, no results from this tool.";

/**
 * Run SonarQube scanner and return parsed findings.
 *
 * If sonar-scanner is not installed, or the root has no
 * `sonar-project.properties`, returns `{ findings: [], skipped: true }`
 * without spawning it. Spawns the command detection resolved (it may be
 * root-local); if it cannot be started, returns
 * `{ findings: [], skipped: true, notice }`.
 */
export async function runSonar(options: SonarOptions): Promise<SonarResult> {
	const resolved = await resolveTool("sonarqube", options);
	const cwd = options.cwd;
	if (
		!resolved.available ||
		!existsSync(join(cwd, "sonar-project.properties"))
	) {
		return { findings: [], skipped: true };
	}

	const args: [string, ...string[]] = [resolved.command];

	const run = await spawnTool(args, cwd, options.process);
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
		// A report older than this run is a leftover, not this run's result.
		const fresh =
			(await reportFile.exists()) &&
			isFreshReport(reportFile.lastModified, run.value);
		if (!fresh) {
			// A failed run that left no report produced nothing to trust.
			if (run.value.exitCode !== 0) {
				return {
					findings: [],
					skipped: true,
					notice: exitFailureNotice("sonarqube", run.value),
				};
			}
			// The analysis went to the server; nothing local to report.
			return {
				findings: [],
				skipped: true,
				notice: NO_LOCAL_REPORT_NOTICE,
			};
		}

		const reportJson = await reportFile.text();
		const findings = parseSonarReport(reportJson);
		return { findings, skipped: false };
	} catch {
		// A report it could not read is no result: a skip, never a pass.
		return { findings: [], skipped: true, notice: UNREADABLE_REPORT_NOTICE };
	}
}
