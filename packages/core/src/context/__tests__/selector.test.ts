import { describe, expect, it } from "bun:test";
import type { BudgetMode } from "../budget.ts";
import { getBudgetMode, getContextNeeds, needsLayer } from "../selector.ts";

describe("getContextNeeds", () => {
	it("commit needs only working + conventions", () => {
		const needs = getContextNeeds("commit");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toBe(false);
		expect(needs.semantic).toEqual(["conventions"]);
		expect(needs.retrieval).toBe(false);
	});

	it("context command needs all 4 layers", () => {
		const needs = getContextNeeds("context");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toBe(true);
		expect(needs.semantic).toBe(true);
		expect(needs.retrieval).toBe(true);
	});

	it("verify needs working + recent-reviews + adrs + conventions", () => {
		const needs = getContextNeeds("verify");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toEqual(["recent-reviews"]);
		expect(needs.semantic).toEqual(["adrs", "conventions"]);
		expect(needs.retrieval).toBe(false);
	});

	it("review returns correct context needs", () => {
		const needs = getContextNeeds("review");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toEqual(["past-reviews"]);
		expect(needs.semantic).toEqual(["adrs"]);
		expect(needs.retrieval).toBe(false);
	});

	it("plan returns correct context needs", () => {
		const needs = getContextNeeds("plan");
		expect(needs.working).toBe(true);
		expect(needs.semantic).toEqual(["adrs", "conventions"]);
		expect(needs.episodic).toBe(false);
		expect(needs.retrieval).toBe(false);
	});

	it("explain returns correct context needs", () => {
		const needs = getContextNeeds("explain");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toBe(false);
		expect(needs.semantic).toBe(true);
		expect(needs.retrieval).toBe(true);
	});

	it("design returns correct context needs", () => {
		const needs = getContextNeeds("design");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toBe(false);
		expect(needs.semantic).toEqual(["adrs"]);
		expect(needs.retrieval).toBe(false);
	});

	it("ticket returns correct context needs", () => {
		const needs = getContextNeeds("ticket");
		expect(needs.working).toBe(false);
		expect(needs.episodic).toBe(false);
		expect(needs.semantic).toEqual(["modules"]);
		expect(needs.retrieval).toBe(false);
	});

	it("analyze returns correct context needs", () => {
		const needs = getContextNeeds("analyze");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toBe(true);
		expect(needs.semantic).toBe(true);
		expect(needs.retrieval).toBe(false);
	});

	it("pr returns correct context needs", () => {
		const needs = getContextNeeds("pr");
		expect(needs.working).toBe(true);
		expect(needs.episodic).toEqual(["past-reviews"]);
		expect(needs.semantic).toBe(true);
		expect(needs.retrieval).toBe(true);
	});
});

describe("needsLayer", () => {
	it("correctly identifies when working layer is needed", () => {
		const needs = getContextNeeds("commit");
		expect(needsLayer(needs, "working")).toBe(true);
	});

	it("correctly identifies when working layer is not needed", () => {
		const needs = getContextNeeds("ticket");
		expect(needsLayer(needs, "working")).toBe(false);
	});

	it("correctly identifies when episodic layer is needed (true)", () => {
		const needs = getContextNeeds("context");
		expect(needsLayer(needs, "episodic")).toBe(true);
	});

	it("correctly identifies when episodic layer is needed (string[])", () => {
		const needs = getContextNeeds("verify");
		expect(needsLayer(needs, "episodic")).toBe(true);
	});

	it("correctly identifies when episodic layer is not needed", () => {
		const needs = getContextNeeds("commit");
		expect(needsLayer(needs, "episodic")).toBe(false);
	});

	it("correctly identifies when semantic layer is needed (true)", () => {
		const needs = getContextNeeds("context");
		expect(needsLayer(needs, "semantic")).toBe(true);
	});

	it("correctly identifies when semantic layer is needed (string[])", () => {
		const needs = getContextNeeds("commit");
		expect(needsLayer(needs, "semantic")).toBe(true);
	});

	it("correctly identifies when retrieval layer is needed", () => {
		const needs = getContextNeeds("context");
		expect(needsLayer(needs, "retrieval")).toBe(true);
	});

	it("correctly identifies when retrieval layer is not needed", () => {
		const needs = getContextNeeds("commit");
		expect(needsLayer(needs, "retrieval")).toBe(false);
	});
});

describe("getBudgetMode", () => {
	it("commit uses focused budget mode", () => {
		expect(getBudgetMode("commit")).toBe("focused" satisfies BudgetMode);
	});

	it("context uses explore budget mode", () => {
		expect(getBudgetMode("context")).toBe("explore" satisfies BudgetMode);
	});

	it("explain uses explore budget mode", () => {
		expect(getBudgetMode("explain")).toBe("explore" satisfies BudgetMode);
	});

	it("review uses default budget mode", () => {
		expect(getBudgetMode("review")).toBe("default" satisfies BudgetMode);
	});

	it("verify uses default budget mode", () => {
		expect(getBudgetMode("verify")).toBe("default" satisfies BudgetMode);
	});

	it("plan uses default budget mode", () => {
		expect(getBudgetMode("plan")).toBe("default" satisfies BudgetMode);
	});

	it("design uses default budget mode", () => {
		expect(getBudgetMode("design")).toBe("default" satisfies BudgetMode);
	});

	it("ticket uses default budget mode", () => {
		expect(getBudgetMode("ticket")).toBe("default" satisfies BudgetMode);
	});

	it("analyze uses default budget mode", () => {
		expect(getBudgetMode("analyze")).toBe("default" satisfies BudgetMode);
	});

	it("pr uses default budget mode", () => {
		expect(getBudgetMode("pr")).toBe("default" satisfies BudgetMode);
	});
});
