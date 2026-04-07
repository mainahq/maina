/**
 * Wiki RL Signals — feedback signals for wiki-as-context effectiveness.
 *
 * Three signals:
 * 1. Wiki usage effectiveness — tracks whether wiki context led to accepted outputs
 * 2. Compilation prompt effectiveness — tracks accept rate per prompt hash
 * 3. Ebbinghaus decay scoring — calculates memory retention score per article type
 *
 * Uses simple JSON file storage in .maina/wiki/.signals.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArticleType } from "./types";
import { DECAY_HALF_LIVES } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WikiEffectivenessSignal {
	articlePath: string;
	command: string;
	accepted: boolean;
	timestamp: string;
}

export interface CompilationPromptSignal {
	promptHash: string;
	articlePath: string;
	indirectAcceptRate: number;
}

export interface ArticleLoadSignal {
	articles: string[];
	command: string;
	timestamp: string;
}

export interface WikiEffectivenessReport {
	totalLoads: number;
	totalAccepts: number;
	totalRejects: number;
	acceptRate: number;
	articleStats: Array<{
		article: string;
		loads: number;
		accepts: number;
		rejects: number;
		effectivenessScore: number; // accepts / loads
	}>;
	negativeArticles: string[]; // articles with < 50% accept rate
	dormantArticles: string[]; // ebbinghaus score < 0.2
}

interface SignalsStore {
	usageSignals: WikiEffectivenessSignal[];
	promptSignals: CompilationPromptSignal[];
	loadSignals?: ArticleLoadSignal[];
}

// ─── Storage ─────────────────────────────────────────────────────────────

const SIGNALS_FILE = ".signals.json";

function signalsPath(wikiDir: string): string {
	return join(wikiDir, SIGNALS_FILE);
}

function loadSignals(wikiDir: string): SignalsStore {
	const path = signalsPath(wikiDir);
	if (!existsSync(path)) {
		return { usageSignals: [], promptSignals: [] };
	}

	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as SignalsStore;
	} catch {
		return { usageSignals: [], promptSignals: [] };
	}
}

function saveSignals(wikiDir: string, store: SignalsStore): void {
	const path = signalsPath(wikiDir);
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(path, JSON.stringify(store, null, 2));
}

// ─── Signal 1: Wiki Usage Effectiveness ─────────────────────────────────

/**
 * Record wiki-as-context usage signal.
 *
 * Called after a command uses wiki articles as context. Tracks whether the
 * AI output (which included wiki context) was accepted by the developer.
 * This feeds the RL flywheel: articles that improve acceptance rates
 * get prioritized in future context assembly.
 *
 * @param feedbackDbPath - Path to the wiki directory (contains .signals.json)
 * @param articles - Article paths that were included in context
 * @param command - The maina command that used the articles
 * @param accepted - Whether the developer accepted the AI output
 */
export function recordWikiUsage(
	feedbackDbPath: string,
	articles: string[],
	command: string,
	accepted: boolean,
): void {
	const store = loadSignals(feedbackDbPath);
	const timestamp = new Date().toISOString();

	for (const articlePath of articles) {
		store.usageSignals.push({
			articlePath,
			command,
			accepted,
			timestamp,
		});
	}

	saveSignals(feedbackDbPath, store);
}

// ─── Signal 2: Compilation Prompt Effectiveness ─────────────────────────

/**
 * Get effectiveness metrics for a compilation prompt hash.
 *
 * Computes the indirect accept rate: what percentage of AI outputs were
 * accepted when articles compiled by this prompt hash were used as context.
 *
 * @param feedbackDbPath - Path to the wiki directory (contains .signals.json)
 * @param promptHash - The hash of the compilation prompt to evaluate
 * @returns Accept rate and sample size
 */
export function getPromptEffectiveness(
	feedbackDbPath: string,
	promptHash: string,
): { acceptRate: number; sampleSize: number } {
	const store = loadSignals(feedbackDbPath);

	// Find articles compiled with this prompt hash
	const promptArticles = store.promptSignals.filter(
		(s) => s.promptHash === promptHash,
	);

	if (promptArticles.length === 0) {
		return { acceptRate: 0, sampleSize: 0 };
	}

	// Get article paths associated with this prompt
	const articlePaths = new Set(promptArticles.map((s) => s.articlePath));

	// Find usage signals for these articles
	const relevantUsage = store.usageSignals.filter((s) =>
		articlePaths.has(s.articlePath),
	);

	if (relevantUsage.length === 0) {
		return { acceptRate: 0, sampleSize: 0 };
	}

	const acceptedCount = relevantUsage.filter((s) => s.accepted).length;
	const acceptRate = acceptedCount / relevantUsage.length;

	return {
		acceptRate: Math.round(acceptRate * 100) / 100,
		sampleSize: relevantUsage.length,
	};
}

// ─── Signal 3: Ebbinghaus Decay ─────────────────────────────────────────

/**
 * Calculate Ebbinghaus retention score for a wiki article.
 *
 * Uses the forgetting curve formula with article-type-specific half-lives:
 *   score = exp(-0.693 * daysSinceAccess / halfLife) + 0.1 * min(accessCount, 10)
 *
 * Decision articles (halfLife=180d) decay slowest because architectural decisions
 * remain relevant longest. Feature articles (halfLife=60d) decay fastest.
 *
 * Score is clamped to [0, 1].
 *
 * @param articleType - The type of wiki article (determines half-life)
 * @param daysSinceAccess - Days since the article was last accessed
 * @param accessCount - Total number of times the article has been accessed
 * @returns Retention score between 0 and 1
 */
export function calculateEbbinghausScore(
	articleType: ArticleType,
	daysSinceAccess: number,
	accessCount: number,
): number {
	const halfLife = DECAY_HALF_LIVES[articleType];

	// Forgetting curve: exp(-ln(2) * t / halfLife)
	const decayComponent = Math.exp((-Math.LN2 * daysSinceAccess) / halfLife);

	// Reinforcement bonus: 0.1 per access, capped at 10 accesses (max 1.0)
	const reinforcementComponent = 0.1 * Math.min(accessCount, 10);

	// Combine and clamp to [0, 1]
	const raw = decayComponent + reinforcementComponent;
	return Math.min(1, Math.max(0, raw));
}

// ─── Signal 4: Articles Loaded Tracking ─────────────────────────────────

/**
 * Record which wiki articles were loaded for a command.
 *
 * Non-blocking: never throws. Used by the context engine (L5) to record
 * which articles were included as context, so the RL flywheel can later
 * correlate them with accept/reject outcomes.
 *
 * @param signalsPath - Path to the .signals.json file
 * @param articles - Relative paths of articles loaded
 * @param command - The maina command that triggered the load
 */
export function recordArticlesLoaded(
	signalsPath: string,
	articles: string[],
	command: string,
): void {
	try {
		if (articles.length === 0) return;

		const wikiDir = dirname(signalsPath);
		const store = loadSignals(wikiDir);

		if (!store.loadSignals) {
			store.loadSignals = [];
		}

		store.loadSignals.push({
			articles,
			command,
			timestamp: new Date().toISOString(),
		});

		saveSignals(wikiDir, store);
	} catch {
		// Non-blocking — never throw from signal recording
	}
}

// ─── Signal 5: Wiki Effectiveness Report ────────────────────────────────

/**
 * Compute a comprehensive effectiveness report for wiki articles.
 *
 * Aggregates usage signals to determine which articles contribute to
 * accepted outputs and which are negatively correlated. Also identifies
 * dormant articles via Ebbinghaus decay scoring.
 *
 * @param signalsPath - Path to the .signals.json file
 * @returns Effectiveness report with per-article stats
 */
export function getWikiEffectivenessReport(
	signalsPath: string,
): WikiEffectivenessReport {
	const emptyReport: WikiEffectivenessReport = {
		totalLoads: 0,
		totalAccepts: 0,
		totalRejects: 0,
		acceptRate: 0,
		articleStats: [],
		negativeArticles: [],
		dormantArticles: [],
	};

	try {
		const wikiDir = dirname(signalsPath);
		const store = loadSignals(wikiDir);
		const { usageSignals } = store;

		if (usageSignals.length === 0) {
			return emptyReport;
		}

		// Aggregate per-article stats
		const statsMap = new Map<
			string,
			{ loads: number; accepts: number; rejects: number }
		>();

		for (const signal of usageSignals) {
			const existing = statsMap.get(signal.articlePath) ?? {
				loads: 0,
				accepts: 0,
				rejects: 0,
			};
			existing.loads += 1;
			if (signal.accepted) {
				existing.accepts += 1;
			} else {
				existing.rejects += 1;
			}
			statsMap.set(signal.articlePath, existing);
		}

		const totalAccepts = usageSignals.filter((s) => s.accepted).length;
		const totalRejects = usageSignals.length - totalAccepts;

		const articleStats = Array.from(statsMap.entries())
			.map(([article, stats]) => ({
				article,
				loads: stats.loads,
				accepts: stats.accepts,
				rejects: stats.rejects,
				effectivenessScore: stats.loads > 0 ? stats.accepts / stats.loads : 0,
			}))
			.sort((a, b) => b.effectivenessScore - a.effectivenessScore);

		// Negative articles: < 50% accept rate with at least 1 load
		const negativeArticles = articleStats
			.filter((s) => s.loads > 0 && s.effectivenessScore < 0.5)
			.map((s) => s.article);

		// Dormant articles: ebbinghaus score < 0.2 based on last usage timestamp
		const dormantArticles: string[] = [];
		for (const signal of usageSignals) {
			const daysSinceAccess =
				(Date.now() - new Date(signal.timestamp).getTime()) /
				(1000 * 60 * 60 * 24);

			// Determine article type from path prefix
			const articleType = inferArticleType(signal.articlePath);
			const score = calculateEbbinghausScore(articleType, daysSinceAccess, 0);
			if (score < 0.2 && !dormantArticles.includes(signal.articlePath)) {
				dormantArticles.push(signal.articlePath);
			}
		}

		return {
			totalLoads: usageSignals.length,
			totalAccepts: totalAccepts,
			totalRejects: totalRejects,
			acceptRate:
				usageSignals.length > 0 ? totalAccepts / usageSignals.length : 0,
			articleStats,
			negativeArticles,
			dormantArticles,
		};
	} catch {
		return emptyReport;
	}
}

/**
 * Infer article type from its relative path.
 * Falls back to "raw" if the directory prefix is unrecognized.
 */
function inferArticleType(articlePath: string): ArticleType {
	const firstSegment = articlePath.split("/")[0] ?? "";
	const typeMap: Record<string, ArticleType> = {
		modules: "module",
		entities: "entity",
		features: "feature",
		decisions: "decision",
		architecture: "architecture",
	};
	return typeMap[firstSegment] ?? "raw";
}
