/**
 * AI Fix Generation — generates minimal code fixes for verification findings.
 *
 * Takes findings from the Verify Engine, checks cache first, then uses the
 * Prompt Engine + AI to generate unified-diff fixes. Results are cached so
 * identical findings never hit the AI twice.
 *
 * Response format expected from AI:
 *   ### Fix for finding: <tool>/<ruleId> at <file>:<line>
 *   **Explanation:** <why this fix works>
 *   **Confidence:** high|medium|low
 *   ```diff
 *   --- a/<file>
 *   +++ b/<file>
 *   @@ ... @@
 *    context
 *   -old line
 *   +new line
 *   ```
 */

import { generate } from "../ai/index";
import { hashContent } from "../cache/keys";
import { createCacheManager } from "../cache/manager";
import { buildSystemPrompt } from "../prompts/engine";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface FixSuggestion {
	finding: Finding;
	diff: string;
	explanation: string;
	confidence: "high" | "medium" | "low";
}

export interface FixResult {
	suggestions: FixSuggestion[];
	cached: boolean;
	model?: string;
}

export interface FixOptions {
	mainaDir: string;
	cwd?: string;
	contextText?: string;
}

// ─── Hashing ──────────────────────────────────────────────────────────────

/**
 * Deterministic hash of a finding for cache key generation.
 * Includes tool, file, line, message, and ruleId.
 */
export function hashFinding(finding: Finding): string {
	const input = [
		finding.tool,
		finding.file,
		String(finding.line),
		finding.message,
		finding.ruleId ?? "",
	].join("|");
	return hashContent(input);
}

/**
 * Build a composite cache key from multiple findings.
 */
function buildFixCacheKey(findings: Finding[]): string {
	const hashes = findings.map(hashFinding).sort();
	return hashContent(`fix:${hashes.join(":")}`);
}

// ─── Response Parsing ─────────────────────────────────────────────────────

/**
 * Match a parsed fix block to its original finding by matching tool/ruleId
 * and file:line from the header.
 */
function matchFinding(
	header: string,
	findings: Finding[],
): Finding | undefined {
	// Header format: "### Fix for finding: <tool>/<ruleId> at <file>:<line>"
	// or "### Fix for finding: <tool> at <file>:<line>" (no ruleId)
	const headerMatch = header.match(
		/### Fix for finding:\s*(\S+?)(?:\/(\S+))?\s+at\s+(\S+?):(\d+)/,
	);
	if (!headerMatch) {
		// Fall back to index-based matching (handled by caller)
		return undefined;
	}

	const [, tool, ruleId, file, lineStr] = headerMatch;
	const line = Number.parseInt(lineStr ?? "0", 10);

	// Try exact match first (tool + ruleId + file + line)
	for (const f of findings) {
		if (f.tool === tool && f.file === file && f.line === line) {
			return f;
		}
	}

	// Try matching by tool/ruleId and file
	for (const f of findings) {
		const fTool = f.ruleId ? `${f.tool}/${f.ruleId}` : f.tool;
		const headerTool = ruleId ? `${tool}/${ruleId}` : (tool ?? "");
		if (fTool === headerTool && f.file === file) {
			return f;
		}
	}

	// Try matching by file and line only
	for (const f of findings) {
		if (f.file === file && f.line === line) {
			return f;
		}
	}

	return undefined;
}

/**
 * Parse the structured AI response into FixSuggestion objects.
 *
 * Expected format per fix:
 *   ### Fix for finding: <tool>/<ruleId> at <file>:<line>
 *   **Explanation:** <text>
 *   **Confidence:** high|medium|low
 *   ```diff
 *   <unified diff content>
 *   ```
 */
export function parseFixResponse(
	response: string,
	findings: Finding[],
): FixSuggestion[] {
	if (!response.trim()) {
		return [];
	}

	const suggestions: FixSuggestion[] = [];

	// Split response into fix blocks by "### Fix for finding:" headers
	const blocks = response.split(/(?=### Fix for finding:)/);

	let blockIndex = 0;
	for (const block of blocks) {
		if (!block.includes("### Fix for finding:")) {
			continue;
		}

		// Extract explanation
		const explanationMatch = block.match(
			/\*\*Explanation:\*\*\s*(.+?)(?:\n\n|\n\*\*)/s,
		);
		const explanation = explanationMatch?.[1]?.trim() ?? "";

		// Extract confidence
		const confidenceMatch = block.match(
			/\*\*Confidence:\*\*\s*(high|medium|low)/i,
		);
		const confidence = (confidenceMatch?.[1]?.toLowerCase() ??
			"low") as FixSuggestion["confidence"];

		// Extract diff
		const diffMatch = block.match(/```diff\n([\s\S]*?)```/);
		const diff = diffMatch?.[1]?.trim() ?? "";

		if (!diff) {
			continue;
		}

		// Match to finding
		const header = block.split("\n")[0] ?? "";
		const finding = matchFinding(header, findings) ?? findings[blockIndex];

		if (!finding) {
			continue;
		}

		suggestions.push({
			finding,
			diff,
			explanation,
			confidence,
		});

		blockIndex++;
	}

	return suggestions;
}

// ─── Prompt Formatting ───────────────────────────────────────────────────

/**
 * Format findings into a text block for the prompt template.
 */
function formatFindings(findings: Finding[]): string {
	return findings
		.map((f, i) => {
			const ruleInfo = f.ruleId ? ` (${f.ruleId})` : "";
			const colInfo = f.column ? `:${f.column}` : "";
			return `${i + 1}. [${f.severity.toUpperCase()}] ${f.tool}${ruleInfo} — ${f.file}:${f.line}${colInfo}\n   ${f.message}`;
		})
		.join("\n\n");
}

/**
 * Build the user prompt instructing the AI how to format its response.
 */
function buildUserPrompt(findings: Finding[]): string {
	const formatted = formatFindings(findings);
	return [
		"Generate fixes for the following findings. Use this exact format for each fix:",
		"",
		"### Fix for finding: <tool>/<ruleId> at <file>:<line>",
		"",
		"**Explanation:** <why this fix works>",
		"",
		"**Confidence:** high|medium|low",
		"",
		"```diff",
		"--- a/<file>",
		"+++ b/<file>",
		"@@ ... @@",
		" context",
		"-old line",
		"+new line",
		"```",
		"",
		"---",
		"",
		"Findings:",
		"",
		formatted,
	].join("\n");
}

// ─── Main Entry Point ────────────────────────────────────────────────────

/**
 * Generate fixes for the given findings using AI.
 *
 * 1. Return early for empty findings.
 * 2. Check cache by findings hash — return cached result if found.
 * 3. Build system prompt via Prompt Engine.
 * 4. Call AI with formatted findings and context.
 * 5. Parse response into FixSuggestion objects.
 * 6. Cache the result and return.
 */
export async function generateFixes(
	findings: Finding[],
	options: FixOptions,
): Promise<FixResult> {
	// No findings, no work
	if (findings.length === 0) {
		return { suggestions: [], cached: false };
	}

	const { mainaDir, contextText } = options;

	// Build cache key from all findings
	const cacheKey = buildFixCacheKey(findings);

	// Check cache first
	const cache = createCacheManager(mainaDir);
	const cachedEntry = cache.get(cacheKey);
	if (cachedEntry !== null) {
		try {
			const parsed = JSON.parse(cachedEntry.value) as FixResult;
			return { ...parsed, cached: true };
		} catch {
			// Corrupted cache entry — fall through to regenerate
		}
	}

	// Build system prompt via Prompt Engine
	const sourceText = contextText ?? "No additional source context available.";
	const findingsText = formatFindings(findings);

	const builtPrompt = await buildSystemPrompt("fix", mainaDir, {
		findings: findingsText,
		source: sourceText,
		conventions: "",
	});

	// Build user prompt
	const userPrompt = buildUserPrompt(findings);

	// Call AI (single call for all findings — batched)
	const aiResult = await generate({
		task: "fix",
		systemPrompt: builtPrompt.prompt,
		userPrompt,
		files: findings.map((f) => f.file),
		mainaDir,
	});

	// Parse the response
	const suggestions = parseFixResponse(aiResult.text, findings);

	const result: FixResult = {
		suggestions,
		cached: false,
		model: aiResult.model,
	};

	// Cache the result (TTL 0 = forever for fix tasks, keyed by content hash)
	cache.set(cacheKey, JSON.stringify(result), {
		ttl: 0,
		model: aiResult.model,
	});

	return result;
}
