import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	assembleBudget,
	type BudgetAllocation,
	type BudgetMode,
	calculateTokens,
	type LayerContent,
	truncateToFit,
} from "./budget";
import { assembleEpisodicText, decayAllEntries, getEntries } from "./episodic";
import {
	assembleRetrievalText,
	type RetrievalOptions,
	search,
} from "./retrieval";
import type { MainaCommand } from "./selector";
import { getBudgetMode, getContextNeeds, needsLayer } from "./selector";
import { assembleWorkingText, loadWorkingContext } from "./working";

// ── Public types ──────────────────────────────────────────────────────────────

export interface LayerReport {
	name: string;
	tokens: number;
	entries: number;
	included: boolean;
}

export interface AssembledContext {
	text: string;
	tokens: number;
	layers: LayerReport[];
	mode: BudgetMode;
	budget: BudgetAllocation;
}

export interface ContextOptions {
	repoRoot?: string; // defaults to process.cwd()
	mainaDir?: string; // defaults to join(repoRoot, '.maina')
	searchQuery?: string; // for retrieval layer
	scope?: string; // limit to specific directory
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Try to read a file as text. Returns empty string on any failure.
 */
function tryReadFile(filePath: string): string {
	try {
		if (existsSync(filePath)) {
			return readFileSync(filePath, "utf8");
		}
	} catch {
		// intentionally swallowed
	}
	return "";
}

/**
 * Minimal fallback for the semantic layer: constitution.md + conventions.md if present.
 */
function fallbackSemanticText(mainaDir: string): string {
	const parts: string[] = [];

	const constitutionPath = join(mainaDir, "constitution.md");
	const constitutionText = tryReadFile(constitutionPath);
	if (constitutionText) {
		parts.push("## Constitution\n");
		parts.push(constitutionText);
	}

	const conventionsPath = join(mainaDir, "conventions.md");
	const conventionsText = tryReadFile(conventionsPath);
	if (conventionsText) {
		parts.push("## Conventions\n");
		parts.push(conventionsText);
	}

	return parts.join("\n");
}

/**
 * Attempt to load and assemble the semantic layer.
 * Uses dynamic import so the engine works even if semantic.ts is not yet built.
 */
async function loadSemanticLayer(
	repoRoot: string,
	mainaDir: string,
	filter?: string[],
): Promise<string> {
	try {
		const { buildSemanticContext, assembleSemanticText } = await import(
			"./semantic"
		);

		// Build a task context from what we know
		const taskContext = {
			touchedFiles: [],
			mentionedFiles: [],
			currentTicketTerms: filter ?? [],
		};

		const semanticContext = await buildSemanticContext(
			repoRoot,
			mainaDir,
			taskContext,
		);
		return assembleSemanticText(semanticContext, filter);
	} catch {
		// semantic module not available or failed — use minimal fallback
		return fallbackSemanticText(mainaDir);
	}
}

/**
 * Build the working layer content. Never throws.
 */
async function buildWorkingLayer(
	mainaDir: string,
	repoRoot: string,
): Promise<LayerContent> {
	try {
		const context = await loadWorkingContext(mainaDir, repoRoot);
		const text = assembleWorkingText(context);
		const tokens = calculateTokens(text);
		return { name: "working", text, tokens, priority: 0 };
	} catch {
		const text = "Working context unavailable.";
		return {
			name: "working",
			text,
			tokens: calculateTokens(text),
			priority: 0,
		};
	}
}

/**
 * Build the episodic layer content. Never throws.
 */
function buildEpisodicLayer(mainaDir: string, filter?: string[]): LayerContent {
	try {
		decayAllEntries(mainaDir);

		let entries: import("./episodic").EpisodicEntry[];
		if (filter !== undefined && filter.length > 0) {
			// When filter is a string[], fetch entries for each type and merge
			const allEntries = filter.flatMap((type) => getEntries(mainaDir, type));
			// Deduplicate by id
			const seen = new Set<string>();
			entries = allEntries.filter((e) => {
				if (seen.has(e.id)) return false;
				seen.add(e.id);
				return true;
			});
		} else {
			entries = getEntries(mainaDir);
		}

		const text = assembleEpisodicText(entries);
		return {
			name: "episodic",
			text,
			tokens: calculateTokens(text),
			priority: 2,
		};
	} catch {
		return { name: "episodic", text: "", tokens: 0, priority: 2 };
	}
}

/**
 * Build the semantic layer content. Never throws.
 */
async function buildSemanticLayer(
	repoRoot: string,
	mainaDir: string,
	filter?: string[],
): Promise<LayerContent> {
	try {
		const text = await loadSemanticLayer(repoRoot, mainaDir, filter);
		return {
			name: "semantic",
			text,
			tokens: calculateTokens(text),
			priority: 1,
		};
	} catch {
		return { name: "semantic", text: "", tokens: 0, priority: 1 };
	}
}

/**
 * Build the retrieval layer content. Never throws.
 */
async function buildRetrievalLayer(
	query: string,
	options: RetrievalOptions,
): Promise<LayerContent> {
	try {
		const results = await search(query, options);
		const text = assembleRetrievalText(results);
		return {
			name: "retrieval",
			text,
			tokens: calculateTokens(text),
			priority: 3,
		};
	} catch {
		return { name: "retrieval", text: "", tokens: 0, priority: 3 };
	}
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Assemble context for a Maina command.
 *
 * 1. Determines which layers are needed via the selector.
 * 2. Builds a budget allocation for the command's mode.
 * 3. Loads each needed layer in parallel (resilient — failures produce empty layers).
 * 4. Runs truncateToFit to stay within token budget.
 * 5. Returns the combined text plus reporting metadata.
 */
export async function assembleContext(
	command: MainaCommand,
	options: ContextOptions = {},
): Promise<AssembledContext> {
	const repoRoot = options.repoRoot ?? process.cwd();
	const mainaDir = options.mainaDir ?? join(repoRoot, ".maina");

	const needs = getContextNeeds(command);
	const mode = getBudgetMode(command);
	const budget = assembleBudget(mode);

	// Determine which layers to build
	const layerPromises: Promise<LayerContent>[] = [];

	// Working layer
	if (needsLayer(needs, "working")) {
		layerPromises.push(buildWorkingLayer(mainaDir, repoRoot));
	}

	// Semantic layer — filter may be a string[]
	if (needsLayer(needs, "semantic")) {
		const semanticFilter = Array.isArray(needs.semantic)
			? needs.semantic
			: undefined;
		layerPromises.push(buildSemanticLayer(repoRoot, mainaDir, semanticFilter));
	}

	// Episodic layer — filter may be a string[]
	if (needsLayer(needs, "episodic")) {
		const episodicFilter = Array.isArray(needs.episodic)
			? needs.episodic
			: undefined;
		layerPromises.push(
			Promise.resolve(buildEpisodicLayer(mainaDir, episodicFilter)),
		);
	}

	// Retrieval layer — only if searchQuery is provided
	if (needsLayer(needs, "retrieval") && options.searchQuery) {
		const retrievalOptions: RetrievalOptions = {
			cwd: options.scope ?? repoRoot,
			tokenBudget: budget.retrieval,
		};
		layerPromises.push(
			buildRetrievalLayer(options.searchQuery, retrievalOptions),
		);
	} else if (needsLayer(needs, "retrieval")) {
		// Layer is needed but no query — add empty placeholder so it appears in reports
		layerPromises.push(
			Promise.resolve({
				name: "retrieval",
				text: "",
				tokens: 0,
				priority: 3,
			}),
		);
	}

	// Build all layers in parallel
	const builtLayers = await Promise.all(layerPromises);

	// Filter out completely empty non-working layers before truncation
	// (keep working even if empty so it's always reported)
	const nonEmptyOrWorking = builtLayers.filter(
		(l) => l.name === "working" || l.tokens > 0,
	);

	// Also keep retrieval in reports even if empty (for test expectations)
	const includedInTruncation =
		nonEmptyOrWorking.length > 0 ? nonEmptyOrWorking : builtLayers;

	// Apply budget truncation
	const surviving = truncateToFit(includedInTruncation, budget);
	const survivingNames = new Set(surviving.map((l) => l.name));

	// Build layer reports (all built layers, marked included/excluded)
	const layerReports: LayerReport[] = builtLayers.map((layer) => ({
		name: layer.name,
		tokens: layer.tokens,
		entries: layer.text.split("\n").filter((line) => line.trim()).length,
		included: survivingNames.has(layer.name),
	}));

	// Combine surviving layer texts
	const combinedParts = surviving
		.filter((l) => l.text.length > 0)
		.map((l) => l.text);

	const text = combinedParts.join("\n\n");
	const tokens = calculateTokens(text);

	return {
		text,
		tokens,
		layers: layerReports,
		mode,
		budget,
	};
}
