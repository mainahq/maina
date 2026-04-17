import { join } from "node:path";

// ── Rule file sources that may contain project conventions ──────────────

const RULE_FILES = [
	"CLAUDE.md",
	"AGENTS.md",
	".cursorrules",
	".github/copilot-instructions.md",
	".windsurfrules",
	".clinerules",
	"CONTRIBUTING.md",
] as const;

export interface ImportedRule {
	source: string;
	content: string;
}

/**
 * Reads .maina/constitution.md, returns empty string if not found.
 * Never throws.
 */
export async function loadConstitution(mainaDir: string): Promise<string> {
	try {
		const filePath = join(mainaDir, "constitution.md");
		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			return "";
		}
		return await file.text();
	} catch {
		return "";
	}
}

/**
 * Scan existing rule files (CLAUDE.md, AGENTS.md, .cursorrules, etc.)
 * and extract their content. Returns an array of imported rules with
 * provenance. Does NOT duplicate — if a rule file's content is already
 * present in the constitution, it's skipped.
 *
 * Never throws.
 */
export async function importExistingRules(
	repoRoot: string,
	constitution: string,
): Promise<ImportedRule[]> {
	const rules: ImportedRule[] = [];

	for (const relPath of RULE_FILES) {
		try {
			const filePath = join(repoRoot, relPath);
			const file = Bun.file(filePath);
			const exists = await file.exists();
			if (!exists) continue;

			const content = await file.text();
			if (!content.trim()) continue;

			// Skip if the constitution already references this file
			if (constitution.includes(`imported_from: ${relPath}`)) continue;

			// For CONTRIBUTING.md, extract only relevant sections
			const filtered =
				relPath === "CONTRIBUTING.md"
					? extractContributingSections(content)
					: content;

			if (filtered.trim()) {
				rules.push({ source: relPath, content: filtered.trim() });
			}
		} catch {
			// File read error — skip
		}
	}

	return rules;
}

/**
 * Extract convention-relevant sections from CONTRIBUTING.md.
 * Keeps: Code Style, Conventions, Testing, Commit, Review sections.
 * Drops: How to Submit, License, CoC, etc.
 */
function extractContributingSections(content: string): string {
	const keepPatterns =
		/^#{1,3}\s*(code\s*style|conventions?|testing|commit|review|lint|format|architecture)/im;
	const lines = content.split("\n");
	const sections: string[] = [];
	let capturing = false;

	for (const line of lines) {
		if (/^#{1,3}\s/.test(line)) {
			capturing = keepPatterns.test(line);
		}
		if (capturing) {
			sections.push(line);
		}
	}

	return sections.join("\n");
}

/**
 * Format imported rules into a constitution-compatible block with provenance.
 */
export function formatImportedRules(rules: ImportedRule[]): string {
	if (rules.length === 0) return "";

	const blocks = rules.map(
		(r) => `<!-- imported_from: ${r.source} -->\n${r.content}`,
	);

	return `\n## Imported Rules\n\n${blocks.join("\n\n")}`;
}

/**
 * Reads .maina/prompts/<task>.md, returns null if not found.
 * Never throws.
 */
export async function loadUserOverride(
	mainaDir: string,
	task: string,
): Promise<string | null> {
	try {
		const filePath = join(mainaDir, "prompts", `${task}.md`);
		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			return null;
		}
		return await file.text();
	} catch {
		return null;
	}
}

/**
 * Merges default prompt with user override.
 * If userOverride is null, returns default.
 * If userOverride exists, it REPLACES the default entirely (user has full control).
 */
export function mergePrompts(
	defaultPrompt: string,
	userOverride: string | null,
): string {
	if (userOverride === null) {
		return defaultPrompt;
	}
	return userOverride;
}

/**
 * Replaces all {{variableName}} placeholders with values from the variables object.
 * Unreplaced variables are left as-is.
 */
export function renderTemplate(
	template: string,
	variables: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		if (Object.hasOwn(variables, key)) {
			return variables[key] ?? match;
		}
		return match;
	});
}
