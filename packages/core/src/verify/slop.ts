/**
 * Slop Detector — catches common AI-generated code patterns.
 *
 * Detects patterns that slip through linters: empty function bodies,
 * hallucinated imports, console.log in production code, TODOs without
 * ticket references, and large blocks of commented-out code.
 *
 * Pattern/regex-based detection. AST-based detection (tree-sitter) is
 * a future improvement — the key is detecting the patterns correctly.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CacheManager } from "../cache/manager";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export type SlopRule =
	| "empty-body"
	| "hallucinated-import"
	| "console-log"
	| "todo-without-ticket"
	| "commented-code";

export interface SlopResult {
	findings: Finding[];
	cached: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hashContent(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

function cacheKey(fileHash: string): string {
	return `slop:${fileHash}`;
}

// ─── Individual Detectors ─────────────────────────────────────────────────

/**
 * Detect empty function/method/arrow bodies.
 *
 * Looks for patterns like `function name() { }`, `() => { }`, `method() { }`.
 * Does NOT flag bodies that contain comments.
 * Does NOT flag object literals or array literals.
 */
export function detectEmptyBodies(content: string, file: string): Finding[] {
	// Skip test files — mocks/stubs intentionally use empty bodies
	if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
		return [];
	}

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Strategy: find lines with `{}` or multiline open/close brace patterns
	// that are part of function/method/arrow declarations.

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();

		// Skip obvious non-function empty braces
		if (
			/(?:const|let|var|type|interface|enum)\s+\w+.*=\s*\{/.test(trimmed) &&
			!trimmed.includes("=>")
		) {
			continue;
		}

		// Check for single-line empty function body
		const emptyBraces = /\{\s*\}/;
		if (emptyBraces.test(trimmed)) {
			// Skip lines where the empty braces are inside a regex literal or string
			if (
				/\/.*\{\\s\*\}.*\//.test(trimmed) ||
				/['"`].*\{\s*\}.*['"`]/.test(trimmed)
			) {
				continue;
			}

			const fnDeclPattern =
				/function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*\}/;
			const arrowPattern = /=>\s*\{\s*\}/;
			const methodPattern =
				/^\s*(?:(?:public|private|protected|static|async|get|set|override)\s+)*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*\}/;
			const nonFnPattern =
				/(?:const|let|var|type|interface|enum|import|export\s+(?:type|interface))\s/;

			const isFunctionLike =
				fnDeclPattern.test(trimmed) ||
				arrowPattern.test(trimmed) ||
				(methodPattern.test(trimmed) && !nonFnPattern.test(trimmed));

			if (isFunctionLike) {
				findings.push({
					tool: "slop",
					file,
					line: i + 1,
					message: "Empty function/method body detected",
					severity: "warning",
					ruleId: "slop/empty-body",
				});
			}
			continue;
		}

		// Multi-line empty body: opening brace on one line, closing on next,
		// with nothing in between
		if (trimmed.endsWith("{")) {
			const nextLine = lines[i + 1]?.trim() ?? "";
			if (nextLine === "}") {
				// Check if this line is a function/method declaration
				const isFunctionLike =
					/function\s+\w+\s*\(/.test(trimmed) ||
					/=>\s*\{$/.test(trimmed) ||
					(/^\s*(?:(?:public|private|protected|static|async|get|set|override)\s+)*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\{$/.test(
						trimmed,
					) &&
						!/(?:const|let|var|type|interface|enum|import|class|if|else|for|while|switch|try|catch)\s/.test(
							trimmed,
						));

				if (isFunctionLike) {
					findings.push({
						tool: "slop",
						file,
						line: i + 1,
						message: "Empty function/method body detected",
						severity: "warning",
						ruleId: "slop/empty-body",
					});
				}
			}
		}
	}

	return findings;
}

/**
 * Detect hallucinated imports — imports that reference non-existent modules.
 *
 * Only checks relative imports (./foo, ../bar). Package imports (react, zod,
 * node:path, bun:test) are skipped since they could be valid packages.
 */
export function detectHallucinatedImports(
	content: string,
	file: string,
	cwd: string,
): Finding[] {
	// Skip test files — test fixtures intentionally use non-existent imports
	if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
		return [];
	}

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Determine the directory of the file being checked
	const fileDir = dirname(isAbsolute(file) ? file : resolve(cwd, file));

	// Match import statements with relative paths
	const importPattern =
		/(?:import\s+.*\s+from\s+|import\s+|require\s*\()['"](\.[^'"]+)['"]/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = importPattern.exec(line);
		if (!match) continue;

		const importPath = match[1];
		if (!importPath) continue;

		// Only check relative imports
		if (!importPath.startsWith(".")) continue;

		// Skip placeholder/ellipsis imports (e.g. "..." in dynamic import docs)
		if (/^\.{2,}$/.test(importPath)) continue;

		const resolvedBase = resolve(fileDir, importPath);

		// Check common extensions and index files
		const candidates = [
			resolvedBase,
			`${resolvedBase}.ts`,
			`${resolvedBase}.tsx`,
			`${resolvedBase}.js`,
			`${resolvedBase}.jsx`,
			`${resolvedBase}.json`,
			join(resolvedBase, "index.ts"),
			join(resolvedBase, "index.tsx"),
			join(resolvedBase, "index.js"),
			join(resolvedBase, "index.jsx"),
		];

		const found = candidates.some((candidate) => existsSync(candidate));

		if (!found) {
			findings.push({
				tool: "slop",
				file,
				line: i + 1,
				message: `Import "${importPath}" does not resolve to an existing file`,
				severity: "error",
				ruleId: "slop/hallucinated-import",
			});
		}
	}

	return findings;
}

/**
 * Detect console.log/warn/error/debug/info in production code.
 *
 * Skips test files (*.test.ts, *.spec.ts).
 */
export function detectConsoleLogs(content: string, file: string): Finding[] {
	// Skip test files
	if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
		return [];
	}

	const findings: Finding[] = [];
	const lines = content.split("\n");

	const consolePattern = /console\.(log|warn|error|debug|info)\s*\(/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		// Respect lint-ignore directives on preceding line
		const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
		if (
			/(?:biome-ignore|eslint-disable|@ts-ignore|noinspection)/.test(prevLine)
		) {
			continue;
		}
		const match = consolePattern.exec(line);
		if (match) {
			findings.push({
				tool: "slop",
				file,
				line: i + 1,
				column: (match.index ?? 0) + 1,
				message: `console.${match[1]} found in production code`,
				severity: "warning",
				ruleId: "slop/console-log",
			});
		}
	}

	return findings;
}

/**
 * Detect TODO/FIXME comments without a ticket reference.
 *
 * A ticket reference is a pattern like #123, PROJ-123, or [#123].
 */
export function detectTodosWithoutTickets(
	content: string,
	file: string,
): Finding[] {
	// Skip test files — fixtures legitimately contain TODO patterns as test data
	if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
		return [];
	}

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Match TODO or FIXME in comments (case-sensitive — these are always uppercase)
	const todoPattern = /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/;
	// Ticket reference patterns: #123, PROJ-123, [#123], (PROJ-123)
	const ticketPattern = /#\d+|\b[A-Z][A-Z0-9]+-\d+/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (todoPattern.test(line) && !ticketPattern.test(line)) {
			findings.push({
				tool: "slop",
				file,
				line: i + 1,
				message: "TODO/FIXME without ticket reference",
				severity: "info",
				ruleId: "slop/todo-without-ticket",
			});
		}
	}

	return findings;
}

/**
 * Detect commented-out code blocks (3+ consecutive comment lines with code patterns).
 *
 * Distinguishes code comments from documentation comments by looking for
 * code-like patterns: keywords, semicolons, brackets, import/export, assignments.
 *
 * JSDoc-style comments (starting with /**) are treated as documentation and skipped.
 */
export function detectCommentedCode(content: string, file: string): Finding[] {
	// Skip test files — fixtures contain intentional commented-out code as test data
	if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
		return [];
	}

	const findings: Finding[] = [];
	const lines = content.split("\n");

	// Code-like patterns in comments
	const codePatterns = [
		/(?:const|let|var|function|class|import|export|return|if|else|for|while|switch|case|break|continue|throw|try|catch)\s/,
		/[=;{}()[\]]/,
		/=>/,
		/require\s*\(/,
		/\.\w+\s*\(/,
	];

	function looksLikeCode(line: string): boolean {
		// Strip the comment prefix
		const stripped = line
			.replace(/^\s*\/\/\s?/, "")
			.replace(/^\s*\*\s?/, "")
			.replace(/^\s*\/\*\s?/, "")
			.trim();
		if (stripped.length === 0) return false;

		return codePatterns.some((p) => p.test(stripped));
	}

	let blockStart = -1;
	let blockCount = 0;
	let inJsDoc = false;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? "").trim();

		// Track JSDoc blocks
		if (trimmed.startsWith("/**")) {
			inJsDoc = true;
			blockStart = -1;
			blockCount = 0;
			continue;
		}
		if (inJsDoc) {
			if (trimmed.includes("*/")) {
				inJsDoc = false;
			}
			continue;
		}

		// Single-line comment
		const isSingleLineComment = trimmed.startsWith("//");

		if (isSingleLineComment && looksLikeCode(trimmed)) {
			if (blockStart === -1) {
				blockStart = i;
				blockCount = 1;
			} else {
				blockCount++;
			}
		} else {
			// End of consecutive comment block
			if (blockCount >= 3) {
				findings.push({
					tool: "slop",
					file,
					line: blockStart + 1,
					message: `${blockCount} consecutive lines of commented-out code`,
					severity: "warning",
					ruleId: "slop/commented-code",
				});
			}
			blockStart = -1;
			blockCount = 0;
		}
	}

	// Check trailing block
	if (blockCount >= 3) {
		findings.push({
			tool: "slop",
			file,
			line: blockStart + 1,
			message: `${blockCount} consecutive lines of commented-out code`,
			severity: "warning",
			ruleId: "slop/commented-code",
		});
	}

	return findings;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────

/**
 * Run slop detection on the given files.
 *
 * Checks for: empty function bodies, hallucinated imports, console.log,
 * bare TODOs missing ticket references, and commented-out code blocks.
 *
 * Results are cached by file content hash when a CacheManager is provided.
 */
export async function detectSlop(
	files: string[],
	options?: {
		cache?: CacheManager;
		cwd?: string;
	},
): Promise<SlopResult> {
	const cwd = options?.cwd ?? process.cwd();
	const cache = options?.cache;

	const allFindings: Finding[] = [];
	let allCached = files.length > 0;

	for (const file of files) {
		const filePath = isAbsolute(file) ? file : resolve(cwd, file);
		let content: string;
		try {
			content = await Bun.file(filePath).text();
		} catch {
			// File doesn't exist or can't be read — skip
			allCached = false;
			continue;
		}

		const hash = hashContent(content);
		const key = cacheKey(hash);

		// Check cache
		if (cache) {
			const cached = cache.get(key);
			if (cached) {
				const cachedFindings: Finding[] = JSON.parse(cached.value);
				allFindings.push(...cachedFindings);
				continue;
			}
		}

		// Not cached — run all detectors
		allCached = false;
		const fileFindings: Finding[] = [
			...detectEmptyBodies(content, file),
			...detectHallucinatedImports(content, file, cwd),
			...detectConsoleLogs(content, file),
			...detectTodosWithoutTickets(content, file),
			...detectCommentedCode(content, file),
		];

		// Store in cache
		if (cache) {
			cache.set(key, JSON.stringify(fileFindings));
		}

		allFindings.push(...fileFindings);
	}

	return {
		findings: allFindings,
		cached: allCached,
	};
}
