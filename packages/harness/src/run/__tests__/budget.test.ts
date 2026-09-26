/**
 * Run budgets (FR-HAR-5): a run stops, with a report, at the first budget
 * it breaches, counted across every attempt of the run.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, type Policy } from "@mainahq/core";
import type { FakeScript } from "../../__fixtures__/fake-acp-agent";
import {
	breachOf,
	budgetsFor,
	describeBreach,
	remainingBudgets,
} from "../budget";
import { orchestratedAttempt, runWithRevision } from "../revision";

const FIXTURE = join(
	import.meta.dir,
	"..",
	"..",
	"__fixtures__",
	"fake-acp-agent.ts",
);
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maina-run-budget-")));

const fakeAgent = (script: FakeScript) => ({
	name: "fake",
	command: process.execPath,
	args: [FIXTURE, JSON.stringify(script)],
});

const call = (id: string) => ({
	update: {
		sessionUpdate: "tool_call" as const,
		toolCallId: id,
		title: id,
		kind: "read" as const,
	},
});

function withBudgets(
	unattended: Policy["run"]["unattended"]["budgets"],
): Policy {
	return {
		...DEFAULT_POLICY,
		run: {
			...DEFAULT_POLICY.run,
			unattended: { ...DEFAULT_POLICY.run.unattended, budgets: unattended },
		},
	};
}

describe("budgetsFor", () => {
	test("reads the context's budgets from the policy, in the orchestrator's units", () => {
		expect(
			budgetsFor(
				withBudgets({ wall_clock_minutes: 2, max_tool_calls: 40 }),
				"unattended",
			),
		).toEqual({ wallClockMs: 120_000, maxToolCalls: 40 });
		expect(budgetsFor(DEFAULT_POLICY, "interactive")).toEqual({});
	});
});

describe("breachOf", () => {
	test("more tool calls than the budget is a breach", () => {
		expect(breachOf({ maxToolCalls: 3 }, { elapsedMs: 0, toolCalls: 3 })).toBe(
			undefined,
		);
		expect(
			breachOf({ maxToolCalls: 3 }, { elapsedMs: 0, toolCalls: 4 }),
		).toEqual({ budget: "tool_calls", limit: 3, used: 4 });
	});

	test("reaching the wall-clock budget is a breach", () => {
		expect(
			breachOf({ wallClockMs: 1000 }, { elapsedMs: 999, toolCalls: 0 }),
		).toBe(undefined);
		expect(
			breachOf({ wallClockMs: 1000 }, { elapsedMs: 1000, toolCalls: 0 }),
		).toEqual({ budget: "wall_clock", limit: 1000, used: 1000 });
	});

	test("no budget, no breach", () => {
		expect(breachOf({}, { elapsedMs: 1e9, toolCalls: 1e9 })).toBe(undefined);
	});
});

describe("remainingBudgets", () => {
	test("a later attempt gets what the earlier ones left", () => {
		expect(
			remainingBudgets(
				{ wallClockMs: 10_000, maxToolCalls: 10 },
				{ elapsedMs: 4_000, toolCalls: 7 },
			),
		).toEqual({ wallClockMs: 6_000, maxToolCalls: 3 });
		expect(remainingBudgets({}, { elapsedMs: 5, toolCalls: 5 })).toEqual({});
	});

	test("never goes below zero", () => {
		expect(
			remainingBudgets(
				{ wallClockMs: 10, maxToolCalls: 1 },
				{ elapsedMs: 50, toolCalls: 9 },
			),
		).toEqual({ wallClockMs: 0, maxToolCalls: 0 });
	});
});

describe("a budget breach stops the run with a report", () => {
	test("an agent past its tool-call budget is stopped; the run is never reviewed and opens no PR", async () => {
		const policy = withBudgets({ max_tool_calls: 1 });
		let reviews = 0;
		let prs = 0;
		const receipt = await runWithRevision(
			{
				task: "fix the bug",
				context: "unattended",
				budgets: budgetsFor(policy, "unattended"),
			},
			{
				attempt: orchestratedAttempt({
					agent: fakeAgent({
						steps: [call("a"), call("b"), call("c"), { hang: true }],
					}),
					root: ROOT,
					policy: () => "allow",
				}),
				review: async () => {
					reviews++;
					return { passed: true, findings: [] };
				},
				openPr: async () => {
					prs++;
					return { ok: true, value: "https://example.test/pr/1" };
				},
				now: Date.now,
			},
		);
		expect(receipt.status).toBe("stopped");
		if (receipt.status !== "stopped") return;
		expect(receipt.reason).toBe("budget_exceeded");
		const { breach } = receipt;
		expect(breach).toMatchObject({ budget: "tool_calls", limit: 1 });
		if (breach === undefined) return;
		expect(breach.used).toBeGreaterThan(1);
		expect(receipt.attempts).toBe(1);
		expect(receipt.report).toContain(describeBreach(breach));
		expect(receipt.report).toContain("stopped");
		expect(reviews).toBe(0);
		expect(prs).toBe(0);
	});

	test("the wall clock covers the whole run: a revision starts with only what is left", async () => {
		let clock = 0;
		const given: number[] = [];
		const receipt = await runWithRevision(
			{
				task: "fix the bug",
				context: "unattended",
				budgets: { wallClockMs: 1000 },
			},
			{
				attempt: async ({ budgets }) => {
					given.push(budgets.wallClockMs ?? Number.NaN);
					clock += 700;
					return {
						end: { type: "end", state: "completed", stopReason: "end_turn" },
						toolCalls: 0,
					};
				},
				review: async () => ({ passed: false, findings: ["lint: x"] }),
				now: () => clock,
			},
		);
		expect(given).toEqual([1000, 300]);
		expect(receipt.status).toBe("stopped");
	});

	test("a budget already spent before the revision stops the run before it starts", async () => {
		let clock = 0;
		let attempts = 0;
		const receipt = await runWithRevision(
			{
				task: "fix the bug",
				context: "interactive",
				budgets: { wallClockMs: 1000 },
			},
			{
				attempt: async () => {
					attempts++;
					clock += 1200;
					return {
						end: { type: "end", state: "completed", stopReason: "end_turn" },
						toolCalls: 0,
					};
				},
				review: async () => ({ passed: false, findings: ["lint: x"] }),
				now: () => clock,
			},
		);
		expect(attempts).toBe(1);
		expect(receipt).toMatchObject({
			status: "stopped",
			reason: "budget_exceeded",
			breach: { budget: "wall_clock", limit: 1000, used: 1200 },
		});
	});
	test("a review that runs past the wall clock stops the run before a revision", async () => {
		let clock = 0;
		let attempts = 0;
		const receipt = await runWithRevision(
			{
				task: "fix the bug",
				context: "unattended",
				budgets: { wallClockMs: 1000 },
			},
			{
				attempt: async () => {
					attempts++;
					clock += 400;
					return {
						end: { type: "end", state: "completed", stopReason: "end_turn" },
						toolCalls: 0,
					};
				},
				review: async () => {
					clock += 800;
					return { passed: false, findings: ["lint: x"] };
				},
				now: () => clock,
			},
		);
		expect(attempts).toBe(1);
		expect(receipt).toMatchObject({
			status: "stopped",
			reason: "budget_exceeded",
			breach: { budget: "wall_clock", limit: 1000, used: 1200 },
		});
		expect(receipt.reviews).toHaveLength(1);
	});

	test("a passing review that runs past the wall clock opens no PR", async () => {
		let clock = 0;
		let prs = 0;
		const receipt = await runWithRevision(
			{
				task: "fix the bug",
				context: "unattended",
				budgets: { wallClockMs: 1000 },
			},
			{
				attempt: async () => {
					clock += 400;
					return {
						end: { type: "end", state: "completed", stopReason: "end_turn" },
						toolCalls: 0,
					};
				},
				review: async () => {
					clock += 800;
					return { passed: true, findings: [] };
				},
				openPr: async () => {
					prs++;
					return { ok: true, value: "https://example.test/pr/1" };
				},
				now: () => clock,
			},
		);
		expect(prs).toBe(0);
		expect(receipt).toMatchObject({
			status: "stopped",
			reason: "budget_exceeded",
		});
		expect(receipt.report).toContain("No PR was opened");
	});
});
