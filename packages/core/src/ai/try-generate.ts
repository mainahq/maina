import { getApiKey, isHostMode } from "../config/index";

export interface DelegationPrompt {
	task: string;
	systemPrompt: string;
	userPrompt: string;
	promptHash: string;
}

export interface TryAIResult {
	text: string | null;
	fromAI: boolean;
	hostDelegation: boolean;
	promptHash?: string;
	/** Structured prompt for host to process when hostDelegation is true */
	delegation?: DelegationPrompt;
}

/**
 * Single entry point for all AI calls.
 *
 * Returns:
 * - { text, fromAI: true } when AI generates a response (has API key)
 * - { text: null, hostDelegation: true, delegation } when in host mode (no key)
 *   The delegation contains structured prompts for the host agent to process.
 * - { text: null } when AI is not available and not in host mode
 */
export async function tryAIGenerate(
	task: string,
	mainaDir: string,
	variables: Record<string, string>,
	userPrompt: string,
): Promise<TryAIResult> {
	const apiKey = getApiKey();

	// Not in host mode and no key → unavailable
	if (!apiKey && !isHostMode()) {
		return { text: null, fromAI: false, hostDelegation: false };
	}

	try {
		const { buildSystemPrompt } = await import("../prompts/engine");

		// Build the prompt (needed for both direct call and delegation)
		const builtPrompt = await buildSystemPrompt(task, mainaDir, variables);

		// If we have an API key, make the direct call
		if (apiKey) {
			const { generate } = await import("./index");
			const result = await generate({
				task,
				systemPrompt: builtPrompt.prompt,
				userPrompt,
				mainaDir,
			});

			// Skip delegation responses from generate() — we handle it below
			if (
				result.text &&
				!result.text.startsWith("[HOST_DELEGATION]") &&
				!result.text.includes("API key")
			) {
				return {
					text: result.text,
					fromAI: true,
					hostDelegation: false,
					promptHash: builtPrompt.hash,
				};
			}
		}

		// Host mode — return structured delegation for host agent to process
		return {
			text: null,
			fromAI: false,
			hostDelegation: true,
			promptHash: builtPrompt.hash,
			delegation: {
				task,
				systemPrompt: builtPrompt.prompt,
				userPrompt,
				promptHash: builtPrompt.hash,
			},
		};
	} catch {
		// AI failure — return null for fallback
	}
	return { text: null, fromAI: false, hostDelegation: false };
}
