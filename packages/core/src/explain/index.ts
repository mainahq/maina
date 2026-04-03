/**
 * Explain Module — Generate Mermaid dependency diagrams and module summaries.
 *
 * Uses the Context Engine semantic layer (dependency_edges and semantic_entities
 * tables) to visualize codebase structure.
 */

import type { Result } from "../db/index.ts";
import { getContextDb } from "../db/index.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModuleSummary {
	module: string;
	entityCount: number;
	functions: number;
	classes: number;
	interfaces: number;
	types: number;
}

export interface DiagramOptions {
	scope?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a short module label from a file path.
 * e.g. "src/context/engine.ts" -> "context/engine"
 *      "context/budget.ts" -> "context/budget"
 */
function toModuleLabel(filePath: string): string {
	// Strip leading src/ if present
	const stripped = filePath.replace(/^src\//, "");
	// Remove file extension
	return stripped.replace(/\.[^/.]+$/, "");
}

// ── generateDependencyDiagram ────────────────────────────────────────────────

/**
 * Read the dependency graph from the Context Engine DB (dependency_edges table)
 * and generate a Mermaid flowchart diagram string.
 *
 * If `scope` is provided, filters to only edges where source or target
 * involves that directory.
 *
 * Returns a Mermaid markdown string on success, or an error on failure.
 * Never throws.
 */
export function generateDependencyDiagram(
	mainaDir: string,
	options?: DiagramOptions,
): Result<string> {
	try {
		const dbResult = getContextDb(mainaDir);
		if (!dbResult.ok) return { ok: false, error: dbResult.error };

		const { db } = dbResult.value;

		const rows = db
			.prepare("SELECT source_file, target_file FROM dependency_edges")
			.all() as Array<{ source_file: string; target_file: string }>;

		let lines = rows.map((row) => ({
			source: toModuleLabel(row.source_file),
			target: toModuleLabel(row.target_file),
		}));

		// Apply scope filter if provided
		if (options?.scope) {
			const scope = options.scope;
			lines = lines.filter(
				(edge) =>
					edge.source.startsWith(scope) || edge.target.startsWith(scope),
			);
		}

		// Build Mermaid diagram
		let diagram = "graph LR\n";
		for (const edge of lines) {
			diagram += `  ${edge.source} --> ${edge.target}\n`;
		}

		db.close();
		return { ok: true, value: diagram };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ── generateModuleSummary ───────────────────────────────────────────────────

/**
 * Read semantic_entities table from Context Engine DB, group entities by
 * file/module, and return a summary of each module.
 *
 * Returns an array of ModuleSummary on success, or an error on failure.
 * Never throws.
 */
export function generateModuleSummary(
	mainaDir: string,
): Result<ModuleSummary[]> {
	try {
		const dbResult = getContextDb(mainaDir);
		if (!dbResult.ok) return { ok: false, error: dbResult.error };

		const { db } = dbResult.value;

		const rows = db
			.prepare("SELECT file_path, kind FROM semantic_entities")
			.all() as Array<{ file_path: string; kind: string }>;

		if (rows.length === 0) {
			db.close();
			return { ok: true, value: [] };
		}

		// Group by module label
		const moduleMap = new Map<
			string,
			{
				functions: number;
				classes: number;
				interfaces: number;
				types: number;
				total: number;
			}
		>();

		for (const row of rows) {
			const mod = toModuleLabel(row.file_path);
			const entry = moduleMap.get(mod) ?? {
				functions: 0,
				classes: 0,
				interfaces: 0,
				types: 0,
				total: 0,
			};

			entry.total++;
			switch (row.kind) {
				case "function":
					entry.functions++;
					break;
				case "class":
					entry.classes++;
					break;
				case "interface":
					entry.interfaces++;
					break;
				case "type":
					entry.types++;
					break;
			}

			moduleMap.set(mod, entry);
		}

		const summaries: ModuleSummary[] = [];
		for (const [mod, entry] of moduleMap) {
			summaries.push({
				module: mod,
				entityCount: entry.total,
				functions: entry.functions,
				classes: entry.classes,
				interfaces: entry.interfaces,
				types: entry.types,
			});
		}

		// Sort by module name for deterministic output
		summaries.sort((a, b) => a.module.localeCompare(b.module));

		db.close();
		return { ok: true, value: summaries };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
