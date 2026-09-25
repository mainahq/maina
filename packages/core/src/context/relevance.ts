import { dirname, extname, resolve } from "node:path";
import { decide, defaultDecidePorts, scoreAnswers } from "../decide/decide";
import { parseFile } from "./treesitter";

export { pageRank } from "../decide/backends/heuristics/retrieval";

export interface DependencyGraph {
	nodes: Set<string>; // file paths
	edges: Map<string, Map<string, number>>; // source -> target -> weight
}

export interface TaskContext {
	touchedFiles: string[];
	mentionedFiles: string[];
	currentTicketTerms: string[];
}

/**
 * Resolves a relative import source to an absolute file path,
 * trying common extensions if needed.
 */
function resolveImportPath(
	importSource: string,
	sourceFile: string,
	knownFiles: Set<string>,
): string | null {
	// Only handle relative imports
	if (!importSource.startsWith(".")) {
		return null;
	}

	const sourceDir = dirname(sourceFile);
	const base = resolve(sourceDir, importSource);

	// Try exact path first, then with extensions
	const candidates = [
		base,
		// TypeScript/JavaScript
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		`${base}.jsx`,
		`${base}/index.ts`,
		`${base}/index.js`,
		// Python
		`${base}.py`,
		`${base}/__init__.py`,
		// Go
		`${base}.go`,
		// Rust
		`${base}.rs`,
		`${base}/mod.rs`,
		// C#
		`${base}.cs`,
		// Java
		`${base}.java`,
		`${base}.kt`,
	];

	for (const candidate of candidates) {
		if (knownFiles.has(candidate)) {
			return candidate;
		}
	}

	return null;
}

/**
 * Determines if an import is type-only based on the import text in the file.
 * Since parseFile doesn't directly expose type-only info, we check specifiers.
 * A heuristic: all specifiers start with uppercase AND source is not a runtime dep.
 * More accurately, we need to re-read to detect "import type".
 */
async function getImportTypeInfo(
	filePath: string,
): Promise<{ typeOnlySources: Set<string>; privateSources: Set<string> }> {
	try {
		const content = await Bun.file(filePath).text();
		const typeOnlySources = new Set<string>();
		const privateSources = new Set<string>();

		// Detect "import type { ... } from '...'"
		const typeImportRe =
			/^import\s+type\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gm;
		for (const match of content.matchAll(typeImportRe)) {
			const source = match[1];
			if (source) typeOnlySources.add(source);
		}

		// Detect imports of private names (specifiers starting with _)
		const namedImportRe =
			/^import\s+(?:type\s+)?\{\s*([^}]+)\}\s+from\s+["']([^"']+)["']/gm;
		for (const match of content.matchAll(namedImportRe)) {
			const specifiers = match[1];
			const source = match[2];
			if (specifiers && source) {
				const names = specifiers.split(",").map((s) => s.trim());
				const allPrivate = names.every((n) => n.startsWith("_") || n === "");
				const hasPrivate = names.some((n) => n.startsWith("_"));
				if (allPrivate && hasPrivate) {
					privateSources.add(source);
				}
			}
		}

		// Default imports of private names
		const defaultImportRe = /^import\s+(_\w+)\s+from\s+["']([^"']+)["']/gm;
		for (const match of content.matchAll(defaultImportRe)) {
			const source = match[2];
			if (source) privateSources.add(source);
		}

		return { typeOnlySources, privateSources };
	} catch {
		return { typeOnlySources: new Set(), privateSources: new Set() };
	}
}

/**
 * Builds a dependency graph from a list of .ts/.js files.
 * Creates directed edges from source -> target based on imports.
 * Weights: 1.0 normal, 0.5 type-only, 0.1 private names (starting with _).
 */
export async function buildGraph(files: string[]): Promise<DependencyGraph> {
	const nodes = new Set<string>(files);
	const edges = new Map<string, Map<string, number>>();

	for (const file of files) {
		const ext = extname(file);
		if (ext !== ".ts" && ext !== ".js") continue;

		let parsed: Awaited<ReturnType<typeof parseFile>> | undefined;
		try {
			parsed = await parseFile(file);
		} catch {
			continue;
		}

		const { typeOnlySources, privateSources } = await getImportTypeInfo(file);

		for (const imp of parsed.imports) {
			const target = resolveImportPath(imp.source, file, nodes);
			if (!target) continue;

			// Determine weight
			let weight = 1.0;
			if (typeOnlySources.has(imp.source)) {
				weight = 0.5;
			} else if (privateSources.has(imp.source)) {
				weight = 0.1;
			} else {
				// Check if all specifiers are private
				const allPrivate =
					imp.specifiers.length > 0 &&
					imp.specifiers.every((s) => s.startsWith("_"));
				if (allPrivate) {
					weight = 0.1;
				}
			}

			if (!edges.has(file)) {
				edges.set(file, new Map());
			}
			// Use max weight if there are multiple imports from same source
			const existing = edges.get(file)?.get(target) ?? 0;
			edges.get(file)?.set(target, Math.max(existing, weight));
		}
	}

	return { nodes, edges };
}

/**
 * Scores every file's relevance to the task via `decide` (`context.select`):
 * the heuristic backend runs personalised PageRank, touched files weighing
 * 50 and mentioned files 10. Returns file → score in graph node order.
 */
export function scoreRelevance(
	graph: DependencyGraph,
	taskContext: TaskContext,
): Map<string, number> {
	const nodes = Array.from(graph.nodes);
	if (nodes.length === 0) return new Map();

	const edges: Array<[string, string, number]> = [];
	for (const [source, targets] of graph.edges) {
		for (const [target, weight] of targets) {
			edges.push([source, target, weight]);
		}
	}
	const result = decide(defaultDecidePorts, {
		type: "context.select",
		state: {
			trusted: {
				nodes,
				edges,
				touched: taskContext.touchedFiles,
				mentioned: taskContext.mentionedFiles,
			},
			untrusted: {},
		},
		questions: nodes.map((_, i) => ({
			kind: "score",
			id: `file:${i}`,
			min: 0,
			max: 1,
		})),
	});
	const scores = scoreAnswers(result, nodes.length, 0);
	return new Map(nodes.map((node, i) => [node, scores[i] ?? 0]));
}
