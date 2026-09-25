import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../config/index";
import { type DecidePorts, defaultDecidePorts } from "../../decide/decide";
import { createRegistry, DEFAULT_REGISTRY } from "../../decide/registry";
import type { Backend } from "../../decide/types";
import { MODEL_TIERS } from "../../decide/types-catalog";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { createFixedClock, createMemoryLogger } from "../../ports/testing";
import { type RouteInput, routeTask, type TierCosts } from "../routing";
import { chooseTier, type ModelTier } from "../tiers";

const COSTS: TierCosts = {
	mechanical: 0.01,
	standard: 0.04,
	architectural: 0.1,
};

/** No cap can be reached: routing alone decides the tier. */
const UNCAPPED = {
	dailyUsd: null,
	perTaskUsd: null,
	onBreach: "degrade",
} as const;

function input(overrides: Partial<RouteInput> = {}): RouteInput {
	return {
		task: "commit",
		budget: UNCAPPED,
		spend: { todayUsd: 0, taskUsd: 0 },
		costPerTaskUsd: COSTS,
		...overrides,
	};
}

/** A `system1` backend answering `task.tier` with `p` on `answer`, the rest spread evenly. */
function stubTier(answer: ModelTier, p: number): DecidePorts {
	const backend: Backend = {
		id: "system1",
		version: "test",
		answer: ({ questions }) => ({
			ok: true,
			value: questions.map((q) => {
				const options = q.kind === "choice" ? q.options : [];
				const rest = (1 - p) / (options.length - 1);
				return {
					answer,
					distribution: options.map((o) => ({
						answer: o,
						p: o === answer ? p : rest,
					})),
				};
			}),
		}),
	};
	const policy: Policy = {
		...DEFAULT_POLICY,
		decisions: {
			...DEFAULT_POLICY.decisions,
			"task.tier": {
				...DEFAULT_POLICY.decisions["task.tier"],
				backend: "system1",
				thresholds: { confidence: 0.8 },
			},
		},
	};
	return {
		clock: createFixedClock(0),
		policy,
		backends: createRegistry([...DEFAULT_REGISTRY.values(), backend]),
	};
}

/** A `system1` backend that always fails. */
function failingTier(): DecidePorts {
	const ports = stubTier("mechanical", 1);
	const backend: Backend = {
		id: "system1",
		version: "test",
		answer: () => ({
			ok: false,
			error: { kind: "unsupported", questionId: undefined, message: "no" },
		}),
	};
	return {
		...ports,
		backends: createRegistry([...DEFAULT_REGISTRY.values(), backend]),
	};
}

describe("chooseTier", () => {
	test("an easy task routes to the lower tier the heuristic picked", () => {
		const choice = chooseTier(defaultDecidePorts, "commit");
		expect(choice).toMatchObject({
			decidedTier: "mechanical",
			tier: "mechanical",
			confidence: 1,
			reason: "confident",
		});
	});

	test("confidence exactly at the threshold keeps the lower tier", () => {
		const choice = chooseTier(stubTier("mechanical", 0.8), "commit");
		expect(choice.tier).toBe("mechanical");
		expect(choice.reason).toBe("confident");
		expect(choice.threshold).toBe(0.8);
	});

	test("confidence above the threshold keeps the lower tier", () => {
		expect(chooseTier(stubTier("standard", 0.95), "review").tier).toBe(
			"standard",
		);
	});

	test("an uncertain task escalates to the top tier", () => {
		const choice = chooseTier(stubTier("mechanical", 0.6), "commit");
		expect(choice).toMatchObject({
			decidedTier: "mechanical",
			tier: "architectural",
			confidence: 0.6,
			reason: "uncertain",
		});
	});

	test("a failed decision is uncertain and escalates to the top tier", () => {
		const choice = chooseTier(failingTier(), "commit");
		expect(choice).toMatchObject({
			decidedTier: undefined,
			tier: "architectural",
			confidence: 0,
			reason: "uncertain",
		});
	});
});

describe("routeTask", () => {
	test("routes an easy task to the lower tier", () => {
		const logger = createMemoryLogger();
		const routed = routeTask(
			{ decide: defaultDecidePorts, logger },
			input({ task: "commit" }),
		);
		expect(routed.ok).toBe(true);
		if (!routed.ok) return;
		expect(routed.value.tier).toBe("mechanical");
		expect(routed.value.estimatedCostUsd).toBe(0.01);
		expect(routed.value.degradedFrom).toBeUndefined();
	});

	test("routes an uncertain task to the top tier", () => {
		const routed = routeTask(
			{ decide: stubTier("mechanical", 0.5), logger: createMemoryLogger() },
			input(),
		);
		expect(routed.ok && routed.value.tier).toBe("architectural");
		expect(routed.ok && routed.value.reason).toBe("uncertain");
	});

	test("the savings estimate is logged once per decision", () => {
		const logger = createMemoryLogger();
		const ports = { decide: defaultDecidePorts, logger };
		const commit = routeTask(ports, input({ task: "commit" }));
		const design = routeTask(ports, input({ task: "design-review" }));

		const entries = logger.entries();
		expect(entries).toHaveLength(2);
		// Baseline defaults to the standard tier: a mechanical task saves the
		// difference, an architectural one costs extra (a negative saving).
		expect(commit.ok && commit.value.savingsUsd).toBeCloseTo(0.03, 10);
		expect(design.ok && design.value.savingsUsd).toBeCloseTo(-0.06, 10);
		const [first, second] = entries;
		expect(first?.level).toBe("info");
		expect(first?.fields).toMatchObject({
			task: "commit",
			tier: "mechanical",
			decidedTier: "mechanical",
			confidence: 1,
			reason: "confident",
			baselineTier: "standard",
			estimatedCostUsd: 0.01,
		});
		expect(first?.fields?.savingsUsd).toBeCloseTo(0.03, 10);
		expect(second?.fields).toMatchObject({
			task: "design-review",
			tier: "architectural",
		});
		expect(second?.fields?.savingsUsd).toBeCloseTo(-0.06, 10);
	});

	test("the savings baseline can be set by the caller", () => {
		const logger = createMemoryLogger();
		const routed = routeTask(
			{ decide: defaultDecidePorts, logger },
			input({ task: "review", baselineTier: "architectural" }),
		);
		expect(routed.ok && routed.value.savingsUsd).toBeCloseTo(0.06, 10);
		expect(logger.entries()[0]?.fields?.baselineTier).toBe("architectural");
	});
});

describe("tiers", () => {
	test("the unimplemented local tier is gone from routing and config", () => {
		expect(MODEL_TIERS).toEqual(["mechanical", "standard", "architectural"]);
		expect(Object.keys(getDefaultConfig().models).sort()).toEqual([
			"architectural",
			"mechanical",
			"standard",
		]);
	});
});
