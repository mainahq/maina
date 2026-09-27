/**
 * Decision diagnostics (#577): validating what a model backend reports
 * beside its answer, and acting on its escalate signal. Pure.
 *
 * Diagnostics are numbers only, so they can be logged without leaking
 * repository content. `decide` and the decision log both validate them
 * here, so a backend and a stored row are held to the same contract.
 */

import type { Result } from "../db/index";
import { DEFAULT_POLICY } from "../policy/defaults";
import { ACTION_CLASS_ID_PATTERN, type Policy } from "../policy/schema";
import {
	type Answer,
	type DecisionDiagnostics,
	type DecisionType,
	type DistributionEntry,
	type QuestionKind,
	SUM_EPSILON,
} from "./types";

function isProbability(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 1
	);
}

function calibratedProblem(
	value: unknown,
	optionCount: number,
): string | undefined {
	if (optionCount === 0)
		return "a score question has no calibrated distribution";
	// Array.from turns holes into `undefined`, which the check rejects.
	if (!Array.isArray(value) || !Array.from(value).every(isProbability)) {
		return "calibrated must be a list of probabilities";
	}
	if (value.length !== optionCount) {
		return "calibrated needs one probability per option, in option order";
	}
	const total = value.reduce((sum: number, p: number) => sum + p, 0);
	return Math.abs(total - 1) > SUM_EPSILON
		? `calibrated sums to ${total}, not 1`
		: undefined;
}

function actionClassProbs(
	value: unknown,
): Result<Readonly<Record<string, number>>, string> {
	const invalid = {
		ok: false,
		error: "actionClassProbs must map action class ids to probabilities",
	} as const;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalid;
	}
	const entries = Object.entries(value);
	if (
		!entries.every(
			([id, p]) => ACTION_CLASS_ID_PATTERN.test(id) && isProbability(p),
		)
	) {
		return invalid;
	}
	const sorted = entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return { ok: true, value: Object.fromEntries(sorted) };
}

/**
 * A clean copy of `value` (diagnostics for a question with `optionCount`
 * options, 0 for a score question) with only the contract's fields, or why
 * it is malformed. `undefined` and diagnostics with no field are none.
 */
export function validateDiagnostics(
	value: unknown,
	optionCount: number,
): Result<DecisionDiagnostics | undefined, string> {
	if (value === undefined) return { ok: true, value: undefined };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: "diagnostics must be an object" };
	}
	const d = value as Readonly<Record<string, unknown>>;
	const clean: {
		calibrated?: readonly number[];
		escalate?: number;
		truncated?: boolean;
		windows?: number;
		actionClassProbs?: Readonly<Record<string, number>>;
	} = {};
	if (d.calibrated !== undefined) {
		const problem = calibratedProblem(d.calibrated, optionCount);
		if (problem !== undefined) return { ok: false, error: problem };
		clean.calibrated = [...(d.calibrated as readonly number[])];
	}
	if (d.escalate !== undefined) {
		if (!isProbability(d.escalate)) {
			return { ok: false, error: "escalate must be a probability" };
		}
		clean.escalate = d.escalate;
	}
	if (d.truncated !== undefined) {
		if (typeof d.truncated !== "boolean") {
			return { ok: false, error: "truncated must be a boolean" };
		}
		clean.truncated = d.truncated;
	}
	if (d.windows !== undefined) {
		if (
			typeof d.windows !== "number" ||
			!Number.isSafeInteger(d.windows) ||
			d.windows < 1
		) {
			return { ok: false, error: "windows must be a positive integer" };
		}
		clean.windows = d.windows;
	}
	if (d.actionClassProbs !== undefined) {
		const probs = actionClassProbs(d.actionClassProbs);
		if (!probs.ok) return probs;
		clean.actionClassProbs = probs.value;
	}
	return {
		ok: true,
		value: Object.keys(clean).length === 0 ? undefined : clean,
	};
}

/**
 * The escalate probability at or over which the answer is not acted on:
 * FP / (FP + FN) of the type's error costs. Escalating a right answer costs
 * a false positive (an unneeded ask); acting on a wrong one a false
 * negative, so escalating pays once P(wrong) · FN ≥ (1 − P(wrong)) · FP.
 * With no cost at all it is 0: any signal escalates (fail closed).
 */
export function escalationCutoff(
	costs: Policy["decisions"][DecisionType]["error_costs"],
): number {
	const cutoff =
		costs.false_positive / (costs.false_positive + costs.false_negative);
	return Number.isFinite(cutoff) ? cutoff : 0;
}

/** The answer `action.risk` escalates to. */
const ASK = "ask";

type Answered = Readonly<{
	answer: Answer;
	distribution: readonly DistributionEntry[];
	diagnostics?: DecisionDiagnostics;
}>;

type EscalatedAnswer = Answered & Readonly<{ escalated?: true }>;

/**
 * `answered` after its escalate signal, if any, is acted on under
 * `policy`: below the type's cutoff (or with no signal, or on a score
 * question) it stands. At or over it, an `action.risk` answer becomes `ask`
 * (degenerate on it, keeping the pre-escalation distribution as
 * `diagnostics.calibrated` unless the backend reported one) and any other
 * answer stands, marked `escalated` so it is never acted on.
 */
export function applyEscalation(
	policy: Policy,
	type: DecisionType,
	kind: QuestionKind,
	answered: Answered,
): EscalatedAnswer {
	const escalate = answered.diagnostics?.escalate;
	if (escalate === undefined || kind === "score") return answered;
	const spec = policy.decisions[type] ?? DEFAULT_POLICY.decisions[type];
	if (escalate < escalationCutoff(spec.error_costs)) return answered;
	const canAsk = answered.distribution.some((e) => e.answer === ASK);
	if (type !== "action.risk" || !canAsk) {
		return { ...answered, escalated: true };
	}
	return {
		answer: ASK,
		distribution: answered.distribution.map((e) => ({
			answer: e.answer,
			p: e.answer === ASK ? 1 : 0,
		})),
		diagnostics: {
			...answered.diagnostics,
			calibrated:
				answered.diagnostics?.calibrated ??
				answered.distribution.map((e) => e.p),
		},
		escalated: true,
	};
}
