/**
 * Evidence from the decision log, shared by promotion and the drift guard:
 * reading a slice of records with their outcomes, and what those outcomes
 * say about each decision.
 */

import type { Result } from "../db/index";
import type { DecisionLogPorts } from "./log/append";
import { type DecisionFilter, queryDecisions } from "./log/query";
import type { DecisionLogError, DecisionRecord } from "./log/schema";
import { queryOutcomes } from "./outcomes/link";
import type { Outcome, OutcomeError, OutcomeRecord } from "./outcomes/types";

/** The `finalAction` of every shadow record: nothing was done with it. */
export const SHADOW_ACTION = "shadow";

/** Appended to a primary record's id to name its shadow record. */
export const SHADOW_SUFFIX = ":shadow";

/** Decision records and the outcomes linked to them. */
export type LogSlice = Readonly<{
	decisions: readonly DecisionRecord[];
	outcomes: readonly OutcomeRecord[];
}>;

/** The decisions matching `filter` and the outcomes linked to them. */
export function readLogSlice(
	ports: Pick<DecisionLogPorts, "db">,
	filter: DecisionFilter = {},
): Result<LogSlice, DecisionLogError | OutcomeError> {
	const decisions = queryDecisions(ports, filter);
	if (!decisions.ok) return decisions;
	const outcomes = queryOutcomes(ports);
	if (!outcomes.ok) return outcomes;
	const ids = new Set(decisions.value.map((d) => d.id));
	return {
		ok: true,
		value: {
			decisions: decisions.value,
			outcomes: outcomes.value.filter((o) => ids.has(o.decisionId)),
		},
	};
}

export type ErrorKind = "false_positive" | "false_negative";

/**
 * What an outcome says about the decision it is linked to: `null` for a
 * confirmation, else the kind of error. Overridden, dismissed or rejected
 * decisions acted when they should not have; reverted, hotfixed or
 * test-failing ones let through what they should have stopped.
 */
const OUTCOME_ERROR: Readonly<Record<Outcome, ErrorKind | null>> = {
	accepted: null,
	override: "false_positive",
	dismissed: "false_positive",
	rejected: "false_positive",
	reverted: "false_negative",
	hotfixed: "false_negative",
	test_failed_after_allow: "false_negative",
};

/**
 * A decision's verdict from its outcomes: unlabelled, right, or wrong with
 * the kinds of error observed. `unknown` kinds come from counterfactuals.
 */
export type Verdict =
	| Readonly<{ kind: "unlabelled" }>
	| Readonly<{ kind: "right" }>
	| Readonly<{ kind: "wrong"; errors: readonly (ErrorKind | "unknown")[] }>;

/** The outcomes of `slice`, grouped by decision id. */
export function outcomesById(
	outcomes: readonly OutcomeRecord[],
): ReadonlyMap<string, readonly Outcome[]> {
	const byId = new Map<string, Outcome[]>();
	for (const o of outcomes) {
		const list = byId.get(o.decisionId) ?? [];
		list.push(o.outcome);
		byId.set(o.decisionId, list);
	}
	return byId;
}

export function verdictOf(outcomes: readonly Outcome[] | undefined): Verdict {
	if (outcomes === undefined || outcomes.length === 0) {
		return { kind: "unlabelled" };
	}
	const errors = outcomes
		.map((o) => OUTCOME_ERROR[o])
		.filter((e): e is ErrorKind => e !== null);
	return errors.length === 0 ? { kind: "right" } : { kind: "wrong", errors };
}

/** The probability of a record's answer: its largest distribution entry. */
export function confidenceOf(record: DecisionRecord): number {
	return Math.max(...record.distribution.map((e) => e.p));
}

export function mean(values: readonly number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Nearest-rank percentile (`q` in (0, 1]). */
export function percentile(
	values: readonly number[],
	q: number,
): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil(q * sorted.length));
	return sorted[rank - 1] ?? null;
}

const CALIBRATION_BINS = 10;

/** Expected calibration error over equal-width confidence bins. */
export function calibrationError(
	samples: readonly Readonly<{ confidence: number; right: boolean }>[],
): number | null {
	if (samples.length === 0) return null;
	const bins = Array.from({ length: CALIBRATION_BINS }, () => ({
		n: 0,
		confidence: 0,
		right: 0,
	}));
	for (const s of samples) {
		const index = Math.min(
			CALIBRATION_BINS - 1,
			Math.floor(s.confidence * CALIBRATION_BINS),
		);
		const bin = bins[index];
		if (bin === undefined) continue;
		bin.n += 1;
		bin.confidence += s.confidence;
		bin.right += s.right ? 1 : 0;
	}
	return bins.reduce(
		(sum, bin) =>
			bin.n === 0
				? sum
				: sum + Math.abs(bin.right - bin.confidence) / samples.length,
		0,
	);
}

/**
 * The candidate's verdict, inferred from its primary's: the same when both
 * answered alike; wrong (of unknown kind) when it disagreed with a right
 * primary on a question with options; right when it disagreed with a wrong
 * primary on a yes/no question; unlabelled otherwise (a different score is
 * not a wrong one).
 */
export function candidateVerdict(
	primary: DecisionRecord,
	shadow: DecisionRecord,
	primaryVerdict: Verdict,
): Verdict {
	if (shadow.answer === primary.answer) return primaryVerdict;
	const options = primary.optionOrder.length;
	switch (primaryVerdict.kind) {
		case "right":
			return options === 0
				? { kind: "unlabelled" }
				: { kind: "wrong", errors: ["unknown"] };
		case "wrong":
			return options === 2 ? { kind: "right" } : { kind: "unlabelled" };
		case "unlabelled":
			return primaryVerdict;
		default: {
			const unreachable: never = primaryVerdict;
			return unreachable;
		}
	}
}
