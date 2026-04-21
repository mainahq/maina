/**
 * "Tree-sitter" pattern sampler.
 *
 * The name is retained for forward compatibility with the feature plan, but
 * the implementation is a regex-based sampler that walks up to 100 files per
 * language and scores coarse patterns. Swapping to a real tree-sitter parser
 * later is a drop-in replacement — the public signature stays
 * `(cwd) => Result<Rule[], string>`.
 *
 * Patterns:
 *   - TypeScript / JavaScript: `Result<`, `async function`, `.test.ts`
 *     sibling files, `console.log` in non-test files.
 *   - Python: `async def`, type-annotated signatures.
 *   - Go: `if err != nil` pattern.
 *   - Rust: `.unwrap()` prevalence in non-test code.
 */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { Result } from "../../db/index";
import type { Rule, RuleCategory, RuleSourceKind } from "../adopt";

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	".cache",
	"coverage",
	".maina",
	".venv",
	"venv",
	"__pycache__",
	"target",
]);

const MAX_FILES_PER_LANG = 100;

type LangId = "ts" | "js" | "py" | "go" | "rust";

interface LangGroup {
	lang: LangId;
	exts: string[];
	cwd: string;
	files: string[]; // relative paths
}

export async function scanTreeSitter(
	cwd: string,
): Promise<Result<Rule[], string>> {
	try {
		const groups: LangGroup[] = [
			{ lang: "ts", exts: [".ts", ".tsx"], cwd, files: [] },
			{ lang: "js", exts: [".js", ".jsx", ".mjs", ".cjs"], cwd, files: [] },
			{ lang: "py", exts: [".py"], cwd, files: [] },
			{ lang: "go", exts: [".go"], cwd, files: [] },
			{ lang: "rust", exts: [".rs"], cwd, files: [] },
		];

		walk(cwd, cwd, groups);

		const out: Rule[] = [];
		for (const group of groups) {
			if (group.files.length === 0) continue;
			out.push(...analyseGroup(group));
		}
		return { ok: true, value: out };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ── Walk ─────────────────────────────────────────────────────────────────────

function walk(root: string, dir: string, groups: LangGroup[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (IGNORED_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		// `lstatSync` does not follow symlinks — prevents the sampler from
		// escaping `root` through a symlinked directory.
		let st: ReturnType<typeof lstatSync>;
		try {
			st = lstatSync(full);
		} catch {
			continue;
		}
		if (st.isSymbolicLink()) continue;
		if (st.isDirectory()) {
			walk(root, full, groups);
			continue;
		}
		if (!st.isFile()) continue;
		const ext = extname(entry).toLowerCase();
		for (const g of groups) {
			if (g.files.length >= MAX_FILES_PER_LANG) continue;
			if (g.exts.includes(ext)) {
				g.files.push(relative(root, full).split(sep).join("/"));
				break;
			}
		}
	}
}

// ── Per-language analysis ────────────────────────────────────────────────────

function analyseGroup(group: LangGroup): Rule[] {
	const counts = {
		resultPattern: 0,
		asyncFn: 0,
		testFiles: 0,
		consoleInNonTest: 0,
		unwrap: 0,
		errNilCheck: 0,
		typedFn: 0,
	};

	for (const rel of group.files) {
		const content = safeRead(join(group.cwd, rel));
		if (content === null) continue;
		const isTest =
			/\.(test|spec)\.[jt]sx?$|_test\.py$|_test\.go$|(^|\/)tests?\//.test(rel);

		if (group.lang === "ts" || group.lang === "js") {
			if (/Result<[^>]+,/.test(content)) counts.resultPattern += 1;
			if (/\basync\s+function\b|\basync\s+\(/.test(content))
				counts.asyncFn += 1;
			if (isTest) counts.testFiles += 1;
			if (!isTest && /^\s*console\.(log|debug)\s*\(/m.test(content))
				counts.consoleInNonTest += 1;
		}
		if (group.lang === "py") {
			if (/\basync\s+def\b/.test(content)) counts.asyncFn += 1;
			if (/def\s+\w+\s*\([^)]*:\s*\w+/.test(content)) counts.typedFn += 1;
			if (isTest) counts.testFiles += 1;
		}
		if (group.lang === "go") {
			if (/if\s+err\s*!=\s*nil\s*\{/.test(content)) counts.errNilCheck += 1;
			if (isTest) counts.testFiles += 1;
		}
		if (group.lang === "rust") {
			if (!isTest && /\.unwrap\(\)/.test(content)) counts.unwrap += 1;
			if (/Result<[^>]+>/.test(content)) counts.resultPattern += 1;
			if (/#\[test\]/.test(content)) counts.testFiles += 1;
		}
	}

	const total = group.files.length;
	const rules: Rule[] = [];

	if (group.lang === "ts" || group.lang === "js") {
		if (counts.resultPattern / total >= 0.05) {
			rules.push(
				mkRule(
					"Error handling uses `Result<T, E>` — prefer typed error returns over exceptions.",
					group.lang,
					0.6,
					"error-handling",
				),
			);
		}
		if (counts.asyncFn / total >= 0.2) {
			rules.push(
				mkRule(
					"Async functions are common — use async/await consistently and never swallow rejections.",
					group.lang,
					0.5,
					"architecture",
				),
			);
		}
		if (counts.testFiles > 0) {
			rules.push(
				mkRule(
					"Tests live next to source as `*.test.ts` / `*.spec.ts` files.",
					group.lang,
					0.6,
					"testing",
				),
			);
		}
		if (counts.consoleInNonTest === 0 && total >= 5) {
			rules.push(
				mkRule(
					"No `console.log` in production code — keep stdout clean.",
					group.lang,
					0.5,
					"style",
				),
			);
		}
	}
	if (group.lang === "py" && counts.typedFn / total >= 0.2) {
		rules.push(
			mkRule(
				"Add type hints to new Python functions — the project uses typed signatures.",
				"py",
				0.5,
				"style",
			),
		);
	}
	if (group.lang === "go" && counts.errNilCheck > 0) {
		rules.push(
			mkRule(
				"Always check `if err != nil` after fallible calls — do not ignore errors.",
				"go",
				0.6,
				"error-handling",
			),
		);
	}
	if (group.lang === "rust" && counts.unwrap / total > 0.1) {
		rules.push(
			mkRule(
				"Avoid `.unwrap()` in library code — return `Result` and bubble errors.",
				"rust",
				0.6,
				"error-handling",
			),
		);
	}

	return rules;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeRead(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function mkRule(
	text: string,
	lang: LangId,
	confidence: number,
	category: RuleCategory,
): Rule {
	const sourceKind: RuleSourceKind = "tree-sitter";
	return {
		text,
		source: `tree-sitter:${lang}`,
		sourceKind,
		confidence,
		category,
	};
}
