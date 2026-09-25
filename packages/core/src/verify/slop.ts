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
import { decideEach, defaultDecidePorts } from "../decide/decide";
import type { LanguageProfile } from "../language/profile";
import { isCodeFile, TYPESCRIPT_PROFILE } from "../language/profile";
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

// Bump this when detection logic changes to invalidate stale cache entries
const SLOP_CACHE_VERSION = 3; // v3: data/docs files skipped (#372)

function cacheKey(fileHash: string): string {
	return `slop:v${SLOP_CACHE_VERSION}:${fileHash}`;
}

/**
 * A line the scanner flagged for a rule. Whether it really is slop is a
 * `slop` decision over the candidate's observations.
 */
interface Candidate {
	/** What the heuristic reads: line text, resolution, block length... */
	trusted?: Readonly<Record<string, unknown>>;
	untrusted?: Readonly<Record<string, unknown>>;
	/** The finding raised when the decision says slop. */
	finding: Finding;
}

/**
 * Ask `decide` (`slop`, question `<rule>:<i>`) about every candidate and
 * return the findings of those it judges slop, in candidate order.
 */
function judgeCandidates(
	rule: SlopRule,
	candidates: readonly Candidate[],
): Finding[] {
	const slop = decideEach(defaultDecidePorts, {
		type: "slop",
		check: rule,
		trusted: candidates.map((c) => c.trusted ?? {}),
		untrusted: candidates.map((c) => c.untrusted ?? {}),
	});
	return candidates.filter((_, i) => slop[i]).map((c) => c.finding);
}

// ─── Individual Detectors ─────────────────────────────────────────────────

/**
 * Detect empty function/method/arrow bodies.
 *
 * Looks for patterns like `function name() { }`, `() => { }`, `method() { }`.
 * Does NOT flag bodies that contain comments.
 * Does NOT flag object literals or array literals.
 */
export function detectEmptyBodies(
	content: string,
	file: string,
	profile?: LanguageProfile,
): Finding[] {
	const lang = profile ?? TYPESCRIPT_PROFILE;
	// Skip test files — mocks/stubs intentionally use empty bodies
	if (lang.testFilePattern.test(file)) {
		return [];
	}

	const lines = content.split("\n");
	const candidates: Candidate[] = [];

	// Candidates: empty braces on one line, or an opening brace whose next
	// line is a lone closing brace. The heuristic decides which are function,
	// method or arrow bodies rather than literals, types, strings or regexes.
	for (let i = 0; i < lines.length; i++) {
		const trimmed = (lines[i] ?? "").trim();
		const next = lines[i + 1]?.trim() ?? "";
		if (!/\{\s*\}/.test(trimmed) && !(trimmed.endsWith("{") && next === "}")) {
			continue;
		}
		candidates.push({
			untrusted: { text: trimmed, next },
			finding: {
				tool: "slop",
				file,
				line: i + 1,
				message: "Empty function/method body detected",
				severity: "warning",
				ruleId: "slop/empty-body",
			},
		});
	}

	return judgeCandidates("empty-body", candidates);
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
	profile?: LanguageProfile,
): Finding[] {
	const lang = profile ?? TYPESCRIPT_PROFILE;
	// Skip test files and non-code files — code snippets held in .md, .json,
	// .yml etc. trigger false positives (#372)
	if (lang.testFilePattern.test(file) || !isCodeFile(file)) {
		return [];
	}

	const candidates: Candidate[] = [];
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
		const paths = [
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

		const resolved = paths.some((path) => existsSync(path));

		candidates.push({
			trusted: { resolved },
			untrusted: { importPath },
			finding: {
				tool: "slop",
				file,
				line: i + 1,
				message: `Import "${importPath}" does not resolve to an existing file`,
				severity: "error",
				ruleId: "slop/hallucinated-import",
			},
		});
	}

	return judgeCandidates("hallucinated-import", candidates);
}

/**
 * Detect console.log/warn/error/debug/info in production code.
 *
 * Skips test files (*.test.ts, *.spec.ts).
 * Accepts an optional LanguageProfile for language-specific patterns.
 * Defaults to TYPESCRIPT_PROFILE for backward compatibility.
 */
export function detectConsoleLogs(
	content: string,
	file: string,
	profile?: LanguageProfile,
): Finding[] {
	const lang = profile ?? TYPESCRIPT_PROFILE;

	// Skip test files using language-specific pattern
	if (lang.testFilePattern.test(file)) {
		return [];
	}

	const candidates: Candidate[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = lang.printPattern.exec(line);
		if (!match) continue;
		// A lint-ignore directive on the preceding line excuses the statement
		const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
		candidates.push({
			trusted: { lintIgnored: lang.lintIgnorePattern.test(prevLine) },
			untrusted: { text: line },
			finding: {
				tool: "slop",
				file,
				line: i + 1,
				column: (match.index ?? 0) + 1,
				message: "Print/log statement found in production code",
				severity: "warning",
				ruleId: "slop/console-log",
			},
		});
	}

	return judgeCandidates("console-log", candidates);
}

/**
 * Detect TODO/FIXME comments without a ticket reference.
 *
 * A ticket reference is a pattern like #123, PROJ-123, or [#123].
 */
export function detectTodosWithoutTickets(
	content: string,
	file: string,
	profile?: LanguageProfile,
): Finding[] {
	const lang = profile ?? TYPESCRIPT_PROFILE;
	// Skip test files — fixtures legitimately contain TODO patterns as test data
	if (lang.testFilePattern.test(file)) {
		return [];
	}

	const candidates: Candidate[] = [];
	const lines = content.split("\n");

	// Match TODO or FIXME in comments (case-sensitive — these are always
	// uppercase). Whether the line carries a ticket reference is decided.
	const todoPattern = /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!todoPattern.test(line)) continue;
		candidates.push({
			untrusted: { text: line },
			finding: {
				tool: "slop",
				file,
				line: i + 1,
				message: "TODO/FIXME without ticket reference",
				severity: "info",
				ruleId: "slop/todo-without-ticket",
			},
		});
	}

	return judgeCandidates("todo-without-ticket", candidates);
}

/** A bare natural-language word, optionally wrapped in `(`/`)` or trailing punctuation. */
const PROSE_WORD = /^\(?[A-Za-z][A-Za-z'’-]*[.,:;!?]?\)?[.,:;!?]?$/;
/** Consecutive prose words that mark a comment line as a sentence. */
const PROSE_RUN = 4;
/**
 * Lowercase JS/TS keywords. They are skipped when counting a prose run
 * (neither extending nor breaking it), so keyword-dense code such as
 * `for (const item of items)` or `bar as unknown as Baz` is not mistaken
 * for a sentence, while prose that merely contains "if"/"return" still is.
 */
const CODE_KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"for",
	"from",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"keyof",
	"let",
	"new",
	"of",
	"return",
	"satisfies",
	"switch",
	"throw",
	"try",
	"type",
	"typeof",
	"unknown",
	"var",
	"void",
	"while",
	"yield",
]);

/**
 * True when a comment line (prefix already stripped) reads as a sentence
 * rather than code. Prose explanations routinely contain parentheses,
 * backtick code spans, quotes and keywords like "if"/"return", which the
 * code patterns would otherwise match (#394).
 *
 * A line ending in a statement/block terminator is never prose. Otherwise
 * inline code spans and double-quoted strings are dropped, and a run of
 * `PROSE_RUN` plain non-keyword words in a row marks the line as prose: real
 * code rarely has four bare identifiers separated only by spaces and
 * keywords.
 */
function looksLikeProse(stripped: string): boolean {
	if (/(?:[;{}]|=>)\s*$/.test(stripped)) return false;
	const withoutSpans = stripped
		.replace(/`[^`]*`/g, " ")
		.replace(/"[^"]*"/g, " ");
	let run = 0;
	for (const token of withoutSpans.split(/\s+/)) {
		if (!PROSE_WORD.test(token)) {
			run = 0;
			continue;
		}
		if (CODE_KEYWORDS.has(token.replace(/[^A-Za-z]/g, ""))) continue;
		run++;
		if (run >= PROSE_RUN) return true;
	}
	return false;
}

/**
 * Detect commented-out code blocks (3+ consecutive comment lines with code patterns).
 *
 * Distinguishes code comments from documentation comments by looking for
 * code-like patterns: keywords, semicolons, brackets, import/export, assignments.
 *
 * JSDoc-style comments (starting with /**) are treated as documentation and skipped.
 */
export function detectCommentedCode(
	content: string,
	file: string,
	profile?: LanguageProfile,
): Finding[] {
	const lang = profile ?? TYPESCRIPT_PROFILE;
	// Skip test files — fixtures contain intentional commented-out code as test data
	if (lang.testFilePattern.test(file)) {
		return [];
	}

	const candidates: Candidate[] = [];
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
		if (looksLikeProse(stripped)) return false;

		return codePatterns.some((p) => p.test(stripped));
	}

	const block = (start: number, count: number): Candidate => ({
		trusted: { blockLines: count },
		finding: {
			tool: "slop",
			file,
			line: start + 1,
			message: `${count} consecutive lines of commented-out code`,
			severity: "warning",
			ruleId: "slop/commented-code",
		},
	});

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
			if (blockCount > 0) candidates.push(block(blockStart, blockCount));
			blockStart = -1;
			blockCount = 0;
		}
	}

	// Trailing block
	if (blockCount > 0) candidates.push(block(blockStart, blockCount));

	// How many consecutive lines make commented-out code is decided.
	return judgeCandidates("commented-code", candidates);
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
	options: {
		cache?: CacheManager;
		/** Repository root relative paths resolve against (explicit). */
		cwd: string;
	},
): Promise<SlopResult> {
	const cwd = options.cwd;
	const cache = options.cache;

	// Slop patterns are code patterns: data/docs files (.json, .yml, .md, …)
	// are skipped so snippets stored in their strings aren't misread (#372)
	const codeFiles = files.filter(isCodeFile);

	const allFindings: Finding[] = [];
	let allCached = codeFiles.length > 0;

	for (const file of codeFiles) {
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
