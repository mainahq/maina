/**
 * ZAP DAST Integration for the Verify Engine.
 *
 * Runs OWASP ZAP baseline scan via Docker against a target URL.
 * Parses JSON output into the unified Finding type.
 * Gracefully skips if Docker is not available or no target URL configured.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ZapOptions {
	targetUrl: string;
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
}

export interface ZapResult {
	findings: Finding[];
	skipped: boolean;
}

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Map ZAP risk description to unified severity.
 *
 * ZAP riskdesc format: "High (Medium)", "Medium (Low)", "Low (Medium)", etc.
 * We extract the first word (risk level) to map severity.
 */
function mapZapRisk(riskdesc: string): "error" | "warning" | "info" {
	const risk = riskdesc.split(" ")[0]?.toLowerCase() ?? "";
	switch (risk) {
		case "high":
			return "error";
		case "medium":
			return "warning";
		case "low":
		case "informational":
			return "info";
		default:
			return "warning";
	}
}

/**
 * Parse ZAP JSON output into Finding[].
 *
 * ZAP JSON baseline report has this structure:
 * ```json
 * {
 *   "site": [{
 *     "alerts": [{
 *       "pluginid": "10021",
 *       "alert": "X-Content-Type-Options Header Missing",
 *       "riskdesc": "Low (Medium)",
 *       "desc": "The Anti-MIME-Sniffing header is not set.",
 *       "instances": [{
 *         "uri": "https://example.com/api/health",
 *         "method": "GET"
 *       }]
 *     }]
 *   }]
 * }
 * ```
 *
 * Each alert may have multiple instances (URLs). We create one Finding per
 * instance. If an alert has no instances, we still emit one Finding with
 * an empty file.
 *
 * Handles malformed JSON and unexpected structures gracefully.
 */
export function parseZapJson(json: string): Finding[] {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}

	const sites = parsed.site;
	if (!Array.isArray(sites)) {
		return [];
	}

	const findings: Finding[] = [];

	for (const site of sites) {
		const s = site as Record<string, unknown>;
		const alerts = s.alerts;

		if (!Array.isArray(alerts)) {
			continue;
		}

		for (const alert of alerts) {
			const a = alert as Record<string, unknown>;
			const pluginId = (a.pluginid as string) ?? undefined;
			const alertName = (a.alert as string) ?? "";
			const riskdesc = (a.riskdesc as string) ?? "Informational";
			const desc = (a.desc as string) ?? "";
			const instances = a.instances;
			const severity = mapZapRisk(riskdesc);

			const message = `${alertName}: ${desc}`;

			if (Array.isArray(instances) && instances.length > 0) {
				for (const instance of instances) {
					const inst = instance as Record<string, unknown>;
					const uri = (inst.uri as string) ?? "";

					findings.push({
						tool: "zap",
						file: uri,
						line: 0,
						message,
						severity,
						ruleId: pluginId,
					});
				}
			} else {
				findings.push({
					tool: "zap",
					file: "",
					line: 0,
					message,
					severity,
					ruleId: pluginId,
				});
			}
		}
	}

	return findings;
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run ZAP baseline scan via Docker and return parsed findings.
 *
 * If Docker is not available or no targetUrl is configured,
 * returns `{ findings: [], skipped: true }`.
 * If ZAP fails, returns `{ findings: [], skipped: false }`.
 */
export async function runZap(options: ZapOptions): Promise<ZapResult> {
	if (!options.targetUrl) {
		return { findings: [], skipped: true };
	}

	const toolAvailable = options.available ?? (await isToolAvailable("zap"));
	if (!toolAvailable) {
		return { findings: [], skipped: true };
	}

	const cwd = options.cwd;

	const args = [
		"docker",
		"run",
		"--rm",
		"zaproxy/zap-stable",
		"zap-baseline.py",
		"-t",
		options.targetUrl,
		"-J",
		"report.json",
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

		const findings = parseZapJson(stdout);
		return { findings, skipped: false };
	} catch {
		return { findings: [], skipped: false };
	}
}
