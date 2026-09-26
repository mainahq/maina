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
const SLOP_CACHE_VERSION = 4; // v4: imports in comments/strings skipped (#399)

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

/** Lexer state carried from one line to the next. */
type LexState = "code" | "block" | "template";

interface LexedLine {
	/** The line with comments blanked to spaces; columns are preserved. */
	code: string;
	/** `code` with string and template contents blanked too; quotes stay. */
	masked: string;
	state: LexState;
}

/** Keywords after which a `/` starts a regex literal, not a division. */
const REGEX_AFTER_WORD =
	/(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Whether a `/` that follows `before` (the line's code so far) opens a
 * regex literal: at line start, after an operator or opening bracket, after
 * `=>`, or after a keyword such as `return`. After an operand it divides.
 */
function slashStartsRegex(before: string): boolean {
	const prev = before.trimEnd();
	if (prev === "") return true;
	if (prev.endsWith("=>")) return true;
	if ("(,=:[!&|?{};".includes(prev[prev.length - 1] ?? "")) return true;
	return REGEX_AFTER_WORD.test(prev);
}

/**
 * The index just past the closing `/` of a regex literal whose opening `/`
 * is at `start`, or -1 when the line ends first (then it is a division).
 */
function regexLiteralEnd(line: string, start: number): number {
	let inClass = false;
	for (let i = start + 1; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\") i++;
		else if (ch === "[") inClass = true;
		else if (ch === "]") inClass = false;
		else if (ch === "/" && !inClass) return i + 1;
	}
	return -1;
}

/**
 * Blank out comments (and, in `masked`, string and regex contents) on one
 * line so import-like text in JSDoc, `//` notes or literals is not read as
 * code (#399). Block comments and template literals carry across lines;
 * `'`/`"` strings and regex literals end at the line break. Regex literals
 * are skipped whole so a quote, backtick or `/*` inside one cannot flip the
 * lexer into another state and hide the real imports after it. Backticks
 * nested in `${…}` are not modelled; they are rare and balance out on a line.
 */
function lexLine(line: string, start: LexState): LexedLine {
	let code = "";
	let masked = "";
	let state: LexState | "'" | '"' = start;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] ?? "";
		const next = line[i + 1] ?? "";
		if (state === "block") {
			if (ch === "*" && next === "/") {
				state = "code";
				i++;
				code += "  ";
				masked += "  ";
			} else {
				code += " ";
				masked += " ";
			}
			continue;
		}
		if (state === "code") {
			if (ch === "/" && next === "/") break;
			if (ch === "/" && next === "*") {
				state = "block";
				i++;
				code += "  ";
				masked += "  ";
				continue;
			}
			if (ch === "/" && slashStartsRegex(code)) {
				const end = regexLiteralEnd(line, i);
				if (end !== -1) {
					const body = line.slice(i, end);
					code += body;
					masked += `/${" ".repeat(body.length - 2)}/`;
					i = end - 1;
					continue;
				}
			}
			if (ch === "`") state = "template";
			else if (ch === "'" || ch === '"') state = ch;
			code += ch;
			masked += ch;
			continue;
		}
		// Inside a string or template literal
		const close = state === "template" ? "`" : state;
		if (ch === "\\" && next) {
			i++;
			code += ch + next;
			masked += "  ";
		} else if (ch === close) {
			state = "code";
			code += ch;
			masked += ch;
		} else {
			code += ch;
			masked += " ";
		}
	}
	const carried: LexState =
		state === "block" || state === "template" ? state : "code";
	return { code, masked, state: carried };
}

/**
 * Import forms matched against the masked line, each ending at the opening
 * quote of the specifier: `import … from`/`export … from` and side-effect
 * `import` at statement position, and `require(` anywhere in code.
 */
const IMPORT_PREFIXES: readonly RegExp[] = [
	/^\s*(?:import|export)\s[^'"`]*?\bfrom\s*['"]/,
	/^\s*import\s*['"]/,
	/\brequire\s*\(\s*['"]/,
];

/** The relative specifier a line imports, or null when it imports none. */
function findImportPath(lexed: LexedLine): string | null {
	for (const prefix of IMPORT_PREFIXES) {
		const match = prefix.exec(lexed.masked);
		if (!match) continue;
		const quoteAt = match.index + match[0].length - 1;
		const quote = lexed.code[quoteAt] ?? "";
		const end = lexed.code.indexOf(quote, quoteAt + 1);
		if (end === -1) return null;
		const specifier = lexed.code.slice(quoteAt + 1, end);
		return specifier.startsWith(".") ? specifier : null;
	}
	return null;
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

	let state: LexState = "code";
	for (let i = 0; i < lines.length; i++) {
		const lexed = lexLine(lines[i] ?? "", state);
		state = lexed.state;
		const importPath = findImportPath(lexed);
		// Null for non-relative specifiers (react, node:path) too
		if (!importPath) continue;

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
