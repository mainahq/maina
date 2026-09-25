/**
 * Wiki Consult — pre-command wiki consultation for plan, design, and brainstorm.
 *
 * Searches wiki articles by keyword overlap to surface existing modules,
 * decisions, and features relevant to a proposed change. All operations
 * are synchronous file reads + keyword matching — no AI calls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decideEach, defaultDecidePorts } from "../decide/decide";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiConsultResult {
	relatedModules: Array<{ name: string; path: string; entities: number }>;
	relatedDecisions: Array<{ id: string; title: string; status: string }>;
	relatedFeatures: Array<{ id: string; title: string }>;
	suggestions: string[];
}

export interface WikiDesignConsultResult {
	conflicts: Array<{ adr: string; title: string; reason: string }>;
	alignments: Array<{ adr: string; title: string }>;
}

export interface WikiBrainstormContext {
	architecture: string;
	moduleCount: number;
	decisionCount: number;
	recentFeatures: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const NOISE_WORDS = new Set([
	"a",
	"an",
	"the",
	"to",
	"in",
	"on",
	"for",
	"and",
	"or",
	"with",
	"from",
	"is",
	"it",
	"be",
	"as",
	"at",
	"by",
	"of",
	"that",
	"this",
	"was",
	"are",
	"will",
	"can",
	"has",
	"have",
	"not",
	"but",
	"all",
	"new",
	"add",
	"use",
]);

/** Tool/pattern pairs where choosing one rules out the other. */
const CONFLICT_PAIRS: ReadonlyArray<readonly [string, string]> = [
	["biome", "eslint"],
	["biome", "prettier"],
	["jest", "bun:test"],
	["vitest", "bun:test"],
	["node", "bun"],
	["npm", "bun"],
	["yarn", "bun"],
	["pnpm", "bun"],
	["mongodb", "sqlite"],
	["postgres", "sqlite"],
];

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase keywords, removing punctuation and noise words.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !NOISE_WORDS.has(w));
}

/**
 * Which articles are relevant to the query keywords: one `wiki.relevance`
 * decision per article over its distinct tokens (keyword overlap).
 */
function relevantArticles(
	articles: ReadonlyArray<{ content: string }>,
	keywords: readonly string[],
): readonly boolean[] {
	return decideEach(defaultDecidePorts, {
		type: "wiki.relevance",
		check: "article",
		untrusted: articles.map((article) => ({
			tokens: [...new Set(tokenize(article.content))],
		})),
		shared: { untrusted: { keywords } },
	});
}

/**
 * Safely read all .md files in a wiki subdirectory.
 */
function readArticles(
	wikiDir: string,
	subdir: string,
): Array<{ filename: string; content: string }> {
	const dir = join(wikiDir, subdir);
	if (!existsSync(dir)) return [];

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}

	const articles: Array<{ filename: string; content: string }> = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		try {
			const content = readFileSync(join(dir, entry), "utf-8");
			articles.push({ filename: entry, content });
		} catch {
			// skip unreadable files
		}
	}
	return articles;
}

/**
 * Extract the first heading from markdown.
 */
function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0] ?? "";
	return firstLine.replace(/^#+\s*/, "").trim();
}

/**
 * Count entities listed in a module article (lines matching `- **name** (kind)`).
 */
function countEntities(content: string): number {
	const entityPattern = /^- \*\*.+\*\* \(.+\)/gm;
	const matches = content.match(entityPattern);
	return matches?.length ?? 0;
}

/**
 * Extract the status from a decision article (e.g., `> Status: **accepted**`).
 */
function extractStatus(content: string): string {
	const statusMatch = content.match(/>\s*Status:\s*\*\*(\w+)\*\*/);
	return statusMatch?.[1] ?? "unknown";
}

/**
 * Extract key assertions from a decision article for conflict detection.
 * Returns lowercased phrases from the Decision and Context sections.
 */
function extractDecisionAssertions(content: string): string[] {
	const assertions: string[] = [];

	// Extract from "## Decision" section
	const decisionMatch = content.match(
		/## Decision\n\n([\s\S]*?)(?=\n## |\n---|$)/,
	);
	if (decisionMatch?.[1]) {
		assertions.push(decisionMatch[1].trim().toLowerCase());
	}

	// Extract from "## Context" section
	const contextMatch = content.match(
		/## Context\n\n([\s\S]*?)(?=\n## |\n---|$)/,
	);
	if (contextMatch?.[1]) {
		assertions.push(contextMatch[1].trim().toLowerCase());
	}

	return assertions;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Consult the wiki before creating a new feature plan.
 * Searches for existing modules, decisions, and features that overlap.
 */
export function consultWikiForPlan(
	wikiDir: string,
	featureDescription: string,
): WikiConsultResult {
	const result: WikiConsultResult = {
		relatedModules: [],
		relatedDecisions: [],
		relatedFeatures: [],
		suggestions: [],
	};

	if (!existsSync(wikiDir)) return result;

	const keywords = tokenize(featureDescription);
	if (keywords.length === 0) return result;

	// Score modules
	const modules = readArticles(wikiDir, "modules");
	const relevantModules = relevantArticles(modules, keywords);
	for (const [i, mod] of modules.entries()) {
		if (relevantModules[i]) {
			const name = mod.filename.replace(/\.md$/, "");
			const entities = countEntities(mod.content);
			result.relatedModules.push({
				name,
				path: `modules/${mod.filename}`,
				entities,
			});
		}
	}
	result.relatedModules.sort((a, b) => b.entities - a.entities);

	// Score decisions
	const decisions = readArticles(wikiDir, "decisions");
	const relevantDecisions = relevantArticles(decisions, keywords);
	for (const [i, dec] of decisions.entries()) {
		if (relevantDecisions[i]) {
			const title = extractTitle(dec.content)
				.replace(/^Decision:\s*/i, "")
				.trim();
			const id = dec.filename.replace(/\.md$/, "");
			const status = extractStatus(dec.content);
			result.relatedDecisions.push({ id, title, status });
		}
	}

	// Score features
	const features = readArticles(wikiDir, "features");
	const relevantFeatures = relevantArticles(features, keywords);
	for (const [i, feat] of features.entries()) {
		if (relevantFeatures[i]) {
			const title = extractTitle(feat.content)
				.replace(/^Feature:\s*/i, "")
				.trim();
			const id = feat.filename.replace(/\.md$/, "");
			result.relatedFeatures.push({ id, title });
		}
	}

	// Generate suggestions
	for (const mod of result.relatedModules) {
		if (mod.entities > 5) {
			result.suggestions.push(
				`Module '${mod.name}' already has ${mod.entities} entities — consider extending it`,
			);
		}
	}

	for (const feat of result.relatedFeatures) {
		result.suggestions.push(
			`Feature ${feat.id} did something similar — check wiki/features/${feat.id}.md`,
		);
	}

	for (const dec of result.relatedDecisions) {
		if (dec.status === "accepted") {
			result.suggestions.push(
				`ADR ${dec.id} (${dec.title}) is accepted — ensure compatibility`,
			);
		}
	}

	return result;
}

/**
 * Check existing ADRs for potential conflicts with a proposed design decision.
 */
export function consultWikiForDesign(
	wikiDir: string,
	proposedDecision: string,
): WikiDesignConsultResult {
	const result: WikiDesignConsultResult = {
		conflicts: [],
		alignments: [],
	};

	if (!existsSync(wikiDir)) return result;

	const proposedLower = proposedDecision.toLowerCase();
	const proposedKeywords = tokenize(proposedDecision);
	if (proposedKeywords.length === 0) return result;

	const decisions = readArticles(wikiDir, "decisions")
		.map((dec) => ({ ...dec, status: extractStatus(dec.content) }))
		.filter((dec) => dec.status === "accepted" || dec.status === "proposed");

	// Does the proposal pick the other side of a known conflict pair from an
	// ADR (`spec.contradiction`, one question per ADR and pair)?
	const assertionTexts = decisions.map((dec) =>
		extractDecisionAssertions(dec.content).join(" "),
	);
	const pairs = assertionTexts.flatMap((adr, d) =>
		CONFLICT_PAIRS.map(([toolA, toolB]) => ({ d, adr, toolA, toolB })),
	);
	const conflicting = decideEach(defaultDecidePorts, {
		type: "spec.contradiction",
		check: "adr-proposal",
		trusted: pairs.map(({ toolA, toolB }) => ({ toolA, toolB })),
		untrusted: pairs.map(({ adr }) => ({ adr })),
		shared: { untrusted: { proposal: proposedLower } },
	});
	const aligned = relevantArticles(decisions, proposedKeywords);

	for (const [d, dec] of decisions.entries()) {
		const title = extractTitle(dec.content)
			.replace(/^Decision:\s*/i, "")
			.trim();
		const id = dec.filename.replace(/\.md$/, "");
		const assertionText = assertionTexts[d] ?? "";

		// The first conflicting pair is reported.
		const conflict = pairs.find((pair, i) => pair.d === d && conflicting[i]);
		if (conflict) {
			const { toolA, toolB } = conflict;
			const adrTool = assertionText.includes(toolA) ? toolA : toolB;
			const proposedTool = proposedLower.includes(toolA) ? toolA : toolB;
			result.conflicts.push({
				adr: id,
				title,
				reason: `ADR chose ${adrTool}, proposal uses ${proposedTool}`,
			});
		} else if (aligned[d]) {
			// No conflict, but the ADR is relevant to the proposal
			result.alignments.push({ adr: id, title });
		}
	}

	return result;
}

/**
 * Load architecture context for brainstorming.
 */
export function consultWikiForBrainstorm(
	wikiDir: string,
): WikiBrainstormContext {
	const result: WikiBrainstormContext = {
		architecture: "",
		moduleCount: 0,
		decisionCount: 0,
		recentFeatures: [],
	};

	if (!existsSync(wikiDir)) return result;

	// Load architecture articles
	const archArticles = readArticles(wikiDir, "architecture");
	if (archArticles.length > 0) {
		result.architecture = archArticles
			.map((a) => a.content)
			.join("\n\n---\n\n");
	}

	// Count modules
	const modules = readArticles(wikiDir, "modules");
	result.moduleCount = modules.length;

	// Count decisions
	const decisions = readArticles(wikiDir, "decisions");
	result.decisionCount = decisions.length;

	// Load recent features (last 5 by filename sort)
	const features = readArticles(wikiDir, "features");
	const sorted = features
		.map((f) => ({
			id: f.filename.replace(/\.md$/, ""),
			title: extractTitle(f.content),
		}))
		.sort((a, b) => b.id.localeCompare(a.id))
		.slice(0, 5);

	result.recentFeatures = sorted.map((f) => `${f.id}: ${f.title}`);

	return result;
}
