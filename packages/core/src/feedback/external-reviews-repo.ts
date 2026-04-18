/**
 * Repository layer for external_review_findings.
 *
 * Per CLAUDE.md "All DB access through repository layer" — this module owns
 * every raw SQL statement against the `external_review_findings` table. The
 * feature module (`external-reviews.ts`) validates and translates inputs,
 * then forwards to these functions.
 */

import { randomUUID } from "node:crypto";
import { getFeedbackDb, type Result } from "../db/index";
import type {
	CategoryByFile,
	ExternalReviewFinding,
	FindingCategory,
	FindingState,
	InsertFindingInput,
	QueryFindingsOptions,
	ReviewerKind,
} from "./external-reviews-types";

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
export function insertFindingRow(
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

/**
 * Query stored findings, filtered by any combination of repo/PR/file/category/state.
 */
export function selectFindings(
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
 * For each file, return the top category (highest count) along with its count.
 *
 * Uses a window function (`ROW_NUMBER() OVER (PARTITION BY file_path ...)`) so
 * the per-file top-category selection happens before LIMIT. Without the
 * window function, the outer LIMIT could trim later high-count categories for
 * the same file and squeeze out other files entirely — leaving `< limit`
 * distinct files in the result.
 */
export function selectTopCategoriesByFile(
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
				`WITH per_file_cat AS (
					SELECT file_path, category, COUNT(*) AS cnt
					FROM external_review_findings
					WHERE file_path IS NOT NULL
					GROUP BY file_path, category
				),
				ranked AS (
					SELECT file_path, category, cnt,
						ROW_NUMBER() OVER (
							PARTITION BY file_path ORDER BY cnt DESC, category ASC
						) AS rn
					FROM per_file_cat
				)
				SELECT file_path, category, cnt
				FROM ranked
				WHERE rn = 1
				ORDER BY cnt DESC, file_path ASC
				LIMIT ?`,
			)
			.all(limit) as Array<{
			file_path: string;
			category: FindingCategory;
			cnt: number;
		}>;
		return ok(
			rows.map((r) => ({
				filePath: r.file_path,
				category: r.category,
				count: r.cnt,
			})),
		);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}
