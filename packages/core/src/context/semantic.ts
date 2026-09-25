import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getContextDb, type Result } from "../db/index";
import { impact, minimalContext } from "../graph/query/index";
import type { ContextSnippet } from "../graph/query/types";
import {
	hasFullIndex,
	indexRepo,
	readGraph,
	updateFiles,
} from "../graph/store/index";
import type {
	GraphStoreError,
	GraphStoreOptions,
	GraphStorePorts,
} from "../graph/store/types";
import { buildGraph, type DependencyGraph, scoreRelevance } from "./relevance";

export interface SemanticContext {
	entities: {
		filePath: string;
		name: string;
		kind: string;
		relevance: number;
	}[];
	graph: DependencyGraph;
	scores: Map<string, number>;
	constitution: string | null;
	customContext: string[];
	/** The touched code and its graph neighbourhood; null when nothing touched is indexed. */
	code: GraphCode | null;
}

/** Graph-derived code context for the touched files (FR-GRAPH-5). */
export type GraphCode = Readonly<{
	snippets: readonly ContextSnippet[];
	tokens: number;
	/** Tokens saved against reading every snippet's file in full. */
	savedTokens: number;
	/** Non-test files depending on the touched code. */
	dependents: readonly string[];
	/** Ids of tests exercising the touched code or its callers. */
	tests: readonly string[];
	/** Share (0..1) of the other non-test files among the dependents. */
	blastScore: number;
}>;

/** The graph store the semantic layer reads and keeps current. */
type SemanticPorts = GraphStorePorts;

type SemanticRequest = Readonly<{
	root: string;
	mainaDir: string;
	/** Repo-relative paths the task touches (staged and recently changed). */
	touchedFiles: readonly string[];
	/** Ceiling on the code snippets' tokens; 0 leaves code out. */
	codeBudgetTokens: number;
}>;

/**
 * Reads .maina/constitution.md if it exists, returning its content.
 * Returns null if the file does not exist or cannot be read.
 */
export async function loadConstitution(
	mainaDir: string,
): Promise<string | null> {
	const constitutionPath = join(mainaDir, "constitution.md");
	try {
		const exists = await Bun.file(constitutionPath).exists();
		if (!exists) return null;
		return await Bun.file(constitutionPath).text();
	} catch {
		return null;
	}
}

/**
 * Reads all files from .maina/context/semantic/custom/ and returns their contents.
 * Returns an empty array if the directory doesn't exist or is empty.
 */
export async function loadCustomContext(mainaDir: string): Promise<string[]> {
	const customDir = join(mainaDir, "context", "semantic", "custom");

	let entries: string[];
	try {
		entries = readdirSync(customDir) as unknown as string[];
	} catch {
		return [];
	}

	const results: string[] = [];
	for (const entry of entries) {
		const filePath = join(customDir, entry);
		try {
			const stat = statSync(filePath);
			if (!stat.isFile()) continue;
			const content = await Bun.file(filePath).text();
			results.push(content);
		} catch {}
	}

	return results;
}

/**
 * Brings the store current for one call without walking the repository: a
 * store that was never fully indexed is indexed once, after that only the
 * touched paths are synced (content-hash incremental). The runtime keeps
 * the rest current from host events (FR-GRAPH-2).
 */
async function syncTouched(
	ports: SemanticPorts,
	root: string,
	touched: readonly string[],
	options: GraphStoreOptions,
): Promise<Result<unknown, GraphStoreError>> {
	const indexed = hasFullIndex(ports.db);
	if (!indexed.ok) return indexed;
	return indexed.value
		? updateFiles(ports, root, touched, options)
		: indexRepo(ports, root, options);
}

/** Snippets of the touched code and its neighbourhood, plus its impact. */
async function graphCode(
	ports: SemanticPorts,
	root: string,
	touched: readonly string[],
	budgetTokens: number,
): Promise<Result<GraphCode, GraphStoreError>> {
	const context = await minimalContext(ports, root, {
		files: touched,
		budgetTokens,
	});
	if (!context.ok) return context;
	const reach = impact(ports, { files: touched });
	if (!reach.ok) return reach;
	return {
		ok: true,
		value: {
			snippets: context.value.snippets,
			tokens: context.value.tokens,
			savedTokens: context.value.savedTokens,
			dependents: reach.value.dependents,
			tests: reach.value.tests.map((t) => t.id),
			blastScore: reach.value.blastScore,
		},
	};
}

/**
 * The semantic layer read from the code graph (FR-GRAPH-5): entities are
 * the stored top-level symbols, PageRank runs over the graph's file edges
 * personalised to the touched files, and the touched code comes back as
 * line-exact snippets with its callers, callees, dependents and tests.
 * Paths are repo-relative.
 */
export async function buildSemanticContext(
	ports: SemanticPorts,
	request: SemanticRequest,
	options: GraphStoreOptions = {},
): Promise<Result<SemanticContext, GraphStoreError>> {
	const { root, mainaDir, touchedFiles, codeBudgetTokens } = request;
	const synced = await syncTouched(ports, root, touchedFiles, options);
	if (!synced.ok) return synced;
	const snapshot = readGraph(ports.db);
	if (!snapshot.ok) return snapshot;

	const graph = buildGraph(snapshot.value);
	const touched = [...new Set(touchedFiles)].filter((p) => graph.nodes.has(p));
	const scores = scoreRelevance(graph, {
		touchedFiles: touched,
		mentionedFiles: [],
		currentTicketTerms: [],
	});
	const entities = snapshot.value.nodes
		.filter((n) => n.kind !== "file" && !n.test && n.parent === null)
		.map((n) => ({
			filePath: n.path,
			name: n.name,
			kind: n.kind,
			relevance: scores.get(n.path) ?? 0,
		}));

	let code: GraphCode | null = null;
	if (touched.length > 0 && codeBudgetTokens > 0) {
		const built = await graphCode(ports, root, touched, codeBudgetTokens);
		if (!built.ok) return built;
		code = built.value;
	}

	const [constitution, customContext] = await Promise.all([
		loadConstitution(mainaDir),
		loadCustomContext(mainaDir),
	]);
	return {
		ok: true,
		value: { entities, graph, scores, constitution, customContext, code },
	};
}

/**
 * Returns top N entities sorted by relevance score (descending).
 * Default N is 20.
 */
export function getTopEntities(
	context: SemanticContext,
	n = 20,
): { filePath: string; name: string; kind: string; relevance: number }[] {
	return [...context.entities]
		.sort((a, b) => b.relevance - a.relevance)
		.slice(0, n);
}

/**
 * Formats the semantic context for LLM consumption.
 * If filter is provided, only includes sections matching the filter terms.
 */
export function assembleSemanticText(
	context: SemanticContext,
	filter?: string[],
): string {
	const parts: string[] = [];

	const shouldInclude = (sectionName: string): boolean => {
		if (!filter || filter.length === 0) return true;
		const lower = sectionName.toLowerCase();
		return filter.some((f) => lower.includes(f.toLowerCase()));
	};

	// Constitution
	if (context.constitution && shouldInclude("constitution")) {
		parts.push("## Project Constitution\n");
		parts.push(context.constitution);
	}

	// Custom context files
	if (context.customContext.length > 0) {
		for (const content of context.customContext) {
			// Determine section name from content heading (first line)
			const firstLine = content.split("\n")[0] ?? "";
			const sectionName = firstLine.replace(/^#+\s*/, "").trim() || "custom";

			if (shouldInclude(sectionName) || shouldInclude("custom")) {
				parts.push(content);
			}
		}
	}

	// Codebase overview section: group entities by file, sorted by relevance
	if (shouldInclude("entities") || !filter || filter.length === 0) {
		const topEntities = getTopEntities(context, 200);
		if (topEntities.length > 0) {
			// Group entities by filePath
			const byFile = new Map<
				string,
				{ kind: string; name: string; relevance: number }[]
			>();
			for (const entity of topEntities) {
				const existing = byFile.get(entity.filePath) ?? [];
				existing.push({
					kind: entity.kind,
					name: entity.name,
					relevance: entity.relevance,
				});
				byFile.set(entity.filePath, existing);
			}

			// Sort files by max relevance descending
			const sortedFiles = [...byFile.entries()].sort((a, b) => {
				const maxA = Math.max(...a[1].map((e) => e.relevance));
				const maxB = Math.max(...b[1].map((e) => e.relevance));
				return maxB - maxA;
			});

			parts.push("## Codebase Overview\n");
			for (const [filePath, entities] of sortedFiles) {
				const fileScore = Math.max(...entities.map((e) => e.relevance));
				parts.push(`### ${filePath} (relevance: ${fileScore.toFixed(4)})`);
				for (const entity of entities) {
					parts.push(`- \`${entity.name}\` (${entity.kind})`);
				}
				parts.push("");
			}
		}
	}

	if (context.code && shouldInclude("graph")) {
		parts.push(renderGraphCode(context.code));
	}

	return parts.join("\n");
}

/** Most dependents or tests listed before the rest are counted. */
const LIST_LIMIT = 20;

function listed(items: readonly string[]): string {
	const shown = items
		.slice(0, LIST_LIMIT)
		.map((item) => `\`${item}\``)
		.join(", ");
	const more = items.length - LIST_LIMIT;
	return more > 0 ? `${shown} (+${more} more)` : shown;
}

/** The code graph section: impact summary, then each snippet in priority order. */
function renderGraphCode(code: GraphCode): string {
	const lines = [
		"## Code Graph\n",
		`Touched code and its graph neighbourhood: ${code.snippets.length} snippets, ${code.tokens} tokens (${code.savedTokens} fewer than reading the files in full).`,
		"",
		`- Blast radius: ${Math.round(code.blastScore * 100)}% of the other source files depend on it`,
	];
	if (code.dependents.length > 0) {
		lines.push(`- Dependents: ${listed(code.dependents)}`);
	}
	if (code.tests.length > 0) lines.push(`- Tests: ${listed(code.tests)}`);
	for (const s of code.snippets) {
		lines.push(
			"",
			`### ${s.path}:${s.startLine}-${s.endLine} \`${s.qualifiedName}\` (${s.reason})`,
			"```",
			s.text,
			"```",
		);
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Mirrors the graph-derived entities and file edges into the context DB's
 * legacy `semantic_entities` / `dependency_edges` tables, which `explain`,
 * `ticket` and `stats` still read. Paths are repo-relative, as the graph
 * stores them. Replaces the previous rows in one transaction; never throws.
 */
export function persistSemanticContext(
	mainaDir: string,
	context: SemanticContext,
): void {
	const dbResult = getContextDb(mainaDir);
	if (!dbResult.ok) return;
	const db = dbResult.value.db;
	try {
		const now = new Date().toISOString();
		db.exec("BEGIN");
		db.exec("DELETE FROM semantic_entities");
		db.exec("DELETE FROM dependency_edges");

		const insertEntity = db.prepare(
			`INSERT INTO semantic_entities (id, file_path, name, kind, start_line, end_line, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const entity of context.entities) {
			insertEntity.run(
				crypto.randomUUID(),
				entity.filePath,
				entity.name,
				entity.kind,
				0,
				0,
				now,
			);
		}

		const insertEdge = db.prepare(
			`INSERT INTO dependency_edges (id, source_file, target_file, weight, type)
			 VALUES (?, ?, ?, ?, ?)`,
		);
		for (const [source, targets] of context.graph.edges) {
			for (const [target, weight] of targets) {
				insertEdge.run(crypto.randomUUID(), source, target, weight, "import");
			}
		}
		db.exec("COMMIT");
	} catch {
		// Persistence failure never propagates.
		try {
			db.exec("ROLLBACK");
		} catch {
			// No transaction was open.
		}
	} finally {
		db.close();
	}
}
