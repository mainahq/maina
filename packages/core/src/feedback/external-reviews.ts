/**
 * External code-review findings ingestion.
 *
 * Pulls review comments from configured reviewers (Copilot, CodeRabbit, named
 * humans) on open + recently merged PRs and stores them as labeled training
 * signal in `.maina/feedback.db`.
 *
 * v1 thin slice: ingest + categorise + query. The RL closure (verify
 * consulting findings, slop ruleset evolution, cloud sync) is v2 — see
 * issue #185.
 *
 * DB access goes through `external-reviews-repo.ts` — this module handles
 * validation, categorisation, and the `gh` subprocess plumbing.
 */

import type { Result } from "../db/index";
import {
	insertFindingRow,
	selectFindings,
	selectTopCategoriesByFile,
} from "./external-reviews-repo";
import type {
	CategoryByFile,
	ExternalReviewComment,
	ExternalReviewFinding,
	FindingCategory,
	IngestOptions,
	IngestStats,
	InsertFindingInput,
	QueryFindingsOptions,
	ReviewerKind,
} from "./external-reviews-types";

// ── Types (re-exported so callers don't need to know about the split) ───────

export type {
	CategoryByFile,
	ExternalReviewComment,
	ExternalReviewFinding,
	FindingCategory,
	FindingState,
	IngestOptions,
	IngestStats,
	InsertFindingInput,
	QueryFindingsOptions,
	ReviewerKind,
} from "./external-reviews-types";

// ── Constants ───────────────────────────────────────────────────────────────

/** Default bot reviewers ingested by `maina feedback ingest`. */
export const ALLOWED_REVIEWERS: readonly string[] = [
	"copilot-pull-request-reviewer",
	"copilot-pull-request-reviewer[bot]",
	"coderabbitai",
	"coderabbitai[bot]",
];

const KNOWN_BOTS = new Set<string>([
	"copilot-pull-request-reviewer",
	"copilot-pull-request-reviewer[bot]",
	"coderabbitai",
	"coderabbitai[bot]",
	"github-actions",
	"github-actions[bot]",
	"renovate",
	"renovate[bot]",
	"dependabot",
	"dependabot[bot]",
]);

// ── Categorisation ──────────────────────────────────────────────────────────

interface CategoryRule {
	category: FindingCategory;
	patterns: RegExp[];
}

/**
 * Heuristic, keyword-driven classifier. v1 explicitly avoids LLM calls — we
 * want categorisation to be cheap and deterministic so the ingestion path
 * stays a weekend-sized chore. v2 may layer an LLM-backed reclassifier on top
 * of accumulated findings.
 */
const RULES: CategoryRule[] = [
	{
		category: "api-mismatch",
		patterns: [
			/doesn[''‘’]t exist/i,
			/does not exist/i,
			/won[''‘’]t typecheck/i,
			/will not typecheck/i,
			/is not exported/i,
			/no such export/i,
			/cannot find (module|name|export)/i,
			/undefined (export|symbol|identifier)/i,
			/wrong import path/i,
		],
	},
	{
		category: "signature-drift",
		patterns: [
			/wrong signature/i,
			/signature (changed|drift|mismatch)/i,
			/expected\s+`?[^`]+`?\s+(but )?got/i,
			/argument (count|type) mismatch/i,
			/parameter[s]? (changed|differ)/i,
			/return type/i,
		],
	},
	{
		category: "dead-code",
		patterns: [
			/\bunused\b/i,
			/never (called|used|read|invoked)/i,
			/dead code/i,
			/unreachable/i,
		],
	},
	{
		category: "security",
		patterns: [
			/race condition/i,
			/\brace\b/i,
			/ENOENT/,
			/spawn .* (failed|error)/i,
			/credential/i,
			/\bsecret\b/i,
			/\btoken\b.*(leak|log)/i,
			/sql injection/i,
			/command injection/i,
			/path traversal/i,
			/unsanitised|unsanitized/i,
		],
	},
	{
		category: "style",
		patterns: [
			/console\.log/i,
			/formatting/i,
			/\bnit:?\b/i,
			/style nit/i,
			/typo/i,
			/trailing whitespace/i,
			/indentation/i,
		],
	},
];

/**
 * Categorise a review comment body using deterministic keyword rules.
 * Returns `"other"` when no rule matches.
 */
export function categoriseComment(body: string): FindingCategory {
	for (const rule of RULES) {
		for (const pat of rule.patterns) {
			if (pat.test(body)) return rule.category;
		}
	}
	return "other";
}

/**
 * Decide whether a reviewer name belongs to a bot. Heuristic only:
 * `[bot]` suffix, known list, or `*-bot` naming.
 */
export function classifyReviewerKind(reviewer: string): ReviewerKind {
	const normalised = reviewer.toLowerCase();
	if (KNOWN_BOTS.has(normalised)) return "bot";
	if (normalised.endsWith("[bot]")) return "bot";
	if (normalised.endsWith("-bot")) return "bot";
	return "human";
}

// ── Persistence (thin wrappers; input validation then repo call) ────────────

function ok<T>(value: T): Result<T, string> {
	return { ok: true, value };
}

function err(error: string): Result<never, string> {
	return { ok: false, error };
}

/**
 * Insert a single finding. Idempotent on `(pr_repo, pr_number, source_id)`.
 * Returns `Result` — never throws.
 */
export function insertFinding(
	mainaDir: string,
	input: InsertFindingInput,
): Result<{ inserted: boolean }, string> {
	return insertFindingRow(mainaDir, input);
}

/**
 * Query stored findings, filtered by any combination of repo/PR/file/category/state.
 */
export function queryFindings(
	mainaDir: string,
	opts: QueryFindingsOptions = {},
): Result<ExternalReviewFinding[], string> {
	return selectFindings(mainaDir, opts);
}

/**
 * For each file, return the top finding category (and its count). Used by
 * `maina stats` to surface which files have accumulated review pressure.
 */
export function getTopCategoriesByFile(
	mainaDir: string,
	opts: { limit?: number } = {},
): Result<CategoryByFile[], string> {
	return selectTopCategoriesByFile(mainaDir, opts);
}

// ── Ingestion ───────────────────────────────────────────────────────────────

/**
 * Markers that identify auto-generated PR-summary comments which carry no
 * actionable signal but trip our keyword categoriser (CodeRabbit's summary
 * header contains words like "auto-generated" and substrings the
 * `security` / `style` rules grab onto). These are issue-level (no
 * `path`), so they show up in the DB as a steady stream of false-positive
 * `security` findings — roughly one per merged PR with a CodeRabbit run.
 *
 * Marker source: CodeRabbit emits these literal HTML comments at the top
 * of every summary it posts. The list is intentionally narrow — only
 * comments whose body STARTS WITH one of these markers is dropped, so we
 * don't accidentally swallow a real review comment that quotes the marker.
 */
const NOISE_MARKERS: readonly string[] = [
	"<!-- This is an auto-generated comment: summarize by coderabbit.ai -->",
	"<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->",
	"<!-- This is an auto-generated comment: skip review by coderabbit.ai -->",
];

/** True if the comment body is a known auto-generated PR-summary header. */
export function isAutoSummaryComment(body: string): boolean {
	const head = body.trimStart();
	for (const marker of NOISE_MARKERS) {
		if (head.startsWith(marker)) return true;
	}
	return false;
}

/**
 * Ingest a batch of pre-fetched comments into the local DB. Skips comments
 * from reviewers not in the allow-list AND comments whose body is an
 * auto-generated PR-summary header. Idempotent on `sourceId`.
 *
 * This split (fetch vs ingest) keeps the heavy network code (`gh api`) out
 * of the hot test path and out of the categorisation logic.
 */
export function ingestComments(
	mainaDir: string,
	comments: ExternalReviewComment[],
	opts: IngestOptions,
): Result<IngestStats, string> {
	const allowed = new Set(opts.allowedReviewers.map((r) => r.toLowerCase()));
	let ingested = 0;
	let skipped = 0;
	for (const c of comments) {
		if (!allowed.has(c.reviewer.toLowerCase())) {
			skipped += 1;
			continue;
		}
		if (isAutoSummaryComment(c.body)) {
			// Auto-generated PR-summary header — no actionable signal, and
			// would otherwise pollute the categoriser with false positives.
			skipped += 1;
			continue;
		}
		const category = categoriseComment(c.body);
		const reviewerKind = classifyReviewerKind(c.reviewer);
		const insertResult = insertFinding(mainaDir, {
			prNumber: c.prNumber,
			prRepo: c.prRepo,
			filePath: c.filePath,
			line: c.line,
			reviewer: c.reviewer,
			reviewerKind,
			category,
			body: c.body,
			diffAtReview: c.diffAtReview,
			sourceId: c.sourceId,
		});
		if (!insertResult.ok) return err(insertResult.error);
		if (insertResult.value.inserted) {
			ingested += 1;
		} else {
			skipped += 1;
		}
	}
	return ok({ ingested, skipped });
}

// ── GitHub ingestion via `gh api` ───────────────────────────────────────────

interface GhReviewComment {
	id: number;
	path?: string;
	line?: number | null;
	original_line?: number | null;
	body: string;
	user?: { login?: string } | null;
	diff_hunk?: string;
}

interface GhIssueComment {
	id: number;
	body: string;
	user?: { login?: string } | null;
}

interface GhPullRef {
	number: number;
}

async function runGh(args: string[]): Promise<Result<string, string>> {
	try {
		const proc = Bun.spawn(["gh", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		const errText = await new Response(proc.stderr).text();
		const code = await proc.exited;
		if (code !== 0) {
			return err(errText.trim() || `gh exited with ${code}`);
		}
		return ok(out);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

async function fetchPrNumbers(
	repo: string,
	sinceDays: number,
): Promise<Result<number[], string>> {
	// Open + recently merged PRs, simple fan-out via `gh pr list`.
	const sinceIso = new Date(Date.now() - sinceDays * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const search = `repo:${repo} is:pr (is:open OR merged:>=${sinceIso})`;
	const result = await runGh([
		"pr",
		"list",
		"--repo",
		repo,
		"--state",
		"all",
		"--search",
		search,
		"--limit",
		"50",
		"--json",
		"number",
	]);
	if (!result.ok) return err(result.error);
	try {
		const parsed = JSON.parse(result.value) as GhPullRef[];
		return ok(parsed.map((p) => p.number));
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

/**
 * `gh api --paginate` emits one JSON document per page (e.g.
 * `[{...}][{...}]`), which `JSON.parse` rejects as soon as the second page
 * arrives. `--slurp` wraps every page into an outer array
 * (`[[{...}],[{...}]]`) so a single `JSON.parse` + `.flat()` handles
 * arbitrary page counts.
 *
 * Exported for tests — production callers should only use it on `gh api
 * ... --paginate --slurp` output.
 */
export function parsePaginatedJson<T>(raw: string): Result<T[], string> {
	try {
		const pages = JSON.parse(raw) as T[][];
		if (!Array.isArray(pages)) {
			return err("expected paginated JSON array-of-arrays");
		}
		return ok(pages.flat());
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

async function fetchPrComments(
	repo: string,
	prNumber: number,
): Promise<Result<ExternalReviewComment[], string>> {
	const out: ExternalReviewComment[] = [];

	// Inline review comments (file/line scoped).
	const reviewRes = await runGh([
		"api",
		`repos/${repo}/pulls/${prNumber}/comments`,
		"--paginate",
		"--slurp",
	]);
	if (!reviewRes.ok) return err(reviewRes.error);
	const reviewParsed = parsePaginatedJson<GhReviewComment>(reviewRes.value);
	if (!reviewParsed.ok) return err(reviewParsed.error);
	for (const c of reviewParsed.value) {
		out.push({
			sourceId: `review-${c.id}`,
			prNumber,
			prRepo: repo,
			filePath: c.path ?? null,
			line: c.line ?? c.original_line ?? null,
			reviewer: c.user?.login ?? "unknown",
			body: c.body,
			diffAtReview: c.diff_hunk,
		});
	}

	// Issue-level comments (top-level PR conversation).
	const issueRes = await runGh([
		"api",
		`repos/${repo}/issues/${prNumber}/comments`,
		"--paginate",
		"--slurp",
	]);
	if (!issueRes.ok) return err(issueRes.error);
	const issueParsed = parsePaginatedJson<GhIssueComment>(issueRes.value);
	if (!issueParsed.ok) return err(issueParsed.error);
	for (const c of issueParsed.value) {
		out.push({
			sourceId: `issue-${c.id}`,
			prNumber,
			prRepo: repo,
			filePath: null,
			line: null,
			reviewer: c.user?.login ?? "unknown",
			body: c.body,
			diffAtReview: undefined,
		});
	}

	return ok(out);
}

export interface IngestPrReviewsOptions {
	repo: string;
	prNumbers?: number[];
	sinceDays?: number;
	allowedReviewers?: readonly string[];
}

/**
 * Top-level ingest: discover PRs (or use `prNumbers`), pull comments via `gh`,
 * and persist matching findings. Network errors surface as `Result.err`.
 */
export async function ingestPrReviews(
	mainaDir: string,
	opts: IngestPrReviewsOptions,
): Promise<Result<IngestStats, string>> {
	const allowed = opts.allowedReviewers ?? ALLOWED_REVIEWERS;
	const sinceDays = opts.sinceDays ?? 14;
	let prNumbers: number[];
	if (opts.prNumbers && opts.prNumbers.length > 0) {
		prNumbers = opts.prNumbers;
	} else {
		const list = await fetchPrNumbers(opts.repo, sinceDays);
		if (!list.ok) return err(list.error);
		prNumbers = list.value;
	}

	const allComments: ExternalReviewComment[] = [];
	for (const n of prNumbers) {
		const c = await fetchPrComments(opts.repo, n);
		if (!c.ok) return err(c.error);
		allComments.push(...c.value);
	}

	return ingestComments(mainaDir, allComments, { allowedReviewers: allowed });
}
