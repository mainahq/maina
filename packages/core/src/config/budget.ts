/**
 * The enforceable budget (#293, enforced by the router in #334). Pure: the
 * caller supplies what has been spent and what the next call would cost;
 * this only says whether that call would cross a cap.
 */

import type { Config } from "./schema";

type Budget = Config["budget"];

/** What has been spent so far, in US dollars. */
export type BudgetSpend = Readonly<{
	/** Spent in the current UTC day. */
	todayUsd: number;
	/** Spent by the running command (task). */
	taskUsd: number;
}>;

export const NO_SPEND: BudgetSpend = { todayUsd: 0, taskUsd: 0 };

/** The cap a call would cross, with the numbers behind it. */
export type BudgetBreach = Readonly<{
	cap: "dailyUsd" | "perTaskUsd";
	limitUsd: number;
	spentUsd: number;
	/** Estimated cost of the call that would cross the cap. */
	costUsd: number;
}>;

/**
 * The first cap (daily, then per task) that spending `costUsd` more would
 * exceed, or `undefined` when the call fits. Reaching a cap exactly is not
 * a breach; a `null` cap is disabled.
 */
export function findBudgetBreach(
	budget: Budget,
	spend: BudgetSpend,
	costUsd: number,
): BudgetBreach | undefined {
	const caps = [
		["dailyUsd", budget.dailyUsd, spend.todayUsd],
		["perTaskUsd", budget.perTaskUsd, spend.taskUsd],
	] as const;
	for (const [cap, limitUsd, spentUsd] of caps) {
		if (limitUsd !== null && spentUsd + costUsd > limitUsd) {
			return { cap, limitUsd, spentUsd, costUsd };
		}
	}
	return undefined;
}

function usd(value: number): string {
	return `$${value.toFixed(2)}`;
}

/** One line for the user: which cap, the numbers, and how to lift it. */
export function formatBudgetBreach(breach: BudgetBreach): string {
	const scope = breach.cap === "dailyUsd" ? "daily" : "per-task";
	const wait =
		breach.cap === "dailyUsd"
			? " or wait for the next UTC day"
			: " or split the task";
	return (
		`Budget stop: the ${scope} cap budget.${breach.cap} is ${usd(breach.limitUsd)}, ` +
		`${usd(breach.spentUsd)} is spent and this call needs ~${usd(breach.costUsd)}. ` +
		`Raise budget.${breach.cap} in the Maina config${wait}.`
	);
}
