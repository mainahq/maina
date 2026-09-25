import { describe, expect, test } from "bun:test";
import type { ModelTier } from "../../ai/tiers";
import {
	boolRecord,
	HEURISTIC,
	outcome,
	riskRecord,
	SYSTEM1,
} from "../../decide/__tests__/slice-fixtures";
import type { LogSlice } from "../../decide/evidence";
import { hashModel, hashValue } from "../../decide/log/hash";
import type { DecisionRecord } from "../../decide/log/schema";
import { MODEL_TIERS } from "../../decide/types-catalog";
import {
	formatSessionSummary,
	type RoutingCosts,
	type SessionSummary,
	summarise,
} from "../summary";

type Verdict = "allow" | "ask" | "deny";

function gate(
	id: string,
	finalAction: Verdict,
	latencyMs = 1,
	answer: Verdict = finalAction,
): DecisionRecord {
	return {
		...riskRecord({ id, model: HEURISTIC, answer, finalAction }),
		latencyMs,
	};
}

function routed(id: string, tier: ModelTier, latencyMs = 1): DecisionRecord {
	return {
		id,
		ts: 1_000,
		type: "task.tier",
		inputHash: hashValue(`input:${id}`),
		schemaHash: hashValue("schema:task.tier"),
		optionOrder: [...MODEL_TIERS],
		policyHash: hashValue("policy"),
		modelHash: hashModel(HEURISTIC),
		distribution: MODEL_TIERS.map((t) => ({
			answer: t,
			p: t === tier ? 1 : 0,
		})),
		answer: tier,
		finalAction: "route",
		latencyMs,
	};
}

function slice(
	decisions: readonly DecisionRecord[],
	outcomes: LogSlice["outcomes"] = [],
): LogSlice {
	return { decisions, outcomes };
}

const COSTS: RoutingCosts = {
	baselineTier: "standard",
	costPerTaskUsd: { mechanical: 0.01, standard: 0.05, architectural: 0.2 },
};

describe("summarise", () => {
	test("is null when nothing happened", () => {
		expect(summarise(slice([]))).toBeNull();
		expect(summarise(slice([]), { routing: COSTS })).toBeNull();
	});

	test("is null when the slice holds no gate or routing decisions", () => {
		const other = [
			boolRecord({ id: "s1", model: HEURISTIC }),
			boolRecord({ id: "s2", model: HEURISTIC, type: "diff.sensitive" }),
		];
		expect(summarise(slice(other))).toBeNull();
	});

	test("counts gate verdicts by what the gate did", () => {
		const summary = summarise(
			slice([
				gate("g1", "deny"),
				gate("g2", "ask"),
				gate("g3", "ask"),
				gate("g4", "allow"),
				gate("g5", "allow"),
				gate("g6", "allow"),
				// The model said allow but the gate asked (below threshold, say).
				gate("g7", "ask", 1, "allow"),
			]),
		);
		expect(summary).not.toBeNull();
		expect(summary?.blocked).toBe(1);
		expect(summary?.asked).toBe(3);
		expect(summary?.allowed).toBe(3);
		expect(summary?.routed).toBe(0);
	});

	test("counts a two-order check as one gate event", () => {
		const summary = summarise(
			slice([
				gate("g1", "ask", 10),
				gate("g1:reversed", "ask", 30),
				gate("g2", "allow", 5),
			]),
		);
		expect(summary?.asked).toBe(1);
		expect(summary?.allowed).toBe(1);
		// The two halves ran one after the other: 10 + 30 ms for g1.
		expect(summary?.addedLatencyP95).toBe(40);
	});

	test("ignores shadow records: nothing was done with them", () => {
		const summary = summarise(
			slice([
				gate("g1", "allow", 3),
				{
					...riskRecord({ id: "g1:shadow", model: SYSTEM1, answer: "deny" }),
					finalAction: "shadow",
					latencyMs: 900,
				},
				{ ...routed("r1:shadow", "mechanical", 900), finalAction: "shadow" },
			]),
		);
		expect(summary?.blocked).toBe(0);
		expect(summary?.allowed).toBe(1);
		expect(summary?.routed).toBe(0);
		expect(summary?.addedLatencyP95).toBe(3);
	});

	test("is null when only shadow records are in the slice", () => {
		const shadowOnly = [
			{ ...gate("g1:shadow", "deny"), finalAction: "shadow" },
		];
		expect(summarise(slice(shadowOnly))).toBeNull();
	});

	test("counts overridden decisions under the verdict the gate gave", () => {
		const summary = summarise(
			slice(
				[gate("g1", "deny"), gate("g2", "ask")],
				[outcome("g1", "override"), outcome("g2", "override")],
			),
		);
		expect(summary?.blocked).toBe(1);
		expect(summary?.asked).toBe(1);
	});

	test("counts routing decisions", () => {
		const summary = summarise(
			slice([routed("r1", "mechanical"), routed("r2", "standard")]),
		);
		expect(summary?.routed).toBe(2);
		expect(summary?.blocked).toBe(0);
		expect(summary?.asked).toBe(0);
		expect(summary?.allowed).toBe(0);
	});

	test("estimates savings against the baseline tier", () => {
		const summary = summarise(
			slice([
				routed("r1", "mechanical"), // 0.05 - 0.01 = +0.04
				routed("r2", "mechanical"), // +0.04
				routed("r3", "standard"), // 0
				routed("r4", "architectural"), // 0.05 - 0.20 = -0.15
			]),
			{ routing: COSTS },
		);
		expect(summary?.routed).toBe(4);
		expect(summary?.estimatedSavedUsd).toBeCloseTo(-0.07, 10);
	});

	test("a tier without a cost adds nothing to the estimate", () => {
		const summary = summarise(
			slice([routed("r1", "local"), routed("r2", "mechanical")]),
			{ routing: COSTS },
		);
		expect(summary?.estimatedSavedUsd).toBeCloseTo(0.04, 10);
	});

	test("an unpriced baseline estimates no savings", () => {
		const summary = summarise(slice([routed("r1", "mechanical")]), {
			routing: { baselineTier: "local", costPerTaskUsd: COSTS.costPerTaskUsd },
		});
		expect(summary?.estimatedSavedUsd).toBe(0);
	});

	test("estimates no savings without routing costs", () => {
		const summary = summarise(slice([routed("r1", "mechanical")]));
		expect(summary?.estimatedSavedUsd).toBe(0);
	});

	test("ignores non-finite or negative costs", () => {
		const nan = summarise(slice([routed("r1", "mechanical")]), {
			routing: {
				baselineTier: "standard",
				costPerTaskUsd: { mechanical: Number.NaN, standard: 0.05 },
			},
		});
		expect(nan?.estimatedSavedUsd).toBe(0);
		const negative = summarise(slice([routed("r1", "mechanical")]), {
			routing: {
				baselineTier: "standard",
				costPerTaskUsd: { mechanical: -1, standard: 0.05 },
			},
		});
		expect(negative?.estimatedSavedUsd).toBe(0);
	});

	test("addedLatencyP95 is the nearest-rank p95 over gate and routing events", () => {
		// 20 events at 1..20 ms: nearest rank ceil(0.95 * 20) = 19.
		const decisions = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0
				? gate(`g${i}`, "allow", i + 1)
				: routed(`r${i}`, "mechanical", i + 1),
		);
		expect(summarise(slice(decisions))?.addedLatencyP95).toBe(19);
	});

	test("addedLatencyP95 of a single event is its latency", () => {
		expect(summarise(slice([gate("g1", "deny", 7)]))?.addedLatencyP95).toBe(7);
	});

	test("addedLatencyP95 leaves out decisions of other types", () => {
		const summary = summarise(
			slice([
				gate("g1", "allow", 2),
				{ ...boolRecord({ id: "s1", model: HEURISTIC }), latencyMs: 5_000 },
			]),
		);
		expect(summary?.addedLatencyP95).toBe(2);
	});

	test("does not depend on log order", () => {
		const decisions = [
			gate("g1:reversed", "ask", 30),
			routed("r1", "mechanical", 4),
			gate("g1", "ask", 10),
			gate("g2", "deny", 2),
		];
		const forward = summarise(slice(decisions), { routing: COSTS });
		const backward = summarise(slice([...decisions].reverse()), {
			routing: COSTS,
		});
		expect(backward).toEqual(forward);
		expect(forward?.asked).toBe(1);
		expect(forward?.addedLatencyP95).toBe(40);
	});
});

describe("formatSessionSummary", () => {
	const base: SessionSummary = {
		blocked: 2,
		asked: 1,
		allowed: 14,
		routed: 5,
		estimatedSavedUsd: 0.4231,
		addedLatencyP95: 38,
	};
	const plain =
		"maina session: 2 blocked, 1 asked, 14 allowed | 5 routed, ~$0.42 saved | +38 ms p95";

	test("is silent when nothing happened", () => {
		expect(formatSessionSummary(null)).toBeUndefined();
		expect(
			formatSessionSummary(null, "https://receipts.example/r/1"),
		).toBeUndefined();
	});

	test("shows the counts, savings, latency and receipt link on one line", () => {
		expect(formatSessionSummary(base, "https://receipts.example/r/1")).toBe(
			`${plain} | receipt: https://receipts.example/r/1`,
		);
	});

	test("leaves out routing when nothing was routed", () => {
		expect(
			formatSessionSummary({ ...base, routed: 0, estimatedSavedUsd: 0 }),
		).toBe("maina session: 2 blocked, 1 asked, 14 allowed | +38 ms p95");
	});

	test("leaves out the saving when there is no estimate", () => {
		expect(formatSessionSummary({ ...base, estimatedSavedUsd: 0 })).toBe(
			"maina session: 2 blocked, 1 asked, 14 allowed | 5 routed | +38 ms p95",
		);
	});

	test("leaves out a saving that rounds to zero cents", () => {
		expect(formatSessionSummary({ ...base, estimatedSavedUsd: 0.004 })).toBe(
			"maina session: 2 blocked, 1 asked, 14 allowed | 5 routed | +38 ms p95",
		);
	});

	test("shows a net extra cost as such", () => {
		expect(formatSessionSummary({ ...base, estimatedSavedUsd: -0.07 })).toBe(
			"maina session: 2 blocked, 1 asked, 14 allowed | 5 routed, ~$0.07 extra | +38 ms p95",
		);
	});

	test("leaves out the gate part when the gate saw nothing", () => {
		expect(
			formatSessionSummary({ ...base, blocked: 0, asked: 0, allowed: 0 }),
		).toBe("maina session: 5 routed, ~$0.42 saved | +38 ms p95");
	});

	test("rounds the latency to whole milliseconds", () => {
		expect(formatSessionSummary({ ...base, addedLatencyP95: 12.6 })).toBe(
			"maina session: 2 blocked, 1 asked, 14 allowed | 5 routed, ~$0.42 saved | +13 ms p95",
		);
	});

	test("drops a receipt link that is not a plain http(s) URL", () => {
		for (const bad of [
			"javascript:alert(1)",
			"https://ok.example/r/1 injected",
			`https://ok.example/${String.fromCharCode(0x202e)}evil`,
			"https://ok.example/\nsecond line",
			"",
		]) {
			expect(formatSessionSummary(base, bad)).toBe(plain);
		}
	});
});
