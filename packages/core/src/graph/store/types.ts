/** Public shapes of the graph store API. */

import type { Result } from "../../db/index";
import type { CorePorts } from "../../ports/index";
import type { Lang, ParsedFile, ParseError } from "../parse/types";
import type { GraphEdge, GraphFile, GraphNode } from "./schema";

export type GraphStorePorts = Readonly<Pick<CorePorts, "fs" | "git" | "db">>;

export type ParseFn = (
	path: string,
	content: string,
	lang?: Lang,
) => Promise<Result<ParsedFile, ParseError>>;

export type GraphStoreOptions = Readonly<{
	/** Defaults to the tree-sitter parser layer. */
	parse?: ParseFn;
}>;

export type GraphStoreError =
	| Readonly<{ kind: "db"; message: string }>
	| Readonly<{ kind: "fs"; path: string; message: string }>
	| Readonly<{ kind: "parse"; error: ParseError }>
	/** Another writer committed under every attempt; a later sync catches up. */
	| Readonly<{ kind: "conflict"; attempts: number }>;

/** What a sync did, each list sorted by path. */
export type GraphSyncReport = Readonly<{
	/** Parsed from source. */
	parsed: readonly string[];
	/** New or changed content whose parse came from the content-hash cache. */
	reused: readonly string[];
	/** Candidates whose content matched the store. */
	unchanged: readonly string[];
	removed: readonly string[];
	/** Files whose edges were recomputed: the changed files and their dependents. */
	resolved: readonly string[];
}>;

export type GraphSnapshot = Readonly<{
	files: readonly GraphFile[];
	nodes: readonly GraphNode[];
	edges: readonly GraphEdge[];
}>;
