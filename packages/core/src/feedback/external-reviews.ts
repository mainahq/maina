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
 */

import { randomUUID } from "node:crypto";
import { getFeedbackDb, type Result } from "../db/index";

// ── Types ───────────────────────────────────────────────────────────────────

export type FindingCategory =
	| "api-mismatch"
	| "signature-drift"
	| "dead-code"
	| "security"
	| "style"
	| "other";

export type ReviewerKind = "bot" | "human";

export type FindingState = "active" | "resolved" | "dismissed";

export interface ExternalReviewComment {
	/** Stable identifier from the review platform (e.g. GitHub comment id). */
	sourceId: string;
	prNumber: number;
	prRepo: string;
	filePath: string | null;
	line: number | null;
	reviewer: string;
	body: string;
	diffAtReview: string | undefined;
}

export interface InsertFindingInput {
	prNumber: number;
	prRepo: string;
	filePath: string | null;
	line: number | null;
	reviewer: string;
	reviewerKind: ReviewerKind;
	category: FindingCategory;
	body: string;
	diffAtReview?: string;
	sourceId: string;
	state?: FindingState;
}

export interface ExternalReviewFinding {
	id: string;
	prNumber: number;
	prRepo: string;
	filePath: string | null;
	line: number | null;
	reviewer: string;
	reviewerKind: ReviewerKind;
	category: FindingCategory;
	body: string;
	diffAtReview: string | null;
	ingestedAt: number;
	state: FindingState;
	sourceId: string;
}

export interface IngestStats {
	ingested: number;
	skipped: number;
}

export interface IngestOptions {
	allowedReviewers: readonly string[];
}

export interface CategoryByFile {
	filePath: string;
	category: FindingCategory;
	count: number;
}

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

// ── Persistence ─────────────────────────────────────────────────────────────

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
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return err(dbResult.error);
	const { db } = dbResult.value;
	try {
		const id = randomUUID();
		const ingestedAt = Date.now();
		const state = input.state ?? "active";
		const stmt = db.prepare(
			`INSERT OR IGNORE INTO external_review_findings
				(id, pr_number, pr_repo, file_path, line, reviewer, reviewer_kind,
				 category, body, diff_at_review, ingested_at, state, source_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const res = stmt.run(
			id,
			input.prNumber,
			input.prRepo,
			input.filePath,
			input.line,
			input.reviewer,
			input.reviewerKind,
			input.category,
			input.body,
			input.diffAtReview ?? null,
			ingestedAt,
			state,
			input.sourceId,
		);
		return ok({ inserted: res.changes > 0 });
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

export interface QueryFindingsOptions {
	prRepo?: string;
	prNumber?: number;
	filePath?: string;
	category?: FindingCategory;
	state?: FindingState;
	limit?: number;
}

/**
 * Query stored findings, filtered by any combination of repo/PR/file/category/state.
 */
export function queryFindings(
	mainaDir: string,
	opts: QueryFindingsOptions = {},
): Result<ExternalReviewFinding[], string> {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return err(dbResult.error);
	const { db } = dbResult.value;
	try {
		const clauses: string[] = [];
		const params: (string | number)[] = [];
		if (opts.prRepo) {
			clauses.push("pr_repo = ?");
			params.push(opts.prRepo);
		}
		if (opts.prNumber !== undefined) {
			clauses.push("pr_number = ?");
			params.push(opts.prNumber);
		}
		if (opts.filePath) {
			clauses.push("file_path = ?");
			params.push(opts.filePath);
		}
		if (opts.category) {
			clauses.push("category = ?");
			params.push(opts.category);
		}
		if (opts.state) {
			clauses.push("state = ?");
			params.push(opts.state);
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = opts.limit ?? 1000;
		const rows = db
			.query(
				`SELECT id, pr_number, pr_repo, file_path, line, reviewer,
					reviewer_kind, category, body, diff_at_review, ingested_at,
					state, source_id
				 FROM external_review_findings
				 ${where}
				 ORDER BY ingested_at DESC
				 LIMIT ?`,
			)
			.all(...params, limit) as Array<{
			id: string;
			pr_number: number;
			pr_repo: string;
			file_path: string | null;
			line: number | null;
			reviewer: string;
			reviewer_kind: ReviewerKind;
			category: FindingCategory;
			body: string;
			diff_at_review: string | null;
			ingested_at: number;
			state: FindingState;
			source_id: string;
		}>;
		return ok(
			rows.map((r) => ({
				id: r.id,
				prNumber: r.pr_number,
				prRepo: r.pr_repo,
				filePath: r.file_path,
				line: r.line,
				reviewer: r.reviewer,
				reviewerKind: r.reviewer_kind,
				category: r.category,
				body: r.body,
				diffAtReview: r.diff_at_review,
				ingestedAt: r.ingested_at,
				state: r.state,
				sourceId: r.source_id,
			})),
		);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

/**
 * For each file, return the top finding category (and its count). Used by
 * `maina stats` to surface which files have accumulated review pressure.
 */
export function getTopCategoriesByFile(
	mainaDir: string,
	opts: { limit?: number } = {},
): Result<CategoryByFile[], string> {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return err(dbResult.error);
	const { db } = dbResult.value;
	try {
		const limit = opts.limit ?? 10;
		const rows = db
			.query(
				`SELECT file_path, category, COUNT(*) as cnt
				 FROM external_review_findings
				 WHERE file_path IS NOT NULL
				 GROUP BY file_path, category
				 ORDER BY cnt DESC
				 LIMIT ?`,
			)
			.all(limit) as Array<{
			file_path: string;
			category: FindingCategory;
			cnt: number;
		}>;
		// Keep only the top category per file (first wins because of ORDER BY).
		const seen = new Set<string>();
		const out: CategoryByFile[] = [];
		for (const r of rows) {
			if (seen.has(r.file_path)) continue;
			seen.add(r.file_path);
			out.push({
				filePath: r.file_path,
				category: r.category,
				count: r.cnt,
			});
		}
		return ok(out);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

// ── Ingestion ───────────────────────────────────────────────────────────────

/**
 * Ingest a batch of pre-fetched comments into the local DB. Skips comments
 * from reviewers not in the allow-list. Idempotent on `sourceId`.
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
	]);
	if (!reviewRes.ok) return err(reviewRes.error);
	try {
		const reviewComments = JSON.parse(reviewRes.value) as GhReviewComment[];
		for (const c of reviewComments) {
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
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}

	// Issue-level comments (top-level PR conversation).
	const issueRes = await runGh([
		"api",
		`repos/${repo}/issues/${prNumber}/comments`,
		"--paginate",
	]);
	if (!issueRes.ok) return err(issueRes.error);
	try {
		const issueComments = JSON.parse(issueRes.value) as GhIssueComment[];
		for (const c of issueComments) {
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
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
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
