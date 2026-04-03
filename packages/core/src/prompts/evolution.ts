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

// ── Constants ────────────────────────────────────────────────────────────────

/** Accept rate below this threshold triggers needsImprovement flag */
const IMPROVEMENT_THRESHOLD = 0.6;

/** Minimum samples before we judge a prompt's performance */
const MIN_SAMPLES = 10;

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
