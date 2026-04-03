import { describe, expect, test } from "bun:test";
import type { MainaConfig } from "../../config/index";
import { getTaskTier, resolveModel } from "../tiers";

const TEST_CONFIG: MainaConfig = {
	models: {
		mechanical: "google/gemini-2.5-flash",
		standard: "anthropic/claude-sonnet-4",
		architectural: "anthropic/claude-sonnet-4-5",
		local: "ollama/qwen3-coder-8b",
	},
	provider: "openrouter",
	budget: {
		daily: 5.0,
		perTask: 0.5,
		alertAt: 0.8,
	},
};

describe("getTaskTier", () => {
	test("commit maps to mechanical", () => {
		expect(getTaskTier("commit")).toBe("mechanical");
	});

	test("tests maps to mechanical", () => {
		expect(getTaskTier("tests")).toBe("mechanical");
	});

	test("slop maps to mechanical", () => {
		expect(getTaskTier("slop")).toBe("mechanical");
	});

	test("compress maps to mechanical", () => {
		expect(getTaskTier("compress")).toBe("mechanical");
	});

	test("review maps to standard", () => {
		expect(getTaskTier("review")).toBe("standard");
	});

	test("plan maps to standard", () => {
		expect(getTaskTier("plan")).toBe("standard");
	});

	test("design maps to standard", () => {
		expect(getTaskTier("design")).toBe("standard");
	});

	test("fix maps to standard", () => {
		expect(getTaskTier("fix")).toBe("standard");
	});

	test("design-review maps to architectural", () => {
		expect(getTaskTier("design-review")).toBe("architectural");
	});

	test("architecture maps to architectural", () => {
		expect(getTaskTier("architecture")).toBe("architectural");
	});

	test("learn maps to architectural", () => {
		expect(getTaskTier("learn")).toBe("architectural");
	});

	test("unknown task defaults to standard", () => {
		expect(getTaskTier("unknown")).toBe("standard");
	});

	test("empty string defaults to standard", () => {
		expect(getTaskTier("")).toBe("standard");
	});
});

describe("resolveModel", () => {
	test("returns correct modelId for mechanical tier task", () => {
		const result = resolveModel("commit", TEST_CONFIG);
		expect(result.tier).toBe("mechanical");
		expect(result.modelId).toBe("google/gemini-2.5-flash");
		expect(result.provider).toBe("openrouter");
	});

	test("returns correct modelId for standard tier task", () => {
		const result = resolveModel("review", TEST_CONFIG);
		expect(result.tier).toBe("standard");
		expect(result.modelId).toBe("anthropic/claude-sonnet-4");
		expect(result.provider).toBe("openrouter");
	});

	test("returns correct modelId for architectural tier task", () => {
		const result = resolveModel("architecture", TEST_CONFIG);
		expect(result.tier).toBe("architectural");
		expect(result.modelId).toBe("anthropic/claude-sonnet-4-5");
		expect(result.provider).toBe("openrouter");
	});

	test("provider comes from config", () => {
		const customConfig: MainaConfig = {
			...TEST_CONFIG,
			provider: "custom-provider",
		};
		const result = resolveModel("commit", customConfig);
		expect(result.provider).toBe("custom-provider");
	});

	test("unknown task resolves to standard tier model", () => {
		const result = resolveModel("bogus-task", TEST_CONFIG);
		expect(result.tier).toBe("standard");
		expect(result.modelId).toBe("anthropic/claude-sonnet-4");
	});
});
