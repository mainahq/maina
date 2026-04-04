import { getApiKey, isHostMode } from "../config/index";

export interface TryAIResult {
	text: string | null;
	fromAI: boolean;
	hostDelegation: boolean;
	promptHash?: string;
}

/**
 * Encapsulates the common pattern: check API key -> build prompt -> generate -> fallback.
 *
 * Returns:
 * - { text, fromAI: true } when AI generates a response
 * - { text, hostDelegation: true } when running inside a host agent (Claude Code/Cursor)
 *   and the prompt should be delegated to the host. The text contains the structured prompt.
 * - { text: null } when AI is not available (no key, error, etc.)
 */
export async function tryAIGenerate(
	task: string,
	mainaDir: string,
	variables: Record<string, string>,
	userPrompt: string,
): Promise<TryAIResult> {
	const apiKey = getApiKey();
	if (!apiKey && !isHostMode()) {
		return { text: null, fromAI: false, hostDelegation: false };
	}

	try {
		const { buildSystemPrompt } = await import("../prompts/engine");
		const { generate } = await import("./index");

		const builtPrompt = await buildSystemPrompt(task, mainaDir, variables);
		const result = await generate({
			task,
			systemPrompt: builtPrompt.prompt,
			userPrompt,
			mainaDir,
		});

		if (result.text?.startsWith("[HOST_DELEGATION]")) {
			// In CLI mode, extract the user prompt as usable content
			// The delegation text contains: [HOST_DELEGATION] Task: ...\n\nSystem: ...\n\nUser: <content>
			const userIdx = result.text.indexOf("\n\nUser: ");
			const extractedContent =
				userIdx !== -1
					? result.text.slice(userIdx + 8) // length of "\n\nUser: "
					: null;

			if (extractedContent) {
				return {
					text: extractedContent,
					fromAI: false,
					hostDelegation: true,
					promptHash: builtPrompt.hash,
				};
			}

			return {
				text: result.text,
				fromAI: false,
				hostDelegation: true,
				promptHash: builtPrompt.hash,
			};
		}

		if (result.text && !result.text?.includes("API key")) {
			return {
				text: result.text,
				fromAI: true,
				hostDelegation: false,
				promptHash: builtPrompt.hash,
			};
		}
	} catch {
		// AI failure — return null for fallback
	}
	return { text: null, fromAI: false, hostDelegation: false };
}
