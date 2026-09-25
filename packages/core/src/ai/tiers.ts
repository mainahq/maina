import type { Config } from "../config/schema";
import { type DecidePorts, decide, defaultDecidePorts } from "../decide/decide";
import { MODEL_TIERS } from "../decide/types-catalog";
import { DEFAULT_POLICY } from "../policy/defaults";

export type ModelTier = "mechanical" | "standard" | "architectural";

/** The most capable tier: where an uncertain task goes. */
const TOP_TIER: ModelTier = "architectural";

interface ModelResolution {
	tier: ModelTier;
	modelId: string;
	provider: string;
}

/** How `chooseTier` picked a task's tier. */
export type TierChoice = Readonly<{
	/** What `decide(task.tier)` answered; `undefined` when it failed. */
	decidedTier: ModelTier | undefined;
	/** The tier to run on. */
	tier: ModelTier;
	/** Probability of `decidedTier`; 0 when `decide` failed. */
	confidence: number;
	/** The policy's `task.tier` confidence threshold. */
	threshold: number;
	/** `confident`: the decided tier was kept; `uncertain`: escalated to the top tier. */
	reason: "confident" | "uncertain";
}>;

/**
 * Routes a task to a tier through `decide(task.tier)`. The decided tier is
 * kept when its confidence is at or above the policy's `task.tier`
 * threshold; below it (or when `decide` fails) the task is uncertain and
 * goes to the top tier, so doubt costs money rather than quality.
 */
export function chooseTier(ports: DecidePorts, task: string): TierChoice {
	const threshold =
		ports.policy.decisions["task.tier"]?.thresholds.confidence ??
		DEFAULT_POLICY.decisions["task.tier"].thresholds.confidence;
	const result = decide(ports, {
		type: "task.tier",
		state: { trusted: { task }, untrusted: {} },
		questions: [{ kind: "choice", id: "tier", options: MODEL_TIERS }],
	});
	const decision = result.ok ? result.value[0] : undefined;
	const decidedTier = MODEL_TIERS.find((t) => t === decision?.answer);
	const confidence =
		decidedTier === undefined ? 0 : (decision?.confidence ?? 0);
	const confident = decidedTier !== undefined && confidence >= threshold;
	return {
		decidedTier,
		tier: confident ? decidedTier : TOP_TIER,
		confidence,
		threshold,
		reason: confident ? "confident" : "uncertain",
	};
}

/**
 * Maps a task name to its model tier via `chooseTier` with the built-in
 * policy and backends.
 * - mechanical: commit, tests, slop, compress
 * - standard: review, plan, design, fix (and any unknown task)
 * - architectural: design-review, architecture, learn
 */
export function getTaskTier(task: string): ModelTier {
	return chooseTier(defaultDecidePorts, task).tier;
}

/**
 * Resolves the model ID and provider for a given task using the provided
 * config. Budget-free: `routeTask` adds budget enforcement and costs.
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
