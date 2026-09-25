/**
 * Queries over the code graph (v1 task 5.3, FR-GRAPH-3, FR-GRAPH-4):
 *
 * - `impact`: transitive callers, dependent files, covering tests and a
 *   blast score for a set of files or symbols.
 * - `minimalContext`: budgeted source snippets for files or a query, with
 *   the tokens saved against reading the files in full.
 * - `search`: ranked symbol, test and file lookup by name.
 *
 * All read the store `store/index.ts` maintains; none writes to it.
 */

export { impact } from "./impact";
export { minimalContext } from "./minimal-context";
export { search } from "./search";
export type {
	ContextSnippet,
	GraphContextPorts,
	GraphReadPorts,
	ImpactedNode,
	ImpactReport,
	ImpactRequest,
	MinimalContext,
	MinimalContextRequest,
	NodeRef,
	SearchHit,
	SearchOptions,
} from "./types";
