import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAuthConfig } from "../cloud/auth";
import { createCloudClient } from "../cloud/client";
import type { CloudEpisodicEntry } from "../cloud/types";
import { getChangedFiles, getRepoSlug, getStagedFiles } from "../git/index";
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
import { loadWikiContext } from "./wiki";
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
	modeOverride?: BudgetMode; // override the command-derived budget mode
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Escape regex metacharacters in a string so it can be safely used
 * as a literal term inside a ripgrep/grep alternation pattern.
 */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
		const {
			buildSemanticContext,
			assembleSemanticText,
			persistSemanticContext,
		} = await import("./semantic");

		// Populate task context from git for PageRank personalization
		const [staged, changed] = await Promise.all([
			getStagedFiles(repoRoot),
			getChangedFiles("HEAD~5", repoRoot),
		]);
		const touchedRelative = [...new Set([...staged, ...changed])];
		// Graph uses absolute paths, so convert for personalization lookup
		const touchedAbsolute = touchedRelative.map((f) => join(repoRoot, f));

		const taskContext = {
			touchedFiles: touchedAbsolute,
			mentionedFiles: [],
			currentTicketTerms: filter ?? [],
		};

		const semanticContext = await buildSemanticContext(
			repoRoot,
			mainaDir,
			taskContext,
		);

		// Persist entities + dependency graph to DB for cross-session recall
		persistSemanticContext(mainaDir, semanticContext, repoRoot);

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

		// Backfill touchedFiles from git if empty (so working layer is useful
		// even without explicit trackFile() calls)
		if (context.touchedFiles.length === 0) {
			const [staged, changed] = await Promise.all([
				getStagedFiles(repoRoot),
				getChangedFiles("HEAD~3", repoRoot),
			]);
			context.touchedFiles = [...new Set([...staged, ...changed])];
		}

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
 * Deduplicate cloud entries against local entries by hashing title+summary.
 * Returns only the cloud entries not already present locally.
 */
function deduplicateCloudEntries(
	localEntries: import("./episodic").EpisodicEntry[],
	cloudEntries: CloudEpisodicEntry[],
): import("./episodic").EpisodicEntry[] {
	const localHashes = new Set(
		localEntries.map((e) => {
			const key = `${e.summary}::${e.content}`;
			return createHash("sha256").update(key).digest("hex").slice(0, 16);
		}),
	);

	return cloudEntries
		.filter((ce) => {
			const key = `${ce.title}::${ce.summary}`;
			const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
			return !localHashes.has(hash);
		})
		.map((ce) => ({
			id: ce.id,
			content: ce.summary,
			summary: ce.title,
			relevance: (ce.relevanceScore ?? 1.0) * ce.decayFactor,
			accessCount: 0,
			createdAt: ce.createdAt,
			lastAccessedAt: ce.accessedAt,
			type: ce.entryType,
		}));
}

const CLOUD_URL = process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";

/**
 * Build the episodic layer content. Never throws.
 * When the user is logged into the cloud, also fetches team episodic entries
 * and merges them (deduplicated by title+summary hash) with local entries.
 */
async function buildEpisodicLayer(
	mainaDir: string,
	repoRoot: string,
	filter?: string[],
): Promise<LayerContent> {
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

		// Merge cloud episodic entries if logged in
		try {
			const auth = loadAuthConfig();
			if (auth.ok && auth.value.accessToken) {
				const client = createCloudClient({
					baseUrl: CLOUD_URL,
					token: auth.value.accessToken,
				});
				const repo = await getRepoSlug(repoRoot);
				const cloudResult = await client.getEpisodicEntries(repo);
				if (cloudResult.ok && cloudResult.value.length > 0) {
					const uniqueCloud = deduplicateCloudEntries(
						entries,
						cloudResult.value,
					);
					entries = [...entries, ...uniqueCloud];
					// Re-sort by relevance descending after merging
					entries.sort((a, b) => b.relevance - a.relevance);
				}
			}
		} catch {
			// Cloud fetch failure is silent — local entries are still available
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
	const mode = options.modeOverride ?? getBudgetMode(command);
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
		layerPromises.push(buildEpisodicLayer(mainaDir, repoRoot, episodicFilter));
	}

	// Retrieval layer — auto-generates search query from staged/changed files if not provided
	if (needsLayer(needs, "retrieval")) {
		let query = options.searchQuery;

		// Auto-generate query from recent changes if none provided
		if (!query) {
			try {
				const [staged, changed] = await Promise.all([
					getStagedFiles(repoRoot),
					getChangedFiles("HEAD~3", repoRoot),
				]);
				const recentFiles = [...new Set([...staged, ...changed])];
				if (recentFiles.length > 0) {
					// Extract meaningful terms, escape regex metacharacters in each,
					// then join with | for ripgrep alternation
					const terms = recentFiles
						.flatMap(
							(f) =>
								f
									.split("/")
									.pop()
									?.replace(/\.\w+$/, "")
									.split(/[-_.]/) ?? [],
						)
						.filter((t) => t.length > 3)
						.map(escapeRegex)
						.slice(0, 5);
					if (terms.length > 0) {
						query = terms.join("|");
					}
				}
			} catch {
				// Failed to auto-generate — leave as empty
			}
		}

		if (query) {
			const retrievalOptions: RetrievalOptions = {
				cwd: options.scope ?? repoRoot,
				tokenBudget: budget.retrieval,
			};
			layerPromises.push(buildRetrievalLayer(query, retrievalOptions));
		} else {
			// No query possible — add empty placeholder so it appears in reports
			layerPromises.push(
				Promise.resolve({
					name: "retrieval",
					text: "",
					tokens: 0,
					priority: 3,
				}),
			);
		}
	}

	// Wiki layer — synchronous, wrapped in a promise for parallel execution
	if (needsLayer(needs, "wiki")) {
		const wikiDir = join(mainaDir, "wiki");
		// Gather working files from a quick git check
		let workingFiles: string[] | undefined;
		try {
			const [staged, changed] = await Promise.all([
				getStagedFiles(repoRoot),
				getChangedFiles("HEAD~3", repoRoot),
			]);
			workingFiles = [...new Set([...staged, ...changed])];
		} catch {
			workingFiles = undefined;
		}

		const wikiResult = loadWikiContext({
			wikiDir,
			workingFiles,
			command,
		});

		if (wikiResult !== null) {
			layerPromises.push(Promise.resolve(wikiResult));
		} else {
			// Empty placeholder so it appears in reports
			layerPromises.push(
				Promise.resolve({
					name: "wiki",
					text: "",
					tokens: 0,
					priority: 4,
				}),
			);
		}
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
