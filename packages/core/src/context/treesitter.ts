export interface ParsedEntity {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "variable";
	startLine: number;
	endLine: number;
}

export interface ParsedImport {
	source: string;
	specifiers: string[];
	isDefault: boolean;
}

export interface ParsedExport {
	name: string;
	kind: string;
}

export interface ParseResult {
	imports: ParsedImport[];
	exports: ParsedExport[];
	entities: ParsedEntity[];
}

/**
 * Extracts import statements from TypeScript/JavaScript source content.
 * Handles named imports, default imports, namespace imports, and type imports.
 * Results are returned in source-order (line order).
 */
export function extractImports(content: string): ParsedImport[] {
	// Collect all matches with their index so we can sort by position
	type RawMatch = { index: number; result: ParsedImport };
	const raw: RawMatch[] = [];

	// Match: import * as X from "..."
	const namespaceRe = /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/gm;
	for (const match of content.matchAll(namespaceRe)) {
		const name = match[1];
		const source = match[2];
		if (name && source) {
			raw.push({
				index: match.index ?? 0,
				result: { source, specifiers: [name], isDefault: false },
			});
		}
	}

	// Match: import { X, Y } from "..." (including import type { ... })
	const namedRe =
		/^import\s+(?:type\s+)?\{\s*([^}]+)\}\s+from\s+["']([^"']+)["']/gm;
	for (const match of content.matchAll(namedRe)) {
		const specifierStr = match[1];
		const source = match[2];
		if (specifierStr && source) {
			const specifiers = specifierStr
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			raw.push({
				index: match.index ?? 0,
				result: { source, specifiers, isDefault: false },
			});
		}
	}

	// Match: import X from "..." (default import, but NOT namespace or named)
	const defaultRe = /^import\s+(\w+)\s+from\s+["']([^"']+)["']/gm;
	for (const match of content.matchAll(defaultRe)) {
		const name = match[1];
		const source = match[2];
		if (name && source) {
			// Avoid double-counting "type" keyword (import type { ... } matched above)
			if (name === "type") continue;
			raw.push({
				index: match.index ?? 0,
				result: { source, specifiers: [name], isDefault: true },
			});
		}
	}

	// Sort by position in source file and return
	raw.sort((a, b) => a.index - b.index);
	return raw.map((r) => r.result);
}

/**
 * Extracts export declarations from TypeScript/JavaScript source content.
 * Handles exported functions, classes, interfaces, types, consts, defaults, and re-exports.
 */
export function extractExports(content: string): ParsedExport[] {
	const results: ParsedExport[] = [];

	// export function / export async function
	const funcRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
	for (const match of content.matchAll(funcRe)) {
		const name = match[1];
		if (name) results.push({ name, kind: "function" });
	}

	// export class
	const classRe = /^export\s+class\s+(\w+)/gm;
	for (const match of content.matchAll(classRe)) {
		const name = match[1];
		if (name) results.push({ name, kind: "class" });
	}

	// export interface
	const interfaceRe = /^export\s+interface\s+(\w+)/gm;
	for (const match of content.matchAll(interfaceRe)) {
		const name = match[1];
		if (name) results.push({ name, kind: "interface" });
	}

	// export type X =
	const typeRe = /^export\s+type\s+(\w+)\s*=/gm;
	for (const match of content.matchAll(typeRe)) {
		const name = match[1];
		if (name) results.push({ name, kind: "type" });
	}

	// export const / export let / export var
	const constRe = /^export\s+(?:const|let|var)\s+(\w+)/gm;
	for (const match of content.matchAll(constRe)) {
		const name = match[1];
		if (name) results.push({ name, kind: "variable" });
	}

	// export default (class/function/expression)
	const defaultClassRe = /^export\s+default\s+(?:class|function)\s+(\w+)/gm;
	for (const _match of content.matchAll(defaultClassRe)) {
		// Named default export — still record as "default"
		results.push({ name: "default", kind: "default" });
	}
	// export default (bare keyword, no named class/function)
	const defaultBareRe = /^export\s+default\s+(?!class\s+\w|function\s+\w)/gm;
	for (const _match of content.matchAll(defaultBareRe)) {
		results.push({ name: "default", kind: "default" });
	}

	// export { X, Y } or export { X, Y } from "..."
	const reExportRe = /^export\s+\{\s*([^}]+)\}/gm;
	for (const match of content.matchAll(reExportRe)) {
		const specifierStr = match[1];
		if (specifierStr) {
			const specifiers = specifierStr
				.split(",")
				.map((s) => {
					// handle "X as Y" — use the exported name (Y)
					const parts = s.trim().split(/\s+as\s+/);
					return (parts[parts.length - 1] ?? "").trim();
				})
				.filter((s) => s.length > 0);
			for (const name of specifiers) {
				results.push({ name, kind: "reexport" });
			}
		}
	}

	return results;
}

/**
 * Extracts top-level entity declarations (functions, classes, interfaces, types, variables)
 * with their starting line numbers.
 */
export function extractEntities(content: string): ParsedEntity[] {
	const results: ParsedEntity[] = [];
	const lines = content.split("\n");

	// Patterns: each tuple is [regex, kind]
	const patterns: Array<[RegExp, ParsedEntity["kind"]]> = [
		// function declarations (exported or not, async or not)
		[/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, "function"],
		// class declarations
		[/^(?:export\s+)?class\s+(\w+)/, "class"],
		// interface declarations
		[/^(?:export\s+)?interface\s+(\w+)/, "interface"],
		// type alias: type X =
		[/^(?:export\s+)?type\s+(\w+)\s*=/, "type"],
		// top-level const/let/var (must start at column 0)
		[/^(?:export\s+)?(?:const|let|var)\s+(\w+)/, "variable"],
	];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const lineNum = i + 1; // 1-based

		for (const [pattern, kind] of patterns) {
			const match = line.match(pattern);
			if (match) {
				const name = match[1];
				if (name) {
					results.push({ name, kind, startLine: lineNum, endLine: lineNum });
					break; // only match one pattern per line
				}
			}
		}
	}

	return results;
}

/**
 * Reads a TypeScript/JavaScript file from disk and returns its parsed structure:
 * imports, exports, and top-level entities with line numbers.
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
	const file = Bun.file(filePath);
	const content = await file.text();

	return {
		imports: extractImports(content),
		exports: extractExports(content),
		entities: extractEntities(content),
	};
}
