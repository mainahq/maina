/**
 * Run budgets (FR-HAR-5). Pure: usage is measured by the caller.
 *
 * A run's budgets come from the policy (`run.<context>.budgets`) and cover
 * the whole run, every attempt and review of it: a revision gets only what
 * the attempts before it left. The orchestrator stops an attempt that
 * breaches what it was given (`budget_exceeded`); `breachOf` says which
 * budget a run as a whole has breached, for the report.
 */

import type { Policy, RunContext } from "@mainahq/core";
import type { BudgetKind } from "../events";
import type { Budgets } from "../orchestrator";

/** What a run has used so far. */
export type RunUsage = Readonly<{
	/** Milliseconds since the run started. */
	elapsedMs: number;
	/** Distinct tool calls across every attempt. */
	toolCalls: number;
}>;

export type BudgetBreach = Readonly<{
	budget: BudgetKind;
	limit: number;
	used: number;
}>;

const MINUTE_MS = 60_000;

/** The budgets of a run in `context`, in the orchestrator's units. */
export function budgetsFor(policy: Policy, context: RunContext): Budgets {
	const { wall_clock_minutes, max_tool_calls } = policy.run[context].budgets;
	return {
		...(wall_clock_minutes === undefined
			? {}
			: { wallClockMs: wall_clock_minutes * MINUTE_MS }),
		...(max_tool_calls === undefined ? {} : { maxToolCalls: max_tool_calls }),
	};
}

/**
 * The first budget `usage` breaches, as the orchestrator counts them: the
 * wall clock once it is reached, tool calls once there are more than
 * allowed.
 */
export function breachOf(
	budgets: Budgets,
	usage: RunUsage,
): BudgetBreach | undefined {
	if (
		budgets.wallClockMs !== undefined &&
		usage.elapsedMs >= budgets.wallClockMs
	) {
		return {
			budget: "wall_clock",
			limit: budgets.wallClockMs,
			used: usage.elapsedMs,
		};
	}
	if (
		budgets.maxToolCalls !== undefined &&
		usage.toolCalls > budgets.maxToolCalls
	) {
		return {
			budget: "tool_calls",
			limit: budgets.maxToolCalls,
			used: usage.toolCalls,
		};
	}
	return undefined;
}

/** What is left of `budgets` after `usage`; never below zero. */
export function remainingBudgets(budgets: Budgets, usage: RunUsage): Budgets {
	return {
		...(budgets.wallClockMs === undefined
			? {}
			: { wallClockMs: Math.max(0, budgets.wallClockMs - usage.elapsedMs) }),
		...(budgets.maxToolCalls === undefined
			? {}
			: {
					maxToolCalls: Math.max(0, budgets.maxToolCalls - usage.toolCalls),
				}),
	};
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`;

/** One line for a report: which budget, its limit and what was used. */
export function describeBreach(breach: BudgetBreach): string {
	switch (breach.budget) {
		case "wall_clock":
			return `wall-clock budget exceeded: ${seconds(breach.used)} of ${seconds(breach.limit)}`;
		case "tool_calls":
			return `tool-call budget exceeded: ${breach.used} calls of ${breach.limit}`;
		default: {
			const unknown: never = breach.budget;
			return `budget exceeded: ${String(unknown)}`;
		}
	}
}
