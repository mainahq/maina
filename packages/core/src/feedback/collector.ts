import { getFeedbackDb } from "../db/index";
import { recordOutcome } from "../prompts/engine";
import { compressReview, storeCompressedReview } from "./compress";

export interface FeedbackRecord {
	promptHash: string;
	task: string;
	accepted: boolean;
	modification?: string;
	timestamp: string;
}

/**
 * Record feedback for an AI interaction.
 * Appends to feedback.db using existing recordOutcome from prompts/engine.
 */
export function recordFeedback(mainaDir: string, record: FeedbackRecord): void {
	recordOutcome(mainaDir, record.promptHash, {
		accepted: record.accepted,
		command: record.task,
		context: record.modification ?? undefined,
	});
}

/**
 * Get feedback summary for a task.
 */
export function getFeedbackSummary(
	mainaDir: string,
	task: string,
): {
	total: number;
	accepted: number;
	rejected: number;
	acceptRate: number;
} {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) {
		return { total: 0, accepted: 0, rejected: 0, acceptRate: 0 };
	}

	const { db } = dbResult.value;

	const row = db
		.query(
			`SELECT
				COUNT(*) as total,
				SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
			 FROM feedback WHERE command = ?`,
		)
		.get(task) as { total: number; accepted_count: number } | null;

	if (!row || row.total === 0) {
		return { total: 0, accepted: 0, rejected: 0, acceptRate: 0 };
	}

	const total = row.total;
	const accepted = row.accepted_count;
	const rejected = total - accepted;

	return {
		total,
		accepted,
		rejected,
		acceptRate: total > 0 ? accepted / total : 0,
	};
}

/**
 * Record feedback and, if the review was accepted, compress and store
 * it as an episodic entry for future context.
 */
export function recordFeedbackWithCompression(
	mainaDir: string,
	record: FeedbackRecord & { aiOutput?: string; diff?: string },
): void {
	// Record the feedback
	recordFeedback(mainaDir, record);

	// If accepted review, compress and store as episodic
	if (record.accepted && record.task === "review" && record.aiOutput) {
		const compressed = compressReview({
			diff: record.diff ?? "",
			aiOutput: record.aiOutput,
			task: record.task,
			accepted: true,
		});
		if (compressed) {
			storeCompressedReview(mainaDir, compressed, record.task);
		}
	}
}
