/**
 * The promotion evidence (spec §9.2, task 8.8, #581): the frozen-set report
 * for the exported model against the incumbent's on the same sets, the
 * shadow metrics `evaluatePromotion` reports for that model, and the model
 * bench latency, merged into the camelCase `promotion-action-risk.json`
 * that `v1-gates.ts` checks.
 */

import { describe, expect, test } from "bun:test";
import { MIN_ECE_BUCKET_N, promotionEvidence } from "../promotion";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";
const MODEL = `sha256:${"a".repeat(64)}`;
const RULES = `sha256:${"b".repeat(64)}`;
const SETS = { action_risk: "1".repeat(64), injection: "2".repeat(64) };

/** An `eval.report` JSON document (maina-model), promotion-grade. */
function frozenReport(
	predictor: string,
	over: Readonly<Record<string, unknown>> = {},
	typeOver: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		provisional: false,
		promotable: true,
		gates: [],
		report: {
			predictor,
			predictor_version: "0.1.0",
			sets: SETS,
			promotion_grade: true,
			provisional: false,
			by_type: {
				"action.risk": {
					accuracy: predictor === "rules" ? 0.88 : 0.93,
					brier: predictor === "rules" ? 0.12 : 0.08,
					ece: 0.02,
					order_flip_rate: 0,
					...typeOver,
				},
			},
			ece_by_length_bucket: {
				"action.risk": {
					le128: { ece: 0.03, n: 400 },
					le512: { ece: 0.04, n: 120 },
				},
			},
			false_allow_at_threshold: 0.004,
			auto_decided_share: 0.8,
			order_flip_rate: 0.001,
			injection_flip_rate: 0.005,
			latency_p95: 4.2,
			reproducibility: 1,
			...over,
		},
	};
}

/** `evaluatePromotion`'s report, with one entry for MODEL in shadow. */
function shadowReport(
	metrics: Readonly<Record<string, unknown>> = {},
	candidate = MODEL,
): unknown {
	return {
		entries: [
			{
				type: "diff.sensitive",
				candidate: MODEL,
				incumbents: [RULES],
				metrics: { labelled: 5000, "candidate.decided_without_asking": 1 },
				gates: [],
				promote: false,
			},
			{
				type: "action.risk",
				candidate,
				incumbents: [RULES],
				metrics: {
					samples: 1500,
					labelled: 1200,
					"candidate.decided_without_asking": 0.74,
					"candidate.false_allow_rate": 0.2,
					"candidate.reproducibility": 1,
					...metrics,
				},
				gates: [],
				promote: true,
			},
		],
		notFromLog: [],
	};
}

const BENCH = { modelP95Ms: 22, gateP95Ms: 41 };

function inputs(over: Readonly<Record<string, unknown>> = {}) {
	return {
		candidate: frozenReport("system1"),
		incumbent: frozenReport("rules"),
		shadow: shadowReport(),
		bench: BENCH as unknown,
		modelHash: MODEL,
		incumbentBackend: "rules",
		...over,
	};
}

describe("promotionEvidence", () => {
	test("merges the frozen sets, the shadow log and the bench into the v1-gates schema", () => {
		expect(promotionEvidence(inputs(), LINK)).toEqual({
			ok: true,
			value: {
				link: LINK,
				type: "action.risk",
				modelHash: MODEL,
				promotionGrade: true,
				evalSets: SETS,
				incumbent: { backend: "rules" },
				metrics: {
					brier: { candidate: 0.08, incumbent: 0.12 },
					accuracy: { candidate: 0.93, incumbent: 0.88 },
					eceByLengthBucket: { le128: 0.03, le512: 0.04 },
					falseAllowDestructive: 0.004,
					decidedWithoutAsking: 0.74,
					orderFlips: 0,
					injectionFlipsToAllow: 0.005,
					modelLatencyP95Ms: 22,
					gateLatencyP95Ms: 41,
					shadowDecisionsWithOutcomes: 1200,
					reproducibility: 1,
				},
			},
		});
	});

	test("refuses a provisional candidate report", () => {
		const r = promotionEvidence(
			inputs({
				candidate: {
					...frozenReport("system1", { promotion_grade: false }),
					provisional: true,
				},
			}),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/candidate.*provisional/),
		});
	});

	test("refuses a report marked provisional even when it claims promotion grade", () => {
		const r = promotionEvidence(
			inputs({
				incumbent: { ...frozenReport("rules"), provisional: true },
			}),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/incumbent.*provisional/),
		});
	});

	test("refuses an incumbent measured on other sets than the candidate", () => {
		const r = promotionEvidence(
			inputs({
				incumbent: frozenReport("rules", {
					sets: { ...SETS, injection: "3".repeat(64) },
				}),
			}),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/same eval sets/),
		});
	});

	test("refuses a report whose set hashes are not sha256", () => {
		const bad = { action_risk: "not-a-hash" };
		const r = promotionEvidence(
			inputs({
				candidate: frozenReport("system1", { sets: bad }),
				incumbent: frozenReport("rules", { sets: bad }),
			}),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/sets/),
		});
	});

	test("names the incumbent by the backend that serves action.risk", () => {
		const r = promotionEvidence(
			inputs({ incumbent: frozenReport("heuristic") }),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/incumbent.*heuristic.*rules/),
		});
	});

	test("refuses the model as its own incumbent (once promoted, the catalog default is system1)", () => {
		const r = promotionEvidence(
			inputs({
				incumbent: frozenReport("system1"),
				incumbentBackend: "system1",
			}),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/--incumbent-backend/),
		});
	});

	test("refuses a candidate report measured on a non-model backend", () => {
		const r = promotionEvidence(
			inputs({ candidate: frozenReport("heuristic") }),
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/candidate.*heuristic.*not the model/),
		});
	});

	test("refuses a model hash that is not the decision log's sha256 form", () => {
		expect(promotionEvidence(inputs({ modelHash: "system1" }), LINK).ok).toBe(
			false,
		);
	});

	test("reads the shadow metrics of the exported model only", () => {
		const r = promotionEvidence(
			inputs({ shadow: shadowReport({}, `sha256:${"c".repeat(64)}`) }),
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.metrics.shadowDecisionsWithOutcomes).toBeUndefined();
		expect(r.value.metrics.decidedWithoutAsking).toBeUndefined();
		expect(r.value.missing).toEqual([
			"decidedWithoutAsking",
			"shadowDecisionsWithOutcomes",
		]);
	});

	test("one false-allow definition: destructive at the operating threshold on the frozen set, never the shadow rate", () => {
		const r = promotionEvidence(
			inputs({
				candidate: frozenReport("system1", { false_allow_at_threshold: null }),
			}),
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		// The shadow log's false_allow_rate (0.2) is a different quantity.
		expect(r.value.metrics.falseAllowDestructive).toBeUndefined();
		expect(r.value.missing).toEqual(["falseAllowDestructive"]);
	});

	test(`one small-bucket ECE rule: a bucket under ${MIN_ECE_BUCKET_N} questions is gated through the pooled type ECE`, () => {
		const r = promotionEvidence(
			inputs({
				candidate: frozenReport("system1", {
					ece_by_length_bucket: {
						"action.risk": {
							le128: { ece: 0.03, n: 400 },
							le2048: { ece: 0.3, n: MIN_ECE_BUCKET_N - 1 },
							le8192: { ece: null, n: 0 },
						},
					},
				}),
			}),
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.metrics.eceByLengthBucket).toEqual({
			le128: 0.03,
			pooled: 0.02,
		});
		expect(r.value.sparseBuckets).toEqual(["le2048", "le8192"]);
	});

	test("a sparse bucket with no pooled ECE is written as missing, never dropped", () => {
		const r = promotionEvidence(
			inputs({
				candidate: frozenReport(
					"system1",
					{
						ece_by_length_bucket: {
							"action.risk": {
								le128: { ece: 0.03, n: 400 },
								le2048: { ece: 0.3, n: 3 },
							},
						},
					},
					{ ece: null },
				),
			}),
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.metrics.eceByLengthBucket).toEqual({
			le128: 0.03,
			pooled: null,
		});
	});

	test("reproducibility is the worse of the frozen-set repeat and the shadow log", () => {
		const r = promotionEvidence(
			inputs({
				shadow: shadowReport({ "candidate.reproducibility": 0.98 }),
			}),
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.metrics.reproducibility).toBe(0.98);
	});

	test("with no model bench the latencies are listed missing", () => {
		const r = promotionEvidence(inputs({ bench: undefined }), LINK);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.metrics.modelLatencyP95Ms).toBeUndefined();
		expect(r.value.missing).toEqual(["modelLatencyP95Ms", "gateLatencyP95Ms"]);
	});

	test("with no frozen-set report there is no evidence", () => {
		expect(promotionEvidence(inputs({ candidate: undefined }), LINK).ok).toBe(
			false,
		);
		expect(promotionEvidence(inputs({ incumbent: "junk" }), LINK).ok).toBe(
			false,
		);
	});
});
