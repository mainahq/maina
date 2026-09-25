/**
 * Entities for the AI review, from the code graph (#329). The review shows
 * the model the bodies of the functions a diff's added lines call; before
 * the graph was wired in, the pipeline passed none at all.
 */

import { posix } from "node:path";
import type { Result } from "../db/index";
import { byId, isFileNode, isTestish, loadIndex } from "../graph/query/graph";
import type { GraphContextPorts } from "../graph/query/types";
import type { GraphNode } from "../graph/store/schema";
import { hashOf } from "../graph/store/sync";
import type { GraphStoreError } from "../graph/store/types";

export interface EntityWithBody {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	filePath: string;
	body: string;
}

/** Words that look like calls (`if (`) but are not. */
const KEYWORDS: ReadonlySet<string> = new Set([
	"if",
	"for",
	"while",
	"switch",
	"catch",
	"function",
	"return",
	"new",
	"typeof",
	"instanceof",
	"await",
	"async",
	"import",
	"export",
	"const",
	"let",
	"var",
	"class",
	"throw",
]);

/** Names called (`name(`) in the added lines of a unified diff. */
export function calledNames(diff: string): ReadonlySet<string> {
	const added = diff
		.split("\n")
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.join("\n");
	const names = new Set<string>();
	for (const match of added.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) {
		const name = match[1];
		if (name !== undefined && !KEYWORDS.has(name)) names.add(name);
	}
	return names;
}

/** Most entities handed to the review; `resolveReferencedFunctions` caps again. */
const MAX_ENTITIES = 12;

const sliceLines = (content: string, start: number, end: number): string =>
	content
		.split("\n")
		.slice(start - 1, end)
		.join("\n");

/**
 * The non-test graph symbols the added lines of `diff` call, with their
 * bodies read from the working tree under `root`, sorted by node id and
 * capped at `MAX_ENTITIES`. A file whose content no longer matches the
 * store (edited or deleted since indexing) is left out: its line ranges
 * would slice the wrong text.
 */
export async function graphReviewEntities(
	ports: GraphContextPorts,
	root: string,
	diff: string,
): Promise<Result<readonly EntityWithBody[], GraphStoreError>> {
	const names = calledNames(diff);
	if (names.size === 0) return { ok: true, value: [] };
	const index = loadIndex(ports.db);
	if (!index.ok) return index;
	const graph = index.value;
	const matches = graph.nodes
		.filter(
			(n: GraphNode) =>
				!isFileNode(n) && !isTestish(graph, n) && names.has(n.name),
		)
		.sort(byId);

	const entities: EntityWithBody[] = [];
	const sources = new Map<string, string | undefined>();
	for (const node of matches) {
		if (entities.length >= MAX_ENTITIES) break;
		if (!sources.has(node.path)) {
			const read = await ports.fs.readFile(posix.join(root, node.path));
			const fresh =
				read.ok && graph.files.get(node.path)?.hash === hashOf(read.value);
			sources.set(node.path, fresh && read.ok ? read.value : undefined);
		}
		const content = sources.get(node.path);
		if (content === undefined) continue;
		entities.push({
			name: node.name,
			kind: node.kind,
			startLine: node.startLine,
			endLine: node.endLine,
			filePath: node.path,
			body: sliceLines(content, node.startLine, node.endLine),
		});
	}
	return { ok: true, value: entities };
}
