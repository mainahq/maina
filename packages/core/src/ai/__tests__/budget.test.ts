import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBudgetBreach } from "../../config/budget";
import type { Config } from "../../config/schema";
import { defaultDecidePorts } from "../../decide/decide";
import { createFakeEnv, createMemoryLogger } from "../../ports/testing";
import { generate } from "../index";
import { type RouteInput, routeTask, type TierCosts } from "../routing";
import { tryAIGenerate } from "../try-generate";

const COSTS: TierCosts = {
	mechanical: 0.01,
	standard: 0.04,
	architectural: 0.1,
};

type Budget = Config["budget"];

function budget(overrides: Partial<Budget> = {}): Budget {
	return { dailyUsd: 5, perTaskUsd: 0.5, onBreach: "degrade", ...overrides };
}

function input(overrides: Partial<RouteInput> = {}): RouteInput {
	return {
		task: "design-review",
		budget: budget(),
		spend: { todayUsd: 0, taskUsd: 0 },
		costPerTaskUsd: COSTS,
		...overrides,
	};
}

function route(overrides: Partial<RouteInput> = {}) {
	const logger = createMemoryLogger();
	const result = routeTask(
		{ decide: defaultDecidePorts, logger },
		input(overrides),
	);
	return { result, logger };
}

describe("findBudgetBreach", () => {
	test("no breach while spend plus the call stays within both caps", () => {
		expect(
			findBudgetBreach(budget(), { todayUsd: 4.9, taskUsd: 0.4 }, 0.1),
		).toBeUndefined();
	});

	test("reaching a cap exactly is not a breach", () => {
		expect(
			findBudgetBreach(budget(), { todayUsd: 4.5, taskUsd: 0 }, 0.5),
		).toBeUndefined();
	});

	test("the daily cap is breached when today's spend plus the call exceeds it", () => {
		expect(
			findBudgetBreach(budget(), { todayUsd: 4.95, taskUsd: 0 }, 0.1),
		).toEqual({ cap: "dailyUsd", limitUsd: 5, spentUsd: 4.95, costUsd: 0.1 });
	});

	test("the per-task cap is breached when the task's spend plus the call exceeds it", () => {
		expect(
			findBudgetBreach(budget(), { todayUsd: 0, taskUsd: 0.45 }, 0.1),
		).toEqual({
			cap: "perTaskUsd",
			limitUsd: 0.5,
			spentUsd: 0.45,
			costUsd: 0.1,
		});
	});

	test("a null cap is disabled", () => {
		expect(
			findBudgetBreach(
				budget({ dailyUsd: null, perTaskUsd: null }),
				{ todayUsd: 1_000, taskUsd: 1_000 },
				1,
			),
		).toBeUndefined();
	});
});

describe("routeTask budget enforcement", () => {
	test("within budget the routed tier is kept", () => {
		const { result } = route();
		expect(result.ok && result.value.tier).toBe("architectural");
	});

	test("a breach with onBreach=degrade drops to the next lower tier that fits", () => {
		const { result, logger } = route({
			spend: { todayUsd: 4.95, taskUsd: 0 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.tier).toBe("standard");
		expect(result.value.degradedFrom).toBe("architectural");
		expect(result.value.estimatedCostUsd).toBe(0.04);
		expect(logger.entries()).toHaveLength(1);
		expect(logger.entries()[0]?.fields).toMatchObject({
			tier: "standard",
			degradedFrom: "architectural",
			breachedCap: "dailyUsd",
		});
	});

	test("degrade skips lower tiers that would still breach", () => {
		const { result } = route({ spend: { todayUsd: 4.985, taskUsd: 0 } });
		expect(result.ok && result.value.tier).toBe("mechanical");
		expect(result.ok && result.value.degradedFrom).toBe("architectural");
	});

	test("degrade stops with a message when even the lowest tier breaches", () => {
		const { result, logger } = route({
			spend: { todayUsd: 5, taskUsd: 0 },
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("budget_exceeded");
		expect(result.error.breach.cap).toBe("dailyUsd");
		expect(result.error.message).toContain("budget.dailyUsd");
		expect(logger.entries()[0]?.level).toBe("warn");
	});

	test("a breach with onBreach=stop stops with a message naming the cap", () => {
		const { result } = route({
			budget: budget({ onBreach: "stop" }),
			spend: { todayUsd: 0, taskUsd: 0.45 },
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "budget_exceeded",
			breach: { cap: "perTaskUsd", limitUsd: 0.5, spentUsd: 0.45 },
		});
		expect(result.error.message).toContain("budget.perTaskUsd");
		expect(result.error.message).toContain("$0.50");
	});

	test("onBreach=stop never degrades, even when a lower tier would fit", () => {
		const { result } = route({
			budget: budget({ onBreach: "stop" }),
			spend: { todayUsd: 4.95, taskUsd: 0 },
		});
		expect(result.ok).toBe(false);
	});
});

// #334 review: a budget stop is not a model answer. Callers that treat
// `generate().text` as output (commit messages, reviews, the setup
// constitution) must be able to tell it apart, and must not get it back as AI text.
describe("a budget stop reaches callers as a stop, not as model output", () => {
	let root = "";
	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "maina-334-budget-stop-"));
		writeFileSync(
			join(root, "maina.config.js"),
			"module.exports = { budget: { perTaskUsd: 0.001, onBreach: 'stop' } };",
		);
	});
	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("generate flags the stop and never reaches the model", async () => {
		const result = await generate({
			task: "commit",
			systemPrompt: "s",
			userPrompt: "u",
			mainaDir: join(root, ".maina"),
			root,
			env: createFakeEnv({ MAINA_API_KEY: "test-key" }),
		});
		expect(result.budgetStop).toContain("budget.perTaskUsd");
		expect(result.model).toBe("");
	});

	test("tryAIGenerate reports the stop instead of returning it as AI text", async () => {
		const result = await tryAIGenerate(
			"commit",
			join(root, ".maina"),
			{},
			"diff",
			{ root, env: createFakeEnv({ MAINA_API_KEY: "test-key" }) },
		);
		expect(result.text).toBeNull();
		expect(result.fromAI).toBe(false);
		expect(result.hostDelegation).toBe(false);
		expect(result.budgetStop).toContain("budget.perTaskUsd");
	});
});
