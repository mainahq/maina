/**
 * Backend promotion (FR-DEC-2, FR-DEC-8). A candidate backend (a System 1
 * model, a new heuristic) first runs in shadow: `shadowRun` asks it the same
 * questions as the backend the policy selects, logs both answers and hands
 * back only the primary's decisions, so the shadow can never change what
 * Maina does. `evaluatePromotion` then reads a slice of the log and reports,
 * per decision type and candidate, every promotion metric the log can
 * supply, checked against the caller's gates.
 *
 * Shadow records are ordinary decision records with `finalAction` set to
 * `SHADOW_ACTION`; the backend that answered is in `modelHash`. Question
 * `i` of a run with id `R` is logged as `R:i`, its shadow as `R:i:shadow`.
 */

import type { Result } from "../db/index";
import type { Policy } from "../policy/schema";
import { type DecidePorts, decide } from "./decide";
import {
	appendDecision,
	buildDecisionRecord,
	type DecisionLogPorts,
} from "./log/append";
import { type DecisionFilter, queryDecisions } from "./log/query";
import type { DecisionLogError, DecisionRecord } from "./log/schema";
import { queryOutcomes } from "./outcomes/link";
import type { Outcome, OutcomeError, OutcomeRecord } from "./outcomes/types";
import { createRegistry } from "./registry";
import type {
	Backend,
	DecideError,
	DecideRequest,
	Decision,
	DecisionBackend,
	DecisionType,
} from "./types";

/** The `finalAction` of every shadow record: nothing was done with it. */
export const SHADOW_ACTION = "shadow";

const SHADOW_SUFFIX = ":shadow";

/** Decision records and the outcomes linked to them. */
export type LogSlice = Readonly<{
	decisions: readonly DecisionRecord[];
	outcomes: readonly OutcomeRecord[];
}>;

/** `policy` with `type` served by `backend`; every other field unchanged. */
export function withBackend(
	policy: Policy,
	type: DecisionType,
	backend: DecisionBackend,
): Policy {
	return {
		...policy,
		decisions: {
			...policy.decisions,
			[type]: { ...policy.decisions[type], backend },
		},
	};
}

// ── Shadow mode ─────────────────────────────────────────────────────────────

export type ShadowPorts = Readonly<{
	/** The ports `decide` runs with: their decisions are the ones acted on. */
	primary: DecidePorts;
	/** The candidate backend. It answers, is logged, and is never acted on. */
	shadow: Backend;
	log: DecisionLogPorts;
}>;

export type ShadowRunInput = Readonly<{
	/** Log id prefix: question `i` is logged as `<id>:<i>`. */
	id: string;
	ts: number;
	request: DecideRequest;
	/** What the caller does with each primary decision, as a label. */
	finalAction: (decision: Decision) => string;
	host?: string;
	sessionId?: string;
}>;

export type ShadowRunResult = Readonly<{
	/** The primary backend's decisions: the only ones to act on. */
	decisions: readonly Decision[];
	/** Every record logged: the primary ones, then the shadow ones. */
	records: readonly DecisionRecord[];
	/** Why the shadow logged nothing, when it did not. */
	shadowError?: DecideError | DecisionLogError;
}>;

function buildRecords(
	input: ShadowRunInput,
	policy: Policy,
	decisions: readonly Decision[],
	idOf: (i: number) => string,
	actionOf: (decision: Decision) => string,
): Result<readonly DecisionRecord[], DecisionLogError> {
	const records: DecisionRecord[] = [];
	for (const [i, decision] of decisions.entries()) {
		const record = buildDecisionRecord({
			id: idOf(i),
			ts: input.ts,
			request: input.request,
			decision,
			policy,
			finalAction: actionOf(decision),
			host: input.host,
			sessionId: input.sessionId,
		});
		if (!record.ok) return record;
		records.push(record.value);
	}
	return { ok: true, value: records };
}

function appendAll(
	ports: DecisionLogPorts,
	records: readonly DecisionRecord[],
): Result<readonly DecisionRecord[], DecisionLogError> {
	const stored: DecisionRecord[] = [];
	for (const record of records) {
		const appended = appendDecision(ports, record);
		if (!appended.ok) return appended;
		stored.push(appended.value);
	}
	return { ok: true, value: stored };
}

/**
 * Answers `input.request` with the primary ports and with `ports.shadow`,
 * logs both and returns the primary's decisions. The primary is decided and
 * logged before the shadow runs, so nothing the shadow returns, throws or
 * mutates can reach them. A primary failure is returned as is (and the
 * shadow is not asked); a shadow failure only sets `shadowError`.
 */
export function shadowRun(
	ports: ShadowPorts,
	input: ShadowRunInput,
): Result<ShadowRunResult, DecideError | DecisionLogError> {
	const { primary, shadow, log } = ports;
	const decided = decide(primary, input.request);
	if (!decided.ok) return decided;
	const decisions = decided.value;
	const built = buildRecords(
		input,
		primary.policy,
		decisions,
		(i) => `${input.id}:${i}`,
		input.finalAction,
	);
	if (!built.ok) return built;
	const logged = appendAll(log, built.value);
	if (!logged.ok) return logged;

	const shadowed = decide(
		{
			clock: primary.clock,
			policy: withBackend(primary.policy, input.request.type, shadow.id),
			backends: createRegistry([shadow]),
		},
		input.request,
	);
	if (!shadowed.ok) {
		return {
			ok: true,
			value: { decisions, records: logged.value, shadowError: shadowed.error },
		};
	}
	// Shadow records carry the acting policy's hash, so a shadow and its
	// primary share every key but the model.
	const shadowRecords = buildRecords(
		input,
		primary.policy,
		shadowed.value,
		(i) => `${input.id}:${i}${SHADOW_SUFFIX}`,
		() => SHADOW_ACTION,
	);
	const shadowLogged = shadowRecords.ok
		? appendAll(log, shadowRecords.value)
		: shadowRecords;
	return {
		ok: true,
		value: shadowLogged.ok
			? { decisions, records: [...logged.value, ...shadowLogged.value] }
			: { decisions, records: logged.value, shadowError: shadowLogged.error },
	};
}

// ── Reading a slice ─────────────────────────────────────────────────────────

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

// ── Metrics ─────────────────────────────────────────────────────────────────

type MetricSource = "log" | "eval";

/**
 * Every promotion metric (spec §9.2), in one place. `log` metrics are
 * computed from shadow evidence here; the rest come from elsewhere and are
 * listed in `PromotionReport.notFromLog`.
 */
export const PROMOTION_METRICS = [
	{ id: "samples", source: "log" },
	{ id: "labelled", source: "log" },
	{ id: "agreement", source: "log" },
	{ id: "override_rate", source: "log" },
	{ id: "incumbent.error_rate", source: "log" },
	{ id: "candidate.error_rate", source: "log" },
	{ id: "incumbent.expected_cost", source: "log" },
	{ id: "candidate.expected_cost", source: "log" },
	{ id: "incumbent.calibration_error", source: "log" },
	{ id: "candidate.calibration_error", source: "log" },
	{ id: "incumbent.mean_confidence", source: "log" },
	{ id: "candidate.mean_confidence", source: "log" },
	{ id: "incumbent.latency_p50_ms", source: "log" },
	{ id: "incumbent.latency_p95_ms", source: "log" },
	{ id: "candidate.latency_p50_ms", source: "log" },
	{ id: "candidate.latency_p95_ms", source: "log" },
	{
		id: "frozen_set",
		source: "eval",
		reason:
			"measured by the eval harness on the frozen labelled set, not from the decision log",
	},
] as const satisfies readonly Readonly<{
	id: string;
	source: MetricSource;
	reason?: string;
}>[];

type MetricSpec = (typeof PROMOTION_METRICS)[number];
type LogMetric = Extract<MetricSpec, { source: "log" }>["id"];

/** Log metrics by id; `null` when the slice holds no evidence for one. */
export type PromotionMetrics = Readonly<Record<LogMetric, number | null>> &
	Readonly<{ samples: number; labelled: number }>;

export type PromotionGates = Readonly<{
	/** Paired shadow decisions needed. */
	minSamples: number;
	/** Paired decisions with an outcome needed. */
	minLabelled: number;
	/** Share of pairs where the candidate answers like the incumbent. */
	minAgreement: number;
	/** Candidate error rate minus incumbent error rate, at most. */
	maxErrorRateDelta: number;
	/** Candidate expected cost minus incumbent expected cost, at most. */
	maxCostDelta: number;
	/** Candidate expected calibration error, at most. */
	maxCalibrationError: number;
	maxLatencyP95Ms: number;
	/** The policy's `error_costs` for the type. */
	errorCosts: Readonly<{ false_positive: number; false_negative: number }>;
}>;

export type PromotionGate =
	| "min_samples"
	| "min_labelled"
	| "min_agreement"
	| "max_error_rate_delta"
	| "max_cost_delta"
	| "max_calibration_error"
	| "max_latency_p95_ms";

export type GateResult = Readonly<{
	gate: PromotionGate;
	/** `null` when the evidence is missing; the gate then fails. */
	value: number | null;
	threshold: number;
	pass: boolean;
}>;

export type PromotionEntry = Readonly<{
	type: DecisionType;
	/** The shadow backend's model hash. */
	candidate: string;
	/** The model hashes of the primaries it was paired with. */
	incumbents: readonly string[];
	metrics: PromotionMetrics;
	gates: readonly GateResult[];
	/** `true` only when every gate passes. */
	promote: boolean;
}>;

export type PromotionReport = Readonly<{
	/** One entry per decision type and candidate, in log order. */
	entries: readonly PromotionEntry[];
	notFromLog: readonly Readonly<{ metric: string; reason: string }>[];
}>;

type ErrorKind = "false_positive" | "false_negative";

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
type Verdict =
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

/**
 * The candidate's verdict, inferred from its primary's: the same when both
 * answered alike; wrong (of unknown kind) when it disagreed with a right
 * primary on a question with options; right when it disagreed with a wrong
 * primary on a yes/no question; unlabelled otherwise (a different score is
 * not a wrong one).
 */
function candidateVerdict(
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
function percentile(values: readonly number[], q: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil(q * sorted.length));
	return sorted[rank - 1] ?? null;
}

const CALIBRATION_BINS = 10;

/** Expected calibration error over equal-width confidence bins. */
function calibrationError(
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

type Scored = Readonly<{ record: DecisionRecord; verdict: Verdict }>;

function errorCost(
	errors: readonly (ErrorKind | "unknown")[],
	costs: PromotionGates["errorCosts"],
): number {
	// An error of unknown kind is charged as the costlier kind.
	const worst = Math.max(costs.false_positive, costs.false_negative);
	return Math.max(...errors.map((e) => (e === "unknown" ? worst : costs[e])));
}

function sideMetrics(
	side: readonly Scored[],
	costs: PromotionGates["errorCosts"],
) {
	const labelled = side.filter((s) => s.verdict.kind !== "unlabelled");
	const wrong = labelled.flatMap((s) =>
		s.verdict.kind === "wrong" ? [s.verdict.errors] : [],
	);
	const latencies = side.map((s) => s.record.latencyMs);
	return {
		error_rate: labelled.length === 0 ? null : wrong.length / labelled.length,
		expected_cost:
			labelled.length === 0
				? null
				: wrong.reduce((sum, e) => sum + errorCost(e, costs), 0) /
					labelled.length,
		calibration_error: calibrationError(
			labelled.map((s) => ({
				confidence: confidenceOf(s.record),
				right: s.verdict.kind === "right",
			})),
		),
		mean_confidence: mean(side.map((s) => confidenceOf(s.record))),
		latency_p50_ms: percentile(latencies, 0.5),
		latency_p95_ms: percentile(latencies, 0.95),
	};
}

type Pair = Readonly<{ primary: DecisionRecord; shadow: DecisionRecord }>;

function metricsOf(
	pairs: readonly Pair[],
	outcomes: ReadonlyMap<string, readonly Outcome[]>,
	costs: PromotionGates["errorCosts"],
): PromotionMetrics {
	const incumbent: Scored[] = [];
	const candidate: Scored[] = [];
	let agreed = 0;
	let overridden = 0;
	for (const { primary, shadow } of pairs) {
		const linked = outcomes.get(primary.id);
		const verdict = verdictOf(linked);
		incumbent.push({ record: primary, verdict });
		candidate.push({
			record: shadow,
			verdict: candidateVerdict(primary, shadow, verdict),
		});
		if (shadow.answer === primary.answer) agreed += 1;
		if (linked?.includes("override")) overridden += 1;
	}
	const inc = sideMetrics(incumbent, costs);
	const cand = sideMetrics(candidate, costs);
	const samples = pairs.length;
	return {
		samples,
		labelled: incumbent.filter((s) => s.verdict.kind !== "unlabelled").length,
		agreement: samples === 0 ? null : agreed / samples,
		override_rate: samples === 0 ? null : overridden / samples,
		"incumbent.error_rate": inc.error_rate,
		"candidate.error_rate": cand.error_rate,
		"incumbent.expected_cost": inc.expected_cost,
		"candidate.expected_cost": cand.expected_cost,
		"incumbent.calibration_error": inc.calibration_error,
		"candidate.calibration_error": cand.calibration_error,
		"incumbent.mean_confidence": inc.mean_confidence,
		"candidate.mean_confidence": cand.mean_confidence,
		"incumbent.latency_p50_ms": inc.latency_p50_ms,
		"incumbent.latency_p95_ms": inc.latency_p95_ms,
		"candidate.latency_p50_ms": cand.latency_p50_ms,
		"candidate.latency_p95_ms": cand.latency_p95_ms,
	};
}

function delta(a: number | null, b: number | null): number | null {
	return a === null || b === null ? null : a - b;
}

/** Missing evidence (`null`) or a non-finite threshold fails the gate. */
function gate(
	name: PromotionGate,
	value: number | null,
	threshold: number,
	direction: "min" | "max",
): GateResult {
	const pass =
		value !== null &&
		Number.isFinite(threshold) &&
		(direction === "min" ? value >= threshold : value <= threshold);
	return { gate: name, value, threshold, pass };
}

function gatesOf(
	m: PromotionMetrics,
	gates: PromotionGates,
): readonly GateResult[] {
	return [
		gate("min_samples", m.samples, gates.minSamples, "min"),
		gate("min_labelled", m.labelled, gates.minLabelled, "min"),
		gate("min_agreement", m.agreement, gates.minAgreement, "min"),
		gate(
			"max_error_rate_delta",
			delta(m["candidate.error_rate"], m["incumbent.error_rate"]),
			gates.maxErrorRateDelta,
			"max",
		),
		gate(
			"max_cost_delta",
			delta(m["candidate.expected_cost"], m["incumbent.expected_cost"]),
			gates.maxCostDelta,
			"max",
		),
		gate(
			"max_calibration_error",
			m["candidate.calibration_error"],
			gates.maxCalibrationError,
			"max",
		),
		gate(
			"max_latency_p95_ms",
			m["candidate.latency_p95_ms"],
			gates.maxLatencyP95Ms,
			"max",
		),
	];
}

/**
 * Shadow records paired with their primary (same id stem, type and input),
 * grouped by type and candidate.
 */
function pairGroups(
	decisions: readonly DecisionRecord[],
): ReadonlyMap<string, readonly Pair[]> {
	const byId = new Map(decisions.map((d) => [d.id, d]));
	const groups = new Map<string, Pair[]>();
	for (const shadow of decisions) {
		if (
			shadow.finalAction !== SHADOW_ACTION ||
			!shadow.id.endsWith(SHADOW_SUFFIX)
		) {
			continue;
		}
		const primary = byId.get(shadow.id.slice(0, -SHADOW_SUFFIX.length));
		if (
			primary === undefined ||
			primary.finalAction === SHADOW_ACTION ||
			primary.type !== shadow.type ||
			primary.inputHash !== shadow.inputHash
		) {
			continue;
		}
		const key = `${shadow.type}\n${shadow.modelHash}`;
		const group = groups.get(key) ?? [];
		group.push({ primary, shadow });
		groups.set(key, group);
	}
	return groups;
}

/**
 * The promotion report for every candidate that ran in shadow in `slice`.
 * Pure: the same slice and gates always give the same report.
 */
export function evaluatePromotion(
	slice: LogSlice,
	gates: PromotionGates,
): PromotionReport {
	const outcomes = outcomesById(slice.outcomes);
	const entries: PromotionEntry[] = [];
	for (const pairs of pairGroups(slice.decisions).values()) {
		const [first] = pairs;
		if (first === undefined) continue;
		const metrics = metricsOf(pairs, outcomes, gates.errorCosts);
		const results = gatesOf(metrics, gates);
		entries.push({
			type: first.shadow.type,
			candidate: first.shadow.modelHash,
			incumbents: [...new Set(pairs.map((p) => p.primary.modelHash))],
			metrics,
			gates: results,
			promote: results.every((g) => g.pass),
		});
	}
	return {
		entries,
		notFromLog: PROMOTION_METRICS.flatMap((m) =>
			m.source === "log" ? [] : [{ metric: m.id, reason: m.reason }],
		),
	};
}
