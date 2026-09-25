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
/** `null` when the file exists but could not be read. */
function extractFromFile(
	repoRoot: string,
	relativePath: string,
): CodeEntity[] | null {
	const fullPath = join(repoRoot, relativePath);
	if (!existsSync(fullPath)) return [];

	let content: string;
	try {
		content = readFileSync(fullPath, "utf-8");
	} catch {
		return null;
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

/** Entities plus the source files that exist but could not be read. */
interface CodeEntityScan {
	readonly entities: readonly CodeEntity[];
	readonly unreadable: readonly string[];
}

/**
 * Like {@link extractCodeEntities} but reports unreadable files, so callers
 * that act on absence (wiki pruning, #377) can tell "no entities" apart from
 * "could not look".
 */
export function scanCodeEntities(
	repoRoot: string,
	files: readonly string[],
): CodeEntityScan {
	const entities: CodeEntity[] = [];
	const unreadable: string[] = [];

	for (const file of files) {
		const found = extractFromFile(repoRoot, file);
		if (found === null) unreadable.push(file);
		else entities.push(...found);
	}

	return { entities, unreadable };
}

export function extractCodeEntities(
	repoRoot: string,
	files: string[],
): Result<CodeEntity[]> {
	return { ok: true, value: [...scanCodeEntities(repoRoot, files).entities] };
}
