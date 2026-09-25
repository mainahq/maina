/**
 * The drift guard (FR-DEC-8). A promoted backend keeps being watched: over
 * the latest `window` decisions it served for a type, the error rate (from
 * linked outcomes) and the drop in mean confidence (against the window
 * before) must stay under the policy's limits. A breach demotes the type to
 * its catalog default backend and carries a notice for the user; a breach on
 * the default backend itself, which has nothing to fall back to, only
 * notifies. `checkDrift` decides; `applyDriftAction` returns the policy with
 * the demotion applied. Both are pure.
 */

import type { Policy } from "../policy/schema";
import { hashModel } from "./log/hash";
import type { DecisionRecord } from "./log/schema";
import {
	confidenceOf,
	type LogSlice,
	mean,
	outcomesById,
	SHADOW_ACTION,
	verdictOf,
	withBackend,
} from "./promotion";
import type { DecisionBackend, DecisionType } from "./types";
import { DECISION_CATALOG } from "./types-catalog";

/** Labelled decisions needed before the guard judges, by default. */
const DEFAULT_MIN_SAMPLES = 20;

export type DriftThresholds = Readonly<{
	type: DecisionType;
	/** The backend serving `type`: the one the guard may demote. */
	backend: Readonly<{ id: DecisionBackend; version: string }>;
	/** How many of its latest decisions are checked. */
	window: number;
	/** Error rate over the window's labelled decisions, at most. */
	maxErrorRate: number;
	/** Mean-confidence drop against the previous window, at most. */
	maxConfidenceDrop: number;
	/**
	 * Labelled decisions needed to judge the error rate, and decisions in
	 * the previous window needed to judge the confidence drop.
	 */
	minSamples: number;
}>;

/** The guard's thresholds for `type` served by `backend`, from `policy.drift`. */
export function driftThresholds(
	policy: Policy,
	type: DecisionType,
	backend: DriftThresholds["backend"],
	minSamples: number = DEFAULT_MIN_SAMPLES,
): DriftThresholds {
	return {
		type,
		backend,
		window: policy.drift.window,
		maxErrorRate: policy.drift.max_error_rate,
		maxConfidenceDrop: policy.drift.max_confidence_drop,
		minSamples,
	};
}

export type DriftBreach = "error_rate" | "confidence_drop";

export type DriftMetrics = Readonly<{
	/** Decisions in the checked window. */
	decisions: number;
	/** Of those, the ones with an outcome. */
	labelled: number;
	/** `null` below `minSamples` labelled decisions. */
	errorRate: number | null;
	recentConfidence: number | null;
	baselineConfidence: number | null;
	/** `null` when the previous window is smaller than `minSamples`. */
	confidenceDrop: number | null;
}>;

export type DriftNotice = Readonly<{ level: "warning"; message: string }>;

export type DriftAction =
	| Readonly<{ kind: "none"; type: DecisionType; metrics: DriftMetrics }>
	| Readonly<{
			kind: "demote";
			type: DecisionType;
			from: DecisionBackend;
			to: DecisionBackend;
			breaches: readonly DriftBreach[];
			metrics: DriftMetrics;
			notice: DriftNotice;
	  }>
	| Readonly<{
			kind: "notify";
			type: DecisionType;
			breaches: readonly DriftBreach[];
			metrics: DriftMetrics;
			notice: DriftNotice;
	  }>;

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function describeBreach(
	breach: DriftBreach,
	metrics: DriftMetrics,
	t: DriftThresholds,
): string {
	switch (breach) {
		case "error_rate":
			return `error rate ${percent(metrics.errorRate ?? 0)} is above the ${percent(t.maxErrorRate)} limit over its last ${metrics.decisions} decisions`;
		case "confidence_drop":
			return `mean confidence fell by ${percent(metrics.confidenceDrop ?? 0)}, more than the ${percent(t.maxConfidenceDrop)} limit`;
		default: {
			const unreachable: never = breach;
			return unreachable;
		}
	}
}

function driftMetrics(slice: LogSlice, t: DriftThresholds): DriftMetrics {
	const model = hashModel(t.backend);
	const served = slice.decisions.filter(
		(d) =>
			d.type === t.type &&
			d.modelHash === model &&
			d.finalAction !== SHADOW_ACTION,
	);
	const size = Math.max(0, Math.floor(t.window));
	const recent = size === 0 ? [] : served.slice(-size);
	const baseline =
		size === 0 ? [] : served.slice(-2 * size, served.length - recent.length);
	const outcomes = outcomesById(slice.outcomes);
	const verdicts = recent
		.map((d) => verdictOf(outcomes.get(d.id)))
		.filter((v) => v.kind !== "unlabelled");
	const wrong = verdicts.filter((v) => v.kind === "wrong").length;
	const confidences = (records: readonly DecisionRecord[]) =>
		mean(records.map(confidenceOf));
	const recentConfidence = confidences(recent);
	const baselineConfidence = confidences(baseline);
	return {
		decisions: recent.length,
		labelled: verdicts.length,
		errorRate:
			verdicts.length >= t.minSamples && verdicts.length > 0
				? wrong / verdicts.length
				: null,
		recentConfidence,
		baselineConfidence,
		confidenceDrop:
			baseline.length >= t.minSamples &&
			baselineConfidence !== null &&
			recentConfidence !== null
				? baselineConfidence - recentConfidence
				: null,
	};
}

/**
 * What to do about drift for `thresholds.type` served by
 * `thresholds.backend`, from the decisions in `slice` (in log order).
 * Shadow records and other backends' decisions are ignored.
 */
export function checkDrift(
	slice: LogSlice,
	thresholds: DriftThresholds,
): DriftAction {
	const metrics = driftMetrics(slice, thresholds);
	const breaches: DriftBreach[] = [];
	if (
		metrics.errorRate !== null &&
		metrics.errorRate > thresholds.maxErrorRate
	) {
		breaches.push("error_rate");
	}
	if (
		metrics.confidenceDrop !== null &&
		metrics.confidenceDrop > thresholds.maxConfidenceDrop
	) {
		breaches.push("confidence_drop");
	}
	const { type } = thresholds;
	if (breaches.length === 0) return { kind: "none", type, metrics };
	const reasons = breaches
		.map((b) => describeBreach(b, metrics, thresholds))
		.join("; ");
	const from = thresholds.backend.id;
	const to = DECISION_CATALOG[type].defaultBackend;
	if (from === to) {
		return {
			kind: "notify",
			type,
			breaches,
			metrics,
			notice: {
				level: "warning",
				message: `Maina's ${from} backend for ${type} is drifting: ${reasons}. It is already the default backend, so nothing was demoted.`,
			},
		};
	}
	return {
		kind: "demote",
		type,
		from,
		to,
		breaches,
		metrics,
		notice: {
			level: "warning",
			message: `Maina demoted ${type} from ${from} to ${to}: ${reasons}.`,
		},
	};
}

/** `policy` with a demotion applied; any other action returns it unchanged. */
export function applyDriftAction(policy: Policy, action: DriftAction): Policy {
	return action.kind === "demote"
		? withBackend(policy, action.type, action.to)
		: policy;
}
