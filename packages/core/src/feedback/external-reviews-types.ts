/**
 * Shared types for external-reviews feature module + repository layer.
 * Kept separate to avoid circular imports between the two.
 */

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

export interface QueryFindingsOptions {
	prRepo?: string;
	prNumber?: number;
	filePath?: string;
	category?: FindingCategory;
	state?: FindingState;
	limit?: number;
}
