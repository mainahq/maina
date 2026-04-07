/**
 * Feedback sync — exports local feedback records and workflow stats for cloud upload.
 *
 * Reads from the local SQLite feedback.db and maps records to the
 * cloud-compatible FeedbackEvent format for batch upload.
 * Also exports workflow step counts for analytics.
 */

import type { EpisodicCloudEntry, FeedbackEvent } from "../cloud/types";
import { getEntries } from "../context/episodic";
import { getFeedbackDb, getStatsDb } from "../db/index";

/** Raw row shape from the feedback table. */
interface FeedbackRow {
	prompt_hash: string;
	command: string;
	accepted: number;
	context: string | null;
	created_at: string;
}

/**
 * Export all local feedback records in the cloud-compatible format.
 *
 * Reads from the feedback table in the SQLite database at `mainaDir/feedback.db`
 * and maps each row to a `FeedbackEvent` object ready for batch upload.
 */
export function exportFeedbackForCloud(mainaDir: string): FeedbackEvent[] {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) {
		return [];
	}

	const { db } = dbResult.value;

	const rows = db
		.query(
			"SELECT prompt_hash, command, accepted, context, created_at FROM feedback ORDER BY created_at ASC",
		)
		.all() as FeedbackRow[];

	return rows.map((row) => {
		const event: FeedbackEvent = {
			promptHash: row.prompt_hash,
			command: row.command,
			accepted: row.accepted === 1,
			timestamp: row.created_at,
		};

		if (row.context) {
			event.context = row.context;
		}

		return event;
	});
}

/** Workflow stats summary for cloud analytics. */
export interface WorkflowStats {
	totalCommits: number;
	totalVerifyTimeMs: number;
	avgVerifyTimeMs: number;
	totalFindings: number;
	totalContextTokens: number;
	cacheHitRate: number;
	passRate: number;
}

/**
 * Export workflow stats from the local stats.db for cloud analytics.
 * Returns aggregated numbers the dashboard can display.
 */
export function exportWorkflowStats(mainaDir: string): WorkflowStats | null {
	const dbResult = getStatsDb(mainaDir);
	if (!dbResult.ok) return null;

	const { db } = dbResult.value;
	try {
		const row = db
			.query(
				`SELECT
				COUNT(*) as total_commits,
				COALESCE(SUM(verify_duration_ms), 0) as total_verify_ms,
				COALESCE(AVG(verify_duration_ms), 0) as avg_verify_ms,
				COALESCE(SUM(findings_total), 0) as total_findings,
				COALESCE(SUM(context_tokens), 0) as total_context_tokens,
				COALESCE(SUM(cache_hits), 0) as total_cache_hits,
				COALESCE(SUM(cache_misses), 0) as total_cache_misses,
				COALESCE(SUM(CASE WHEN pipeline_passed = 1 THEN 1 ELSE 0 END), 0) as passed_count
			FROM commit_snapshots`,
			)
			.get() as {
			total_commits: number;
			total_verify_ms: number;
			avg_verify_ms: number;
			total_findings: number;
			total_context_tokens: number;
			total_cache_hits: number;
			total_cache_misses: number;
			passed_count: number;
		} | null;

		if (!row || row.total_commits === 0) return null;

		const totalCacheOps = row.total_cache_hits + row.total_cache_misses;

		return {
			totalCommits: row.total_commits,
			totalVerifyTimeMs: row.total_verify_ms,
			avgVerifyTimeMs: Math.round(row.avg_verify_ms),
			totalFindings: row.total_findings,
			totalContextTokens: row.total_context_tokens,
			cacheHitRate:
				totalCacheOps > 0 ? row.total_cache_hits / totalCacheOps : 0,
			passRate: row.passed_count / row.total_commits,
		};
	} catch {
		return null;
	}
}

/**
 * Export local episodic entries for cloud upload.
 *
 * Reads from the episodic_entries table in the context DB and maps
 * each entry to the cloud-compatible EpisodicCloudEntry format.
 *
 * @param repo - Repository identifier (e.g. "owner/repo") to tag entries with.
 */
export function exportEpisodicForCloud(
	mainaDir: string,
	repo: string,
): EpisodicCloudEntry[] {
	const entries = getEntries(mainaDir);

	return entries.map((entry) => ({
		repo,
		entryType: entry.type,
		title: entry.summary || entry.type,
		summary: entry.content,
		relevanceScore: entry.relevance,
	}));
}
