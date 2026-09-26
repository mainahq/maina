import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadAuthConfig } from "../cloud/auth";
import { createCloudClient } from "../cloud/client";
import type { CloudEpisodicEntry } from "../cloud/types";
import type { Result } from "../db/index";
import { getChangedFiles, getRepoSlug, getStagedFiles } from "../git/index";
import type { GraphStorePorts } from "../graph/store/types";
import {
	type OpenedGraph,
	type OpenGraphError,
	openCodeGraph,
	systemFs,
} from "../graph/system";
import type { ClockPort } from "../ports/clock";
import type { EnvPort } from "../ports/env";
import {
	assembleBudget,
	type BudgetAllocation,
	type BudgetMode,
	calculateTokens,
	type LayerContent,
	truncateToFit,
} from "./budget";
import {
	assembleEpisodicText,
	decayAllEntries,
	type EpisodicEntry,
	getEntries,
} from "./episodic";
import {
	DEFAULT_CLOUD_EPISODIC_TIMEOUT_MS,
	loadCloudEpisodicEntries,
} from "./episodic-cloud";
import {
	assembleRetrievalText,
	type RetrievalOptions,
	search,
} from "./retrieval";
import type { MainaCommand } from "./selector";
import { getBudgetMode, getContextNeeds, needsLayer } from "./selector";
import {
	assembleSemanticText,
	buildSemanticContext,
	loadConstitution,
	loadCustomContext,
	persistSemanticContext,
} from "./semantic";
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
	repoRoot: string; // explicit repository root
	env: EnvPort; // environment (MAINA_CLOUD_URL for team episodic entries)
	mainaDir?: string; // defaults to join(repoRoot, '.maina')
	searchQuery?: string; // for retrieval layer
	scope?: string; // limit to specific directory (relative to repoRoot)
	modeOverride?: BudgetMode; // override the command-derived budget mode
	modelContextWindow?: number; // override default 200K token context window
	/** Code-graph store ports; defaults to the store under `mainaDir`. */
	graph?: GraphStorePorts;
	/** Directory holding the cloud `auth.json`; defaults to `~/.maina`. */
	authDir?: string;
	/** Ceiling on the team episodic fetch from the cloud (default 1.5s). */
	cloudTimeoutMs?: number;
	/** Clock for the cloud episodic cache's freshness; wall clock by default. */
	clock?: ClockPort;
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

/** Semantic filters that need the code graph; no filter needs everything. */
const GRAPH_SECTIONS: ReadonlySet<string> = new Set(["graph", "entities"]);

const needsCodeGraph = (filter?: readonly string[]): boolean =>
	filter === undefined || filter.some((f) => GRAPH_SECTIONS.has(f));

type SemanticLayerRequest = Readonly<{
	repoRoot: string;
	mainaDir: string;
	filter?: string[];
	/** Ceiling on the graph's code snippets. */
	codeBudgetTokens: number;
	/** Graph store ports; the store under `mainaDir` when absent. */
	graph?: GraphStorePorts;
}>;

/**
 * The semantic layer (FR-GRAPH-5): constitution and custom context, plus,
 * when the command's filter asks for it, the code graph's view of the
 * touched files. The graph is read from its store and synced for the
 * touched paths only; the repository is listed once, when the store is
 * still empty.
 */
async function loadSemanticLayer(
	request: SemanticLayerRequest,
): Promise<string> {
	const { repoRoot, mainaDir, filter } = request;
	if (!needsCodeGraph(filter)) {
		const [constitution, customContext] = await Promise.all([
			loadConstitution(mainaDir),
			loadCustomContext(mainaDir),
		]);
		return assembleSemanticText(
			{
				entities: [],
				graph: { nodes: new Set(), edges: new Map() },
				scores: new Map(),
				constitution,
				customContext,
				code: null,
			},
			filter,
		);
	}

	// Caller-supplied ports stay open: the caller owns their lifetime.
	const opened: Result<OpenedGraph, OpenGraphError> = request.graph
		? { ok: true, value: { ports: request.graph, close: () => undefined } }
		: openCodeGraph(mainaDir);
	if (!opened.ok) return fallbackSemanticText(mainaDir);
	try {
		const [staged, changed] = await Promise.all([
			getStagedFiles(repoRoot),
			getChangedFiles("HEAD~5", repoRoot),
		]);
		const built = await buildSemanticContext(opened.value.ports, {
			root: repoRoot,
			mainaDir,
			touchedFiles: [...new Set([...staged, ...changed])],
			codeBudgetTokens: request.codeBudgetTokens,
		});
		if (!built.ok) return fallbackSemanticText(mainaDir);
		// `explain`, `ticket` and `stats` still read the legacy tables.
		persistSemanticContext(mainaDir, built.value);
		return assembleSemanticText(built.value, filter);
	} catch {
		// An unexpected failure (a grammar that will not load) degrades to the
		// constitution and conventions, as a failed graph read does.
		return fallbackSemanticText(mainaDir);
	} finally {
		opened.value.close();
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
	localEntries: EpisodicEntry[],
	cloudEntries: readonly CloudEpisodicEntry[],
): EpisodicEntry[] {
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

const DEFAULT_CLOUD_URL = "https://api.mainahq.com";

const systemClock: ClockPort = { now: () => Date.now() };

type EpisodicLayerRequest = Readonly<{
	mainaDir: string;
	repoRoot: string;
	cloudUrl: string;
	/** Where the cloud `auth.json` lives; `~/.maina` when absent. */
	authDir?: string;
	cloudTimeoutMs: number;
	clock: ClockPort;
	filter?: string[];
}>;

/**
 * The team's episodic entries from the cloud, or none when not logged in.
 * Bounded and cached (#439): a slow or unreachable cloud costs at most one
 * `cloudTimeoutMs` per cache window, never the client's full retry budget.
 */
async function loadTeamEpisodicEntries(
	request: EpisodicLayerRequest,
): Promise<readonly CloudEpisodicEntry[]> {
	const auth = loadAuthConfig(request.authDir);
	if (!auth.ok || !auth.value.accessToken) return [];
	const client = createCloudClient({
		baseUrl: request.cloudUrl,
		token: auth.value.accessToken,
		timeoutMs: request.cloudTimeoutMs,
		maxRetries: 0,
	});
	const repo = await getRepoSlug(request.repoRoot);
	// A fingerprint of the token keeps one account's cached team entries from
	// being served after logging in as another.
	const account = createHash("sha256")
		.update(auth.value.accessToken)
		.digest("hex")
		.slice(0, 12);
	return loadCloudEpisodicEntries({
		mainaDir: request.mainaDir,
		fs: systemFs,
		key: `${request.cloudUrl}|${repo}|${account}`,
		fetch: () => client.getEpisodicEntries(repo),
		timeoutMs: request.cloudTimeoutMs,
		now: () => request.clock.now(),
	});
}

/**
 * Build the episodic layer content. Never throws.
 * When the user is logged into the cloud, also merges the team's episodic
 * entries (deduplicated by title+summary hash) with local entries.
 */
async function buildEpisodicLayer(
	request: EpisodicLayerRequest,
): Promise<LayerContent> {
	const { mainaDir, filter } = request;
	try {
		decayAllEntries(mainaDir);

		let entries: EpisodicEntry[];
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
			const cloudEntries = await loadTeamEpisodicEntries(request);
			if (cloudEntries.length > 0) {
				const uniqueCloud = deduplicateCloudEntries(entries, cloudEntries);
				entries = [...entries, ...uniqueCloud];
				// Re-sort by relevance descending after merging
				entries.sort((a, b) => b.relevance - a.relevance);
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
	request: SemanticLayerRequest,
): Promise<LayerContent> {
	try {
		const text = await loadSemanticLayer(request);
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
	options: ContextOptions,
): Promise<AssembledContext> {
	const { repoRoot } = options;
	const cloudUrl = options.env.get("MAINA_CLOUD_URL") ?? DEFAULT_CLOUD_URL;
	const mainaDir = options.mainaDir ?? join(repoRoot, ".maina");

	const needs = getContextNeeds(command);
	const mode = options.modeOverride ?? getBudgetMode(command);
	const budget = assembleBudget(mode, options.modelContextWindow);

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
		layerPromises.push(
			buildSemanticLayer({
				repoRoot,
				mainaDir,
				filter: semanticFilter,
				// Half the layer for code; the rest for constitution and overview.
				codeBudgetTokens: Math.floor(budget.semantic / 2),
				graph: options.graph,
			}),
		);
	}

	// Episodic layer — filter may be a string[]
	if (needsLayer(needs, "episodic")) {
		const episodicFilter = Array.isArray(needs.episodic)
			? needs.episodic
			: undefined;
		layerPromises.push(
			buildEpisodicLayer({
				mainaDir,
				repoRoot,
				cloudUrl,
				authDir: options.authDir,
				cloudTimeoutMs:
					options.cloudTimeoutMs ?? DEFAULT_CLOUD_EPISODIC_TIMEOUT_MS,
				clock: options.clock ?? systemClock,
				filter: episodicFilter,
			}),
		);
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
				cwd: options.scope ? resolve(repoRoot, options.scope) : repoRoot,
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
