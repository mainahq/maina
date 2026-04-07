/**
 * Wiki Types — core type definitions for the Maina Wiki knowledge compiler.
 *
 * Defines the data model for wiki articles, knowledge graph edges,
 * extracted lifecycle artifacts, state tracking, and lint results.
 */

// ─── Article Types ───────────────────────────────────────────────────────

export type ArticleType =
	| "module"
	| "entity"
	| "feature"
	| "decision"
	| "architecture"
	| "raw";

/**
 * 11 edge types in the unified knowledge graph.
 * 5 from code (calls, imports, inherits, references, member_of)
 * 6 from lifecycle artifacts (modified_by, specified_by, decided_by, motivated_by, constrains, aligns_with)
 */
export type EdgeType =
	// Code edges (from dependency graph)
	| "calls"
	| "imports"
	| "inherits"
	| "references"
	| "member_of"
	// Lifecycle edges (from extractors)
	| "modified_by"
	| "specified_by"
	| "decided_by"
	| "motivated_by"
	| "constrains"
	| "aligns_with";

export interface WikiLink {
	target: string;
	type: EdgeType;
	weight: number;
}

export interface WikiArticle {
	path: string;
	type: ArticleType;
	title: string;
	content: string;
	contentHash: string;
	sourceHashes: string[];
	backlinks: WikiLink[];
	forwardLinks: WikiLink[];
	pageRank: number;
	lastCompiled: string;
	referenceCount: number;
	ebbinghausScore: number;
}

// ─── Extracted Lifecycle Artifacts ───────────────────────────────────────

export interface TaskItem {
	id: string;
	description: string;
	completed: boolean;
}

export interface ExtractedFeature {
	id: string;
	title: string;
	scope: string;
	specQualityScore: number;
	specAssertions: string[];
	tasks: TaskItem[];
	entitiesModified: string[];
	decisionsCreated: string[];
	branch: string;
	prNumber: number | null;
	merged: boolean;
}

export type DecisionStatus =
	| "proposed"
	| "accepted"
	| "deprecated"
	| "superseded";

export interface ExtractedDecision {
	id: string;
	title: string;
	status: DecisionStatus;
	context: string;
	decision: string;
	rationale: string;
	alternativesRejected: string[];
	entityMentions: string[];
	constitutionAlignment: string[];
}

export interface WorkflowStep {
	command: string;
	timestamp: string;
	summary: string;
}

export interface RLSignal {
	step: string;
	accepted: boolean;
}

export interface ExtractedWorkflowTrace {
	featureId: string;
	steps: WorkflowStep[];
	wikiRefsRead: string[];
	wikiRefsWritten: string[];
	rlSignals: RLSignal[];
}

// ─── State ───────────────────────────────────────────────────────────────

export interface WikiState {
	fileHashes: Record<string, string>;
	articleHashes: Record<string, string>;
	lastFullCompile: string;
	lastIncrementalCompile: string;
	compilationPromptHash: string;
}

// ─── Lint ────────────────────────────────────────────────────────────────

export type WikiLintCheck =
	| "stale"
	| "orphan"
	| "gap"
	| "broken_link"
	| "contradiction"
	| "spec_drift"
	| "decision_violation"
	| "missing_rationale";

export interface WikiLintFinding {
	check: string;
	severity: "error" | "warning" | "info";
	article: string;
	message: string;
	source?: string;
}

export interface WikiLintResult {
	stale: WikiLintFinding[];
	orphans: WikiLintFinding[];
	gaps: WikiLintFinding[];
	brokenLinks: WikiLintFinding[];
	contradictions: WikiLintFinding[];
	specDrift: WikiLintFinding[];
	decisionViolations: WikiLintFinding[];
	missingRationale: WikiLintFinding[];
	coveragePercent: number;
}

// ─── Ebbinghaus Decay Half-Lives (days) ─────────────────────────────────

export const DECAY_HALF_LIVES: Record<ArticleType, number> = {
	decision: 180,
	architecture: 150,
	module: 120,
	entity: 90,
	feature: 60,
	raw: 90,
};
