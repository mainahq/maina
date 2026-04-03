import type { Result } from "../db/index.ts";
import { getStatsDb } from "../db/index.ts";

export interface SnapshotInput {
	branch: string;
	commitHash: string;
	verifyDurationMs: number;
	totalDurationMs: number;
	contextTokens: number;
	contextBudget: number;
	cacheHits: number;
	cacheMisses: number;
	findingsTotal: number;
	findingsErrors: number;
	findingsWarnings: number;
	toolsRun: number;
	syntaxPassed: boolean;
	pipelinePassed: boolean;
}

export interface CommitSnapshot extends SnapshotInput {
	id: string;
	timestamp: string;
	contextUtilization: number;
}

export interface StatsReport {
	totalCommits: number;
	latest: CommitSnapshot | null;
	averages: {
		verifyDurationMs: number;
		contextTokens: number;
		cacheHitRate: number;
		findingsPerCommit: number;
	};
}

export type TrendDirection = "up" | "down" | "stable";

export interface TrendsReport {
	verifyDuration: TrendDirection;
	contextTokens: TrendDirection;
	cacheHitRate: TrendDirection;
	findingsPerCommit: TrendDirection;
	window: number;
}

interface RawSnapshotRow {
	id: string;
	timestamp: string;
	branch: string;
	commit_hash: string;
	verify_duration_ms: number;
	total_duration_ms: number;
	context_tokens: number;
	context_budget: number;
	context_utilization: number;
	cache_hits: number;
	cache_misses: number;
	findings_total: number;
	findings_errors: number;
	findings_warnings: number;
	tools_run: number;
	syntax_passed: number;
	pipeline_passed: number;
}

function rowToSnapshot(row: RawSnapshotRow): CommitSnapshot {
	return {
		id: row.id,
		timestamp: row.timestamp,
		branch: row.branch,
		commitHash: row.commit_hash,
		verifyDurationMs: row.verify_duration_ms,
		totalDurationMs: row.total_duration_ms,
		contextTokens: row.context_tokens,
		contextBudget: row.context_budget,
		contextUtilization: row.context_utilization,
		cacheHits: row.cache_hits,
		cacheMisses: row.cache_misses,
		findingsTotal: row.findings_total,
		findingsErrors: row.findings_errors,
		findingsWarnings: row.findings_warnings,
		toolsRun: row.tools_run,
		syntaxPassed: row.syntax_passed === 1,
		pipelinePassed: row.pipeline_passed === 1,
	};
}

/**
 * Records a commit snapshot to the stats database.
 * Generates a UUID id and ISO timestamp automatically.
 * Computes contextUtilization from contextTokens / contextBudget.
 */
export function recordSnapshot(
	mainaDir: string,
	snapshot: SnapshotInput,
): Result<void> {
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return dbResult;

		const { db } = dbResult.value;
		const id = crypto.randomUUID();
		const timestamp = new Date().toISOString();
		const contextUtilization =
			snapshot.contextBudget > 0
				? snapshot.contextTokens / snapshot.contextBudget
				: 0;

		db.prepare(
			`INSERT INTO commit_snapshots (
				id, timestamp, branch, commit_hash,
				verify_duration_ms, total_duration_ms,
				context_tokens, context_budget, context_utilization,
				cache_hits, cache_misses,
				findings_total, findings_errors, findings_warnings,
				tools_run, syntax_passed, pipeline_passed
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			timestamp,
			snapshot.branch,
			snapshot.commitHash,
			snapshot.verifyDurationMs,
			snapshot.totalDurationMs,
			snapshot.contextTokens,
			snapshot.contextBudget,
			contextUtilization,
			snapshot.cacheHits,
			snapshot.cacheMisses,
			snapshot.findingsTotal,
			snapshot.findingsErrors,
			snapshot.findingsWarnings,
			snapshot.toolsRun,
			snapshot.syntaxPassed ? 1 : 0,
			snapshot.pipelinePassed ? 1 : 0,
		);

		return { ok: true, value: undefined };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Returns the most recent commit snapshot, or null if none exist.
 */
export function getLatest(mainaDir: string): Result<CommitSnapshot | null> {
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return dbResult;

		const { db } = dbResult.value;
		const row = db
			.prepare("SELECT * FROM commit_snapshots ORDER BY rowid DESC LIMIT 1")
			.get() as RawSnapshotRow | null;

		if (!row) return { ok: true, value: null };
		return { ok: true, value: rowToSnapshot(row) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Computes aggregate statistics over the last N snapshots.
 * Returns total commit count, latest snapshot, and averages.
 */
export function getStats(
	mainaDir: string,
	options?: { last?: number },
): Result<StatsReport> {
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return dbResult;

		const { db } = dbResult.value;
		const limit = options?.last ?? 10;

		// Total count of all snapshots
		const countRow = db
			.prepare("SELECT COUNT(*) as cnt FROM commit_snapshots")
			.get() as { cnt: number };
		const totalCommits = countRow.cnt;

		// Latest snapshot
		const latestRow = db
			.prepare("SELECT * FROM commit_snapshots ORDER BY rowid DESC LIMIT 1")
			.get() as RawSnapshotRow | null;
		const latest = latestRow ? rowToSnapshot(latestRow) : null;

		// Last N snapshots for averages
		const rows = db
			.prepare("SELECT * FROM commit_snapshots ORDER BY rowid DESC LIMIT ?")
			.all(limit) as RawSnapshotRow[];

		let avgVerifyDurationMs = 0;
		let avgContextTokens = 0;
		let avgCacheHitRate = 0;
		let avgFindingsPerCommit = 0;

		if (rows.length > 0) {
			let totalVerify = 0;
			let totalTokens = 0;
			let totalCacheHits = 0;
			let totalCacheTotal = 0;
			let totalFindings = 0;

			for (const row of rows) {
				totalVerify += row.verify_duration_ms;
				totalTokens += row.context_tokens;
				totalCacheHits += row.cache_hits;
				totalCacheTotal += row.cache_hits + row.cache_misses;
				totalFindings += row.findings_total;
			}

			avgVerifyDurationMs = totalVerify / rows.length;
			avgContextTokens = totalTokens / rows.length;
			avgCacheHitRate =
				totalCacheTotal > 0 ? totalCacheHits / totalCacheTotal : 0;
			avgFindingsPerCommit = totalFindings / rows.length;
		}

		return {
			ok: true,
			value: {
				totalCommits,
				latest,
				averages: {
					verifyDurationMs: avgVerifyDurationMs,
					contextTokens: avgContextTokens,
					cacheHitRate: avgCacheHitRate,
					findingsPerCommit: avgFindingsPerCommit,
				},
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function computeTrend(recent: number, previous: number): TrendDirection {
	if (previous === 0 && recent === 0) return "stable";
	if (previous === 0) return "up";

	const change = (recent - previous) / Math.abs(previous);
	if (Math.abs(change) < 0.05) return "stable";
	return change > 0 ? "up" : "down";
}

/**
 * Compares averages of recent N snapshots vs previous N snapshots.
 * Returns trend direction for each metric with a 5% threshold.
 */
export function getTrends(
	mainaDir: string,
	options?: { window?: number },
): Result<TrendsReport> {
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return dbResult;

		const { db } = dbResult.value;
		const window = options?.window ?? 5;

		const allStable: TrendsReport = {
			verifyDuration: "stable",
			contextTokens: "stable",
			cacheHitRate: "stable",
			findingsPerCommit: "stable",
			window,
		};

		// Need at least 2*window snapshots
		const countRow = db
			.prepare("SELECT COUNT(*) as cnt FROM commit_snapshots")
			.get() as { cnt: number };

		if (countRow.cnt < 2 * window) {
			return { ok: true, value: allStable };
		}

		// Fetch 2*window most recent snapshots
		const rows = db
			.prepare("SELECT * FROM commit_snapshots ORDER BY rowid DESC LIMIT ?")
			.all(2 * window) as RawSnapshotRow[];

		// Recent = first `window` rows, Previous = next `window` rows
		const recentRows = rows.slice(0, window);
		const previousRows = rows.slice(window, 2 * window);

		function avgMetrics(subset: RawSnapshotRow[]) {
			let totalVerify = 0;
			let totalTokens = 0;
			let totalCacheHits = 0;
			let totalCacheTotal = 0;
			let totalFindings = 0;

			for (const row of subset) {
				totalVerify += row.verify_duration_ms;
				totalTokens += row.context_tokens;
				totalCacheHits += row.cache_hits;
				totalCacheTotal += row.cache_hits + row.cache_misses;
				totalFindings += row.findings_total;
			}

			const n = subset.length;
			return {
				verifyDuration: n > 0 ? totalVerify / n : 0,
				contextTokens: n > 0 ? totalTokens / n : 0,
				cacheHitRate:
					totalCacheTotal > 0 ? totalCacheHits / totalCacheTotal : 0,
				findingsPerCommit: n > 0 ? totalFindings / n : 0,
			};
		}

		const recent = avgMetrics(recentRows);
		const previous = avgMetrics(previousRows);

		return {
			ok: true,
			value: {
				verifyDuration: computeTrend(
					recent.verifyDuration,
					previous.verifyDuration,
				),
				contextTokens: computeTrend(
					recent.contextTokens,
					previous.contextTokens,
				),
				cacheHitRate: computeTrend(recent.cacheHitRate, previous.cacheHitRate),
				findingsPerCommit: computeTrend(
					recent.findingsPerCommit,
					previous.findingsPerCommit,
				),
				window,
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
