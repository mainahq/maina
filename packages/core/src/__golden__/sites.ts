/**
 * Golden decision harness (v1 plan task 0.2, FR-DEC-6).
 *
 * One runner per heuristic decision site. Each runner takes a plain JSON
 * input, feeds it through the *current* deterministic code path and returns
 * a plain JSON output. `scripts/golden-capture.ts` records `{ site, input,
 * output }` fixtures with these runners; `decisions.test.ts` replays them and
 * fails when behaviour drifts.
 *
 * Rules: no clock, no network, no AI. Sites that only accept paths get a
 * throwaway temp directory that is removed before the runner resolves.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { resolveModel } from "../ai/tiers";
import { validateAIOutput } from "../ai/validate";
import type { Config } from "../config/schema";
import { buildGraph, scoreRelevance } from "../context/relevance";
import { analyze } from "../features/analyzer";
import { verifyPlan } from "../features/checklist";
import { scoreSpec } from "../features/quality";
import {
	categoriseComment,
	classifyReviewerKind,
} from "../feedback/external-reviews";
import {
	acknowledgeFinding,
	dismissFinding,
	getNoisyRules,
} from "../feedback/preferences";
import { reviewCodeQuality, reviewSpecCompliance } from "../review/index";
import { detectSlop } from "../verify/slop";
import {
	consultWikiForBrainstorm,
	consultWikiForDesign,
	consultWikiForPlan,
} from "../wiki/consult";

// ── Types ───────────────────────────────────────────────────────────────────

export const GOLDEN_SITES = [
	"features/checklist.ts",
	"features/analyzer.ts",
	"features/quality.ts",
	"review/index.ts#spec-compliance",
	"review/index.ts#code-quality",
	"feedback/external-reviews.ts#category",
	"feedback/external-reviews.ts#reviewer-kind",
	"feedback/preferences.ts#false-positive",
	"verify/slop.ts",
	"ai/validate.ts",
	"wiki/consult.ts",
	"context/relevance.ts",
	"ai/tiers.ts",
] as const;

export type GoldenSite = (typeof GOLDEN_SITES)[number];

/** Minimum number of recorded inputs per site (issue #284). */
export const MIN_CASES_PER_SITE = 25;

export interface GoldenCase {
	readonly site: GoldenSite;
	readonly input: unknown;
	readonly output: unknown;
}

export interface GoldenFixtureFile {
	readonly site: GoldenSite;
	readonly cases: readonly GoldenCase[];
}

export interface ChecklistInput {
	readonly spec: string;
	readonly plan: string;
}

export interface AnalyzerInput {
	readonly spec: string | null;
	readonly plan: string | null;
	readonly tasks: string | null;
}

export interface QualityInput {
	readonly spec: string;
}

export interface SpecComplianceInput {
	readonly diff: string;
	readonly plan: string | null;
	readonly decisionSummaries: readonly string[] | null;
}

export interface CodeQualityInput {
	readonly diff: string;
}

export interface CategoryInput {
	readonly body: string;
}

export interface ReviewerKindInput {
	readonly reviewer: string;
}

export interface FalsePositiveInput {
	readonly events: ReadonlyArray<{
		readonly ruleId: string;
		readonly action: "dismiss" | "acknowledge";
	}>;
}

export interface SlopInput {
	/** Repo-relative path of the file under test. */
	readonly file: string;
	readonly content: string;
	/** Repo-relative paths that relative imports resolved to at capture time. */
	readonly existing: ReadonlyArray<{
		readonly path: string;
		readonly kind: "file" | "dir";
	}>;
}

export interface ValidateInput {
	readonly text: string;
}

export type WikiInput =
	| {
			readonly mode: "plan" | "design";
			readonly query: string;
			readonly wiki: Readonly<Record<string, string>>;
	  }
	| {
			readonly mode: "brainstorm";
			readonly wiki: Readonly<Record<string, string>>;
	  };

export interface RelevanceInput {
	/** Repo-relative path → file content (import prelude). */
	readonly files: Readonly<Record<string, string>>;
	readonly touchedFiles: readonly string[];
	readonly mentionedFiles: readonly string[];
}

export interface TiersInput {
	readonly task: string;
	readonly config: {
		readonly provider: string;
		readonly models: Config["models"];
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run `fn` inside a fresh temp directory that is always removed afterwards. */
async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "maina-golden-"));
	try {
		return await fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function writeTree(
	root: string,
	files: Readonly<Record<string, string>>,
): void {
	for (const [path, content] of Object.entries(files)) {
		const abs = join(root, path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content, "utf-8");
	}
}

/** Round-trip through JSON so outputs compare exactly like stored fixtures. */
function toJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

function byKey<T>(key: (item: T) => string): (a: T, b: T) => number {
	return (a, b) => {
		const ka = key(a);
		const kb = key(b);
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	};
}

// ── Runners ─────────────────────────────────────────────────────────────────

async function runChecklist(input: ChecklistInput): Promise<unknown> {
	return withTempDir((dir) => {
		const specPath = join(dir, "spec.md");
		const planPath = join(dir, "plan.md");
		writeFileSync(specPath, input.spec, "utf-8");
		writeFileSync(planPath, input.plan, "utf-8");
		return verifyPlan(planPath, specPath);
	});
}

async function runAnalyzer(input: AnalyzerInput): Promise<unknown> {
	return withTempDir((dir) => {
		const files: Record<string, string> = {};
		if (input.spec !== null) files["spec.md"] = input.spec;
		if (input.plan !== null) files["plan.md"] = input.plan;
		if (input.tasks !== null) files["tasks.md"] = input.tasks;
		writeTree(dir, files);
		const result = analyze(dir);
		// featureDir is the temp path — the only non-deterministic field.
		return result.ok
			? { ok: true, value: { ...result.value, featureDir: "<featureDir>" } }
			: result;
	});
}

async function runQuality(input: QualityInput): Promise<unknown> {
	return withTempDir((dir) => {
		const specPath = join(dir, "spec.md");
		writeFileSync(specPath, input.spec, "utf-8");
		return scoreSpec(specPath);
	});
}

async function runFalsePositive(input: FalsePositiveInput): Promise<unknown> {
	return withTempDir((dir) => {
		for (const event of input.events) {
			if (event.action === "dismiss") dismissFinding(dir, event.ruleId);
			else acknowledgeFinding(dir, event.ruleId);
		}
		return getNoisyRules(dir);
	});
}

async function runSlop(input: SlopInput): Promise<unknown> {
	return withTempDir(async (dir) => {
		for (const entry of input.existing) {
			const abs = join(dir, entry.path);
			if (entry.kind === "dir") {
				mkdirSync(abs, { recursive: true });
			} else {
				mkdirSync(dirname(abs), { recursive: true });
				writeFileSync(abs, "", "utf-8");
			}
		}
		writeTree(dir, { [input.file]: input.content });
		const result = await detectSlop([input.file], { cwd: dir });
		return result.findings;
	});
}

/**
 * Wiki consult reads articles in `readdirSync` order, which differs between
 * filesystems (APFS vs ext4). Order-only differences are canonicalised so the
 * goldens pin *which* modules/ADRs/features are surfaced, not directory order.
 */
async function runWiki(input: WikiInput): Promise<unknown> {
	return withTempDir((dir) => {
		writeTree(dir, input.wiki);
		switch (input.mode) {
			case "plan": {
				const r = consultWikiForPlan(dir, input.query);
				return {
					relatedModules: [...r.relatedModules].sort(
						(a, b) =>
							b.entities - a.entities || byKey<typeof a>((m) => m.name)(a, b),
					),
					relatedDecisions: [...r.relatedDecisions].sort(byKey((d) => d.id)),
					relatedFeatures: [...r.relatedFeatures].sort(byKey((f) => f.id)),
					suggestions: [...r.suggestions].sort(byKey((s) => s)),
				};
			}
			case "design": {
				const r = consultWikiForDesign(dir, input.query);
				return {
					conflicts: [...r.conflicts].sort(byKey((c) => c.adr)),
					alignments: [...r.alignments].sort(byKey((a) => a.adr)),
				};
			}
			case "brainstorm": {
				const r = consultWikiForBrainstorm(dir);
				// Architecture articles are joined in readdir order too.
				const architecture = r.architecture
					.split("\n\n---\n\n")
					.sort(byKey((s) => s))
					.join("\n\n---\n\n");
				return { ...r, architecture };
			}
			default: {
				const unreachable: never = input;
				return unreachable;
			}
		}
	});
}

async function runRelevance(input: RelevanceInput): Promise<unknown> {
	return withTempDir(async (dir) => {
		writeTree(dir, input.files);
		const abs = (p: string): string => join(dir, p);
		const rel = (p: string): string => relative(dir, p);
		const graph = await buildGraph(Object.keys(input.files).map(abs));
		const scores = scoreRelevance(graph, {
			touchedFiles: input.touchedFiles.map(abs),
			mentionedFiles: input.mentionedFiles.map(abs),
			currentTicketTerms: [],
		});
		const edges: Array<[string, string, number]> = [];
		for (const [source, targets] of graph.edges) {
			for (const [target, weight] of targets) {
				edges.push([rel(source), rel(target), weight]);
			}
		}
		return {
			edges,
			scores: [...scores].map(([file, score]) => [rel(file), score]),
		};
	});
}

function runTiers(input: TiersInput): unknown {
	return resolveModel(input.task, {
		provider: input.config.provider,
		models: input.config.models,
	});
}

/**
 * Evaluate one golden input against current behaviour and return the output
 * as plain JSON. Inputs are trusted fixture data shaped by
 * `scripts/golden-capture.ts`.
 */
export async function runSite(
	site: GoldenSite,
	input: unknown,
): Promise<unknown> {
	return toJson(await dispatch(site, input));
}

async function dispatch(site: GoldenSite, input: unknown): Promise<unknown> {
	switch (site) {
		case "features/checklist.ts":
			return runChecklist(input as ChecklistInput);
		case "features/analyzer.ts":
			return runAnalyzer(input as AnalyzerInput);
		case "features/quality.ts":
			return runQuality(input as QualityInput);
		case "review/index.ts#spec-compliance": {
			const i = input as SpecComplianceInput;
			return reviewSpecCompliance(
				i.diff,
				i.plan,
				i.decisionSummaries as string[] | null,
			);
		}
		case "review/index.ts#code-quality":
			return reviewCodeQuality((input as CodeQualityInput).diff, null);
		case "feedback/external-reviews.ts#category":
			return categoriseComment((input as CategoryInput).body);
		case "feedback/external-reviews.ts#reviewer-kind":
			return classifyReviewerKind((input as ReviewerKindInput).reviewer);
		case "feedback/preferences.ts#false-positive":
			return runFalsePositive(input as FalsePositiveInput);
		case "verify/slop.ts":
			return runSlop(input as SlopInput);
		case "ai/validate.ts":
			return validateAIOutput((input as ValidateInput).text);
		case "wiki/consult.ts":
			return runWiki(input as WikiInput);
		case "context/relevance.ts":
			return runRelevance(input as RelevanceInput);
		case "ai/tiers.ts":
			return runTiers(input as TiersInput);
		default: {
			const unreachable: never = site;
			return unreachable;
		}
	}
}

/** Type guard for fixture site names read from disk. */
export function isGoldenSite(value: unknown): value is GoldenSite {
	return (
		typeof value === "string" &&
		(GOLDEN_SITES as readonly string[]).includes(value)
	);
}

/** File name (without `.json`) that stores a site's fixtures. */
export function fixtureFileName(site: GoldenSite): string {
	return site.replace(/\.ts/g, "").replace(/[/#]/g, "-");
}
