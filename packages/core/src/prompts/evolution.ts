import { hashContent } from "../cache/keys";
import { getFeedbackDb } from "../db/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeedbackAnalysis {
	task: string;
	totalSamples: number;
	acceptRate: number;
	needsImprovement: boolean;
}

export interface CandidatePrompt {
	task: string;
	content: string;
	hash: string;
	status: "candidate" | "active" | "retired";
}

export interface AbTestResult {
	variant: "active" | "candidate";
	hash?: string;
}

export interface ABResolution {
	task: string;
	action: "promoted" | "retired" | "continuing";
	reason: string;
	candidateAcceptRate?: number;
	incumbentAcceptRate?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Accept rate below this threshold triggers needsImprovement flag */
const IMPROVEMENT_THRESHOLD = 0.6;

/** Minimum samples before we judge a prompt's performance */
const MIN_SAMPLES = 10;

/** Minimum samples for A/B test resolution */
const MIN_AB_SAMPLES = 30;

/** Accept rate margin: candidate must beat incumbent by this much to promote */
const AB_MARGIN = 0.05;

/** Candidate traffic split (20% goes to candidate) */
const CANDIDATE_RATIO = 0.2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensurePromptVersionsTable(mainaDir: string) {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return null;
	return dbResult.value;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyses feedback for a specific task (command).
 * Returns sample count, accept rate, and whether improvement is needed.
 */
export function analyseFeedback(
	mainaDir: string,
	task: string,
): FeedbackAnalysis {
	const handle = ensurePromptVersionsTable(mainaDir);
	if (!handle) {
		return { task, totalSamples: 0, acceptRate: 0, needsImprovement: false };
	}

	const { db } = handle;
	const row = db
		.query(
			`SELECT COUNT(*) as total,
			        SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
			 FROM feedback WHERE command = ?`,
		)
		.get(task) as { total: number; accepted_count: number } | null;

	if (!row || row.total === 0) {
		return { task, totalSamples: 0, acceptRate: 0, needsImprovement: false };
	}

	const acceptRate = row.accepted_count / row.total;
	const needsImprovement =
		row.total >= MIN_SAMPLES && acceptRate < IMPROVEMENT_THRESHOLD;

	return {
		task,
		totalSamples: row.total,
		acceptRate,
		needsImprovement,
	};
}

/**
 * Creates a candidate prompt version for A/B testing.
 * Stored in prompt_versions table with status 'candidate'.
 */
export function createCandidate(
	mainaDir: string,
	task: string,
	content: string,
): CandidatePrompt {
	const hash = hashContent(content);
	const handle = ensurePromptVersionsTable(mainaDir);

	if (handle) {
		const { db } = handle;
		const id = `${task}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

		// Get next version number for this task
		const maxRow = db
			.query(
				`SELECT MAX(version) as max_ver FROM prompt_versions WHERE task = ?`,
			)
			.get(task) as { max_ver: number | null } | null;
		const nextVersion = (maxRow?.max_ver ?? 0) + 1;

		db.prepare(
			`INSERT INTO prompt_versions (id, task, hash, content, version, accept_rate, usage_count, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			task,
			hash,
			content,
			nextVersion,
			null,
			0,
			new Date().toISOString(),
		);
	}

	return { task, content, hash, status: "candidate" };
}

/**
 * A/B test: returns 'active' (80%) or 'candidate' (20%).
 * If no candidate exists for the task, always returns 'active'.
 */
export function abTest(mainaDir: string, task: string): AbTestResult {
	const handle = ensurePromptVersionsTable(mainaDir);
	if (!handle) {
		return { variant: "active" };
	}

	const { db } = handle;

	// Find the most recent candidate for this task
	const candidate = db
		.query(
			`SELECT hash, content FROM prompt_versions
			 WHERE task = ? ORDER BY version DESC LIMIT 1`,
		)
		.get(task) as { hash: string; content: string } | null;

	if (!candidate) {
		return { variant: "active" };
	}

	// 80/20 split
	if (Math.random() < CANDIDATE_RATIO) {
		return { variant: "candidate", hash: candidate.hash };
	}

	return { variant: "active" };
}

/**
 * Promotes a candidate to active by removing it from the candidates table.
 * The promoted content should be written to .maina/prompts/<task>.md by the caller.
 */
export function promote(mainaDir: string, hash: string): boolean {
	const handle = ensurePromptVersionsTable(mainaDir);
	if (!handle) return false;

	const { db } = handle;
	const result = db
		.prepare(`DELETE FROM prompt_versions WHERE hash = ?`)
		.run(hash);
	return result.changes > 0;
}

/**
 * Retires a candidate without promoting it.
 * Removes it from the candidates table.
 */
export function retire(mainaDir: string, hash: string): boolean {
	const handle = ensurePromptVersionsTable(mainaDir);
	if (!handle) return false;

	const { db } = handle;
	const result = db
		.prepare(`DELETE FROM prompt_versions WHERE hash = ?`)
		.run(hash);
	return result.changes > 0;
}

/**
 * Check all active A/B tests and promote/retire based on performance.
 * Returns a list of actions taken.
 *
 * Logic:
 * - For each task with a candidate in prompt_versions, query feedback
 * - If candidate has < MIN_AB_SAMPLES samples: continue
 * - If candidate accept rate > incumbent + AB_MARGIN: promote
 * - If candidate accept rate < incumbent - AB_MARGIN: retire
 * - Otherwise: continue (within margin)
 */
export function resolveABTests(mainaDir: string): ABResolution[] {
	const handle = ensurePromptVersionsTable(mainaDir);
	if (!handle) return [];

	const { db } = handle;

	// Find all candidates (one per task, most recent)
	const candidates = db
		.query(
			`SELECT task, hash FROM prompt_versions
			 ORDER BY version DESC`,
		)
		.all() as Array<{ task: string; hash: string }>;

	if (candidates.length === 0) return [];

	// Deduplicate: keep only the most recent candidate per task
	const taskMap = new Map<string, string>();
	for (const c of candidates) {
		if (!taskMap.has(c.task)) {
			taskMap.set(c.task, c.hash);
		}
	}

	const resolutions: ABResolution[] = [];

	for (const [task, candidateHash] of taskMap) {
		// Get candidate feedback stats
		const candidateRow = db
			.query(
				`SELECT COUNT(*) as total,
				        SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
				 FROM feedback WHERE command = ? AND prompt_hash = ?`,
			)
			.get(task, candidateHash) as {
			total: number;
			accepted_count: number;
		} | null;

		const candidateTotal = candidateRow?.total ?? 0;
		const candidateAccepted = candidateRow?.accepted_count ?? 0;

		if (candidateTotal < MIN_AB_SAMPLES) {
			resolutions.push({
				task,
				action: "continuing",
				reason: `Insufficient samples (${candidateTotal}/${MIN_AB_SAMPLES})`,
				candidateAcceptRate:
					candidateTotal > 0 ? candidateAccepted / candidateTotal : 0,
			});
			continue;
		}

		const candidateAcceptRate = candidateAccepted / candidateTotal;

		// Get incumbent feedback stats (all feedback for this task EXCEPT candidate hash)
		const incumbentRow = db
			.query(
				`SELECT COUNT(*) as total,
				        SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
				 FROM feedback WHERE command = ? AND prompt_hash != ?`,
			)
			.get(task, candidateHash) as {
			total: number;
			accepted_count: number;
		} | null;

		const incumbentTotal = incumbentRow?.total ?? 0;
		const incumbentAccepted = incumbentRow?.accepted_count ?? 0;
		const incumbentAcceptRate =
			incumbentTotal > 0 ? incumbentAccepted / incumbentTotal : 0;

		if (candidateAcceptRate > incumbentAcceptRate + AB_MARGIN) {
			// Candidate outperforms — promote
			promote(mainaDir, candidateHash);
			resolutions.push({
				task,
				action: "promoted",
				reason: `Candidate (${(candidateAcceptRate * 100).toFixed(1)}%) outperforms incumbent (${(incumbentAcceptRate * 100).toFixed(1)}%) by >${(AB_MARGIN * 100).toFixed(0)}%`,
				candidateAcceptRate,
				incumbentAcceptRate,
			});
		} else if (candidateAcceptRate < incumbentAcceptRate - AB_MARGIN) {
			// Candidate underperforms — retire
			retire(mainaDir, candidateHash);
			resolutions.push({
				task,
				action: "retired",
				reason: `Candidate (${(candidateAcceptRate * 100).toFixed(1)}%) underperforms incumbent (${(incumbentAcceptRate * 100).toFixed(1)}%) by >${(AB_MARGIN * 100).toFixed(0)}%`,
				candidateAcceptRate,
				incumbentAcceptRate,
			});
		} else {
			// Within margin — continue
			resolutions.push({
				task,
				action: "continuing",
				reason: `Within margin: candidate ${(candidateAcceptRate * 100).toFixed(1)}% vs incumbent ${(incumbentAcceptRate * 100).toFixed(1)}%`,
				candidateAcceptRate,
				incumbentAcceptRate,
			});
		}
	}

	return resolutions;
}
