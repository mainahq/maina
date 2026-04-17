/**
 * GitHub Checks API — create Check Runs for Maina verification results.
 *
 * Creates a Check Run with conclusion (success/failure/neutral),
 * summary, and up to 50 line annotations from verify findings.
 * Uses fetch directly — no Octokit dependency.
 */

import type { Result } from "../db/index";
import type { Finding } from "../verify/diff-filter";

// ── Types ──────────────────────────────────────────────────────────────

export interface CheckRunOptions {
	token: string;
	owner: string;
	repo: string;
	headSha: string;
	findings: Finding[];
	totalChecks: number;
	detailsUrl?: string;
	apiBase?: string;
}

export interface CheckRunResult {
	checkRunId: number;
	conclusion: "success" | "failure" | "neutral";
}

interface GitHubAnnotation {
	path: string;
	start_line: number;
	end_line: number;
	annotation_level: "notice" | "warning" | "failure";
	message: string;
	title?: string;
}

// ── Formatting ─────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, "notice" | "warning" | "failure"> = {
	info: "notice",
	warning: "warning",
	error: "failure",
};

/**
 * Convert verify findings to GitHub annotation format.
 * Caps at 50 (GitHub API limit per check run).
 */
export function formatAnnotations(findings: Finding[]): GitHubAnnotation[] {
	return findings.slice(0, 50).map((f) => ({
		path: f.file,
		start_line: f.line,
		end_line: f.line,
		annotation_level: SEVERITY_MAP[f.severity] ?? "warning",
		message: `[${f.tool}] ${f.message}`,
		title: f.ruleId,
	}));
}

/**
 * Determine Check Run conclusion from findings.
 * - errors → failure
 * - warnings/info only → neutral
 * - no findings → success
 */
export function determineConclusion(
	findings: Finding[],
): "success" | "failure" | "neutral" {
	if (findings.length === 0) return "success";
	if (findings.some((f) => f.severity === "error")) return "failure";
	return "neutral";
}

/**
 * Format the summary line for the Check Run.
 */
export function formatSummary(
	passed: number,
	warnings: number,
	errors: number,
): string {
	const total = passed + warnings + errors;
	const parts: string[] = [`${passed}/${total} passed`];
	if (errors > 0) parts.push(`${errors} errors`);
	if (warnings > 0) parts.push(`${warnings} warnings`);
	return parts.join(" · ");
}

// ── API ────────────────────────────────────────────────────────────────

/**
 * Create a GitHub Check Run with conclusion, summary, and annotations.
 */
export async function createCheckRun(
	options: CheckRunOptions,
): Promise<Result<CheckRunResult>> {
	const {
		token,
		owner,
		repo,
		headSha,
		findings,
		totalChecks,
		detailsUrl,
		apiBase = "https://api.github.com",
	} = options;

	const conclusion = determineConclusion(findings);
	const annotations = formatAnnotations(
		findings.filter((f) => f.file && f.line),
	);

	const errorCount = findings.filter((f) => f.severity === "error").length;
	const warningCount = findings.filter((f) => f.severity === "warning").length;
	const passedCount = totalChecks - errorCount - warningCount;
	const summary = formatSummary(
		Math.max(0, passedCount),
		warningCount,
		errorCount,
	);

	const body: Record<string, unknown> = {
		name: "Maina verification",
		head_sha: headSha,
		status: "completed",
		conclusion,
		output: {
			title: `Maina verification — ${conclusion}`,
			summary,
			annotations,
		},
	};

	if (detailsUrl) {
		body.details_url = detailsUrl;
	}

	try {
		const url = `${apiBase}/repos/${owner}/${repo}/check-runs`;
		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github.v3+json",
				"Content-Type": "application/json",
				"User-Agent": "maina-verify",
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			if (res.status === 403 || res.status === 422) {
				return {
					ok: false,
					error: `Missing permission: checks:write is required to create Check Runs (${res.status})`,
				};
			}
			return {
				ok: false,
				error: `Failed to create Check Run: ${res.status} ${res.statusText}`,
			};
		}

		const data = (await res.json()) as { id: number };
		return {
			ok: true,
			value: { checkRunId: data.id, conclusion },
		};
	} catch (e) {
		return {
			ok: false,
			error: `GitHub API error: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}
