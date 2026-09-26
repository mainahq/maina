import { describe, expect, test } from "bun:test";
import { computeSatisfaction } from "../satisfaction";

describe("computeSatisfaction: the share of scenario runs that satisfied (FR-FAC-4)", () => {
	test("is computed over every run of every scenario, not one run each", () => {
		const result = computeSatisfaction([
			{ scenario: "checkout", run: 1, satisfied: true },
			{ scenario: "checkout", run: 2, satisfied: false },
			{ scenario: "checkout", run: 3, satisfied: true },
			{ scenario: "refund", run: 1, satisfied: true },
			{ scenario: "refund", run: 2, satisfied: true },
			{ scenario: "refund", run: 3, satisfied: true },
		]);
		expect(result.runs).toBe(6);
		expect(result.satisfiedRuns).toBe(5);
		expect(result.score).toBe(0.8333);
		expect(result.scenarios).toEqual([
			{ scenario: "checkout", runs: 3, satisfiedRuns: 2, score: 0.6667 },
			{ scenario: "refund", runs: 3, satisfiedRuns: 3, score: 1 },
		]);
	});

	test("a flaky scenario lowers the score even when its first run passed", () => {
		const once = computeSatisfaction([
			{ scenario: "login", run: 1, satisfied: true },
		]);
		const repeated = computeSatisfaction([
			{ scenario: "login", run: 1, satisfied: true },
			{ scenario: "login", run: 2, satisfied: false },
		]);
		expect(once.score).toBe(1);
		expect(repeated.score).toBe(0.5);
	});

	test("no runs scores zero, never a vacuous 1", () => {
		expect(computeSatisfaction([])).toEqual({
			runs: 0,
			satisfiedRuns: 0,
			score: 0,
			scenarios: [],
		});
	});
});
