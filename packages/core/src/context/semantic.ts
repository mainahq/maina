import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getContextDb } from "../db/index";
import {
	buildGraph,
	type DependencyGraph,
	scoreRelevance,
	type TaskContext,
} from "./relevance";
import { parseFile } from "./treesitter";

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
}

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".pyi",
	".go",
	".rs",
]);

/**
 * Recursively walks a directory and collects source files,
 * excluding node_modules, dist, and .git directories.
 */
function collectSourceFiles(dir: string): string[] {
	const results: string[] = [];
	const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

	function walk(current: string): void {
		let entries: string[];
		try {
			entries = readdirSync(current) as unknown as string[];
		} catch {
			return;
		}

		for (const entry of entries) {
			if (SKIP_DIRS.has(entry)) continue;

			const fullPath = join(current, entry);
			let stat: ReturnType<typeof statSync> | undefined;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				walk(fullPath);
			} else if (stat.isFile()) {
				const dotIdx = entry.lastIndexOf(".");
				const ext = dotIdx >= 0 ? entry.slice(dotIdx) : "";
				if (SOURCE_EXTENSIONS.has(ext)) {
					results.push(fullPath);
				}
			}
		}
	}

	walk(dir);
	return results;
}

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
 * Builds the full semantic context for a repo:
 * - Scans .ts/.js files (excluding node_modules/dist/.git)
 * - Builds dependency graph
 * - Runs PageRank (personalized toward task context)
 * - Loads constitution and custom context
 * - Attaches relevance scores to all parsed entities
 */
export async function buildSemanticContext(
	repoRoot: string,
	mainaDir: string,
	taskContext: TaskContext,
): Promise<SemanticContext> {
	// Collect all relevant source files
	const files = collectSourceFiles(repoRoot);

	// Build dependency graph
	const graph = await buildGraph(files);

	// Run PageRank with task personalization
	const scores = scoreRelevance(graph, taskContext);

	// Parse entities from all files and annotate with relevance.
	// Entity filePaths are stored as relative to repoRoot for LLM consumption.
	const entities: SemanticContext["entities"] = [];

	for (const file of files) {
		const fileScore = scores.get(file) ?? 0;
		const relPath = relative(repoRoot, file);
		let parsed: Awaited<ReturnType<typeof parseFile>> | undefined;
		try {
			parsed = await parseFile(file);
		} catch {
			continue;
		}

		for (const entity of parsed.entities) {
			entities.push({
				filePath: relPath,
				name: entity.name,
				kind: entity.kind,
				relevance: fileScore,
			});
		}
	}

	// Load constitution and custom context
	const [constitution, customContext] = await Promise.all([
		loadConstitution(mainaDir),
		loadCustomContext(mainaDir),
	]);

	return {
		entities,
		graph,
		scores,
		constitution,
		customContext,
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

	return parts.join("\n");
}

/**
 * Persist semantic context (entities + dependency edges) to the context DB.
 * Replaces all existing data — this is a full re-index.
 * Never throws — silently fails on DB errors.
 */
export function persistSemanticContext(
	mainaDir: string,
	context: SemanticContext,
	repoRoot: string,
): void {
	try {
		const dbResult = getContextDb(mainaDir);
		if (!dbResult.ok) return;

		const db = dbResult.value.db;
		const now = new Date().toISOString();

		// Clear existing data and re-insert (full re-index)
		db.exec("DELETE FROM semantic_entities");
		db.exec("DELETE FROM dependency_edges");

		// Insert entities
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

		// Insert dependency edges
		const insertEdge = db.prepare(
			`INSERT INTO dependency_edges (id, source_file, target_file, weight, type)
			 VALUES (?, ?, ?, ?, ?)`,
		);
		for (const [source, targets] of context.graph.edges) {
			for (const [target, weight] of targets) {
				insertEdge.run(
					crypto.randomUUID(),
					relative(repoRoot, source),
					relative(repoRoot, target),
					weight,
					"import",
				);
			}
		}
	} catch {
		// Persistence failure should never propagate
	}
}
