import type { Config } from "../config/schema";
import { choiceAnswer, decide, defaultDecidePorts } from "../decide/decide";
import { MODEL_TIERS } from "../decide/types-catalog";

export type ModelTier = "mechanical" | "standard" | "architectural" | "local";

interface ModelResolution {
	tier: ModelTier;
	modelId: string;
	provider: string;
}

/**
 * Maps a task name to its model tier via `decide` (`task.tier`).
 * - mechanical: commit, tests, slop, compress
 * - standard: review, plan, design, fix (and any unknown task)
 * - architectural: design-review, architecture, learn
 * - local: not auto-assigned; user must explicitly set
 */
export function getTaskTier(task: string): ModelTier {
	const result = decide(defaultDecidePorts, {
		type: "task.tier",
		state: { trusted: { task }, untrusted: {} },
		questions: [{ kind: "choice", id: "tier", options: MODEL_TIERS }],
	});
	return choiceAnswer(result, MODEL_TIERS, "standard");
}

/**
 * Resolves the model ID and provider for a given task using the provided config.
 */
export function resolveModel(
	task: string,
	config: Pick<Config, "models" | "provider">,
): ModelResolution {
	const tier = getTaskTier(task);
	const modelId = config.models[tier];
	return {
		tier,
		modelId,
		provider: config.provider,
	};
}
