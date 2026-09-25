/**
 * Setup — Prompt Loader
 *
 * Renders the universal setup prompt template, substituting the `{stack}`
 * and `{repoSummary}` placeholders. Pure function — no AI calls here;
 * callers feed the rendered string to the AI layer.
 *
 * The template is inlined at build time (text import) so the bundled CLI
 * in `dist/` does not depend on `.md` files sitting next to its chunks.
 */

import universalTemplate from "./prompts/universal.md" with { type: "text" };

interface UniversalPromptInputs {
	/** JSON-serialized `StackContext` (caller decides stringification). */
	stack: string;
	/** Output of `summarizeRepo()`. */
	repoSummary: string;
}

/** Render the universal setup prompt. */
export function loadUniversalPrompt(inputs: UniversalPromptInputs): string {
	return universalTemplate
		.replaceAll("{stack}", inputs.stack)
		.replaceAll("{repoSummary}", inputs.repoSummary);
}
