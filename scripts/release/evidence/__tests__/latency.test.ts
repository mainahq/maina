/**
 * The latency evidence (spec §8, §9.2): the gate and decide benches, the
 * code-graph bench and the MCP cold-start bench, folded into the numbers
 * `v1-gates.ts` holds to budget.
 */

import { describe, expect, test } from "bun:test";
import { latencyEvidence, summarizeColdStarts } from "../latency";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

const GATE = { gateP95Ms: 0.412, decideP95Ms: 0.021, events: 1200 };
const GRAPH = {
	repo: "zod@2bf7b06",
	queries: {
		search: { p50: 11, p95: 13.2, max: 16, count: 50 },
		impact: { p50: 10, p95: 12, max: 13, count: 50 },
		minimalContext: { p50: 14, p95: 21.46, max: 24, count: 50 },
	},
};
const MCP = { samples: [420, 380, 390], p95Ms: 420, maxMs: 420 };

describe("latencyEvidence", () => {
	test("every bench folded into the gate's numbers", () => {
		expect(
			latencyEvidence({ gate: GATE, graph: GRAPH, mcp: MCP }, LINK),
		).toEqual({
			ok: true,
			value: {
				link: LINK,
				gateP95Ms: 0.412,
				decideP95Ms: 0.021,
				graphQueryP95Ms: 21.46,
				mcpColdStartMs: 420,
				graphRepo: "zod@2bf7b06",
			},
		});
	});

	test("a bench that produced nothing leaves its numbers out", () => {
		const r = latencyEvidence(
			{ gate: GATE, graph: undefined, mcp: { nonsense: true } },
			LINK,
		);
		expect(r).toEqual({
			ok: true,
			value: {
				link: LINK,
				gateP95Ms: 0.412,
				decideP95Ms: 0.021,
				missing: ["graph bench", "MCP cold-start bench"],
			},
		});
	});

	test("with no bench at all there is no evidence", () => {
		expect(
			latencyEvidence({ gate: undefined, graph: null, mcp: 3 }, LINK).ok,
		).toBe(false);
	});
});

describe("summarizeColdStarts", () => {
	test("p95 and max over every cold start", () => {
		const samples = Array.from({ length: 20 }, (_, i) => 100 + i * 10);
		expect(summarizeColdStarts(samples)).toEqual({
			ok: true,
			value: { samples, p95Ms: 290, maxMs: 290 },
		});
	});

	test("no successful start is an error", () => {
		expect(summarizeColdStarts([]).ok).toBe(false);
	});
});
