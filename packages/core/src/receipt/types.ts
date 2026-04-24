/**
 * Maina Receipt — v1 TypeScript types.
 *
 * Mirrors the canonical v1 JSON Schema published at
 * `https://schemas.mainahq.com/v1.json` and tracked in `mainahq/receipt-schema`.
 *
 * TODO(mainahq/maina#229): once @mainahq/receipt-schema v1.0.0 publishes to npm, replace this file with `export * from "@mainahq/receipt-schema"`.
 */

export type CheckStatus = "passed" | "failed" | "skipped";

export type CheckTool =
	| "biome"
	| "semgrep"
	| "sonar"
	| "trivy"
	| "secretlint"
	| "diff-cover"
	| "stryker"
	| "slop"
	| "review-spec"
	| "review-quality"
	| "tests"
	| "visual"
	| "doc-claims";

export type ReceiptStatus = "passed" | "failed" | "partial";

export interface Finding {
	severity: "info" | "warning" | "error";
	/** Path relative to repo root, POSIX forward slashes, no leading "./". */
	file: string;
	line?: number;
	message: string;
	rule?: string;
}

export interface Patch {
	diff: string;
	rationale: string;
}

export interface Check {
	id: string;
	name: string;
	status: CheckStatus;
	tool: CheckTool;
	findings: Finding[];
	patch?: Patch;
}

export interface Diff {
	additions: number;
	deletions: number;
	files: number;
}

export interface Agent {
	id: string;
	modelVersion: string;
}

export interface PromptVersion {
	constitutionHash: string;
	promptsHash: string;
}

export interface FeedbackEntry {
	checkId: string;
	reason: string;
	constitutionHash: string;
}

export interface Receipt {
	prTitle: string;
	repo: string;
	timestamp: string;
	status: ReceiptStatus;
	hash: string;
	diff: Diff;
	agent: Agent;
	promptVersion: PromptVersion;
	checks: Check[];
	walkthrough: string;
	feedback: FeedbackEntry[];
	retries: number;
}
