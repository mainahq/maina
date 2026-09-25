import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// ── Glob-scoped constitution (constitution.d/*.md) ──────────────────────

interface ConstitutionShard {
	filename: string;
	content: string;
	appliesTo: string[];
}

/**
 * Parse `applies_to:` frontmatter from a constitution shard.
 * Format: `applies_to: ["apps/web/**", "packages/ui/**"]`
 */
function parseAppliesTo(content: string): string[] {
	const match = content.match(
		/^---[\s\S]*?applies_to:\s*\[([^\]]*)\][\s\S]*?---/m,
	);
	if (!match?.[1]) return [];
	return match[1]
		.split(",")
		.map((s) => s.trim().replace(/["']/g, ""))
		.filter(Boolean);
}

/**
 * Strip frontmatter from a constitution shard, returning only the body.
 */
function stripFrontmatter(content: string): string {
	return content.replace(/^---[\s\S]*?---\n?/, "").trim();
}

/**
 * Simple glob matcher — supports `*` (any segment) and `**` (any depth).
 * No external dependency needed for basic patterns.
 */
function matchGlob(pattern: string, filePath: string): boolean {
	const regex = pattern
		.replace(/\./g, "\\.")
		.replace(/\*\*/g, "{{GLOBSTAR}}")
		.replace(/\*/g, "[^/]*")
		.replace(/\{\{GLOBSTAR\}\}/g, ".*");
	return new RegExp(`^${regex}$`).test(filePath);
}

/**
 * Load all constitution shards from `constitution.d/`.
 * Returns shards sorted alphabetically by filename.
 * Never throws.
 */
export async function loadConstitutionShards(
	mainaDir: string,
): Promise<ConstitutionShard[]> {
	const shardsDir = join(mainaDir, "constitution.d");
	if (!existsSync(shardsDir)) return [];

	try {
		const files = readdirSync(shardsDir)
			.filter((f) => f.endsWith(".md"))
			.sort();

		const shards: ConstitutionShard[] = [];
		for (const filename of files) {
			try {
				const content = readFileSync(join(shardsDir, filename), "utf-8");
				const appliesTo = parseAppliesTo(content);
				const body = stripFrontmatter(content);
				if (body) {
					shards.push({ filename, content: body, appliesTo });
				}
			} catch {
				// Skip unreadable shards
			}
		}
		return shards;
	} catch {
		return [];
	}
}

/**
 * Load constitution with glob-scoped shards.
 *
 * If `filePath` is provided, only shards whose `applies_to:` globs
 * match the file path are included. If no `filePath`, all shards are included.
 *
 * Backward compatible: if `constitution.d/` doesn't exist, returns root only.
 */
export async function loadScopedConstitution(
	mainaDir: string,
	filePath?: string,
): Promise<string> {
	const root = await loadConstitution(mainaDir);
	const shards = await loadConstitutionShards(mainaDir);

	if (shards.length === 0) return root;

	const filtered = filePath
		? shards.filter(
				(s) =>
					s.appliesTo.length === 0 ||
					s.appliesTo.some((glob) => matchGlob(glob, filePath)),
			)
		: shards;

	if (filtered.length === 0) return root;

	const shardBlocks = filtered
		.map((s) => `<!-- from: constitution.d/${s.filename} -->\n${s.content}`)
		.join("\n\n");

	return root ? `${root}\n\n${shardBlocks}` : shardBlocks;
}
