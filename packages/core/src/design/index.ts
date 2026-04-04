/**
 * Architecture Decision Record (ADR) management.
 *
 * Handles auto-numbering, scaffolding MADR templates, and listing ADRs.
 * ADRs capture WHAT and WHY — no implementation details.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tryAIGenerate } from "../ai/try-generate";
import type { Result } from "../db/index";
import { toKebabCase } from "../utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdrSummary {
	number: string;
	title: string;
	status: string;
	path: string;
}

/**
 * Extract numeric prefix from an ADR filename.
 * Returns the number if the name matches NNNN-*.md pattern, or null.
 */
function extractNumber(name: string): number | null {
	const match = name.match(/^(\d{4})-.*\.md$/);
	if (!match?.[1]) return null;
	return Number.parseInt(match[1], 10);
}

// ── MADR Template ────────────────────────────────────────────────────────────

function buildMadrTemplate(number: string, title: string): string {
	const today = new Date().toISOString().split("T")[0];
	return `# ${number}. ${title}

Date: ${today}

## Status

Proposed

## Context

What is the issue that we're seeing that is motivating this decision or change?

[NEEDS CLARIFICATION] Describe the context.

## Decision

What is the change that we're proposing and/or doing?

[NEEDS CLARIFICATION] Describe the decision.

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- [NEEDS CLARIFICATION]

### Negative

- [NEEDS CLARIFICATION]

### Neutral

- [NEEDS CLARIFICATION]

## High-Level Design

### System Overview

[NEEDS CLARIFICATION]

### Component Boundaries

[NEEDS CLARIFICATION]

### Data Flow

[NEEDS CLARIFICATION]

### External Dependencies

[NEEDS CLARIFICATION]

## Low-Level Design

### Interfaces & Types

[NEEDS CLARIFICATION]

### Function Signatures

[NEEDS CLARIFICATION]

### DB Schema Changes

[NEEDS CLARIFICATION]

### Sequence of Operations

[NEEDS CLARIFICATION]

### Error Handling

[NEEDS CLARIFICATION]

### Edge Cases

[NEEDS CLARIFICATION]
`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan `adr/` directory for existing ADRs (files named NNNN-*.md),
 * and return the next number zero-padded to 4 digits.
 *
 * Empty dir -> "0001". Existing 0001, 0002 -> "0003".
 * Creates adr/ if it doesn't exist.
 */
export async function getNextAdrNumber(
	adrDir: string,
): Promise<Result<string>> {
	try {
		if (!existsSync(adrDir)) {
			mkdirSync(adrDir, { recursive: true });
			return { ok: true, value: "0001" };
		}

		const entries = readdirSync(adrDir);
		let maxNumber = 0;

		for (const entry of entries) {
			const num = extractNumber(entry);
			if (num !== null && num > maxNumber) {
				maxNumber = num;
			}
		}

		const next = (maxNumber + 1).toString().padStart(4, "0");
		return { ok: true, value: next };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to get next ADR number: ${message}`,
		};
	}
}

/**
 * Create `adr/NNNN-kebab-title.md` using the MADR template.
 * Returns the file path on success.
 */
export async function scaffoldAdr(
	adrDir: string,
	number: string,
	title: string,
): Promise<Result<string>> {
	try {
		const kebabTitle = toKebabCase(title);
		const filename = `${number}-${kebabTitle}.md`;
		const filePath = join(adrDir, filename);

		if (!existsSync(adrDir)) {
			mkdirSync(adrDir, { recursive: true });
		}

		const content = buildMadrTemplate(number, title);
		await Bun.write(filePath, content);

		return { ok: true, value: filePath };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to scaffold ADR: ${message}`,
		};
	}
}

/**
 * List existing ADRs with number, title, status.
 * Reads each NNNN-*.md file to extract title (line 1) and status (after ## Status).
 * Returns sorted by number.
 */
export async function listAdrs(adrDir: string): Promise<Result<AdrSummary[]>> {
	try {
		if (!existsSync(adrDir)) {
			return {
				ok: false,
				error: `ADR directory does not exist: ${adrDir}`,
			};
		}

		const entries = readdirSync(adrDir);
		const summaries: AdrSummary[] = [];

		for (const entry of entries) {
			const num = extractNumber(entry);
			if (num === null) continue;

			const filePath = join(adrDir, entry);
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n");

			// Extract title from first line: "# NNNN. Title"
			let title = "";
			const titleMatch = lines[0]?.match(/^#\s+\d{4}\.\s+(.+)/);
			if (titleMatch?.[1]) {
				title = titleMatch[1];
			}

			// Extract status: find "## Status" header, then take next non-empty line
			let status = "Unknown";
			const statusIdx = lines.findIndex((l) =>
				l.trim().toLowerCase().startsWith("## status"),
			);
			if (statusIdx !== -1) {
				for (let i = statusIdx + 1; i < lines.length; i++) {
					const line = lines[i]?.trim();
					if (line && line.length > 0) {
						status = line;
						break;
					}
				}
			}

			summaries.push({
				number: num.toString().padStart(4, "0"),
				title,
				status,
				path: filePath,
			});
		}

		summaries.sort((a, b) => a.number.localeCompare(b.number));

		return { ok: true, value: summaries };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: `Failed to list ADRs: ${message}`,
		};
	}
}

/**
 * Generate HLD/LLD sections from a spec using AI (standard tier).
 * Returns the generated markdown content, or null if AI is unavailable.
 */
export async function generateHldLld(
	specContent: string,
	mainaDir: string,
): Promise<Result<string | null>> {
	try {
		const variables: Record<string, string> = {
			spec: specContent,
			conventions: "",
		};

		const aiResult = await tryAIGenerate(
			"design-hld-lld",
			mainaDir,
			variables,
			`Generate HLD and LLD sections for this spec:\n\n${specContent}`,
		);

		if (!aiResult.text) {
			if (aiResult.delegation) {
				// Return delegation prompt for host to process
				return {
					ok: true,
					value: `<!-- AI delegation: process this prompt to generate HLD/LLD -->\n\n${aiResult.delegation.userPrompt}`,
				};
			}
			return {
				ok: false,
				error:
					"AI generation unavailable — set MAINA_API_KEY or OPENROUTER_API_KEY to enable HLD/LLD generation",
			};
		}

		return { ok: true, value: aiResult.text };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, error: `HLD/LLD generation failed: ${message}` };
	}
}
