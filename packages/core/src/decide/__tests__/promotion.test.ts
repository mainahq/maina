import { describe, expect, test } from "bun:test";
import { migrateDecisionOutcomes } from "../../db/decision-outcomes";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { DbPort } from "../../ports/db";
import { createFixedClock, createMemoryDb } from "../../ports/testing";
import { type DecidePorts, decide } from "../decide";
import { readLogSlice, SHADOW_ACTION } from "../evidence";
import type { DecisionLogPorts } from "../log/append";
import { hashModel } from "../log/hash";
import { queryDecisions } from "../log/query";
import type { DecisionRecord } from "../log/schema";
import { linkOutcome } from "../outcomes/link";
import type { OutcomeRecord } from "../outcomes/types";
import {
	evaluatePromotion,
	PROMOTION_METRICS,
	type PromotionGates,
	shadowRun,
} from "../promotion";
import { createRegistry, DEFAULT_REGISTRY } from "../registry";
import type { Backend, DecideRequest, Decision } from "../types";
import {
	boolRecord,
	HEURISTIC,
	outcome,
	riskRecord,
	SYSTEM1,
} from "./slice-fixtures";

function unwrap<T, E>(
	result: { ok: true; value: T } | { ok: false; error: E },
): T {
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		return undefined as never;
	}
	return result.value;
}

function migratedDb(): DbPort {
	const db = createMemoryDb();
	unwrap(migrateDecisionOutcomes(db));
	return db;
}

const REQUEST: DecideRequest = {
	type: "slop",
	state: { trusted: {}, untrusted: { text: "console.log(1)" } },
	questions: [
		{ kind: "bool", id: "ai-console" },
		{ kind: "bool", id: "ai-todo" },
	],
};

function primaryPorts(): DecidePorts {
	return {
		clock: createFixedClock(1_000),
		policy: DEFAULT_POLICY,
		backends: DEFAULT_REGISTRY,
	};
}

/** A shadow that always answers the opposite of what it is told to. */
function contrarian(answer: boolean): Backend {
	return {
		id: "system1",
		version: "0.1.0",
		answer: (input) => ({
			ok: true,
			value: input.questions.map(() => ({
				answer,
				distribution: [
					{ answer: true, p: answer ? 0.99 : 0.01 },
					{ answer: false, p: answer ? 0.01 : 0.99 },
				],
			})),
		}),
	};
}

function logPorts(db: DbPort): DecisionLogPorts {
	return { db };
}

describe("shadowRun", () => {
	test("a shadow backend never affects actions", () => {
		const db = migratedDb();
		const primary = primaryPorts();
		const expected = unwrap(decide(primaryPorts(), REQUEST));
		const acted: Decision[] = [];
		for (const shadowAnswer of [true, false]) {
			acted.length = 0;
			const run = unwrap(
				shadowRun(
					{ primary, shadow: contrarian(shadowAnswer), log: logPorts(db) },
					{
						id: `run-${shadowAnswer}`,
						ts: 10,
						request: REQUEST,
						finalAction: (d) => {
							acted.push(d);
							return d.answer === true ? "flag" : "pass";
						},
					},
				),
			);
			expect(run.decisions).toEqual(expected);
			expect(acted).toEqual([...expected]);
			expect(run.shadowError).toBeUndefined();
		}

		const logged = unwrap(queryDecisions({ db }));
		const primaryRecords = logged.filter(
			(r) => r.finalAction !== SHADOW_ACTION,
		);
		const shadowRecords = logged.filter((r) => r.finalAction === SHADOW_ACTION);
		expect(primaryRecords).toHaveLength(4);
		expect(shadowRecords).toHaveLength(4);
		const heuristicHash = hashModel(expected[0]?.backend ?? HEURISTIC);
		for (const r of primaryRecords) expect(r.modelHash).toBe(heuristicHash);
		expect(primaryRecords.map((r) => r.finalAction)).toEqual(
			[...expected, ...expected].map((d) =>
				d.answer === true ? "flag" : "pass",
			),
		);
		for (const r of shadowRecords) {
			expect(r.modelHash).toBe(hashModel(SYSTEM1));
		}
		expect(shadowRecords.map((r) => r.id)).toEqual([
			"run-true:0:shadow",
			"run-true:1:shadow",
			"run-false:0:shadow",
			"run-false:1:shadow",
		]);
		// A shadow record describes the same input as its primary.
		const byId = new Map(logged.map((r) => [r.id, r]));
		for (const r of shadowRecords) {
			const pair = byId.get(r.id.replace(/:shadow$/, ""));
			expect(pair?.inputHash).toBe(r.inputHash);
			expect(pair?.policyHash).toBe(r.policyHash);
		}
	});

	test("a failing shadow is reported and still never affects actions", () => {
		const failing: readonly Backend[] = [
			{
				id: "system1",
				version: "0.1.0",
				answer: () => {
					throw new Error("model crashed");
				},
			},
			{
				id: "system1",
				version: "0.1.0",
				answer: () => ({
					ok: false,
					error: { kind: "unsupported", questionId: undefined, message: "no" },
				}),
			},
			{
				id: "system1",
				version: "0.1.0",
				answer: () => ({ ok: true, value: [{ answer: "maybe" }] as never }),
			},
		];
		const expected = unwrap(decide(primaryPorts(), REQUEST));
		for (const [i, shadow] of failing.entries()) {
			const db = migratedDb();
			const run = unwrap(
				shadowRun(
					{ primary: primaryPorts(), shadow, log: logPorts(db) },
					{ id: `f${i}`, ts: 10, request: REQUEST, finalAction: () => "flag" },
				),
			);
			expect(run.decisions).toEqual(expected);
			expect(run.shadowError).toBeDefined();
			const logged = unwrap(queryDecisions({ db }));
			expect(logged.map((r) => r.id)).toEqual([`f${i}:0`, `f${i}:1`]);
		}
	});

	test("a shadow that mutates the request cannot change the primary decisions", () => {
		const db = migratedDb();
		const state = {
			trusted: {} as Record<string, unknown>,
			untrusted: { text: "console.log(1)" } as Record<string, unknown>,
		};
		const request: DecideRequest = { ...REQUEST, state };
		const expected = unwrap(decide(primaryPorts(), REQUEST));
		const vandal: Backend = {
			...contrarian(false),
			answer: (input) => {
				(input.state.untrusted as Record<string, unknown>).text = "clean";
				return contrarian(false).answer(input);
			},
		};
		const run = unwrap(
			shadowRun(
				{ primary: primaryPorts(), shadow: vandal, log: logPorts(db) },
				{ id: "m", ts: 10, request, finalAction: () => "flag" },
			),
		);
		expect(run.decisions).toEqual(expected);
	});

	test("both primary and shadow records follow the log's privacy setting", () => {
		const pick = (id: "heuristic" | "system1", file: string): Backend => ({
			id,
			version: "1",
			answer: () => ({
				ok: true,
				value: [
					{
						answer: file,
						distribution: [
							{ answer: "a.ts", p: file === "a.ts" ? 1 : 0 },
							{ answer: "b.ts", p: file === "b.ts" ? 1 : 0 },
						],
					},
				],
			}),
		});
		const request: DecideRequest = {
			type: "context.select",
			state: { trusted: {}, untrusted: {} },
			questions: [{ kind: "choice", id: "file", options: ["a.ts", "b.ts"] }],
		};
		const db = migratedDb();
		const run = unwrap(
			shadowRun(
				{
					primary: {
						...primaryPorts(),
						backends: createRegistry([pick("heuristic", "a.ts")]),
					},
					shadow: pick("system1", "b.ts"),
					log: { db, privacy: { rawOptions: true } },
				},
				{ id: "p", ts: 10, request, finalAction: () => "select" },
			),
		);
		expect(run.shadowError).toBeUndefined();
		expect(run.records.map((r) => [r.id, r.optionOrder, r.answer])).toEqual([
			["p:0", ["a.ts", "b.ts"], "a.ts"],
			["p:0:shadow", ["a.ts", "b.ts"], "b.ts"],
		]);
	});

	test("a primary failure is returned and nothing is logged or shadowed", () => {
		const db = migratedDb();
		let shadowCalls = 0;
		const shadow: Backend = {
			...contrarian(true),
			answer: (input) => {
				shadowCalls += 1;
				return contrarian(true).answer(input);
			},
		};
		const result = shadowRun(
			{ primary: primaryPorts(), shadow, log: logPorts(db) },
			{
				id: "bad",
				ts: 10,
				request: { ...REQUEST, questions: [] },
				finalAction: () => "flag",
			},
		);
		expect(result.ok).toBe(false);
		expect(shadowCalls).toBe(0);
		expect(unwrap(queryDecisions({ db }))).toEqual([]);
	});
});

// ── Promotion report ────────────────────────────────────────────────────────

/**
 * Ten paired decisions of `slop`, heuristic primary against a system1
 * shadow:
 *
 * | pair | primary | shadow | outcome on primary          |
 * | 0-3  | true    | true   | accepted                    |
 * | 4-5  | true    | true   | none                        |
 * | 6-7  | true    | false  | dismissed (false positive)  |
 * | 8    | true    | false  | accepted                    |
 * | 9    | true    | true   | reverted (false negative)   |
 */
function pairedSlice(): Readonly<{
	decisions: readonly DecisionRecord[];
	outcomes: readonly OutcomeRecord[];
}> {
	const decisions: DecisionRecord[] = [];
	const outcomes: OutcomeRecord[] = [];
	for (let i = 0; i < 10; i++) {
		const id = `d${i}`;
		const disagree = i >= 6 && i <= 8;
		decisions.push(boolRecord({ id, model: HEURISTIC, p: 0.9, latencyMs: 2 }));
		decisions.push(
			boolRecord({
				id: `${id}:shadow`,
				model: SYSTEM1,
				answer: !disagree,
				p: 0.8,
				latencyMs: i + 1,
				finalAction: SHADOW_ACTION,
			}),
		);
		if (i <= 3 || i === 8) outcomes.push(outcome(id, "accepted"));
		if (i === 6 || i === 7) outcomes.push(outcome(id, "dismissed"));
		if (i === 9) outcomes.push(outcome(id, "reverted"));
	}
	return { decisions, outcomes };
}

const GATES: PromotionGates = {
	minSamples: 10,
	minLabelled: 8,
	minAgreement: 0.7,
	maxErrorRateDelta: 0,
	maxCostDelta: 1,
	maxCalibrationError: 0.1,
	maxLatencyP95Ms: 10,
	errorCosts: { false_positive: 1, false_negative: 10 },
};

describe("evaluatePromotion", () => {
	test("the promotion report computes every §9.2 metric available from the log", () => {
		const report = evaluatePromotion(pairedSlice(), GATES);
		expect(report.entries).toHaveLength(1);
		const [entry] = report.entries;
		if (entry === undefined) return;
		expect(entry.type).toBe("slop");
		expect(entry.candidate).toBe(hashModel(SYSTEM1));
		expect(entry.incumbents).toEqual([hashModel(HEURISTIC)]);

		const fromLog = PROMOTION_METRICS.filter((m) => m.source === "log");
		expect(fromLog.length).toBeGreaterThan(0);
		// A yes/no type has no "ask" option and this slice repeats no input:
		// those two metrics are covered by the action.risk test below.
		const notApplicable = new Set<string>([
			"incumbent.decided_without_asking",
			"candidate.decided_without_asking",
			"incumbent.reproducibility",
			"candidate.reproducibility",
		]);
		for (const metric of fromLog) {
			expect({ metric: metric.id, value: entry.metrics[metric.id] }).toEqual({
				metric: metric.id,
				value: notApplicable.has(metric.id) ? null : expect.any(Number),
			});
		}
		expect(Object.keys(entry.metrics).sort()).toEqual(
			fromLog.map((m) => m.id).sort(),
		);
		// Metrics the log cannot supply are named, with the reason.
		const elsewhere = PROMOTION_METRICS.filter((m) => m.source !== "log");
		expect(report.notFromLog.map((m) => m.metric)).toEqual(
			elsewhere.map((m) => m.id),
		);
		for (const m of report.notFromLog)
			expect(m.reason.length).toBeGreaterThan(0);

		const m = entry.metrics;
		expect(m.samples).toBe(10);
		expect(m.labelled).toBe(8);
		expect(m.agreement).toBeCloseTo(0.7);
		expect(m.override_rate).toBe(0);
		expect(m["incumbent.error_rate"]).toBeCloseTo(3 / 8);
		expect(m["candidate.error_rate"]).toBeCloseTo(2 / 8);
		// FP costs 1, FN 10; a candidate error of unknown kind costs the max.
		expect(m["incumbent.expected_cost"]).toBeCloseTo((1 + 1 + 10) / 8);
		expect(m["candidate.expected_cost"]).toBeCloseTo((10 + 10) / 8);
		expect(m["incumbent.calibration_error"]).toBeCloseTo(0.9 - 5 / 8);
		expect(m["candidate.calibration_error"]).toBeCloseTo(0.8 - 6 / 8);
		expect(m["incumbent.mean_confidence"]).toBeCloseTo(0.9);
		expect(m["candidate.mean_confidence"]).toBeCloseTo(0.8);
		expect(m["incumbent.latency_p50_ms"]).toBe(2);
		expect(m["incumbent.latency_p95_ms"]).toBe(2);
		expect(m["candidate.latency_p50_ms"]).toBe(5);
		expect(m["candidate.latency_p95_ms"]).toBe(10);
		// Pair 9 let a revert through; the candidate also disagreed with the
		// right primary of pair 8, an error of unknown kind, charged as the
		// worse one.
		expect(m["incumbent.false_allow_rate"]).toBeCloseTo(1 / 8);
		expect(m["candidate.false_allow_rate"]).toBeCloseTo(2 / 8);
	});

	test("usefulness, safety and reproducibility come from the log for action.risk", () => {
		// | pair | input | primary | shadow | outcome on primary |
		// | 0    | x     | allow   | allow  | accepted           |
		// | 1    | 1     | ask     | allow  | accepted           |
		// | 2    | 2     | allow   | deny   | accepted           |
		// | 3    | 3     | ask     | ask    | none               |
		// | 4    | 4     | allow   | allow  | reverted           |
		// | 5    | 5     | deny    | ask    | accepted           |
		// | 6    | x     | allow   | deny   | none               |
		const rows = [
			["allow", "allow", "accepted", "x"],
			["ask", "allow", "accepted"],
			["allow", "deny", "accepted"],
			["ask", "ask", undefined],
			["allow", "allow", "reverted"],
			["deny", "ask", "accepted"],
			["allow", "deny", undefined, "x"],
		] as const;
		const decisions: DecisionRecord[] = [];
		const outcomes: OutcomeRecord[] = [];
		for (const [i, [primary, shadow, result, input]] of rows.entries()) {
			const id = `r${i}`;
			decisions.push(
				riskRecord({ id, model: HEURISTIC, answer: primary, input }),
				riskRecord({
					id: `${id}:shadow`,
					model: SYSTEM1,
					answer: shadow,
					input,
					finalAction: SHADOW_ACTION,
				}),
			);
			if (result !== undefined) outcomes.push(outcome(id, result));
		}
		const report = evaluatePromotion(
			{ decisions, outcomes },
			{
				...GATES,
				minDecidedWithoutAsking: 0.75,
				maxFalseAllowRate: 0.005,
				minReproducibility: 1,
			},
		);
		const [entry] = report.entries;
		if (entry === undefined) {
			expect(entry).toBeDefined();
			return;
		}
		const m = entry.metrics;
		expect(m.labelled).toBe(5);
		// Usefulness: answers other than "ask".
		expect(m["incumbent.decided_without_asking"]).toBeCloseTo(5 / 7);
		expect(m["candidate.decided_without_asking"]).toBeCloseTo(5 / 7);
		// Safety: the incumbent let pair 4 through. The candidate allowed
		// what a right primary asked about (1), agreed on pair 4, and on 5
		// differed from a right deny without allowing (unknown kind).
		expect(m["incumbent.false_allow_rate"]).toBeCloseTo(1 / 5);
		expect(m["candidate.false_allow_rate"]).toBeCloseTo(3 / 5);
		// Denying what a right primary allowed (2) is a false positive.
		expect(m["candidate.error_rate"]).toBeCloseTo(4 / 5);
		expect(m["candidate.expected_cost"]).toBeCloseTo((10 + 1 + 10 + 10) / 5);
		// Reproducibility: input x was asked twice; the incumbent answered
		// alike both times, the candidate did not.
		expect(m["incumbent.reproducibility"]).toBe(1);
		expect(m["candidate.reproducibility"]).toBe(0);

		const failed = entry.gates.filter((g) => !g.pass).map((g) => g.gate);
		expect(failed).toContain("min_decided_without_asking");
		expect(failed).toContain("max_false_allow_rate");
		expect(failed).toContain("min_reproducibility");
		expect(entry.promote).toBe(false);
	});

	test("optional gates are checked only when set, and fail without evidence", () => {
		const slice = pairedSlice();
		const plain = evaluatePromotion(slice, GATES).entries[0];
		const names = plain?.gates.map((g) => g.gate) ?? [];
		expect(names).not.toContain("min_decided_without_asking");
		expect(names).not.toContain("max_false_allow_rate");
		expect(names).not.toContain("min_reproducibility");

		// A yes/no type never asks and this slice repeats no input: set
		// anyway, the gates fail closed.
		const strict = evaluatePromotion(slice, {
			...GATES,
			minDecidedWithoutAsking: 0,
			minReproducibility: 0,
		}).entries[0];
		expect(
			strict?.gates.filter((g) => !g.pass).map((g) => [g.gate, g.value]),
		).toEqual([
			["min_decided_without_asking", null],
			["min_reproducibility", null],
		]);
		expect(strict?.promote).toBe(false);
	});

	test("the candidate is promoted only when every gate passes", () => {
		const slice = pairedSlice();
		const passing = evaluatePromotion(slice, { ...GATES, maxCostDelta: 1 });
		expect(passing.entries[0]?.gates.every((g) => g.pass)).toBe(true);
		expect(passing.entries[0]?.promote).toBe(true);

		const tight = evaluatePromotion(slice, { ...GATES, maxLatencyP95Ms: 9 });
		expect(tight.entries[0]?.promote).toBe(false);
		expect(
			tight.entries[0]?.gates.filter((g) => !g.pass).map((g) => g.gate),
		).toEqual(["max_latency_p95_ms"]);

		const costly = evaluatePromotion(slice, { ...GATES, maxCostDelta: 0.5 });
		expect(costly.entries[0]?.promote).toBe(false);
		expect(
			costly.entries[0]?.gates.find((g) => g.gate === "max_cost_delta"),
		).toEqual({
			gate: "max_cost_delta",
			value: expect.closeTo(1, 6),
			threshold: 0.5,
			pass: false,
		});
	});

	test("missing evidence fails its gates instead of passing them", () => {
		const { decisions } = pairedSlice();
		const report = evaluatePromotion({ decisions, outcomes: [] }, GATES);
		const [entry] = report.entries;
		expect(entry?.metrics.labelled).toBe(0);
		expect(entry?.metrics["candidate.error_rate"]).toBeNull();
		expect(entry?.promote).toBe(false);
		const failed = entry?.gates.filter((g) => !g.pass).map((g) => g.gate);
		expect(failed).toContain("min_labelled");
		expect(failed).toContain("max_error_rate_delta");
		expect(failed).toContain("max_calibration_error");
	});

	test("reports one entry per type and candidate; unpaired shadows are ignored", () => {
		const other = { id: "system1", version: "0.2.0" } as const;
		const decisions = [
			boolRecord({ id: "a", model: HEURISTIC }),
			boolRecord({
				id: "a:shadow",
				model: SYSTEM1,
				finalAction: SHADOW_ACTION,
			}),
			boolRecord({ id: "b", model: HEURISTIC, type: "finding.real" }),
			boolRecord({
				id: "b:shadow",
				model: SYSTEM1,
				type: "finding.real",
				finalAction: SHADOW_ACTION,
			}),
			boolRecord({ id: "c", model: HEURISTIC }),
			boolRecord({ id: "c:shadow", model: other, finalAction: SHADOW_ACTION }),
			boolRecord({
				id: "orphan:shadow",
				model: SYSTEM1,
				finalAction: SHADOW_ACTION,
			}),
		];
		const report = evaluatePromotion({ decisions, outcomes: [] }, GATES);
		expect(
			report.entries.map((e) => [e.type, e.candidate, e.metrics.samples]),
		).toEqual([
			["slop", hashModel(SYSTEM1), 1],
			["finding.real", hashModel(SYSTEM1), 1],
			["slop", hashModel(other), 1],
		]);
	});

	test("a shadow is paired only with a primary over the same input", () => {
		const shadow = boolRecord({
			id: "a:shadow",
			model: SYSTEM1,
			finalAction: SHADOW_ACTION,
		});
		const decisions = [
			{
				...boolRecord({ id: "a", model: HEURISTIC }),
				inputHash: shadow.schemaHash,
			},
			shadow,
		];
		expect(
			evaluatePromotion({ decisions, outcomes: [] }, GATES).entries,
		).toEqual([]);
	});

	test("a disagreeing score is not judged against a right primary", () => {
		const score = (id: string, model: typeof HEURISTIC, value: number) => ({
			...boolRecord({ id, model }),
			type: "spec.quality" as const,
			optionOrder: [],
			distribution: [{ answer: value, p: 1 }],
			answer: value,
			finalAction: id.endsWith(":shadow") ? SHADOW_ACTION : "flag",
		});
		const report = evaluatePromotion(
			{
				decisions: [
					score("q", HEURISTIC, 0.7),
					score("q:shadow", SYSTEM1, 0.71),
				],
				outcomes: [outcome("q", "accepted")],
			},
			GATES,
		);
		const m = report.entries[0]?.metrics;
		expect(m?.["incumbent.error_rate"]).toBe(0);
		expect(m?.["candidate.error_rate"]).toBeNull();
	});

	test("a slice with no shadow decisions has nothing to promote", () => {
		const decisions = [boolRecord({ id: "a", model: HEURISTIC })];
		expect(
			evaluatePromotion({ decisions, outcomes: [] }, GATES).entries,
		).toEqual([]);
	});

	test("override outcomes count toward the incumbent override rate", () => {
		const decisions = [
			boolRecord({ id: "a", model: HEURISTIC }),
			boolRecord({
				id: "a:shadow",
				model: SYSTEM1,
				finalAction: SHADOW_ACTION,
			}),
			boolRecord({ id: "b", model: HEURISTIC }),
			boolRecord({
				id: "b:shadow",
				model: SYSTEM1,
				finalAction: SHADOW_ACTION,
			}),
		];
		const report = evaluatePromotion(
			{ decisions, outcomes: [outcome("a", "override")] },
			GATES,
		);
		expect(report.entries[0]?.metrics.override_rate).toBeCloseTo(0.5);
	});
});

describe("readLogSlice", () => {
	test("reads shadow runs and their outcomes back for the report", () => {
		const db = migratedDb();
		const clock = createFixedClock(5_000);
		const run = unwrap(
			shadowRun(
				{ primary: primaryPorts(), shadow: contrarian(false), log: { db } },
				{ id: "r", ts: 10, request: REQUEST, finalAction: () => "flag" },
			),
		);
		const [first] = run.records;
		if (first === undefined) return;
		unwrap(
			linkOutcome({ db, clock }, first.id, {
				kind: "accepted",
				source: "gate",
			}),
		);

		const slice = unwrap(readLogSlice({ db }, { type: "slop" }));
		expect(slice.decisions.map((r) => r.id)).toEqual(
			run.records.map((r) => r.id),
		);
		expect(slice.outcomes.map((o) => o.decisionId)).toEqual([first.id]);
		const report = evaluatePromotion(slice, GATES);
		expect(report.entries[0]?.metrics.samples).toBe(2);
		expect(report.entries[0]?.metrics.labelled).toBe(1);
	});
});
