#!/usr/bin/env bun
/**
 * The promotion evidence for spec §9.2 (v1 task 8.8, #581): folds three
 * reports into the camelCase `promotion-action-risk.json` that
 * `v1-gates.ts` checks.
 *
 *   frozen sets    maina-model `eval.report` JSON for the exported model
 *                  (--candidate) and for the incumbent backend on the same
 *                  sets (--incumbent)
 *   shadow log     `evaluatePromotion`'s report (packages/core/src/decide/
 *                  promotion.ts) as JSON; the entry for the model's hash
 *   latency        packages/runtime/bench/model.bench.ts --json:
 *                  { modelP95Ms, gateP95Ms }
 *
 *   bun scripts/release/evidence/promotion.ts --candidate <f> --incumbent <f> \
 *     --shadow <f> --bench <f> --model-hash sha256:<hex> --out <f> [--link <url>] \
 *     [--incumbent-backend <rules|heuristic>]
 *
 * The incumbent defaults to `action.risk`'s catalog backend (`rules`). Once
 * the model is promoted that default is `system1`, so pass the backend it
 * replaced.
 *
 * Refused outright (no evidence file, so the gate says MISSING): a report
 * marked provisional or not promotion-grade, an incumbent measured on other
 * sets or by another backend than the one serving `action.risk`, a model
 * (`system1`) as the incumbent, a candidate report from a non-model backend,
 * or a model
 * hash not in the decision log's `sha256:<hex>` form. A shadow log or bench
 * that has nothing for the model leaves its numbers out and lists them in
 * `missing`, so the gate reports them missing instead of passing.
 *
 * Each metric has one definition:
 *
 * - `falseAllowDestructive` is the frozen-set share of destructive actions
 *   finally allowed at the operating threshold (`false_allow_at_threshold`).
 *   The shadow log's `false_allow_rate` counts any labelled false allow, so
 *   it is a different quantity and is never used here.
 * - `eceByLengthBucket` gates each length bucket with at least
 *   `MIN_ECE_BUCKET_N` questions on its own. When any bucket has fewer, the
 *   type's pooled ECE is gated in their place as `pooled` (null when the
 *   report has none, which the gate reads as missing).
 * - `decidedWithoutAsking` and `shadowDecisionsWithOutcomes` are log metrics
 *   (`PROMOTION_METRICS`): they come from shadow mode only.
 * - `reproducibility` is the worse of the frozen-set repeat and the shadow
 *   log's repeated inputs, when both are measured.
 */

import { DECISION_BACKENDS } from "../../../packages/core/src/policy/schema";
import type { Result } from "./shell";

type Obj = Readonly<Record<string, unknown>>;

const isObj = (v: unknown): v is Obj =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

const TYPE = "action.risk";

/** Buckets with fewer questions are gated through the pooled type ECE. */
export const MIN_ECE_BUCKET_N = 30;

/** An eval set's content hash (`SET.json` `sha256`). */
const SET_HASH = /^[0-9a-f]{64}$/;

/** The decision log's model hash (`hashModel`). */
const MODEL_HASH = /^sha256:[0-9a-f]{64}$/;

/** Backends that are not the model: the only ones it can be compared with. */
const NON_MODEL: readonly string[] = DECISION_BACKENDS.filter(
	(b) => b !== "system1",
);

export type PromotionInputs = Readonly<{
	/** The frozen-set report for the exported model. */
	candidate: unknown;
	/** The frozen-set report for the incumbent backend, same sets. */
	incumbent: unknown;
	/** `evaluatePromotion`'s report. */
	shadow: unknown;
	/** The model bench report. */
	bench: unknown;
	/** The exported model's hash, as the decision log records it. */
	modelHash: string;
	/**
	 * The backend serving `action.risk` before promotion. Once promoted the
	 * catalog default is `system1`, so the CLI then needs
	 * `--incumbent-backend`.
	 */
	incumbentBackend: string;
}>;

type Pair = Readonly<{ candidate: number; incumbent: number }>;

export type PromotionMetricsEvidence = Readonly<{
	brier?: Pair;
	accuracy?: Pair;
	eceByLengthBucket?: Readonly<Record<string, number | null>>;
	falseAllowDestructive?: number;
	decidedWithoutAsking?: number;
	orderFlips?: number;
	injectionFlipsToAllow?: number;
	modelLatencyP95Ms?: number;
	gateLatencyP95Ms?: number;
	shadowDecisionsWithOutcomes?: number;
	reproducibility?: number;
}>;

export type PromotionEvidence = Readonly<{
	link: string;
	type: typeof TYPE;
	modelHash: string;
	promotionGrade: true;
	evalSets: Readonly<Record<string, string>>;
	incumbent: Readonly<{ backend: string }>;
	metrics: PromotionMetricsEvidence;
	sparseBuckets?: readonly string[];
	missing?: readonly string[];
}>;

/** Every metric key, in the order the gate lists them. */
const METRIC_KEYS = [
	"brier",
	"accuracy",
	"eceByLengthBucket",
	"falseAllowDestructive",
	"decidedWithoutAsking",
	"orderFlips",
	"injectionFlipsToAllow",
	"modelLatencyP95Ms",
	"gateLatencyP95Ms",
	"shadowDecisionsWithOutcomes",
	"reproducibility",
] as const;

type FrozenReport = Readonly<{
	predictor: string;
	sets: Readonly<Record<string, string>>;
	report: Obj;
	byType: Obj;
}>;

/**
 * A promotion-grade `eval.report` document, or why it is not one. The
 * document is `{ provisional, report }` or the bare report.
 */
function frozenReport(
	role: "candidate" | "incumbent",
	doc: unknown,
): Result<FrozenReport, string> {
	if (!isObj(doc)) {
		return { ok: false, error: `${role}: no frozen-set report` };
	}
	const report = isObj(doc.report) ? doc.report : doc;
	if (
		doc.provisional !== false ||
		report.provisional === true ||
		report.promotion_grade !== true
	) {
		return {
			ok: false,
			error: `${role} report is provisional: every set must be frozen and human-labelled`,
		};
	}
	const sets = report.sets;
	if (
		!isObj(sets) ||
		Object.keys(sets).length === 0 ||
		!Object.values(sets).every((h) => typeof h === "string" && SET_HASH.test(h))
	) {
		return {
			ok: false,
			error: `${role} report: sets must map each eval set to its sha256`,
		};
	}
	const byTypeAll = isObj(report.by_type) ? report.by_type : {};
	const byType = isObj(byTypeAll[TYPE]) ? byTypeAll[TYPE] : {};
	return {
		ok: true,
		value: {
			predictor: typeof report.predictor === "string" ? report.predictor : "",
			sets: sets as Readonly<Record<string, string>>,
			report,
			byType,
		},
	};
}

function sameSets(
	a: Readonly<Record<string, string>>,
	b: Readonly<Record<string, string>>,
): boolean {
	const ka = Object.keys(a).sort();
	const kb = Object.keys(b).sort();
	return (
		ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
	);
}

function pair(cand: Obj, inc: Obj, key: string): Pair | undefined {
	const c = num(cand[key]);
	const i = num(inc[key]);
	return c === undefined || i === undefined
		? undefined
		: { candidate: c, incumbent: i };
}

/** The one small-bucket ECE rule (see the header). */
function eceBuckets(cand: FrozenReport): Readonly<{
	ece: Readonly<Record<string, number | null>> | undefined;
	sparse: readonly string[];
}> {
	const all = isObj(cand.report.ece_by_length_bucket)
		? cand.report.ece_by_length_bucket
		: {};
	const cells = isObj(all[TYPE]) ? all[TYPE] : {};
	const ece: Record<string, number | null> = {};
	const sparse: string[] = [];
	for (const bucket of Object.keys(cells).sort()) {
		const cell = cells[bucket];
		const value = isObj(cell) ? num(cell.ece) : undefined;
		const n = isObj(cell) ? (num(cell.n) ?? 0) : 0;
		if (value !== undefined && n >= MIN_ECE_BUCKET_N) ece[bucket] = value;
		else sparse.push(bucket);
	}
	if (sparse.some((b) => isObj(cells[b]) && num(cells[b].ece) !== undefined)) {
		ece.pooled = num(cand.byType.ece) ?? null;
	}
	return {
		ece: Object.keys(ece).length === 0 ? undefined : ece,
		sparse,
	};
}

/** The shadow entry for `modelHash` on `action.risk`, if any. */
function shadowMetrics(shadow: unknown, modelHash: string): Obj {
	const entries =
		isObj(shadow) && Array.isArray(shadow.entries) ? shadow.entries : [];
	const entry = entries.find(
		(e): e is Obj => isObj(e) && e.type === TYPE && e.candidate === modelHash,
	);
	return entry !== undefined && isObj(entry.metrics) ? entry.metrics : {};
}

function worst(...values: readonly (number | undefined)[]): number | undefined {
	const known = values.filter((v): v is number => v !== undefined);
	return known.length === 0 ? undefined : Math.min(...known);
}

export function promotionEvidence(
	inputs: PromotionInputs,
	link: string,
): Result<PromotionEvidence, string> {
	if (!MODEL_HASH.test(inputs.modelHash)) {
		return {
			ok: false,
			error: `model hash ${JSON.stringify(inputs.modelHash)} is not the decision log's sha256:<hex>`,
		};
	}
	if (!NON_MODEL.includes(inputs.incumbentBackend)) {
		return {
			ok: false,
			error: `incumbent backend ${JSON.stringify(inputs.incumbentBackend)} is not one the model can be compared with (${NON_MODEL.join(", ")}); pass --incumbent-backend`,
		};
	}
	const cand = frozenReport("candidate", inputs.candidate);
	if (!cand.ok) return cand;
	if (NON_MODEL.includes(cand.value.predictor)) {
		return {
			ok: false,
			error: `candidate report is for ${JSON.stringify(cand.value.predictor)}, not the model`,
		};
	}
	const inc = frozenReport("incumbent", inputs.incumbent);
	if (!inc.ok) return inc;
	if (inc.value.predictor !== inputs.incumbentBackend) {
		return {
			ok: false,
			error: `incumbent report is for ${JSON.stringify(inc.value.predictor)}, but ${TYPE} is served by "${inputs.incumbentBackend}"`,
		};
	}
	if (!sameSets(cand.value.sets, inc.value.sets)) {
		return {
			ok: false,
			error:
				"the candidate and incumbent must be measured on the same eval sets (names and sha256)",
		};
	}
	const c = cand.value;
	const r = c.report;
	const shadow = shadowMetrics(inputs.shadow, inputs.modelHash);
	const bench = isObj(inputs.bench) ? inputs.bench : {};
	const { ece, sparse } = eceBuckets(c);
	const found: PromotionMetricsEvidence = {
		brier: pair(c.byType, inc.value.byType, "brier"),
		accuracy: pair(c.byType, inc.value.byType, "accuracy"),
		eceByLengthBucket: ece,
		falseAllowDestructive: num(r.false_allow_at_threshold),
		decidedWithoutAsking: num(shadow["candidate.decided_without_asking"]),
		orderFlips: num(c.byType.order_flip_rate) ?? num(r.order_flip_rate),
		injectionFlipsToAllow: num(r.injection_flip_rate),
		modelLatencyP95Ms: num(bench.modelP95Ms),
		gateLatencyP95Ms: num(bench.gateP95Ms),
		shadowDecisionsWithOutcomes: num(shadow.labelled),
		reproducibility: worst(
			num(r.reproducibility),
			num(shadow["candidate.reproducibility"]),
		),
	};
	const metrics = Object.fromEntries(
		METRIC_KEYS.flatMap((k) =>
			found[k] === undefined ? [] : [[k, found[k]] as const],
		),
	) as PromotionMetricsEvidence;
	const missing = METRIC_KEYS.filter((k) => found[k] === undefined);
	return {
		ok: true,
		value: {
			link,
			type: TYPE,
			modelHash: inputs.modelHash,
			promotionGrade: true,
			evalSets: c.sets,
			incumbent: { backend: inputs.incumbentBackend },
			metrics,
			...(sparse.length > 0 ? { sparseBuckets: sparse } : {}),
			...(missing.length > 0 ? { missing } : {}),
		},
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, readJson, runLink } = await import("./shell");
	const { DECISION_CATALOG } = await import(
		"../../../packages/core/src/decide/types-catalog"
	);
	const argv = process.argv.slice(2);
	emit(
		"promotion-action-risk",
		flag(argv, "--out"),
		promotionEvidence(
			{
				candidate: readJson(flag(argv, "--candidate")),
				incumbent: readJson(flag(argv, "--incumbent")),
				shadow: readJson(flag(argv, "--shadow")),
				bench: readJson(flag(argv, "--bench")),
				modelHash: flag(argv, "--model-hash") ?? "",
				incumbentBackend:
					flag(argv, "--incumbent-backend") ??
					DECISION_CATALOG[TYPE].defaultBackend,
			},
			flag(argv, "--link") ?? runLink(process.env),
		),
	);
}
