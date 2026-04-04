import { dirname, extname, resolve } from "node:path";
import { parseFile } from "./treesitter";

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
 * Implements the PageRank algorithm over a dependency graph.
 * Returns a map of file -> score, where scores sum to approximately 1.
 *
 * Formula per iteration:
 *   score[n] = (1 - d) * personalWeight[n] / totalPersonalWeight
 *            + d * sum(score[m] / outDegree(m) for m that links to n)
 */
export function pageRank(
	graph: DependencyGraph,
	options?: {
		personalization?: Map<string, number>;
		dampingFactor?: number;
		iterations?: number;
	},
): Map<string, number> {
	const nodes = Array.from(graph.nodes);
	const n = nodes.length;

	if (n === 0) {
		return new Map();
	}

	const d = options?.dampingFactor ?? 0.85;
	const iters = options?.iterations ?? 20;
	const personalization = options?.personalization;

	// Build personalization weights
	const personalWeights = new Map<string, number>();
	let totalPersonalWeight = 0;

	if (personalization && personalization.size > 0) {
		for (const node of nodes) {
			const w = personalization.get(node) ?? 0;
			personalWeights.set(node, w);
			totalPersonalWeight += w;
		}
		// If all personalized nodes are not in graph, fall back to uniform
		if (totalPersonalWeight === 0) {
			for (const node of nodes) {
				personalWeights.set(node, 1);
				totalPersonalWeight += 1;
			}
		}
	} else {
		// Uniform personalization
		for (const node of nodes) {
			personalWeights.set(node, 1);
		}
		totalPersonalWeight = n;
	}

	// Compute out-degrees (weighted)
	const outDegree = new Map<string, number>();
	for (const node of nodes) {
		const targets = graph.edges.get(node);
		if (targets && targets.size > 0) {
			let total = 0;
			for (const w of targets.values()) {
				total += w;
			}
			outDegree.set(node, total);
		} else {
			outDegree.set(node, 0);
		}
	}

	// Build reverse adjacency: target -> list of (source, weight)
	const inLinks = new Map<string, Array<[string, number]>>();
	for (const node of nodes) {
		inLinks.set(node, []);
	}
	for (const [source, targets] of graph.edges) {
		for (const [target, weight] of targets) {
			if (inLinks.has(target)) {
				inLinks.get(target)?.push([source, weight]);
			}
		}
	}

	// Initialize scores
	let scores = new Map<string, number>();
	for (const node of nodes) {
		scores.set(node, 1 / n);
	}

	// Dangling nodes (no outgoing edges) — redistribute uniformly
	const danglingNodes = nodes.filter((node) => outDegree.get(node) === 0);

	// Iterate
	for (let iter = 0; iter < iters; iter++) {
		const newScores = new Map<string, number>();

		// Sum of dangling node scores
		let danglingSum = 0;
		for (const node of danglingNodes) {
			danglingSum += scores.get(node) ?? 0;
		}

		for (const node of nodes) {
			const personalBase =
				((1 - d) * (personalWeights.get(node) ?? 0)) / totalPersonalWeight;

			// Dangling node contribution distributed by personalization
			const danglingContrib =
				d *
				danglingSum *
				((personalWeights.get(node) ?? 0) / totalPersonalWeight);

			// Link contributions
			let linkSum = 0;
			const incoming = inLinks.get(node) ?? [];
			for (const [source, weight] of incoming) {
				const sourceOut = outDegree.get(source) ?? 0;
				if (sourceOut > 0) {
					linkSum += d * (scores.get(source) ?? 0) * (weight / sourceOut);
				}
			}

			newScores.set(node, personalBase + danglingContrib + linkSum);
		}

		scores = newScores;
	}

	// Normalize so scores sum to 1
	let total = 0;
	for (const v of scores.values()) {
		total += v;
	}
	if (total > 0) {
		for (const [node, v] of scores) {
			scores.set(node, v / total);
		}
	}

	return scores;
}

/**
 * Convenience wrapper: builds personalization vector from taskContext
 * (touched files get weight 50, mentioned files get weight 10),
 * then runs pageRank.
 */
export function scoreRelevance(
	graph: DependencyGraph,
	taskContext: TaskContext,
): Map<string, number> {
	const personalization = new Map<string, number>();

	for (const file of taskContext.touchedFiles) {
		personalization.set(file, (personalization.get(file) ?? 0) + 50);
	}

	for (const file of taskContext.mentionedFiles) {
		personalization.set(file, (personalization.get(file) ?? 0) + 10);
	}

	return pageRank(graph, { personalization });
}
