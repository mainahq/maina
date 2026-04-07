import { hashContent } from "../cache/keys";
import { loadAuthConfig } from "../cloud/auth";
import { createCloudClient } from "../cloud/client";
import { getFeedbackDb } from "../db/index";
import { getRepoSlug } from "../git/index";
import { recordOutcome } from "../prompts/engine";
import { compressReview, storeCompressedReview } from "./compress";

const CLOUD_URL = process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";

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

			// Auto-sync episodic entry to cloud (fire-and-forget)
			queueMicrotask(async () => {
				try {
					const auth = loadAuthConfig();
					if (auth.ok && auth.value.accessToken) {
						const client = createCloudClient({
							baseUrl: CLOUD_URL,
							token: auth.value.accessToken,
						});
						const repo = await getRepoSlug();
						const title =
							record.task === "review"
								? "Accepted review"
								: `Accepted ${record.task} review`;
						await client.postEpisodicEntries([
							{
								repo,
								entryType: record.task,
								title,
								summary: compressed,
							},
						]);
					}
				} catch {
					// Cloud sync failure is silent
				}
			});
		}
	}
}

/**
 * Record feedback asynchronously — never blocks the calling command.
 * Uses queueMicrotask for zero-latency fire-and-forget.
 */
export function recordFeedbackAsync(
	mainaDir: string,
	record: FeedbackRecord & {
		workflowStep?: string;
		workflowId?: string;
	},
): void {
	queueMicrotask(() => {
		try {
			// Use existing recordFeedback for the base record
			recordFeedback(mainaDir, record);

			// Write workflow columns directly if provided
			if (record.workflowStep || record.workflowId) {
				const dbResult = getFeedbackDb(mainaDir);
				if (!dbResult.ok) return;
				const { db } = dbResult.value;

				// Update the most recent row for this prompt hash
				db.prepare(
					`UPDATE feedback SET workflow_step = ?, workflow_id = ?
           WHERE id = (SELECT id FROM feedback ORDER BY created_at DESC LIMIT 1)`,
				).run(record.workflowStep ?? null, record.workflowId ?? null);
			}
		} catch {
			// Never throw from background feedback
		}

		// Auto-sync to cloud if logged in (fire-and-forget, never blocks)
		try {
			const auth = loadAuthConfig();
			if (auth.ok && auth.value.accessToken) {
				const client = createCloudClient({
					baseUrl: CLOUD_URL,
					token: auth.value.accessToken,
				});
				client.postFeedbackBatch([
					{
						promptHash: record.promptHash,
						command: record.task,
						accepted: record.accepted,
						context: record.modification,
					},
				]);
			}
		} catch {
			// Cloud sync failure is silent
		}
	});
}

/**
 * Generate a workflow ID from a branch name.
 * All commands on the same branch share the same workflow ID.
 */
export function getWorkflowId(branchName: string): string {
	return hashContent(`workflow:${branchName}`).slice(0, 12);
}
