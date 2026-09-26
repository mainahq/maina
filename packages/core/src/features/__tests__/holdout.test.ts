import { describe, expect, test } from "bun:test";
import type { Result } from "../../db/index";
import { createMemoryFs } from "../../ports/testing";
import {
	holdoutDir,
	holdoutFeatureDir,
	runHoldout,
	type Scenario,
	type ScenarioJudgement,
} from "../holdout";

const ROOT = "/repo";
const FEATURE = "012-export";

function holdoutFs() {
	return createMemoryFs({
		[`${ROOT}/.maina/holdout/${FEATURE}/checkout.md`]:
			"As a buyer I export my orders and open them in a spreadsheet.",
		[`${ROOT}/.maina/holdout/${FEATURE}/refund.md`]:
			"As support I export refunds for one month.",
		[`${ROOT}/.maina/holdout/${FEATURE}/notes.txt`]: "not a scenario",
	});
}

type Call = { scenario: string; run: number };

function scripted(
	answers: Readonly<Record<string, readonly boolean[]>>,
	calls: Call[] = [],
) {
	return async (
		scenario: Scenario,
		run: number,
	): Promise<Result<ScenarioJudgement, { message: string }>> => {
		calls.push({ scenario: scenario.id, run });
		const satisfied = answers[scenario.id]?.[run - 1];
		return satisfied === undefined
			? { ok: false, error: { message: "runner crashed" } }
			: { ok: true, value: { satisfied } };
	};
}

describe("holdout directory", () => {
	test("lives under .maina/holdout, one folder per feature", () => {
		expect(holdoutDir(ROOT)).toBe("/repo/.maina/holdout");
		expect(holdoutFeatureDir(ROOT, FEATURE)).toBe(
			"/repo/.maina/holdout/012-export",
		);
	});
});

describe("runHoldout(root, feature) → { passed, satisfaction } (FR-FAC-4)", () => {
	test("runs every scenario repeatedly and scores satisfaction over all runs", async () => {
		const calls: Call[] = [];
		const result = await runHoldout(ROOT, FEATURE, {
			fs: holdoutFs(),
			runScenario: scripted(
				{ checkout: [true, true, false], refund: [true, true, true] },
				calls,
			),
		});
		expect(calls).toEqual([
			{ scenario: "checkout", run: 1 },
			{ scenario: "checkout", run: 2 },
			{ scenario: "checkout", run: 3 },
			{ scenario: "refund", run: 1 },
			{ scenario: "refund", run: 2 },
			{ scenario: "refund", run: 3 },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.satisfaction).toBe(0.8333);
		expect(result.value.passed).toBe(false);
		expect(result.value.detail.runs).toBe(6);
	});

	test("passes when satisfaction reaches the threshold", async () => {
		const result = await runHoldout(
			ROOT,
			FEATURE,
			{
				fs: holdoutFs(),
				runScenario: scripted({
					checkout: [true, false],
					refund: [true, true],
				}),
			},
			{ runs: 2, minSatisfaction: 0.75 },
		);
		expect(result.ok && result.value).toMatchObject({
			passed: true,
			satisfaction: 0.75,
		});
	});

	test("a runner failure counts as an unsatisfied run, not a pass", async () => {
		const result = await runHoldout(
			ROOT,
			FEATURE,
			{ fs: holdoutFs(), runScenario: scripted({ checkout: [true] }) },
			{ runs: 1 },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.satisfaction).toBe(0.5);
		expect(result.value.passed).toBe(false);
		expect(result.value.runs).toContainEqual({
			scenario: "refund",
			run: 1,
			satisfied: false,
			note: "runner failed: runner crashed",
		});
	});

	test("no holdout folder, no scenarios, bad names and bad options are errors", async () => {
		const deps = { fs: holdoutFs(), runScenario: scripted({}) };
		const none = await runHoldout(ROOT, "999-none", deps);
		expect(none.ok ? undefined : none.error.kind).toBe("no_holdout");
		const bad = await runHoldout(ROOT, "../features", deps);
		expect(bad.ok ? undefined : bad.error.kind).toBe("invalid_feature");
		const zero = await runHoldout(ROOT, FEATURE, deps, { runs: 0 });
		expect(zero.ok ? undefined : zero.error.kind).toBe("invalid_options");
		const empty = await runHoldout(ROOT, "013-empty", {
			fs: createMemoryFs({
				[`${ROOT}/.maina/holdout/013-empty/README.txt`]: "no scenarios",
			}),
			runScenario: scripted({}),
		});
		expect(empty.ok ? undefined : empty.error.kind).toBe("no_scenarios");
	});
});
