import type { MainaConfig } from "../config/index";

export type ModelTier = "mechanical" | "standard" | "architectural" | "local";

export interface ModelResolution {
	tier: ModelTier;
	modelId: string;
	provider: string;
}

const MECHANICAL_TASKS = new Set([
	"commit",
	"tests",
	"slop",
	"compress",
	"code-review",
]);
const ARCHITECTURAL_TASKS = new Set(["design-review", "architecture", "learn"]);

/**
 * Maps a task name to its model tier.
 * - mechanical: commit, tests, slop, compress
 * - standard: review, plan, design, fix (and any unknown task)
 * - architectural: design-review, architecture, learn
 * - local: not auto-assigned; user must explicitly set
 */
export function getTaskTier(task: string): ModelTier {
	if (MECHANICAL_TASKS.has(task)) {
		return "mechanical";
	}
	if (ARCHITECTURAL_TASKS.has(task)) {
		return "architectural";
	}
	// standard is the default for known standard tasks and all unknowns
	return "standard";
}

/**
 * Resolves the model ID and provider for a given task using the provided config.
 */
export function resolveModel(
	task: string,
	config: MainaConfig,
): ModelResolution {
	const tier = getTaskTier(task);
	const modelId = config.models[tier];
	return {
		tier,
		modelId,
		provider: config.provider,
	};
}
