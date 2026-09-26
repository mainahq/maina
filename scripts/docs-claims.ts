#!/usr/bin/env bun
/**
 * "No forbidden claims" lint (#359, FR-DOC-4).
 *
 * The docs may only promise what the code does. Four claims are checked,
 * outside fenced and inline code:
 *
 * - **deterministic**: maina's judgements come from rules, heuristics and
 *   (later) a model, each answer with a confidence. Say what is reproducible
 *   or rule-based instead.
 * - **cannot-hallucinate**: nothing here is promised never to be wrong.
 * - **no-telemetry**: "no telemetry" and the like must carry the qualifier
 *   the config makes true ("by default", "unless you turn it on"), and even
 *   that is flagged once any channel is on by default. The channels come
 *   from the generated facts module, so the lint follows the code.
 * - **ast**: "AST" (or "abstract syntax tree") only on a page `AST_EVIDENCE`
 *   vouches for, citing source that loads a tree-sitter grammar.
 *
 * Scanned: the docs content, the README and the landing page (#360): its
 * copy in `src/data/landing.ts`, its components in `src/components/home/`
 * and the page itself. Not scanned: the blog (dated posts), the changelog
 * and the roadmap (release history: what was said then), and the /cloud
 * page's copy.
 *
 *   bun scripts/docs-claims.ts    exit 1 and list every forbidden claim
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { facts } from "../packages/docs/src/data/facts";
import { prose } from "./docs-links";

const CONTENT = "packages/docs/src/content/docs";

/** The landing page: its copy, its components and the page (#360). */
const LANDING_DATA = "packages/docs/src/data/landing.ts";
const LANDING_COMPONENTS = "packages/docs/src/components/home";
const LANDING_PAGE = "packages/docs/src/pages/index.astro";

/** Content paths (relative to `CONTENT`) that record history, not claims. */
const HISTORY: readonly RegExp[] = [
	/^blog\//,
	/^changelog\.mdx?$/,
	/^roadmap\.mdx?$/,
];

// ── Rules ───────────────────────────────────────────────────────────────────

export type ClaimRule =
	| "deterministic"
	| "cannot-hallucinate"
	| "no-telemetry"
	| "ast";

export type ClaimContext = Readonly<{
	/** Telemetry channels that are on without an opt-in. */
	telemetryOnByDefault: readonly string[];
	/** The page is in `AST_EVIDENCE`. */
	astAllowed: boolean;
}>;

export type Claim = Readonly<{
	/** 1-based line in the file. */
	line: number;
	rule: ClaimRule;
	match: string;
	reason: string;
}>;

const REASONS: Readonly<Record<ClaimRule, string>> = {
	deterministic:
		"maina's answers come from rules, heuristics or a model, each with a confidence: say what is rule-based or reproducible instead",
	"cannot-hallucinate": "nothing maina runs is promised never to be wrong",
	"no-telemetry":
		"state telemetry the way the config has it (off by default, opt-in per channel)",
	ast: "no tree-sitter grammar backs an AST claim on this page: add it to AST_EVIDENCE with the source, or reword",
};

const DETERMINISTIC = /(?<!non-?)\bdeterministic(?:ally)?\b/gi;

const CANNOT_HALLUCINATE =
	/\b(?:can(?:no|['’])t|can not|never|won['’]?t|will not|doesn['’]?t|does not|don['’]?t|do not|unable to)\s+hallucinat\w*|\bhallucination[- ]free\b|\b(?:no|zero)\s+hallucinations?\b/gi;

/** Telemetry claims that need a qualifier after them. */
const NO_TELEMETRY =
	/\b(?:no|zero|without)\s+telemetry\b|\bnever\s+phones?\s+home\b|\bsends?\s+nothing\b|\bnothing\s+leaves\s+(?:your|the)\s+machine\b/gi;

/** Telemetry claims that carry their qualifier. */
const TELEMETRY_OFF_BY_DEFAULT =
	/\btelemetry\s+(?:is\s+)?off\s+by\s+default\b/gi;

/** What makes a "no telemetry" claim match an opt-in config. */
const QUALIFIER = /\b(?:by default|unless you|until you|opt[- ]in|you turn)\b/i;

const AST = /\bASTs?\b|\babstract syntax trees?\b/g;

/** `line` after `index`, up to the end of its sentence. */
function restOfSentence(line: string, index: number): string {
	const rest = line.slice(index);
	const end = /[.!?](?:\s|$)/.exec(rest);
	return end === null ? rest : rest.slice(0, end.index);
}

/** The line with inline code spans blanked: identifiers are not claims. */
const withoutInlineCode = (line: string): string =>
	line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));

function lineClaims(
	line: string,
	ctx: ClaimContext,
): { rule: ClaimRule; match: string; index: number }[] {
	const found: { rule: ClaimRule; match: string; index: number }[] = [];
	const add = (
		rule: ClaimRule,
		pattern: RegExp,
		keep = (_m: RegExpMatchArray) => true,
	) => {
		for (const m of line.matchAll(pattern)) {
			if (keep(m)) found.push({ rule, match: m[0], index: m.index ?? 0 });
		}
	};
	const telemetryOn = ctx.telemetryOnByDefault.length > 0;
	add("deterministic", DETERMINISTIC);
	add("cannot-hallucinate", CANNOT_HALLUCINATE);
	add(
		"no-telemetry",
		NO_TELEMETRY,
		(m) => telemetryOn || !QUALIFIER.test(restOfSentence(line, m.index ?? 0)),
	);
	add("no-telemetry", TELEMETRY_OFF_BY_DEFAULT, () => telemetryOn);
	if (!ctx.astAllowed) add("ast", AST);
	return found.sort((a, b) => a.index - b.index);
}

/** Every forbidden claim in `text`, in line order, outside code. */
export function findClaims(text: string, ctx: ClaimContext): Claim[] {
	return prose(text).flatMap(({ line, text: row }) =>
		lineClaims(withoutInlineCode(row), ctx).map(({ rule, match }) => ({
			line,
			rule,
			match,
			reason: REASONS[rule],
		})),
	);
}

// ── AST evidence ────────────────────────────────────────────────────────────

/**
 * Pages (repo-relative) that may say "AST", and the source that makes it
 * true: each file must load a tree-sitter grammar.
 */
export const AST_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
	"README.md": ["packages/core/src/graph/parse/index.ts"],
	[`${CONTENT}/engines/context.mdx`]: [
		"packages/core/src/graph/parse/index.ts",
	],
};

/** An import whose module specifier names tree-sitter. */
const TREE_SITTER_IMPORT = /\bfrom\s+["'][^"']*tree-sitter[^"']*["']/;

/** Why each cited source does not back its page, as `page: problem`. */
export function astEvidenceProblems(
	root: string,
	evidence: Readonly<Record<string, readonly string[]>> = AST_EVIDENCE,
): string[] {
	return Object.entries(evidence).flatMap(([page, sources]) =>
		sources.flatMap((source) => {
			const full = join(root, source);
			if (!existsSync(full)) return [`${page}: ${source} does not exist`];
			return TREE_SITTER_IMPORT.test(readFileSync(full, "utf-8"))
				? []
				: [`${page}: ${source} does not load a tree-sitter grammar`];
		}),
	);
}

// ── Check ───────────────────────────────────────────────────────────────────

export type ClaimFinding = Readonly<{ file: string } & Claim>;

const posix = (path: string): string => path.split(sep).join("/");

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}

/** Files the lint reads, repo-relative. */
export function scannedFiles(root: string): string[] {
	const content = walk(join(root, CONTENT))
		.map((full) => posix(relative(join(root, CONTENT), full)))
		.filter((rel) => /\.mdx?$/.test(rel))
		.filter((rel) => !HISTORY.some((pattern) => pattern.test(rel)))
		.map((rel) => `${CONTENT}/${rel}`)
		.sort();
	const landing = walk(join(root, LANDING_COMPONENTS))
		.map((full) => posix(relative(root, full)))
		.filter((rel) => rel.endsWith(".astro"))
		.sort();
	return [
		"README.md",
		...content,
		LANDING_DATA,
		LANDING_PAGE,
		...landing,
	].filter((rel) => existsSync(join(root, rel)));
}

/**
 * Every forbidden claim under `root`, in file then line order, plus a
 * finding for each `AST_EVIDENCE` source that does not back its page.
 */
export function checkDocsClaims(
	root: string,
	telemetryOnByDefault: readonly string[] = facts.telemetry.onByDefault,
): ClaimFinding[] {
	const evidence: ClaimFinding[] = astEvidenceProblems(root).map((problem) => ({
		file: "scripts/docs-claims.ts",
		line: 0,
		rule: "ast",
		match: "AST_EVIDENCE",
		reason: problem,
	}));
	const claims = scannedFiles(root).flatMap((file) =>
		findClaims(readFileSync(join(root, file), "utf-8"), {
			telemetryOnByDefault,
			astAllowed: file in AST_EVIDENCE,
		}).map((claim) => ({ file, ...claim })),
	);
	return [...evidence, ...claims];
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const found = checkDocsClaims(root);
	if (found.length === 0) {
		process.stdout.write("docs-claims: OK: no forbidden claims.\n");
		process.exit(0);
	}
	process.stderr.write("docs-claims: FAIL\n");
	for (const f of found) {
		process.stderr.write(
			`  ${f.file}:${f.line}: "${f.match}" [${f.rule}] ${f.reason}\n`,
		);
	}
	process.exit(1);
}
