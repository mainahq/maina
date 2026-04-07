/**
 * Code Entity Extractor — thin adapter for wiki compilation.
 *
 * Uses regex-based extraction of exported entities from TypeScript files.
 * This is a lightweight approach for the wiki foundation — the full
 * tree-sitter + PageRank analysis lives in the Semantic layer and will
 * be integrated in Sprint 1 (Knowledge Graph).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../../db/index";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CodeEntity {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "variable" | "enum";
	file: string;
	line: number;
	exported: boolean;
}

// ─── Extraction ──────────────────────────────────────────────────────────

/**
 * Extract entities from a single TypeScript file using regex patterns.
 * Captures exported functions, classes, interfaces, types, variables, and enums.
 */
function extractFromFile(repoRoot: string, relativePath: string): CodeEntity[] {
	const fullPath = join(repoRoot, relativePath);
	if (!existsSync(fullPath)) return [];

	let content: string;
	try {
		content = readFileSync(fullPath, "utf-8");
	} catch {
		return [];
	}

	const entities: CodeEntity[] = [];
	const lines = content.split("\n");

	const patterns: Array<{
		regex: RegExp;
		kind: CodeEntity["kind"];
	}> = [
		{ regex: /^export\s+(?:async\s+)?function\s+(\w+)/, kind: "function" },
		{ regex: /^export\s+class\s+(\w+)/, kind: "class" },
		{ regex: /^export\s+interface\s+(\w+)/, kind: "interface" },
		{ regex: /^export\s+type\s+(\w+)/, kind: "type" },
		{ regex: /^export\s+(?:const|let|var)\s+(\w+)/, kind: "variable" },
		{ regex: /^export\s+enum\s+(\w+)/, kind: "enum" },
	];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		for (const { regex, kind } of patterns) {
			const match = line.match(regex);
			if (match?.[1]) {
				entities.push({
					name: match[1],
					kind,
					file: relativePath,
					line: i + 1,
					exported: true,
				});
				break;
			}
		}
	}

	return entities;
}

// ─── Public API ──────────────────────────────────────────────────────────

export function extractCodeEntities(
	repoRoot: string,
	files: string[],
): Result<CodeEntity[]> {
	const allEntities: CodeEntity[] = [];

	for (const file of files) {
		const entities = extractFromFile(repoRoot, file);
		allEntities.push(...entities);
	}

	return { ok: true, value: allEntities };
}
