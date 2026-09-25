#!/usr/bin/env bun

/**
 * Golden capture — records `{ site, input, output }` fixtures for every
 * heuristic decision site (v1 plan task 0.2, FR-DEC-6).
 *
 *   bun scripts/golden-capture.ts             # recompute outputs, keep inputs
 *   bun scripts/golden-capture.ts --resample  # re-collect inputs from the repo
 *
 * Default mode keeps each fixture's recorded inputs and only re-runs the
 * current code, so an intentional behaviour change shows up as an
 * output-only diff. `--resample` rebuilds the inputs from `examples/`, the
 * Maina repo (`.maina/features`, `.maina/wiki`, git history, source files)
 * and `scripts/golden-corpus/`. Capture itself uses git and the filesystem;
 * replay (`decisions.test.ts`) needs neither clock, network nor AI.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
	type AnalyzerInput,
	type CategoryInput,
	type ChecklistInput,
	type CodeQualityInput,
	type FalsePositiveInput,
	fixtureFileName,
	GOLDEN_SITES,
	type GoldenCase,
	type GoldenFixtureFile,
	type GoldenSite,
	MIN_CASES_PER_SITE,
	type QualityInput,
	type RelevanceInput,
	type ReviewerKindInput,
	runSite,
	type SlopInput,
	type SpecComplianceInput,
	type TiersInput,
	type ValidateInput,
	type WikiInput,
} from "../packages/core/src/__golden__/sites";

const ROOT = resolve(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "packages/core/src/__golden__/decisions");
const FEATURES_DIR = join(ROOT, ".maina/features");
const WIKI_DIR = join(ROOT, ".maina/wiki");
const CORPUS = join(ROOT, "scripts/golden-corpus/review-comments.json");

/** Target number of inputs per site (issue floor is MIN_CASES_PER_SITE). */
const TARGET = 30;
const MAX_DOC = 8_000;
const MAX_DIFF = 6_000;
const MAX_SOURCE = 10_000;
const MAX_ARTICLE = 1_000;

// ── Small helpers ───────────────────────────────────────────────────────────

/** Truncate at the last newline before `max` so inputs stay line-aligned. */
function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.lastIndexOf("\n", max);
	return text.slice(0, cut > 0 ? cut + 1 : max);
}

function readText(path: string): string | null {
	return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** Evenly spaced, order-preserving sample of `n` items. */
function sample<T>(items: readonly T[], n: number): T[] {
	if (items.length <= n) return [...items];
	const step = items.length / n;
	return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)] as T);
}

/**
 * Pick `n` candidates spread across distinct current outcomes, so the goldens
 * pin every branch a site takes on real inputs rather than 30 copies of the
 * most common one. Groups are visited round-robin in sorted key order.
 */
async function stratify<T>(
	site: GoldenSite,
	candidates: readonly T[],
	n: number,
	signature: (output: unknown) => string,
): Promise<T[]> {
	const groups = new Map<string, T[]>();
	for (const c of candidates) {
		const key = signature(await runSite(site, c));
		groups.set(key, [...(groups.get(key) ?? []), c]);
	}
	const queues = [...groups.keys()]
		.sort()
		.map((k) => sample(groups.get(k) ?? [], n));
	const picked: T[] = [];
	while (picked.length < n && queues.some((q) => q.length > 0)) {
		for (const q of queues) {
			const next = q.shift();
			if (next !== undefined && picked.length < n) picked.push(next);
		}
	}
	return picked;
}

function git(args: string[]): string {
	const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT });
	return proc.exitCode === 0 ? proc.stdout.toString() : "";
}

function walk(dir: string, filter: (path: string) => boolean): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir).sort()) {
		if (entry === "node_modules" || entry === "dist") continue;
		const abs = join(dir, entry);
		if (statSync(abs).isDirectory()) out.push(...walk(abs, filter));
		else if (filter(abs)) out.push(abs);
	}
	return out;
}

function featureDirs(): string[] {
	if (!existsSync(FEATURES_DIR)) return [];
	return readdirSync(FEATURES_DIR)
		.sort()
		.map((d) => join(FEATURES_DIR, d))
		.filter((d) => statSync(d).isDirectory());
}

function doc(dir: string, name: string): string | null {
	const text = readText(join(dir, name));
	return text === null ? null : clip(text, MAX_DOC);
}

/** Replay of the diffs that landed with each feature's plan. */
function commitDiff(sha: string): string {
	return clip(
		git(["show", "--format=", "--no-color", "-U2", sha, "--", ".", ":!.maina"]),
		MAX_DIFF,
	);
}

// ── Input collectors (one per site) ─────────────────────────────────────────

function checklistInputs(): ChecklistInput[] {
	const dirs = featureDirs().filter(
		(d) => existsSync(join(d, "spec.md")) && existsSync(join(d, "plan.md")),
	);
	return sample(dirs, TARGET).map((d) => ({
		spec: doc(d, "spec.md") ?? "",
		plan: doc(d, "plan.md") ?? "",
	}));
}

function analyzerInputs(): AnalyzerInput[] {
	const dirs = featureDirs();
	const complete = (d: string): boolean =>
		["spec.md", "plan.md", "tasks.md"].every((f) => existsSync(join(d, f)));
	// Every partially-populated feature (missing-file paths) plus a spread of full ones.
	const partial = dirs.filter((d) => !complete(d));
	const full = sample(
		dirs.filter(complete),
		Math.max(TARGET - partial.length, 0),
	);
	const picked = [...partial, ...full].sort();
	const inputs: AnalyzerInput[] = picked.map((d) => ({
		spec: doc(d, "spec.md"),
		plan: doc(d, "plan.md"),
		tasks: doc(d, "tasks.md"),
	}));
	inputs.push({ spec: null, plan: null, tasks: null });
	return inputs;
}

function qualityInputs(): QualityInput[] {
	const specs = featureDirs()
		.map((d) => doc(d, "spec.md"))
		.filter((s): s is string => s !== null);
	const examples = ["examples/todo-api/README.md"]
		.map((p) => readText(join(ROOT, p)))
		.filter((s): s is string => s !== null)
		.map((s) => clip(s, MAX_DOC));
	return [...sample(specs, TARGET - examples.length - 1), ...examples, ""].map(
		(spec) => ({ spec }),
	);
}

/** `title: first decision line` for each ADR — mirrors loadDecisionSummaries. */
function decisionSummaries(): string[] {
	const dir = join(WIKI_DIR, "decisions");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => {
			const content = readFileSync(join(dir, f), "utf-8");
			const title =
				content
					.match(/^#\s+(.+)/m)?.[1]
					?.replace(/^Decision:\s*/i, "")
					.trim() ?? f;
			const decision =
				content
					.match(/## Decision\n\n([\s\S]*?)(?=\n## |\n---|$)/)?.[1]
					?.trim()
					.split("\n")[0] ?? "";
			return `${title}: ${decision}`;
		});
}

async function specComplianceInputs(): Promise<SpecComplianceInput[]> {
	const summaries = decisionSummaries();
	// Keep ADRs naming a tool the review knows conflicts for, plus a rotation.
	const toolAdrs = summaries.filter((s) => /biome|bun:test/i.test(s));
	const adrsFor = (i: number): string[] => [
		...new Set([
			...toolAdrs,
			...Array.from(
				{ length: Math.min(6, summaries.length) },
				(_, j) => summaries[(i * 5 + j) % summaries.length] ?? "",
			),
		]),
	];
	const plans = featureDirs().filter((d) => existsSync(join(d, "plan.md")));
	const candidates: SpecComplianceInput[] = [];
	// The diff that landed with each feature's plan.
	for (const d of plans) {
		const rel = relative(ROOT, join(d, "plan.md"));
		const sha = git([
			"log",
			"--diff-filter=A",
			"--format=%H",
			"-1",
			"--",
			rel,
		]).trim();
		const diff = sha ? commitDiff(sha) : "";
		if (!diff.trim()) continue;
		candidates.push({
			diff,
			plan: doc(d, "plan.md"),
			decisionSummaries: adrsFor(candidates.length),
		});
	}
	// Commits touching tool names the ADR check looks for, against a rotating plan.
	const toolShas = git([
		"log",
		"--format=%H",
		"-G",
		"eslint|prettier|jest|vitest",
		"-n",
		"10",
		"--",
		"packages",
	])
		.trim()
		.split("\n")
		.filter(Boolean);
	toolShas.forEach((sha, k) => {
		const d = plans[(k * 7) % Math.max(plans.length, 1)];
		const diff = commitDiff(sha);
		if (!d || !diff.trim()) return;
		candidates.push({
			diff,
			plan: doc(d, "plan.md"),
			decisionSummaries: adrsFor(k),
		});
	});
	const picked = await stratify(
		"review/index.ts#spec-compliance",
		candidates,
		TARGET - 4,
		(out) => {
			const o = out as {
				passed: boolean;
				findings: Array<{ message: string }>;
			};
			const kinds = new Set(o.findings.map((f) => f.message.split(/[ :]/)[0]));
			return `${o.passed}:${[...kinds].sort().join(",")}`;
		},
	);
	// No-plan and no-ADR paths on real diffs.
	const extra = sample(candidates, 4).map((c, i) =>
		i % 2 === 0 ? { ...c, plan: null } : { ...c, decisionSummaries: null },
	);
	return [...picked, ...extra];
}

function codeQualityInputs(): CodeQualityInput[] {
	const shas = git([
		"log",
		"--no-merges",
		"--format=%H",
		"-n",
		String(TARGET * 3),
		"HEAD",
		"--",
		"packages",
		"examples",
	])
		.trim()
		.split("\n")
		.filter(Boolean);
	return sample(shas, TARGET)
		.map((sha) => ({ diff: commitDiff(sha) }))
		.filter((i) => i.diff.trim().length > 0);
}

interface Corpus {
	readonly comments: readonly string[];
	readonly reviewers: readonly string[];
}

function corpus(): Corpus {
	const text = readText(CORPUS);
	return text ? (JSON.parse(text) as Corpus) : { comments: [], reviewers: [] };
}

function categoryInputs(): CategoryInput[] {
	return corpus().comments.map((body) => ({ body }));
}

function reviewerKindInputs(): ReviewerKindInput[] {
	const authors = git(["log", "--format=%an%n%cn"])
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	const names = [...new Set([...corpus().reviewers, ...authors])];
	return names.map((reviewer) => ({ reviewer }));
}

function falsePositiveInputs(): FalsePositiveInput[] {
	type Event = FalsePositiveInput["events"][number];
	const seq = (ruleId: string, dismiss: number, ack: number): Event[] => {
		// Interleave so ordering, not just totals, is part of the input.
		const events: Event[] = [];
		for (let i = 0; i < Math.max(dismiss, ack); i++) {
			if (i < dismiss) events.push({ ruleId, action: "dismiss" });
			if (i < ack) events.push({ ruleId, action: "acknowledge" });
		}
		return events;
	};
	const inputs: FalsePositiveInput[] = [];

	// Real dismissal history recorded in this repo.
	const prefs = readText(join(ROOT, ".maina/preferences.json"));
	if (prefs) {
		const rules = (
			JSON.parse(prefs) as {
				rules?: Record<string, { dismissCount: number; totalCount: number }>;
			}
		).rules;
		const all = Object.entries(rules ?? {});
		for (const [ruleId, r] of all) {
			inputs.push({
				events: seq(ruleId, r.dismissCount, r.totalCount - r.dismissCount),
			});
		}
		inputs.push({
			events: all.flatMap(([ruleId, r]) =>
				seq(ruleId, r.dismissCount, r.totalCount - r.dismissCount),
			),
		});
	}

	// Threshold sweep around the >50% rate and >=5 sample floors.
	const rules = [
		"slop/console-log",
		"slop/empty-body",
		"slop/todo-without-ticket",
		"slop/commented-code",
		"slop/hallucinated-import",
		"biome/lint/suspicious/noExplicitAny",
	];
	const grid: Array<[number, number]> = [
		[0, 0],
		[1, 0],
		[4, 0],
		[5, 0],
		[3, 2],
		[2, 3],
		[3, 3],
		[4, 3],
		[4, 4],
		[5, 4],
		[6, 6],
		[7, 6],
		[0, 10],
		[10, 1],
		[26, 25],
		[25, 26],
	];
	grid.forEach(([d, a], i) => {
		inputs.push({ events: seq(rules[i % rules.length] ?? "rule", d, a) });
	});
	// Mixed multi-rule histories.
	for (let k = 0; k < 8; k++) {
		inputs.push({
			events: rules.flatMap((ruleId, j) =>
				seq(ruleId, (k + j) % 7, (k * 2 + j) % 5),
			),
		});
	}
	return inputs;
}

const RELATIVE_IMPORT =
	/(?:import\s+.*\s+from\s+|import\s+|require\s*\()['"](\.[^'"]+)['"]/;

/** Where each relative import resolved at capture time (see detectHallucinatedImports). */
function resolvedImports(
	absFile: string,
	content: string,
): SlopInput["existing"] {
	const out: Array<{ path: string; kind: "file" | "dir" }> = [];
	for (const line of content.split("\n")) {
		const spec = RELATIVE_IMPORT.exec(line)?.[1];
		if (!spec || /^\.{2,}$/.test(spec)) continue;
		const base = resolve(dirname(absFile), spec);
		const candidates = [
			base,
			...[".ts", ".tsx", ".js", ".jsx", ".json"].map((e) => `${base}${e}`),
			...["index.ts", "index.tsx", "index.js", "index.jsx"].map((i) =>
				join(base, i),
			),
		];
		const hit = candidates.find((c) => existsSync(c));
		if (!hit) continue;
		const path = relative(ROOT, hit);
		if (path.startsWith("..") || out.some((e) => e.path === path)) continue;
		out.push({ path, kind: statSync(hit).isDirectory() ? "dir" : "file" });
	}
	return out;
}

async function slopInputs(): Promise<SlopInput[]> {
	const isSource = (p: string): boolean =>
		/\.(ts|tsx|js)$/.test(p) && statSync(p).size <= MAX_SOURCE;
	const fromFile = (abs: string): SlopInput => {
		const content = clip(readFileSync(abs, "utf-8"), MAX_SOURCE);
		return {
			file: relative(ROOT, abs),
			content,
			existing: resolvedImports(abs, content),
		};
	};
	const sources = [
		...walk(join(ROOT, "examples"), isSource),
		join(ROOT, "examples/todo-api/README.md"),
		...walk(join(ROOT, "scripts"), isSource).filter(
			(p) => !p.endsWith("golden-capture.ts"),
		),
		...walk(join(ROOT, "packages"), isSource).filter(
			(p) => !p.includes("/packages/docs/") && !p.includes("/__golden__/"),
		),
	].filter(existsSync);
	// Code blocks from plans/docs — what AI-written snippets look like before
	// they land, relative imports included (nothing exists next to them).
	const snippets: SlopInput[] = codeFences().map((f, i) => ({
		file: `snippets/${f.source.replace(/[^\w.-]+/g, "_")}.${i}.ts`,
		content: clip(f.code, MAX_SOURCE),
		existing: [],
	}));
	const candidates = [...sources.map(fromFile), ...snippets];
	return stratify("verify/slop.ts", candidates, TARGET, (out) => {
		const rules = new Set(
			(out as Array<{ ruleId: string }>).map((f) => f.ruleId),
		);
		return [...rules].sort().join(",");
	});
}

/** Markdown the repo keeps that was largely AI-written: plans, docs, prompts. */
function markdownSources(): string[] {
	return [
		...walk(FEATURES_DIR, (p) => p.endsWith(".md")),
		...walk(join(ROOT, "packages/docs/src/content/docs"), (p) =>
			/\.mdx?$/.test(p),
		),
		...walk(join(ROOT, "packages/core/src/prompts"), (p) => p.endsWith(".md")),
	];
}

/** TypeScript/JavaScript fenced code blocks, keyed by their source document. */
function codeFences(): Array<{ source: string; code: string }> {
	const fence = /```(?:ts|typescript|tsx|js|javascript)\n([\s\S]*?)```/g;
	return markdownSources().flatMap((abs) =>
		[...readFileSync(abs, "utf-8").matchAll(fence)].map((m) => ({
			source: relative(ROOT, abs),
			code: m[1] ?? "",
		})),
	);
}

async function validateInputs(): Promise<ValidateInput[]> {
	const whole = markdownSources().map((p) => readFileSync(p, "utf-8"));
	const candidates: ValidateInput[] = [
		...sample(whole, 40),
		...codeFences().map((f) => f.code),
	].map((text) => ({ text: clip(text, 2_500) }));
	return stratify("ai/validate.ts", candidates, TARGET, (out) =>
		(out as { warnings: string[] }).warnings.join("|"),
	);
}

function wikiArticles(subdir: string): Array<[string, string]> {
	const dir = join(WIKI_DIR, subdir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => [
			`${subdir}/${f}`,
			clip(readFileSync(join(dir, f), "utf-8"), MAX_ARTICLE),
		]);
}

function wikiInputs(): WikiInput[] {
	const modules = wikiArticles("modules");
	const decisions = wikiArticles("decisions");
	const features = wikiArticles("features");
	const architecture = wikiArticles("architecture");
	const rotate = <T>(items: readonly T[], start: number, n: number): T[] =>
		items.length === 0
			? []
			: Array.from(
					{ length: Math.min(n, items.length) },
					(_, j) => items[(start + j) % items.length] as T,
				);
	const snapshot = (i: number, extra: Array<[string, string]> = []) =>
		Object.fromEntries([
			...rotate(modules, i * 7, 3),
			...rotate(decisions, i * 3, 3),
			...rotate(features, i * 5, 3),
			...extra,
		]);

	const inputs: WikiInput[] = [];

	// Plan: feature summaries from .maina/features, wiki includes its own article.
	const planFeatures = sample(
		featureDirs().filter((d) => existsSync(join(d, "spec.md"))),
		12,
	);
	planFeatures.forEach((d, i) => {
		const spec = readFileSync(join(d, "spec.md"), "utf-8");
		const heading = spec.match(/^#\s+(.+)/m)?.[1] ?? "";
		const own = features.filter(([p]) =>
			p.includes(d.split("/").pop() ?? "\0"),
		);
		inputs.push({ mode: "plan", query: heading, wiki: snapshot(i, own) });
	});

	// Design: ADR titles (alignment) plus tool swaps against them (conflicts).
	const swaps = [
		"Adopt eslint and prettier for linting",
		"Switch the test runner to jest",
		"Run the CLI on node with npm scripts",
		"Store findings in postgres instead of a local file",
		"Use vitest for unit tests",
	];
	sample(decisions, 5).forEach(([path, content], i) => {
		const title = content.match(/^#\s+(.+)/m)?.[1] ?? path;
		inputs.push({
			mode: "design",
			query: title,
			wiki: snapshot(i + 12, [[path, content]]),
		});
		inputs.push({
			mode: "design",
			query: swaps[i % swaps.length] ?? "",
			wiki: snapshot(i + 20, [[path, content]]),
		});
	});

	// Brainstorm: architecture + counts.
	for (let i = 0; i < 5; i++) {
		inputs.push({
			mode: "brainstorm",
			wiki: snapshot(i + 30, rotate(architecture, i, 2)),
		});
	}
	return inputs;
}

/** Keep only the import prelude — the part buildGraph reads. */
function importPrelude(content: string): string {
	const lines = content.split("\n");
	const firstDecl = lines.findIndex((l) =>
		/^(export\s+)?(default\s+)?(async\s+)?(function|const|let|class|interface|type|enum)\b/.test(
			l,
		),
	);
	const head = firstDecl === -1 ? lines : lines.slice(0, firstDecl);
	let last = -1;
	head.forEach((l, i) => {
		if (/from\s+["'][^"']+["']/.test(l)) last = i;
	});
	return last === -1 ? "" : `${head.slice(0, last + 1).join("\n")}\n`;
}

function relevanceInputs(): RelevanceInput[] {
	const isTs = (p: string): boolean =>
		p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts");
	const dirs = [
		...readdirSync(join(ROOT, "packages/core/src"))
			.sort()
			.map((d) => join(ROOT, "packages/core/src", d)),
		join(ROOT, "packages/cli/src/commands"),
		join(ROOT, "packages/mcp/src"),
		join(ROOT, "examples/todo-api/src"),
	].filter(
		(d) =>
			existsSync(d) && statSync(d).isDirectory() && !d.endsWith("__golden__"),
	);

	const inputs: RelevanceInput[] = [];
	for (const dir of dirs) {
		const own = readdirSync(dir)
			.sort()
			.map((f) => join(dir, f))
			.filter((p) => statSync(p).isFile() && isTs(p))
			.slice(0, 10);
		if (own.length < 2) continue;
		// One hop of resolved relative imports so edges cross directories.
		const hop = new Set<string>(own);
		for (const f of own) {
			for (const e of resolvedImports(f, readFileSync(f, "utf-8"))) {
				const abs = join(ROOT, e.path);
				if (e.kind === "file" && isTs(abs) && hop.size < 16) hop.add(abs);
			}
		}
		const files = Object.fromEntries(
			[...hop]
				.sort()
				.map((abs) => [
					relative(ROOT, abs),
					importPrelude(readFileSync(abs, "utf-8")),
				]),
		);
		const rels = Object.keys(files);
		const i = inputs.length;
		inputs.push({
			files,
			touchedFiles: i % 4 === 3 ? [] : [rels[i % rels.length] ?? ""],
			mentionedFiles: i % 3 === 2 ? [] : [rels[(i + 1) % rels.length] ?? ""],
		});
	}
	return sample(inputs, TARGET);
}

function tiersInputs(): TiersInput[] {
	const sources = walk(
		join(ROOT, "packages"),
		(p) => /\.ts$/.test(p) && !p.includes("/__golden__/"),
	);
	const tasks = new Set<string>();
	const patterns = [
		/tryAIGenerate\(\s*"([a-z-]+)"/g,
		/resolveModel\(\s*"([a-z-]+)"/g,
		/getTaskTier\(\s*"([a-z-]+)"/g,
		/\btask:\s*"([a-z-]+)"/g,
	];
	for (const file of sources) {
		const content = readFileSync(file, "utf-8");
		for (const re of patterns) {
			for (const m of content.matchAll(re)) if (m[1]) tasks.add(m[1]);
		}
	}
	for (const f of walk(join(ROOT, "packages/core/src/prompts"), (p) =>
		p.endsWith(".md"),
	)) {
		tasks.add(f.split("/").pop()?.replace(/\.md$/, "") ?? "");
	}
	for (const t of ["", "COMMIT", "local", "unknown-task", "design review"])
		tasks.add(t);

	// Placeholder model ids: the goldens pin the task→tier mapping, not model choices.
	const configs: TiersInput["config"][] = [
		{
			provider: "provider-a",
			models: {
				mechanical: "model-mechanical",
				standard: "model-standard",
				architectural: "model-architectural",
				local: "model-local",
			},
		},
		{
			provider: "provider-b",
			models: {
				mechanical: "m1",
				standard: "m2",
				architectural: "m3",
				local: "m4",
			},
		},
	];
	return [...tasks].sort().map((task, i) => ({
		task,
		config: configs[i % configs.length] as TiersInput["config"],
	}));
}

const COLLECTORS: Record<GoldenSite, () => unknown[] | Promise<unknown[]>> = {
	"features/checklist.ts": checklistInputs,
	"features/analyzer.ts": analyzerInputs,
	"features/quality.ts": qualityInputs,
	"review/index.ts#spec-compliance": specComplianceInputs,
	"review/index.ts#code-quality": codeQualityInputs,
	"feedback/external-reviews.ts#category": categoryInputs,
	"feedback/external-reviews.ts#reviewer-kind": reviewerKindInputs,
	"feedback/preferences.ts#false-positive": falsePositiveInputs,
	"verify/slop.ts": slopInputs,
	"ai/validate.ts": validateInputs,
	"wiki/consult.ts": wikiInputs,
	"context/relevance.ts": relevanceInputs,
	"ai/tiers.ts": tiersInputs,
};

// ── Main ────────────────────────────────────────────────────────────────────

function existingInputs(site: GoldenSite): unknown[] | null {
	const text = readText(join(OUT_DIR, `${fixtureFileName(site)}.json`));
	if (!text) return null;
	return (JSON.parse(text) as GoldenFixtureFile).cases.map((c) => c.input);
}

/** Drop repeated inputs (e.g. two features still holding the same scaffold). */
function dedupe(inputs: readonly unknown[]): unknown[] {
	const seen = new Set<string>();
	return inputs.filter((input) => {
		const key = JSON.stringify(input);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

async function main(): Promise<number> {
	const resample = process.argv.includes("--resample");
	mkdirSync(OUT_DIR, { recursive: true });
	let failed = false;

	for (const site of GOLDEN_SITES) {
		const inputs = dedupe(
			(!resample && existingInputs(site)) || (await COLLECTORS[site]()),
		);
		const cases: GoldenCase[] = [];
		for (const input of inputs) {
			cases.push({ site, input, output: await runSite(site, input) });
		}
		const file: GoldenFixtureFile = { site, cases };
		const path = join(OUT_DIR, `${fixtureFileName(site)}.json`);
		writeFileSync(path, `${JSON.stringify(file, null, "\t")}\n`, "utf-8");
		const flag = cases.length < MIN_CASES_PER_SITE ? "  (below minimum)" : "";
		if (flag) failed = true;
		process.stdout.write(
			`${site}: ${cases.length} cases → ${relative(ROOT, path)}${flag}\n`,
		);
	}
	return failed ? 1 : 0;
}

process.exit(await main());
