/**
 * Decision Extractor — parses adr/*.md into structured ExtractedDecision records.
 *
 * ADRs follow the structured format from `maina design`:
 *   # ADR-NNNN: Title (or # NNNN. Title)
 *   ## Status
 *   ## Context
 *   ## Decision
 *   ## Rationale / Consequences
 *   ## Alternatives Considered
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Result } from "../../db/index";
import type { DecisionStatus, ExtractedDecision } from "../types";

// ─── Parsing Helpers ─────────────────────────────────────────────────────

/**
 * Extract sections from an ADR markdown file.
 * Returns a map of lowercase section name → content.
 *
 * Handles nested subsections (### Positive, ### Negative) by merging
 * them into the parent ## section rather than creating separate entries.
 */
function parseSections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const lines = content.split("\n");
	let currentSection = "";
	const currentLines: string[] = [];

	function flushSection(): void {
		if (currentSection) {
			sections.set(currentSection, currentLines.join("\n").trim());
		}
		currentLines.length = 0;
	}

	for (const line of lines) {
		// Match ## headings (h2) but NOT ### headings (h3)
		const h2Match = line.match(/^##\s+(?!#)(.+)/);
		if (h2Match) {
			flushSection();
			currentSection = (h2Match[1] ?? "").trim().toLowerCase();
			continue;
		}
		// ### subsections get merged into the current parent section
		if (currentSection) {
			currentLines.push(line);
		}
	}
	flushSection();

	return sections;
}

/**
 * Extract ID from filename. Handles:
 *   "0002-jwt-strategy.md" → "0002-jwt-strategy"
 */
function extractId(filename: string): string {
	return basename(filename, ".md");
}

/**
 * Extract title from first H1 heading. Handles:
 *   "# ADR-0002: Use JWT for Authentication"
 *   "# 0002. Use JWT for Authentication"
 */
function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0] ?? "";
	const heading = firstLine.replace(/^#+\s*/, "");

	// Strip "ADR-NNNN: " or "NNNN. " prefixes
	const stripped = heading.replace(/^ADR-\d+:\s*/, "").replace(/^\d+\.\s*/, "");

	return stripped.trim();
}

/**
 * Normalize status string to DecisionStatus.
 * The status section may contain the status on its own line,
 * possibly with additional text (e.g. "Superseded by ADR-0005").
 * Extract the first meaningful line and match against known statuses.
 */
function normalizeStatus(raw: string): DecisionStatus {
	// Take the first non-empty line from the status section
	const firstLine =
		raw
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	const lower = firstLine.toLowerCase();
	if (lower.startsWith("accepted")) return "accepted";
	if (lower.startsWith("proposed")) return "proposed";
	if (lower.startsWith("deprecated")) return "deprecated";
	if (lower.startsWith("superseded")) return "superseded";
	return "proposed";
}

/**
 * Extract bullet list items from a section.
 */
function extractBulletItems(text: string): string[] {
	const items: string[] = [];
	for (const line of text.split("\n")) {
		const match = line.match(/^-\s+(.+)/);
		if (match?.[1]) {
			items.push(match[1].trim());
		}
	}
	return items;
}

/**
 * Extract file/entity references from content.
 * Looks for paths like src/auth/jwt.ts or packages/core/src/...
 */
function extractEntityMentions(content: string): string[] {
	const mentions: string[] = [];
	const regex = /(?:src\/|packages\/)[^\s,)]+\.(?:ts|js|tsx|jsx|py|go|rs)/g;
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard pattern for regex exec
	while ((match = regex.exec(content)) !== null) {
		mentions.push(match[0]);
	}
	return [...new Set(mentions)];
}

// ─── Public API ──────────────────────────────────────────────────────────

export function extractSingleDecision(
	adrPath: string,
): Result<ExtractedDecision> {
	if (!existsSync(adrPath)) {
		return { ok: false, error: `ADR file does not exist: ${adrPath}` };
	}

	let content: string;
	try {
		content = readFileSync(adrPath, "utf-8");
	} catch (_e) {
		return { ok: false, error: `Failed to read ADR: ${adrPath}` };
	}

	const id = extractId(adrPath);
	const title = extractTitle(content);
	const sections = parseSections(content);

	const statusRaw = sections.get("status") ?? "";
	const status = normalizeStatus(statusRaw);

	const context = sections.get("context") ?? "";
	const decision = sections.get("decision") ?? "";

	// Rationale can be under "rationale", "consequences", or "positive"
	const rationale =
		sections.get("rationale") ??
		sections.get("consequences") ??
		sections.get("positive") ??
		"";

	// Alternatives under various headings — gracefully return empty if missing
	const altSection =
		sections.get("alternatives considered") ??
		sections.get("alternatives") ??
		"";
	const alternativesRejected = extractBulletItems(altSection);

	// Entity mentions: check "entities" section first, then always fall back to full content scan
	const entitiesSection = sections.get("entities") ?? "";
	const entityBullets = extractBulletItems(entitiesSection);
	const entityMentions =
		entityBullets.length > 0 ? entityBullets : extractEntityMentions(content);

	return {
		ok: true,
		value: {
			id,
			title,
			status,
			context,
			decision,
			rationale,
			alternativesRejected,
			entityMentions,
			constitutionAlignment: [],
		},
	};
}

export function extractDecisions(adrDir: string): Result<ExtractedDecision[]> {
	if (!existsSync(adrDir)) {
		return { ok: false, error: `ADR directory does not exist: ${adrDir}` };
	}

	let entries: string[];
	try {
		entries = readdirSync(adrDir);
	} catch {
		return { ok: false, error: `Failed to read ADR directory: ${adrDir}` };
	}

	const decisions: ExtractedDecision[] = [];

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;

		const result = extractSingleDecision(join(adrDir, entry));
		if (result.ok) {
			decisions.push(result.value);
		}
	}

	return { ok: true, value: decisions };
}
