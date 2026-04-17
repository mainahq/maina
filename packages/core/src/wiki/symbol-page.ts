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

	const limited = refs.slice(0, 20);
	const lines: string[] = ["```mermaid", "graph LR"];

	for (const ref of limited) {
		const safeName = ref.name.replace(/[^a-zA-Z0-9_]/g, "_");
		const safeEntity = entity.name.replace(/[^a-zA-Z0-9_]/g, "_");

		if (ref.direction === "inbound") {
			lines.push(
				`  ${safeName}["${ref.name}"] --> ${safeEntity}["${entity.name}"]`,
			);
		} else {
			lines.push(
				`  ${safeEntity}["${entity.name}"] --> ${safeName}["${ref.name}"]`,
			);
		}
	}

	lines.push("```");
	return lines.join("\n");
}

// ── Combined Generator ─────────────────────────────────────────────────

/**
 * Generate a full symbol page with all sections.
 * Deterministic: same entity + refs → same output.
 */
export function generateSymbolPage(
	entity: CodeEntity,
	refs: SymbolRef[] = [],
): string {
	const sections = [
		formatSignature(entity),
		"",
		formatLocation(entity),
		"",
		formatRefs(refs),
	];

	const diagram = formatMermaidDiagram(entity, refs);
	if (diagram) {
		sections.push("", "### Call Graph", "", diagram);
	}

	return sections.join("\n");
}
