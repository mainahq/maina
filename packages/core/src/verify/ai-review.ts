/**
 * AI Review — semantic code review using LLM.
 *
 * Two tiers:
 * - mechanical (always-on): diff + referenced functions, <3s, warnings only
 * - standard (--deep): adds spec/plan context, can emit errors
 */

import type { AIContext } from "../ai/index";
import { tryAIGenerate } from "../ai/try-generate";
import { buildCacheKey, hashContent } from "../cache/keys";
import { createCacheManager } from "../cache/manager";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReferencedFunction {
	name: string;
	filePath: string;
	body: string;
}

export interface EntityWithBody {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	filePath: string;
	body: string;
}

/** `root` + `env` decide the AI provider, key and host delegation. */
export interface AIReviewOptions extends AIContext {
	diff: string;
	entities: EntityWithBody[];
	deep?: boolean;
	specContext?: string;
	planContext?: string;
	mainaDir: string;
}

export interface AIReviewResult {
	findings: Finding[];
	skipped: boolean;
	tier: "mechanical" | "standard";
	duration: number;
}

const MAX_REFS_PER_FILE = 3;

// ─── Referenced Function Resolution ───────────────────────────────────────

/**
 * Extract function/method names called in added lines of a diff,
 * then match them against known entities to get their bodies.
 * Capped at MAX_REFS_PER_FILE (3) to bound token usage.
 */
export function resolveReferencedFunctions(
	diff: string,
	entities: EntityWithBody[],
): ReferencedFunction[] {
	// Extract added lines from diff
	const addedLines = diff
		.split("\n")
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.join("\n");

	if (!addedLines.trim()) return [];

	// Extract identifier-like tokens that could be function calls
	// Match word( pattern — likely a function call
	const callPattern = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
	const calledNames = new Set<string>();
	for (const match of addedLines.matchAll(callPattern)) {
		if (match[1]) calledNames.add(match[1]);
	}

	// Remove common keywords that match the pattern
	const KEYWORDS = new Set([
		"if",
		"for",
		"while",
		"switch",
		"catch",
		"function",
		"return",
		"new",
		"typeof",
		"instanceof",
		"await",
		"async",
		"import",
		"export",
		"const",
		"let",
		"var",
		"class",
		"throw",
	]);
	for (const kw of KEYWORDS) calledNames.delete(kw);

	if (calledNames.size === 0) return [];

	// Match against known entities
	const matched: ReferencedFunction[] = [];
	for (const entity of entities) {
		if (matched.length >= MAX_REFS_PER_FILE) break;
		if (calledNames.has(entity.name)) {
			matched.push({
				name: entity.name,
				filePath: entity.filePath,
				body: entity.body,
			});
		}
	}

	return matched;
}

// ─── AI Review Runner ─────────────────────────────────────────────────────

const VALID_RULE_IDS = new Set([
	"ai-review/cross-function",
	"ai-review/edge-case",
	"ai-review/dead-code",
	"ai-review/contract",
	"ai-review/spec-compliance",
	"ai-review/architecture",
	"ai-review/coverage-gap",
]);

/**
 * Parse the AI response JSON into Finding[].
 * Returns null on any parse failure — caller should treat as skip.
 */
function parseAIResponse(text: string, deep: boolean): Finding[] | null {
	try {
		// Strip markdown fences if present
		const cleaned = text
			.replace(/^```json?\n?/m, "")
			.replace(/\n?```$/m, "")
			.trim();
		const parsed = JSON.parse(cleaned);

		if (!parsed || !Array.isArray(parsed.findings)) return null;

		const findings: Finding[] = [];
		for (const f of parsed.findings) {
			if (!f.file || typeof f.line !== "number" || !f.message) continue;

			let severity: Finding["severity"] =
				f.severity === "error" ? "error" : "warning";
			// Mechanical mode caps at warning
			if (!deep && severity === "error") severity = "warning";

			const ruleId = VALID_RULE_IDS.has(f.ruleId)
				? f.ruleId
				: "ai-review/edge-case";

			findings.push({
				tool: "ai-review",
				file: f.file,
				line: f.line,
				message: f.message,
				severity,
				ruleId,
			});
		}

		return findings;
	} catch {
		return null;
	}
}

/**
 * Run AI review on a diff.
 *
 * - mechanical (default): uses "code-review" task → mechanical tier model, caps at warning
 * - standard (deep=true): uses "deep-code-review" task → standard tier model, can emit error
 *
 * Gracefully skips on AI failure, host delegation, or malformed response.
 */
export async function runAIReview(
	options: AIReviewOptions,
): Promise<AIReviewResult> {
	const start = performance.now();
	const {
		diff,
		entities,
		deep = false,
		specContext,
		planContext,
		mainaDir,
		root,
		env,
	} = options;

	if (!diff.trim()) {
		return {
			findings: [],
			skipped: true,
			tier: deep ? "standard" : "mechanical",
			duration: 0,
		};
	}

	// Resolve referenced functions from entities
	const refs = resolveReferencedFunctions(diff, entities);
	const refsText =
		refs.length > 0
			? refs
					.map(
						(r) =>
							`### ${r.name} (${r.filePath})\n\`\`\`typescript\n${r.body}\n\`\`\``,
					)
					.join("\n\n")
			: "None found.";

	const task = deep ? "deep-code-review" : "code-review";
	const reviewMode = deep
		? "deep — check everything including spec compliance. May emit error severity."
		: "mechanical — check cross-function consistency and edge cases only. All findings are warning severity.";

	// ── Cache check ──────────────────────────────────────────────────────
	const cacheKey = await buildCacheKey({
		task,
		extra: hashContent(diff + refsText),
	});

	const cache = createCacheManager(mainaDir);
	const cached = cache.get(cacheKey);
	if (cached) {
		try {
			const findings = JSON.parse(cached.value) as Finding[];
			const duration = Math.round(performance.now() - start);
			return {
				findings,
				skipped: false,
				tier: deep ? "standard" : "mechanical",
				duration,
			};
		} catch {
			// Corrupted cache entry — fall through to AI
		}
	}

	// ── AI call ──────────────────────────────────────────────────────────
	const variables: Record<string, string> = {
		diff,
		referencedFunctions: refsText,
		reviewMode,
	};

	if (deep && specContext) variables.specContext = specContext;
	if (deep && planContext) variables.planContext = planContext;

	const userPrompt = `Review this diff for semantic issues:\n\n${diff}`;

	const aiResult = await tryAIGenerate(task, mainaDir, variables, userPrompt, {
		root,
		env,
	});

	const duration = Math.round(performance.now() - start);
	const tier = deep ? "standard" : "mechanical";

	// Host delegation or no AI → skip (no cache entry per spec)
	if (!aiResult.text || aiResult.hostDelegation) {
		return { findings: [], skipped: true, tier, duration };
	}

	// Parse response
	const findings = parseAIResponse(aiResult.text, deep);
	if (findings === null) {
		return { findings: [], skipped: true, tier, duration };
	}

	// Cache successful result
	cache.set(cacheKey, JSON.stringify(findings));

	return { findings, skipped: false, tier, duration };
}
