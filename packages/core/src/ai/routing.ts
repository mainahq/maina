/**
 * Model routing with an enforced budget (#334, spec §4 routing job, §10
 * metrics). `routeTask` picks the tier with `chooseTier` (the
 * `decide(task.tier)` answer, or the top tier when that answer is
 * uncertain), then holds it to `budget.dailyUsd` / `budget.perTaskUsd`: on
 * a breach it degrades to the dearest lower tier that fits, or stops with a
 * message, per `budget.onBreach`. Every routing decision is logged with its
 * savings estimate against a baseline tier. Pure given its ports.
 */

import {
	type BudgetBreach,
	type BudgetSpend,
	findBudgetBreach,
	formatBudgetBreach,
	NO_SPEND,
} from "../config/budget";
import type { Config } from "../config/schema";
import type { Result } from "../db/index";
import type { DecidePorts } from "../decide/decide";
import { MODEL_TIERS } from "../decide/types-catalog";
import type { LoggerPort } from "../ports/logger";
import { chooseTier, type ModelTier, type TierChoice } from "./tiers";

/** Estimated cost of one task on each tier, in US dollars. */
export type TierCosts = Readonly<Record<ModelTier, number>>;

/**
 * Rough per-task estimates for the default models: about 8k input and 1k
 * output tokens at public list prices. Callers with real prices or
 * measured usage pass their own.
 */
const DEFAULT_TIER_COSTS_USD: TierCosts = {
	mechanical: 0.015,
	standard: 0.04,
	architectural: 0.07,
};

/** The tier a task would run on without routing, for the savings estimate. */
const DEFAULT_BASELINE_TIER: ModelTier = "standard";

type RoutePorts = Readonly<{
	decide: DecidePorts;
	/** Receives one entry per routing decision. */
	logger: LoggerPort;
}>;

export type RouteInput = Readonly<{
	task: string;
	budget: Config["budget"];
	/** Defaults to nothing spent. */
	spend?: BudgetSpend;
	/** Defaults to `DEFAULT_TIER_COSTS_USD`. */
	costPerTaskUsd?: TierCosts;
	/** Defaults to `standard`. */
	baselineTier?: ModelTier;
}>;

type RouteDecision = TierChoice &
	Readonly<{
		/** Set when a budget breach moved the task down from this tier. */
		degradedFrom?: ModelTier;
		estimatedCostUsd: number;
		baselineTier: ModelTier;
		/** Baseline cost minus the routed tier's; negative when dearer. */
		savingsUsd: number;
	}>;

type RouteError = Readonly<{
	kind: "budget_exceeded";
	breach: BudgetBreach;
	message: string;
}>;

/** Tiers cheaper than `tier`, dearest first. */
function lowerTiers(tier: ModelTier): readonly ModelTier[] {
	return MODEL_TIERS.slice(0, MODEL_TIERS.indexOf(tier)).reverse();
}

/**
 * Routes `input.task` to a tier and enforces the budget (see the header).
 * Logs one `info` entry per routed decision, or one `warn` entry when the
 * budget stops the task.
 */
export function routeTask(
	ports: RoutePorts,
	input: RouteInput,
): Result<RouteDecision, RouteError> {
	const costs = input.costPerTaskUsd ?? DEFAULT_TIER_COSTS_USD;
	const spend = input.spend ?? NO_SPEND;
	const baselineTier = input.baselineTier ?? DEFAULT_BASELINE_TIER;
	const choice = chooseTier(ports.decide, input.task);

	const breach = findBudgetBreach(input.budget, spend, costs[choice.tier]);
	const fallback =
		breach !== undefined && input.budget.onBreach === "degrade"
			? lowerTiers(choice.tier).find(
					(t) => findBudgetBreach(input.budget, spend, costs[t]) === undefined,
				)
			: undefined;

	if (breach !== undefined && fallback === undefined) {
		const message = formatBudgetBreach(breach);
		ports.logger.warn("model routing stopped by budget", {
			task: input.task,
			tier: choice.tier,
			onBreach: input.budget.onBreach,
			breachedCap: breach.cap,
			limitUsd: breach.limitUsd,
			spentUsd: breach.spentUsd,
			estimatedCostUsd: breach.costUsd,
		});
		return { ok: false, error: { kind: "budget_exceeded", breach, message } };
	}

	const tier = fallback ?? choice.tier;
	const estimatedCostUsd = costs[tier];
	const decision: RouteDecision = {
		...choice,
		tier,
		...(fallback === undefined ? {} : { degradedFrom: choice.tier }),
		estimatedCostUsd,
		baselineTier,
		savingsUsd: costs[baselineTier] - estimatedCostUsd,
	};
	ports.logger.info("model routed", {
		task: input.task,
		tier,
		decidedTier: choice.decidedTier,
		confidence: choice.confidence,
		threshold: choice.threshold,
		reason: choice.reason,
		...(breach === undefined
			? {}
			: { degradedFrom: choice.tier, breachedCap: breach.cap }),
		estimatedCostUsd,
		baselineTier,
		savingsUsd: decision.savingsUsd,
	});
	return { ok: true, value: decision };
}
