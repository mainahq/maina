/**
 * Setup — Adopt existing rule files.
 *
 * Deterministic, read-only. Walks a repo looking for every agent-instruction
 * / house-rules file the user has already authored (AGENTS.md, CLAUDE.md,
 * .cursorrules, .cursor/rules/*.mdc, .windsurfrules, .windsurf/rules/*,
 * .github/copilot-instructions.md, CONTRIBUTING.md, CONTEXT.md) and extracts
 * them as `Rule[]` with confidence 1.0 (explicit user intent).
 *
 * Never calls an LLM. Never calls the network. Safe to run on untrusted
 * repos — no file path is resolved outside `cwd`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Result } from "../db/index";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Origin of a rule. `RuleSourceKind` is the canonical label used in provenance
 * comments; the `source` field on each `Rule` embeds the file path + line
 * range for traceability.
 */
export type RuleSourceKind =
	| "AGENTS.md"
	| "CLAUDE.md"
	| ".cursorrules"
	| ".cursor/rules"
	| ".windsurfrules"
	| ".windsurf/rules"
	| ".github/copilot-instructions.md"
	| "CONTRIBUTING.md"
	| "CONTEXT.md"
	| "biome.json"
	| ".eslintrc"
	| "ruff.toml"
	| ".prettierrc"
	| "tsconfig.json"
	| "pyproject.toml"
	| "Cargo.toml"
	| "go.mod"
	| "git-log"
	| "tree-sitter"
	| "workflows";

export type RuleCategory =
	| "style"
	| "testing"
	| "error-handling"
	| "commits"
	| "review"
	| "ci"
	| "architecture"
	| "security"
	| "misc";

export interface Rule {
	/** Single-sentence rule text, no markdown formatting, no leading bullet. */
	text: string;
	/** Human-readable source locator, e.g. `AGENTS.md:L12-L18`. */
	source: string;
	/** Canonical source kind used in dedupe + provenance comments. */
	sourceKind: RuleSourceKind;
	/** 0.0–1.0. Adopted rules are always 1.0. */
	confidence: number;
	/** Best-effort category inferred from the nearest heading above. */
	category: RuleCategory;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Order matters: earlier entries "win" on duplicate-text dedupe. */
const TOP_LEVEL_FILES: { path: string; kind: RuleSourceKind }[] = [
	{ path: "AGENTS.md", kind: "AGENTS.md" },
	{ path: "CLAUDE.md", kind: "CLAUDE.md" },
	{ path: ".cursorrules", kind: ".cursorrules" },
	{ path: ".windsurfrules", kind: ".windsurfrules" },
	{
		path: ".github/copilot-instructions.md",
		kind: ".github/copilot-instructions.md",
	},
	{ path: "CONTRIBUTING.md", kind: "CONTRIBUTING.md" },
	{ path: "CONTEXT.md", kind: "CONTEXT.md" },
];

/** Directory-expanded sources: every matching file under the directory is scanned. */
const DIRECTORY_SOURCES: {
	dir: string;
	suffixes: string[];
	kind: RuleSourceKind;
}[] = [
	{ dir: ".cursor/rules", suffixes: [".mdc", ".md"], kind: ".cursor/rules" },
	{
		dir: ".windsurf/rules",
		suffixes: [".md", ".mdc"],
		kind: ".windsurf/rules",
	},
];

const MAX_RULE_TEXT_LEN = 300;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Walk `cwd` and return every adopted rule. Order: top-level files first
 * (stable order — see `TOP_LEVEL_FILES`), then directory-sourced files sorted
 * by relative path.
 *
 * Duplicate-text rules are collapsed to a single entry — the earliest scanned
 * file wins (preserving the ordering in `TOP_LEVEL_FILES`).
 */
export async function adoptRules(cwd: string): Promise<Result<Rule[], string>> {
	if (!existsSync(cwd)) {
		return { ok: false, error: `Path does not exist: ${cwd}` };
	}
	try {
		const rules: Rule[] = [];

		for (const entry of TOP_LEVEL_FILES) {
			const full = join(cwd, entry.path);
			if (!existsSync(full)) continue;
			const text = safeRead(full);
			if (text === null) continue;
			rules.push(...extractRulesFromText(text, entry.path, entry.kind));
		}

		for (const dirSource of DIRECTORY_SOURCES) {
			const dirFull = join(cwd, dirSource.dir);
			if (!existsSync(dirFull)) continue;
			for (const file of walkFiles(dirFull, dirSource.suffixes, cwd)) {
				const text = safeRead(file.full);
				if (text === null) continue;
				rules.push(...extractRulesFromText(text, file.rel, dirSource.kind));
			}
		}

		return { ok: true, value: dedupeByText(rules) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Render the HTML-comment provenance marker attached to each adopted rule
 * when it lands in `constitution.md`.
 */
export function formatProvenanceComment(rule: Rule): string {
	const confidence = Number.isInteger(rule.confidence)
		? `${rule.confidence}.0`
		: rule.confidence.toString();
	return `<!-- source: ${rule.source}, confidence: ${confidence} -->`;
}

/**
 * Extract the list of rule files that exist in `cwd`. Used by
 * `context.summarizeRepo()` to flag adopted inputs.
 */
export function detectExistingRuleFiles(cwd: string): string[] {
	const found: string[] = [];
	for (const entry of TOP_LEVEL_FILES) {
		if (existsSync(join(cwd, entry.path))) found.push(entry.path);
	}
	for (const dirSource of DIRECTORY_SOURCES) {
		const dirFull = join(cwd, dirSource.dir);
		if (!existsSync(dirFull)) continue;
		for (const f of walkFiles(dirFull, dirSource.suffixes, cwd)) {
			found.push(f.rel);
		}
	}
	return found;
}

// ── Internals ────────────────────────────────────────────────────────────────

function safeRead(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

interface WalkedFile {
	full: string;
	rel: string;
}

function walkFiles(dir: string, suffixes: string[], cwd: string): WalkedFile[] {
	const out: WalkedFile[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries.sort()) {
		const full = join(dir, entry);
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			out.push(...walkFiles(full, suffixes, cwd));
			continue;
		}
		if (!st.isFile()) continue;
		if (!suffixes.some((s) => entry.endsWith(s))) continue;
		out.push({ full, rel: relative(cwd, full).split(sep).join("/") });
	}
	return out;
}

/**
 * Extract candidate rule sentences from a markdown or prose file.
 *
 * A "rule" is a bullet line (`-` or `*` or `1.`) or an imperative-looking
 * sentence at the start of a line. We also track the nearest H2 heading
 * above the rule to infer a category.
 */
function extractRulesFromText(
	content: string,
	relPath: string,
	kind: RuleSourceKind,
): Rule[] {
	const lines = content.split("\n");
	const rules: Rule[] = [];
	let currentHeading: string | null = null;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();

		// Track current H2/H3 heading for category inference.
		const headingMatch = /^#{1,3}\s+(.+?)\s*$/.exec(trimmed);
		if (headingMatch) {
			currentHeading = headingMatch[1] ?? null;
			i += 1;
			continue;
		}

		const bulletMatch = /^[-*]\s+(\S.*)$/.exec(trimmed);
		const numberedMatch = /^\d+\.\s+(\S.*)$/.exec(trimmed);

		if (bulletMatch || numberedMatch) {
			// Gather continuation lines: indented lines that follow.
			const firstLine = (bulletMatch ?? numberedMatch) as RegExpExecArray;
			let body = firstLine[1] ?? "";
			const startLine = i + 1; // 1-based
			let endLine = startLine;
			let j = i + 1;
			while (j < lines.length) {
				const next = lines[j] ?? "";
				if (next.trim().length === 0) break;
				// Continuation if the raw line starts with whitespace.
				if (/^\s+\S/.test(next) && !/^[-*]\s+/.test(next.trim())) {
					body += ` ${next.trim()}`;
					endLine = j + 1;
					j += 1;
					continue;
				}
				break;
			}

			const text = normaliseText(stripInlineMarkdown(body));
			if (text.length > 0) {
				const source =
					startLine === endLine
						? `${relPath}:L${startLine}`
						: `${relPath}:L${startLine}-L${endLine}`;
				rules.push({
					text: truncate(text, MAX_RULE_TEXT_LEN),
					source,
					sourceKind: kind,
					confidence: text.length > MAX_RULE_TEXT_LEN ? 0.8 : 1.0,
					category: categoryFor(currentHeading, text),
				});
			}
			i = j;
			continue;
		}

		i += 1;
	}
	return rules;
}

function stripInlineMarkdown(s: string): string {
	return s
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function normaliseText(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return `${s.slice(0, n - 1).trimEnd()}…`;
}

const CATEGORY_KEYWORDS: { kw: RegExp; cat: RuleCategory }[] = [
	{ kw: /commit|conventional/i, cat: "commits" },
	{ kw: /test|tdd|spec|coverage|pytest|bun:test|jest|vitest/i, cat: "testing" },
	{ kw: /error|exception|panic|throw|result<|unwrap/i, cat: "error-handling" },
	{ kw: /review|pr|pull request/i, cat: "review" },
	{ kw: /ci\b|workflow|lint|biome|eslint|prettier|format/i, cat: "ci" },
	{
		kw: /security|secret|credential|token|password|sanitise|sanitize/i,
		cat: "security",
	},
	{ kw: /architecture|module|layer|package|boundary/i, cat: "architecture" },
	{ kw: /style|naming|case|import|file name|kebab|camel/i, cat: "style" },
];

function categoryFor(heading: string | null, text: string): RuleCategory {
	const target = `${heading ?? ""} ${text}`;
	for (const { kw, cat } of CATEGORY_KEYWORDS) {
		if (kw.test(target)) return cat;
	}
	return "misc";
}

/**
 * Collapse rules with identical normalised text to a single entry. The
 * earliest-scanned rule wins (matches `TOP_LEVEL_FILES` order).
 */
function dedupeByText(rules: Rule[]): Rule[] {
	const seen = new Map<string, Rule>();
	for (const r of rules) {
		const key = r.text
			.toLowerCase()
			.replace(/[.!?]+$/u, "")
			.trim();
		if (!seen.has(key)) seen.set(key, r);
	}
	return [...seen.values()];
}
