/** The MCP prompt catalog (FR-MCP-3), in listing order. */

import { planFeaturePrompt } from "./plan-feature";
import { preMergePrompt } from "./pre-merge";
import { reviewChangesPrompt } from "./review-changes";
import type { PromptDefinition } from "./shared";

export const PROMPTS: readonly PromptDefinition[] = [
	reviewChangesPrompt,
	preMergePrompt,
	planFeaturePrompt,
];

/** The prompts whose every named tool is among `enabled`. */
export function servablePrompts(
	enabled: readonly string[],
): PromptDefinition[] {
	return PROMPTS.filter((p) => p.tools.every((t) => enabled.includes(t)));
}
