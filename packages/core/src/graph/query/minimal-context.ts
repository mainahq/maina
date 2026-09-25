/**
 * Minimal context (FR-GRAPH-4): the smallest set of source snippets that
 * lets a reader work on some files or on what a query names, within a hard
 * token budget.
 *
 * Candidates come in priority order: the targets themselves, then for each
 * hop out to `depth` what the previous hop calls, references or extends
 * (callees), then what calls it (callers). Tests and whole files are never
 * pulled in as neighbours. Each candidate is its symbol's exact line range,
 * read from the working tree; a file whose content no longer matches the
 * store is reported as stale and contributes nothing, since its line ranges
 * cannot be trusted.
 *
 * Candidates are taken greedily: one that does not fit the remaining budget
 * is skipped (and listed as omitted) and later, smaller ones may still fit.
 * A candidate inside a snippet already taken is dropped as covered.
 */

import { posix } from "node:path";
import { calculateTokens } from "../../context/budget";
import type { Result } from "../../db/index";
import type { EdgeKind, GraphNode } from "../store/schema";
import { hashOf } from "../store/sync";
import type { GraphStoreError } from "../store/types";
import {
	type GraphIndex,
	isFileNode,
	isTestish,
	loadIndex,
	normalizePath,
	toRef,
	withMembers,
} from "./graph";
import { naiveReadTokens, tokenSavings } from "./savings";
import { searchIndex } from "./search";
import type {
	ContextSnippet,
	GraphContextPorts,
	MinimalContext,
	MinimalContextRequest,
} from "./types";

const DEFAULT_DEPTH = 1;
/** Most query hits used as targets. */
const QUERY_TARGETS = 5;
const NEIGHBOUR_EDGES: ReadonlySet<EdgeKind> = new Set([
	"calls",
	"references",
	"inherits",
]);

type Candidate = Readonly<{
	node: GraphNode;
	reason: ContextSnippet["reason"];
	depth: number;
}>;

type Targets = Readonly<{
	/** What becomes a snippet. */
	targets: readonly GraphNode[];
	/** What the neighbourhood grows from (targets plus their members). */
	sources: readonly GraphNode[];
}>;

function fileTargets(index: GraphIndex, paths: readonly string[]): Targets {
	const targets: GraphNode[] = [];
	const sources: GraphNode[] = [];
	for (const raw of paths) {
		const nodes = index.byPath.get(normalizePath(raw)) ?? [];
		const topLevel = nodes.filter((n) => !isFileNode(n) && n.parent === null);
		// A file of bare statements has nothing smaller to offer than itself.
		targets.push(
			...(topLevel.length > 0 ? topLevel : nodes.filter(isFileNode)),
		);
		sources.push(...nodes);
	}
	return { targets, sources };
}

/**
 * The best symbol hits (within half the top score, so weak path-only matches
 * do not crowd in), or the files hit when no symbol matches.
 */
function queryTargets(index: GraphIndex, query: string): Targets {
	const hits = searchIndex(index, query, { includeTests: false });
	const symbols = hits.filter((h) => h.kind !== "file");
	if (symbols.length === 0) {
		return fileTargets(
			index,
			hits.map((h) => h.path),
		);
	}
	const best = symbols[0]?.score ?? 0;
	const nodes = symbols
		.filter((h) => h.score * 2 >= best)
		.slice(0, QUERY_TARGETS)
		.flatMap((h) => {
			const node = index.byId.get(h.id);
			return node === undefined ? [] : [node];
		});
	return {
		targets: nodes,
		sources: nodes.flatMap((n) => withMembers(index, n)),
	};
}

function candidatesOf(
	index: GraphIndex,
	request: MinimalContextRequest,
): readonly Candidate[] {
	const fromFiles = fileTargets(index, request.files ?? []);
	const fromQuery =
		request.query === undefined
			? { targets: [], sources: [] }
			: queryTargets(index, request.query);
	const seen = new Set<string>();
	const out: Candidate[] = [];
	for (const node of [...fromFiles.targets, ...fromQuery.targets]) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		out.push({ node, reason: "target", depth: 0 });
	}
	let frontier = [...fromFiles.sources, ...fromQuery.sources];
	for (const n of frontier) seen.add(n.id);

	const depth = Math.max(0, Math.floor(request.depth ?? DEFAULT_DEPTH));
	for (let hop = 1; hop <= depth && frontier.length > 0; hop++) {
		const take = (id: string, into: GraphNode[]): void => {
			const node = index.byId.get(id);
			if (node === undefined || seen.has(node.id)) return;
			if (isFileNode(node) || isTestish(index, node)) return;
			seen.add(node.id);
			into.push(node);
		};
		const callees: GraphNode[] = [];
		const callers: GraphNode[] = [];
		for (const n of frontier) {
			for (const e of index.outgoing.get(n.id) ?? []) {
				if (NEIGHBOUR_EDGES.has(e.kind)) take(e.dst, callees);
			}
		}
		for (const n of frontier) {
			for (const e of index.incoming.get(n.id) ?? []) {
				if (NEIGHBOUR_EDGES.has(e.kind)) take(e.src, callers);
			}
		}
		out.push(
			...callees.map(
				(node): Candidate => ({ node, reason: "callee", depth: hop }),
			),
			...callers.map(
				(node): Candidate => ({ node, reason: "caller", depth: hop }),
			),
		);
		frontier = [...callees, ...callers].flatMap((n) => withMembers(index, n));
		for (const n of frontier) seen.add(n.id);
	}
	return out;
}

type Sources = Readonly<{
	/** Content of every file that still matches the store. */
	fresh: ReadonlyMap<string, string>;
	stale: readonly string[];
}>;

async function readSources(
	ports: GraphContextPorts,
	root: string,
	index: GraphIndex,
	paths: readonly string[],
): Promise<Result<Sources, GraphStoreError>> {
	const fresh = new Map<string, string>();
	const stale: string[] = [];
	for (const path of paths) {
		const read = await ports.fs.readFile(posix.join(root, path));
		if (!read.ok) {
			if (read.error.kind === "not_found") {
				stale.push(path);
				continue;
			}
			return {
				ok: false,
				error: { kind: "fs", path, message: read.error.message },
			};
		}
		if (index.files.get(path)?.hash !== hashOf(read.value)) stale.push(path);
		else fresh.set(path, read.value);
	}
	return { ok: true, value: { fresh, stale: stale.sort() } };
}

const sliceLines = (content: string, start: number, end: number): string =>
	content
		.split("\n")
		.slice(start - 1, end)
		.join("\n");

type Taken = Readonly<{ path: string; startLine: number; endLine: number }>;

const covers = (outer: Taken, inner: Taken): boolean =>
	outer.path === inner.path &&
	outer.startLine <= inner.startLine &&
	inner.endLine <= outer.endLine;

/** Greedy fill in priority order; see the module comment. */
function fill(
	candidates: readonly Candidate[],
	fresh: ReadonlyMap<string, string>,
	budget: number,
): Readonly<{
	snippets: readonly ContextSnippet[];
	omitted: readonly string[];
}> {
	const snippets: ContextSnippet[] = [];
	const omitted: string[] = [];
	let remaining = budget;
	for (const { node, reason, depth } of candidates) {
		const content = fresh.get(node.path);
		if (content === undefined) continue;
		if (snippets.some((s) => covers(s, node))) continue;
		const text = sliceLines(content, node.startLine, node.endLine);
		const tokens = calculateTokens(text);
		if (tokens > remaining) {
			omitted.push(node.id);
			continue;
		}
		remaining -= tokens;
		snippets.push({ ...toRef(node), reason, depth, text, tokens });
	}
	return { snippets, omitted };
}

/**
 * Source snippets for `files` or `query` and their graph neighbourhood,
 * never more than `budgetTokens` in total, with the saving against reading
 * every touched file in full.
 */
export async function minimalContext(
	ports: GraphContextPorts,
	root: string,
	request: MinimalContextRequest,
): Promise<Result<MinimalContext, GraphStoreError>> {
	const index = loadIndex(ports.db);
	if (!index.ok) return index;
	const candidates = candidatesOf(index.value, request);
	const paths = [...new Set(candidates.map((c) => c.node.path))];
	const sources = await readSources(ports, root, index.value, paths);
	if (!sources.ok) return sources;
	const { fresh, stale } = sources.value;

	const budget = Number.isFinite(request.budgetTokens)
		? Math.max(0, Math.floor(request.budgetTokens))
		: 0;
	const { snippets, omitted } = fill(candidates, fresh, budget);
	const tokens = snippets.reduce((sum, s) => sum + s.tokens, 0);
	const naiveTokens = naiveReadTokens(fresh);
	return {
		ok: true,
		value: {
			snippets,
			tokens,
			naiveTokens,
			savedTokens: tokenSavings(naiveTokens, tokens),
			omitted,
			stale,
		},
	};
}
