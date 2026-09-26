/**
 * One receipt check run per head commit, created once and updated in place
 * on every republish (looked up by name on the commit).
 */

import type { Result } from "../db/index";
import type { ReceiptStatus } from "../receipt/types";
import {
	type GitHubAuth,
	type GitHubError,
	githubRequest,
	type HttpPort,
} from "./http";

type CheckConclusion = "success" | "failure" | "neutral";

/** GitHub rejects a check-run `output.summary` longer than this. */
export const CHECK_SUMMARY_LIMIT = 65_535;

const TRUNCATED = "\n\n…(truncated, see the full receipt)";

type CheckRunSpec = Readonly<{
	name: string;
	headSha: string;
	conclusion: CheckConclusion;
	title: string;
	summary: string;
	detailsUrl?: string;
}>;

type CheckRunInput = Readonly<{
	http: HttpPort;
	auth: GitHubAuth;
	repo: string;
	check: CheckRunSpec;
}>;

type CheckRunResult = Readonly<{
	id: number;
	action: "created" | "updated";
}>;

export function conclusionFor(status: ReceiptStatus): CheckConclusion {
	if (status === "passed") return "success";
	if (status === "partial") return "neutral";
	return "failure";
}

export async function upsertCheckRun(
	input: CheckRunInput,
): Promise<Result<CheckRunResult, GitHubError>> {
	const { http, auth, repo, check } = input;
	const listed = await githubRequest(
		http,
		auth,
		"GET",
		`/repos/${repo}/commits/${check.headSha}/check-runs?check_name=${encodeURIComponent(check.name)}&per_page=100`,
	);
	if (!listed.ok) return listed;
	const existing = firstRunId(listed.value, check.name);

	const payload = {
		name: check.name,
		head_sha: check.headSha,
		status: "completed",
		conclusion: check.conclusion,
		output: { title: check.title, summary: clip(check.summary) },
		...(check.detailsUrl === undefined
			? {}
			: { details_url: check.detailsUrl }),
	};

	if (existing !== undefined) {
		const updated = await githubRequest(
			http,
			auth,
			"PATCH",
			`/repos/${repo}/check-runs/${existing}`,
			payload,
		);
		if (!updated.ok) return updated;
		return { ok: true, value: { id: existing, action: "updated" } };
	}

	const created = await githubRequest(
		http,
		auth,
		"POST",
		`/repos/${repo}/check-runs`,
		payload,
	);
	if (!created.ok) return created;
	const id = (created.value as { id?: unknown } | null)?.id;
	return typeof id === "number"
		? { ok: true, value: { id, action: "created" } }
		: {
				ok: false,
				error: { kind: "bad_response", message: "created check run has no id" },
			};
}

/** The oldest run with this exact name (GitHub lists newest first). */
function firstRunId(value: unknown, name: string): number | undefined {
	const runs = (value as { check_runs?: unknown } | null)?.check_runs;
	if (!Array.isArray(runs)) return undefined;
	const ids = runs
		.filter(
			(r): r is { id: number; name: string } =>
				typeof r === "object" &&
				r !== null &&
				typeof (r as { id?: unknown }).id === "number" &&
				(r as { name?: unknown }).name === name,
		)
		.map((r) => r.id);
	return ids.length === 0 ? undefined : Math.min(...ids);
}

function clip(summary: string): string {
	return summary.length <= CHECK_SUMMARY_LIMIT
		? summary
		: `${summary.slice(0, CHECK_SUMMARY_LIMIT - TRUNCATED.length)}${TRUNCATED}`;
}
