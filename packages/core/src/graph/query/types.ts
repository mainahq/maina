/** Public shapes of the graph query API (v1 task 5.3, FR-GRAPH-3, FR-GRAPH-4). */

import type { CorePorts } from "../../ports/index";
import type { NodeKind } from "../store/schema";

/** Queries that only read the store. */
export type GraphReadPorts = Readonly<Pick<CorePorts, "db">>;

/** Queries that also read source text from the working tree. */
export type GraphContextPorts = Readonly<Pick<CorePorts, "fs" | "db">>;

/** A graph node as a query reports it. */
export type NodeRef = Readonly<{
	id: string;
	path: string;
	name: string;
	qualifiedName: string;
	kind: NodeKind;
	startLine: number;
	endLine: number;
}>;

export type ImpactRequest = Readonly<{
	/** Repo-relative paths: every symbol in each file is a target. */
	files?: readonly string[];
	/** Node ids (`path#qualifiedName`) or qualified names (`Circle.area`). A type takes its members with it. */
	symbols?: readonly string[];
	/** How many call hops to follow back from the targets. Defaults to 3. */
	depth?: number;
}>;

export type ImpactedNode = NodeRef & Readonly<{ depth: number }>;

export type ImpactReport = Readonly<{
	/** The nodes the request named, sorted by id. */
	targets: readonly NodeRef[];
	/** Requested files and symbols the store does not know, sorted. */
	unknown: readonly string[];
	/** Code that calls, references or extends a target, directly or through other callers, nearest first. */
	callers: readonly ImpactedNode[];
	/** Non-test files, other than the targets' own, holding a caller or importing a target file; sorted. */
	dependents: readonly string[];
	/** Tests that exercise a target or a caller in range, sorted by id. */
	tests: readonly ImpactedNode[];
	/** Share (0..1) of the repo's other non-test files among the dependents. */
	blastScore: number;
}>;

export type SearchOptions = Readonly<{
	/** Most hits to return. Defaults to 20. */
	limit?: number;
	/** Include test cases, suites and anything in a test file. Defaults to true. */
	includeTests?: boolean;
}>;

export type SearchHit = NodeRef &
	Readonly<{
		test: boolean;
		/** Higher is better; only meaningful relative to other hits of the same query. */
		score: number;
	}>;

export type MinimalContextRequest = Readonly<{
	/** Repo-relative paths whose symbols are the targets. */
	files?: readonly string[];
	/** Free text: the best symbol matches become the targets. */
	query?: string;
	/** Hard ceiling on `tokens`. */
	budgetTokens: number;
	/** How many hops of callees and callers to consider. Defaults to 1. */
	depth?: number;
}>;

export type ContextSnippet = NodeRef &
	Readonly<{
		/** Why the snippet is here: a target, something a target uses, or something using one. */
		reason: "target" | "callee" | "caller";
		/** Hops from the nearest target; 0 for targets. */
		depth: number;
		/** Lines `startLine..endLine` of the file, joined with `\n`. */
		text: string;
		tokens: number;
	}>;

export type MinimalContext = Readonly<{
	/** In priority order: targets, then each hop's callees, then its callers. */
	snippets: readonly ContextSnippet[];
	/** Sum of the snippets' tokens; never above the budget. */
	tokens: number;
	/** Cost of reading every file the candidates live in, in full. */
	naiveTokens: number;
	/** `naiveTokens - tokens`, floored at 0. */
	savedTokens: number;
	/** Candidate ids that did not fit the budget, in priority order. */
	omitted: readonly string[];
	/** Files whose content no longer matches the store (edited or deleted since indexing); their snippets are left out. */
	stale: readonly string[];
	/** Requested files the store does not know (not indexed, or a typo), as given, sorted. */
	unknown: readonly string[];
}>;
