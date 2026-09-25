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
	ASK_ANSWER,
	calibrationError,
	candidateVerdict,
	confidenceOf,
	type ErrorKind,
	type LogSlice,
	mean,
	outcomesById,
	percentile,
	SHADOW_ACTION,
	SHADOW_SUFFIX,
	type Verdict,
	verdictOf,
} from "./evidence";
import {
	appendDecision,
	buildDecisionRecord,
	type DecisionLogPorts,
} from "./log/append";
import type { DecisionLogError, DecisionRecord } from "./log/schema";
import type { Outcome } from "./outcomes/types";
import { createRegistry, withBackend } from "./registry";
import type {
	Backend,
	DecideError,
	DecideRequest,
	Decision,
	DecisionType,
} from "./types";

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
	privacy: DecisionLogPorts["privacy"],
	decisions: readonly Decision[],
	idOf: (i: number) => string,
	actionOf: (decision: Decision) => string,
): Result<readonly DecisionRecord[], DecisionLogError> {
	const records: DecisionRecord[] = [];
	for (const [i, decision] of decisions.entries()) {
		const record = buildDecisionRecord(
			{
				id: idOf(i),
				ts: input.ts,
				request: input.request,
				decision,
				policy,
				finalAction: actionOf(decision),
				host: input.host,
				sessionId: input.sessionId,
			},
			privacy,
		);
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
		log.privacy,
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
		log.privacy,
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
	// Usefulness: share of answers other than "ask", on types that can ask.
	{ id: "incumbent.decided_without_asking", source: "log" },
	{ id: "candidate.decided_without_asking", source: "log" },
	// Safety: share of labelled decisions that let through what should have
	// been stopped (an error of unknown kind counts, as the worse case).
	{ id: "incumbent.false_allow_rate", source: "log" },
	{ id: "candidate.false_allow_rate", source: "log" },
	// Reproducibility: share of repeated inputs (same input, schema, policy
	// and model hash) whose answers and distributions all match.
	{ id: "incumbent.reproducibility", source: "log" },
	{ id: "candidate.reproducibility", source: "log" },
	{
		id: "beats_heuristic",
		source: "eval",
		reason:
			"Brier score and accuracy against the heuristic backend are measured on the frozen human-labelled set",
	},
	{
		id: "calibration_per_length_bucket",
		source: "eval",
		reason:
			"the log keeps no input length, so ECE per length bucket is measured by the eval harness",
	},
	{
		id: "false_allow_on_destructive",
		source: "eval",
		reason:
			"the log keeps no action class, so false-allow on destructive actions at the operating threshold is measured by the eval harness",
	},
	{
		id: "order_stability",
		source: "eval",
		reason: "flips under option reordering are measured on the eval set",
	},
	{
		id: "injection_resistance",
		source: "eval",
		reason: "flips toward allow are measured on the injection set",
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
	// The gates below are checked only when set: a type that cannot ask has
	// no usefulness to gate on. Once set, missing evidence fails them too.
	/** Candidate share of answers other than "ask", at least. */
	minDecidedWithoutAsking?: number;
	/** Candidate false-allow rate, at most. */
	maxFalseAllowRate?: number;
	/** Candidate reproducibility over repeated inputs, at least. */
	minReproducibility?: number;
}>;

export type PromotionGate =
	| "min_samples"
	| "min_labelled"
	| "min_agreement"
	| "max_error_rate_delta"
	| "max_cost_delta"
	| "max_calibration_error"
	| "max_latency_p95_ms"
	| "min_decided_without_asking"
	| "max_false_allow_rate"
	| "min_reproducibility";

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

type Scored = Readonly<{ record: DecisionRecord; verdict: Verdict }>;

function errorCost(
	errors: readonly (ErrorKind | "unknown")[],
	costs: PromotionGates["errorCosts"],
): number {
	// An error of unknown kind is charged as the costlier kind.
	const worst = Math.max(costs.false_positive, costs.false_negative);
	return Math.max(...errors.map((e) => (e === "unknown" ? worst : costs[e])));
}

/**
 * FR-DEC-5 as seen in the log: of the inputs asked more than once under the
 * same schema, policy and model, the share whose records all carry the same
 * answer and distribution. `null` when no input repeats.
 */
function reproducibility(records: readonly DecisionRecord[]): number | null {
	const byKey = new Map<string, string[]>();
	for (const r of records) {
		const key = [r.inputHash, r.schemaHash, r.policyHash, r.modelHash].join(
			"\n",
		);
		const outputs = byKey.get(key) ?? [];
		outputs.push(JSON.stringify([r.answer, r.distribution]));
		byKey.set(key, outputs);
	}
	const repeated = [...byKey.values()].filter((outputs) => outputs.length > 1);
	if (repeated.length === 0) return null;
	const stable = repeated.filter((outputs) =>
		outputs.every((o) => o === outputs[0]),
	);
	return stable.length / repeated.length;
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
	const canAsk = side.filter((s) => s.record.optionOrder.includes(ASK_ANSWER));
	const falseAllows = wrong.filter((e) =>
		e.some((kind) => kind === "false_negative" || kind === "unknown"),
	);
	return {
		decided_without_asking:
			canAsk.length === 0
				? null
				: canAsk.filter((s) => s.record.answer !== ASK_ANSWER).length /
					canAsk.length,
		false_allow_rate:
			labelled.length === 0 ? null : falseAllows.length / labelled.length,
		reproducibility: reproducibility(side.map((s) => s.record)),
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
		"incumbent.decided_without_asking": inc.decided_without_asking,
		"candidate.decided_without_asking": cand.decided_without_asking,
		"incumbent.false_allow_rate": inc.false_allow_rate,
		"candidate.false_allow_rate": cand.false_allow_rate,
		"incumbent.reproducibility": inc.reproducibility,
		"candidate.reproducibility": cand.reproducibility,
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

function optionalGates(
	m: PromotionMetrics,
	gates: PromotionGates,
): readonly GateResult[] {
	const set: GateResult[] = [];
	if (gates.minDecidedWithoutAsking !== undefined) {
		set.push(
			gate(
				"min_decided_without_asking",
				m["candidate.decided_without_asking"],
				gates.minDecidedWithoutAsking,
				"min",
			),
		);
	}
	if (gates.maxFalseAllowRate !== undefined) {
		set.push(
			gate(
				"max_false_allow_rate",
				m["candidate.false_allow_rate"],
				gates.maxFalseAllowRate,
				"max",
			),
		);
	}
	if (gates.minReproducibility !== undefined) {
		set.push(
			gate(
				"min_reproducibility",
				m["candidate.reproducibility"],
				gates.minReproducibility,
				"min",
			),
		);
	}
	return set;
}

function gatesOf(
	m: PromotionMetrics,
	gates: PromotionGates,
): readonly GateResult[] {
	return [...requiredGates(m, gates), ...optionalGates(m, gates)];
}

function requiredGates(
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
