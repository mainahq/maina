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
