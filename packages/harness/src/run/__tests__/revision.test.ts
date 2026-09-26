/**
 * Bounded revision (FR-HAR-5): a run is reviewed, revised at most once, and
 * a second failed review stops it with a "stopped" receipt instead of a PR.
 */

import { describe, expect, test } from "bun:test";
import type { RunContext } from "@mainahq/core";
import type { EndEvent } from "../../events";
import type { Budgets } from "../../orchestrator";
import {
	type Attempt,
	MAX_REVIEWS,
	type Review,
	type RevisionPorts,
	runWithRevision,
} from "../revision";

const completed: EndEvent = {
	type: "end",
	state: "completed",
	stopReason: "end_turn",
};

type Script = Readonly<{
	reviews: readonly Review[];
	ends?: readonly EndEvent[];
	pr?: RevisionPorts["openPr"];
}>;

/** Scripted ports that record every call. */
function scripted(script: Script) {
	const prompts: string[] = [];
	let reviewed = 0;
	let prs = 0;
	const ports: RevisionPorts = {
		attempt: async ({ prompt }): Promise<Attempt> => {
			prompts.push(prompt);
			return {
				end: script.ends?.[prompts.length - 1] ?? completed,
				toolCalls: 3,
			};
		},
		review: async () => {
			const review = script.reviews[reviewed] ?? {
				passed: false,
				findings: ["still failing"],
			};
			reviewed++;
			return review;
		},
		...(script.pr === undefined
			? {}
			: {
					openPr: async () => {
						prs++;
						return (script.pr as NonNullable<RevisionPorts["openPr"]>)();
					},
				}),
		now: () => 0,
	};
	return {
		ports,
		prompts,
		reviewed: () => reviewed,
		prs: () => prs,
	};
}

const fail = (...findings: string[]): Review => ({ passed: false, findings });
const pass: Review = { passed: true, findings: [] };
const openedPr = async () =>
	({ ok: true, value: "https://example.test/pr/9" }) as const;

describe("bounded revision", () => {
	test("a run gets two reviews at most: the first and one after a revision", () => {
		expect(MAX_REVIEWS).toBe(2);
	});

	test("a second failed review always stops the run with a stopped receipt, not a PR", async () => {
		const contexts: readonly RunContext[] = ["interactive", "unattended"];
		const budgets: readonly Budgets[] = [
			{},
			{ wallClockMs: 1e9, maxToolCalls: 1e6 },
		];
		const firsts: readonly Review[] = [
			fail("lint: unused import"),
			fail(),
			fail("a", "b", "c"),
		];
		for (const context of contexts) {
			for (const budget of budgets) {
				for (const first of firsts) {
					const run = scripted({
						reviews: [first, fail("tests: 2 failing")],
						pr: openedPr,
					});
					const receipt = await runWithRevision(
						{ task: "fix the bug", context, budgets: budget },
						run.ports,
					);
					expect(receipt).toMatchObject({
						status: "stopped",
						reason: "review_failed",
						context,
						attempts: 2,
					});
					expect(receipt.reviews).toHaveLength(2);
					expect("pr" in receipt).toBe(false);
					expect(receipt.report).toContain("stopped");
					expect(receipt.report).toContain("No PR was opened");
					expect(receipt.report).toContain("tests: 2 failing");
					expect(run.prs()).toBe(0);
					expect(run.prompts).toHaveLength(2);
					expect(run.reviewed()).toBe(2);
				}
			}
		}
	});

	test("the revision is asked with the task and the failed review's findings", async () => {
		const run = scripted({
			reviews: [fail("lint: unused import", "tests: 1 failing"), pass],
			pr: openedPr,
		});
		const receipt = await runWithRevision(
			{ task: "fix the bug", context: "unattended", budgets: {} },
			run.ports,
		);
		expect(run.prompts[0]).toBe("fix the bug");
		expect(run.prompts[1]).toContain("fix the bug");
		expect(run.prompts[1]).toContain("lint: unused import");
		expect(run.prompts[1]).toContain("tests: 1 failing");
		expect(receipt).toMatchObject({
			status: "passed",
			attempts: 2,
			pr: "https://example.test/pr/9",
		});
		expect(run.prs()).toBe(1);
	});

	test("a first review that passes opens the PR after one attempt", async () => {
		const run = scripted({ reviews: [pass], pr: openedPr });
		const receipt = await runWithRevision(
			{ task: "t", context: "interactive", budgets: {} },
			run.ports,
		);
		expect(receipt).toMatchObject({
			status: "passed",
			attempts: 1,
			usage: { toolCalls: 3 },
		});
		expect(run.prompts).toHaveLength(1);
	});

	test("without a PR port a passing run passes and opens nothing", async () => {
		const run = scripted({ reviews: [pass] });
		const receipt = await runWithRevision(
			{ task: "t", context: "unattended", budgets: {} },
			run.ports,
		);
		expect(receipt.status).toBe("passed");
		expect("pr" in receipt).toBe(false);
	});

	test("a PR that cannot be opened stops the run and says why", async () => {
		const run = scripted({
			reviews: [pass],
			pr: async () => ({
				ok: false,
				error: { message: "gh is not installed" },
			}),
		});
		const receipt = await runWithRevision(
			{ task: "t", context: "unattended", budgets: {} },
			run.ports,
		);
		expect(receipt).toMatchObject({ status: "stopped", reason: "pr_failed" });
		expect(receipt.report).toContain("gh is not installed");
	});

	test("an agent that fails stops the run, unreviewed", async () => {
		const run = scripted({
			reviews: [pass],
			ends: [
				{
					type: "end",
					state: "failed",
					error: { code: "agent_exited", message: "agent died" },
				},
			],
			pr: openedPr,
		});
		const receipt = await runWithRevision(
			{ task: "t", context: "unattended", budgets: {} },
			run.ports,
		);
		expect(receipt).toMatchObject({
			status: "stopped",
			reason: "agent_failed",
			error: { code: "agent_exited" },
		});
		expect(receipt.report).toContain("agent died");
		expect(run.reviewed()).toBe(0);
		expect(run.prs()).toBe(0);
	});

	test("a cancelled run, or one the agent stopped short, is stopped unreviewed", async () => {
		for (const [end, reason] of [
			[{ type: "end", state: "cancelled" }, "cancelled"],
			[
				{ type: "end", state: "stopped", stopReason: "refusal" },
				"agent_stopped",
			],
		] as const) {
			const run = scripted({ reviews: [pass], ends: [end], pr: openedPr });
			const receipt = await runWithRevision(
				{ task: "t", context: "interactive", budgets: {} },
				run.ports,
			);
			expect(receipt).toMatchObject({ status: "stopped", reason });
			expect(run.reviewed()).toBe(0);
		}
	});

	test("a port that throws still ends in a stopped receipt, never a PR", async () => {
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};
		const cases: ReadonlyArray<
			readonly [Partial<RevisionPorts>, string, number]
		> = [
			[{ attempt: boom }, "agent_failed", 0],
			[{ review: boom }, "review_error", 0],
			[{ openPr: boom }, "pr_failed", 1],
		];
		for (const [override, reason, reviewed] of cases) {
			const run = scripted({ reviews: [pass], pr: openedPr });
			const receipt = await runWithRevision(
				{ task: "t", context: "unattended", budgets: {} },
				{ ...run.ports, ...override },
			);
			expect(receipt).toMatchObject({ status: "stopped", reason });
			expect("pr" in receipt).toBe(false);
			expect(receipt.report).toContain("boom");
			expect(run.reviewed()).toBe(reviewed);
		}
	});
});
