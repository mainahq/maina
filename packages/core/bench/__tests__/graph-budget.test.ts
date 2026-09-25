import { describe, expect, test } from "bun:test";
import {
	type BenchReport,
	checkBudgets,
	GRAPH_BUDGETS,
	percentile,
	summarize,
} from "../graph-budget";

describe("percentile", () => {
	test("nearest rank over unsorted samples", () => {
		const samples = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
		expect(percentile(samples, 0.5)).toBe(5);
		expect(percentile(samples, 0.95)).toBe(10);
		expect(percentile(samples, 1)).toBe(10);
		expect(percentile(samples, 0)).toBe(1);
	});

	test("an empty sample is 0, not NaN", () => {
		expect(percentile([], 0.95)).toBe(0);
	});

	test("does not reorder the caller's samples", () => {
		const samples = [3, 1, 2];
		percentile(samples, 0.5);
		expect(samples).toEqual([3, 1, 2]);
	});
});

describe("summarize", () => {
	test("reports p50, p95 and max", () => {
		const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
		expect(s).toEqual({ count: 100, p50: 50, p95: 95, max: 100 });
	});
});

const passing: BenchReport = {
	repo: "zod@2bf7b06",
	files: 400,
	loc: 100_000,
	nodes: 10_000,
	edges: 20_000,
	initialIndexMs: 30_000,
	update: summarize([120, 180, 240]),
	queries: {
		search: summarize([4, 5, 6]),
		impact: summarize([10, 12, 15]),
		minimalContext: summarize([20, 25, 30]),
	},
};

describe("checkBudgets", () => {
	test("the v1 budgets: every update <= 500 ms, warm query <= 200 ms p95", () => {
		expect(GRAPH_BUDGETS).toEqual({ updateMs: 500, queryP95Ms: 200 });
	});

	test("passes when every measurement is within budget", () => {
		expect(checkBudgets(passing)).toEqual([]);
	});

	test("the initial index time is recorded, not budgeted", () => {
		expect(checkBudgets({ ...passing, initialIndexMs: 10_000_000 })).toEqual(
			[],
		);
	});

	test("a single-file update over budget is a breach", () => {
		const breaches = checkBudgets({
			...passing,
			update: summarize([100, 200, 501]),
		});
		expect(breaches).toEqual([
			{ metric: "update max", actualMs: 501, budgetMs: 500 },
		]);
	});

	test("the update budget is a ceiling on every sample, not a p95", () => {
		// 24 samples: nearest-rank p95 is the second slowest, so a p95 check
		// would let the one slow update through.
		const samples = [...Array.from({ length: 23 }, () => 100), 501];
		expect(summarize(samples).p95).toBeLessThanOrEqual(500);
		expect(checkBudgets({ ...passing, update: summarize(samples) })).toEqual([
			{ metric: "update max", actualMs: 501, budgetMs: 500 },
		]);
	});

	test("each query kind is held to the p95 budget on its own", () => {
		const breaches = checkBudgets({
			...passing,
			queries: {
				...passing.queries,
				impact: summarize([150, 190, 250]),
				search: summarize([201]),
			},
		});
		expect(breaches).toEqual([
			{ metric: "query search p95", actualMs: 201, budgetMs: 200 },
			{ metric: "query impact p95", actualMs: 250, budgetMs: 200 },
		]);
	});

	test("an empty measurement is a breach, not a silent pass", () => {
		const breaches = checkBudgets({ ...passing, update: summarize([]) });
		expect(breaches).toEqual([
			{ metric: "update samples", actualMs: 0, budgetMs: 500 },
		]);
	});
});
