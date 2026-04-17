/**
 * Symbol Page Templates — structured per-symbol wiki pages.
 *
 * Generates markdown with: signature, location, refs, Mermaid diagram.
 * Pure function: (entity, refs) → markdown string.
 * Deterministic: same input → same output (cacheable via content hash).
 */

import type { CodeEntity } from "./extractors/code";

// ── Types ──────────────────────────────────────────────────────────────

export interface SymbolRef {
	name: string;
	file: string;
	line: number;
	direction: "inbound" | "outbound";
}

// ── Formatters ─────────────────────────────────────────────────────────

const KIND_LABELS: Record<CodeEntity["kind"], string> = {
	function: "Function",
	class: "Class",
	interface: "Interface",
	type: "Type Alias",
	variable: "Variable",
	enum: "Enum",
};

/**
 * Format the signature block showing entity kind, name, and export status.
 */
export function formatSignature(entity: CodeEntity): string {
	const kind = KIND_LABELS[entity.kind] ?? entity.kind;
	const exported = entity.exported ? "exported" : "internal";
	return `## ${entity.name}\n\n**${kind}** (${exported})`;
}

/**
 * Format file + line as a repo-relative location.
 */
export function formatLocation(entity: CodeEntity): string {
	return `**Location:** \`${entity.file}:${entity.line}\``;
}

/**
 * Format inbound and outbound refs as bullet lists with file links.
 * Caps at 20 per direction to keep pages manageable.
 */
export function formatRefs(refs: SymbolRef[]): string {
	const inbound = refs.filter((r) => r.direction === "inbound").slice(0, 20);
	const outbound = refs.filter((r) => r.direction === "outbound").slice(0, 20);

	const sections: string[] = [];

	if (inbound.length > 0) {
		sections.push("### Callers (inbound)\n");
		for (const ref of inbound) {
			sections.push(`- \`${ref.name}\` (\`${ref.file}:${ref.line}\`)`);
		}
	}

	if (outbound.length > 0) {
		if (sections.length > 0) sections.push("");
		sections.push("### Callees (outbound)\n");
		for (const ref of outbound) {
			sections.push(`- \`${ref.name}\` (\`${ref.file}:${ref.line}\`)`);
		}
	}

	if (sections.length === 0) {
		return "### References\n\nNo references found.";
	}

	return sections.join("\n");
}

/**
 * Generate a Mermaid graph LR diagram showing call relationships.
 * Caps at 20 total refs. Renders without JS in GitHub/markdown viewers.
 */
export function formatMermaidDiagram(
	entity: CodeEntity,
	refs: SymbolRef[],
): string {
	if (refs.length === 0) return "";

	// Cap per direction (consistent with formatRefs)
	const inbound = refs.filter((r) => r.direction === "inbound").slice(0, 20);
	const outbound = refs.filter((r) => r.direction === "outbound").slice(0, 20);
	const limited = [...inbound, ...outbound];

	const lines: string[] = ["```mermaid", "graph LR"];
	const safeEntity = entity.name.replace(/[^a-zA-Z0-9_]/g, "_");
	const usedIds = new Set<string>();

	for (let i = 0; i < limited.length; i++) {
		const ref = limited[i];
		if (!ref) continue;
		// Unique node ID: sanitized name + index to prevent collisions
		let safeRef = ref.name.replace(/[^a-zA-Z0-9_]/g, "_");
		if (usedIds.has(safeRef)) {
			safeRef = `${safeRef}_${i}`;
		}
		usedIds.add(safeRef);

		if (ref.direction === "inbound") {
			lines.push(
				`  ${safeRef}["${ref.name}"] --> ${safeEntity}["${entity.name}"]`,
			);
		} else {
			lines.push(
				`  ${safeEntity}["${entity.name}"] --> ${safeRef}["${ref.name}"]`,
			);
		}
	}

	lines.push("```");
	return lines.join("\n");
}

// ── LLM Prose ──────────────────────────────────────────────────────────

/**
 * Generate a prose description for a symbol via one LLM pass.
 * Returns null if AI is unavailable. Content-hash keyed for caching.
 */
export async function generateSymbolProse(
	entity: CodeEntity,
	refs: SymbolRef[],
	mainaDir: string,
): Promise<string | null> {
	try {
		const { tryAIGenerate } = await import("../ai/try-generate");

		const refSummary = refs
			.slice(0, 10)
			.map((r) => `${r.direction}: ${r.name} (${r.file})`)
			.join(", ");

		const result = await tryAIGenerate(
			"symbol-page",
			mainaDir,
			{
				symbol_name: entity.name,
				symbol_kind: entity.kind,
				symbol_file: entity.file,
				symbol_line: String(entity.line),
				symbol_exported: String(entity.exported),
				refs: refSummary || "none",
			},
			`Write a 2-3 sentence description of the ${entity.kind} "${entity.name}" defined in ${entity.file}:${entity.line}. It is ${entity.exported ? "exported" : "internal"}. References: ${refSummary || "none"}. Be concise and factual. Do not repeat the signature.`,
		);

		if (result.fromAI && result.text) {
			return result.text.trim();
		}
	} catch {
		// AI unavailable — fall back to null
	}

	return null;
}

// ── Combined Generator ─────────────────────────────────────────────────

export interface SymbolPageOptions {
	/** Path to .maina directory for AI prose generation */
	mainaDir?: string;
	/** Skip AI prose (for testing or when AI is unavailable) */
	skipProse?: boolean;
}

/**
 * Generate a full symbol page with all sections.
 * When mainaDir is provided and AI is available, includes LLM-generated prose.
 * Falls back to template-only when AI is unavailable.
 */
export async function generateSymbolPage(
	entity: CodeEntity,
	refs: SymbolRef[] = [],
	options: SymbolPageOptions = {},
): Promise<string> {
	const sections = [formatSignature(entity), "", formatLocation(entity)];

	// LLM prose (optional — requires mainaDir and AI availability)
	if (options.mainaDir && !options.skipProse) {
		const prose = await generateSymbolProse(entity, refs, options.mainaDir);
		if (prose) {
			sections.push("", prose);
		}
	}

	sections.push("", formatRefs(refs));

	const diagram = formatMermaidDiagram(entity, refs);
	if (diagram) {
		sections.push("", "### Call Graph", "", diagram);
	}

	return sections.join("\n");
}
