import { describe, expect, test } from "bun:test";
import type { BudgetAllocation, LayerContent } from "../budget";
import {
	assembleBudget,
	calculateTokens,
	getBudgetRatio,
	truncateToFit,
} from "../budget";

describe("calculateTokens", () => {
	test("returns approximately chars/3.5", () => {
		const text = "hello world"; // 11 chars → ceil(11/3.5) = ceil(3.14) = 4
		expect(calculateTokens(text)).toBe(Math.ceil(text.length / 3.5));
	});

	test("returns 0 for empty string", () => {
		expect(calculateTokens("")).toBe(0);
	});

	test("always returns a whole number", () => {
		const text = "abcde"; // 5 chars → ceil(5/3.5) = ceil(1.43) = 2
		const result = calculateTokens(text);
		expect(Number.isInteger(result)).toBe(true);
		expect(result).toBe(2);
	});
});

describe("getBudgetRatio", () => {
	test("focused mode returns 0.4", () => {
		expect(getBudgetRatio("focused")).toBe(0.4);
	});

	test("default mode returns 0.6", () => {
		expect(getBudgetRatio("default")).toBe(0.6);
	});

	test("explore mode returns 0.8", () => {
		expect(getBudgetRatio("explore")).toBe(0.8);
	});
});

describe("assembleBudget", () => {
	test("allocations sum correctly for default mode with default context window", () => {
		const allocation = assembleBudget("default");
		// working + episodic + semantic + retrieval + headroom === total
		const layerSum =
			allocation.working +
			allocation.episodic +
			allocation.semantic +
			allocation.retrieval +
			allocation.headroom;
		expect(layerSum).toBe(allocation.total);
	});

	test("total equals model context window", () => {
		const allocation = assembleBudget("default", 100_000);
		expect(allocation.total).toBe(100_000);
	});

	test("headroom is correct for focused mode", () => {
		const modelContext = 200_000;
		const allocation = assembleBudget("focused", modelContext);
		const ratio = 0.4;
		const budget = Math.floor(modelContext * ratio);
		const expectedHeadroom = modelContext - budget;
		expect(allocation.headroom).toBe(expectedHeadroom);
	});

	test("layer allocations sum to budget (not total) for explore mode", () => {
		const modelContext = 200_000;
		const allocation = assembleBudget("explore", modelContext);
		const ratio = 0.8;
		const budget = Math.floor(modelContext * ratio);
		const layerSum =
			allocation.working +
			allocation.episodic +
			allocation.semantic +
			allocation.retrieval;
		expect(layerSum).toBe(budget);
	});

	test("working layer is always fully allocated", () => {
		const modelContext = 200_000;
		const allocationDefault = assembleBudget("default", modelContext);
		const allocationFocused = assembleBudget("focused", modelContext);
		// working = ~25% of budget; for focused: budget = 0.4 * 200_000 = 80_000
		// working = floor(80_000 * 0.25) = 20_000
		expect(allocationFocused.working).toBe(
			Math.floor(Math.floor(modelContext * 0.4) * 0.25),
		);
		expect(allocationDefault.working).toBe(
			Math.floor(Math.floor(modelContext * 0.6) * 0.25),
		);
	});
});

describe("truncateToFit", () => {
	const makeLayers = (): LayerContent[] => [
		{ name: "working", text: "working context", tokens: 100, priority: 0 },
		{ name: "semantic", text: "semantic context", tokens: 200, priority: 1 },
		{ name: "episodic", text: "episodic context", tokens: 300, priority: 2 },
		{ name: "retrieval", text: "retrieval context", tokens: 400, priority: 3 },
	];

	const makeBudget = (
		overrides: Partial<BudgetAllocation> = {},
	): BudgetAllocation => ({
		working: 100,
		semantic: 200,
		episodic: 300,
		retrieval: 400,
		headroom: 0,
		total: 1000,
		...overrides,
	});

	test("returns all layers unchanged when within budget", () => {
		const layers = makeLayers(); // total 1000 tokens
		const budget = makeBudget(); // total 1000
		const result = truncateToFit(layers, budget);
		expect(result).toHaveLength(4);
	});

	test("removes retrieval first when over budget", () => {
		const layers = makeLayers(); // total 1000 tokens
		// Budget only allows 600 tokens total (working+semantic+episodic = 600)
		const budget = makeBudget({ retrieval: 0, total: 600 });
		const result = truncateToFit(layers, budget);
		const names = result.map((l) => l.name);
		expect(names).not.toContain("retrieval");
	});

	test("removes episodic after retrieval when still over budget", () => {
		const layers = makeLayers(); // total 1000 tokens
		// Budget only allows 300 tokens (working+semantic = 300)
		const budget = makeBudget({ retrieval: 0, episodic: 0, total: 300 });
		const result = truncateToFit(layers, budget);
		const names = result.map((l) => l.name);
		expect(names).not.toContain("retrieval");
		expect(names).not.toContain("episodic");
	});

	test("never removes working context", () => {
		const layers = makeLayers();
		// Tiny budget — only enough for working
		const budget = makeBudget({
			semantic: 0,
			episodic: 0,
			retrieval: 0,
			total: 100,
		});
		const result = truncateToFit(layers, budget);
		const names = result.map((l) => l.name);
		expect(names).toContain("working");
	});

	test("working context is always present even when over budget", () => {
		const layers = makeLayers();
		// Absurdly small budget
		const budget = makeBudget({
			working: 1,
			semantic: 0,
			episodic: 0,
			retrieval: 0,
			total: 1,
		});
		const result = truncateToFit(layers, budget);
		expect(result.some((l) => l.name === "working")).toBe(true);
	});

	test("returns layers sorted by priority after truncation", () => {
		const layers = makeLayers();
		const budget = makeBudget({ retrieval: 0, total: 600 });
		const result = truncateToFit(layers, budget);
		const priorities = result.map((l) => l.priority);
		const sorted = [...priorities].sort((a, b) => a - b);
		expect(priorities).toEqual(sorted);
	});
});
