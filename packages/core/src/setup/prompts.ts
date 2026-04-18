/**
 * Setup — Prompt Loader
 *
 * Loads the universal setup prompt template from disk and substitutes
 * the `{stack}` and `{repoSummary}` placeholders. Pure function — no AI
 * calls here; callers feed the rendered string to the AI layer.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface UniversalPromptInputs {
	/** JSON-serialized `StackContext` (caller decides stringification). */
	stack: string;
	/** Output of `summarizeRepo()`. */
	repoSummary: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "prompts", "universal.md");

/**
 * Load and render the universal setup prompt. Throws only if the template
 * file is missing from the package — an invariant error the caller cannot fix.
 */
export function loadUniversalPrompt(inputs: UniversalPromptInputs): string {
	const template = readFileSync(TEMPLATE_PATH, "utf-8");
	return template
		.replaceAll("{stack}", inputs.stack)
		.replaceAll("{repoSummary}", inputs.repoSummary);
}

/** Path to the raw template file — useful for tooling that wants the source. */
export function getUniversalPromptPath(): string {
	return TEMPLATE_PATH;
}
