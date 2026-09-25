import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createFakeEnv } from "../../ports/testing";

// Mock tryAIGenerate
let mockAIResult: {
	text: string | null;
	fromAI: boolean;
	hostDelegation: boolean;
} = {
	text: null,
	fromAI: false,
	hostDelegation: false,
};

mock.module("../../ai/try-generate", () => ({
	tryAIGenerate: async () => mockAIResult,
}));

mock.module("../../cache/keys", () => ({
	hashContent: (s: string) => `hash-${s.length}`,
	buildCacheKey: async () => "test-cache-key",
}));

mock.module("../../cache/manager", () => ({
	createCacheManager: () => ({
		get: () => null,
		set: () => {},
		stats: () => ({ l1Hits: 0, l2Hits: 0, misses: 0 }),
	}),
}));

afterAll(() => mock.restore());

import { resolveReferencedFunctions } from "../ai-review";

describe("resolveReferencedFunctions", () => {
	it("should extract function calls from added lines in diff", () => {
		const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,5 @@ function existing() {
+  const result = validateInput(data);
+  processResult(result);
   return true;`;

		const entities = [
			{
				name: "validateInput",
				kind: "function" as const,
				startLine: 1,
				endLine: 5,
				filePath: "src/utils.ts",
				body: "function validateInput(data: unknown) {\n  if (!data) return null;\n  return data;\n}",
			},
			{
				name: "processResult",
				kind: "function" as const,
				startLine: 10,
				endLine: 15,
				filePath: "src/utils.ts",
				body: "function processResult(result: unknown) {\n  console.log(result);\n}",
			},
			{
				name: "unusedFunction",
				kind: "function" as const,
				startLine: 20,
				endLine: 25,
				filePath: "src/other.ts",
				body: "function unusedFunction() { return 1; }",
			},
		];

		const result = resolveReferencedFunctions(diff, entities);

		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("validateInput");
		expect(result[1]?.name).toBe("processResult");
	});

	it("should cap at 3 referenced functions per file", () => {
		const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,7 @@
+  fn1();
+  fn2();
+  fn3();
+  fn4();`;

		const entities = [
			{
				name: "fn1",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/a.ts",
				body: "function fn1() {}",
			},
			{
				name: "fn2",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/b.ts",
				body: "function fn2() {}",
			},
			{
				name: "fn3",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/c.ts",
				body: "function fn3() {}",
			},
			{
				name: "fn4",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/d.ts",
				body: "function fn4() {}",
			},
		];

		const result = resolveReferencedFunctions(diff, entities);
		expect(result).toHaveLength(3);
	});

	it("should return empty array when no functions match", () => {
		const diff = `+++ b/src/app.ts
@@ -1,1 +1,2 @@
+  const x = 42;`;

		const result = resolveReferencedFunctions(diff, []);
		expect(result).toHaveLength(0);
	});
});

// Import AFTER mocking
const { runAIReview } = await import("../ai-review");

describe("runAIReview", () => {
	const baseOptions = {
		diff: "+  const x = validateInput(data);",
		entities: [],
		mainaDir: ".maina",
		root: ".",
		env: createFakeEnv(),
	};

	beforeEach(() => {
		mockAIResult = { text: null, fromAI: false, hostDelegation: false };
	});

	it("should return findings from AI response (mechanical tier)", async () => {
		mockAIResult = {
			text: JSON.stringify({
				findings: [
					{
						file: "src/app.ts",
						line: 10,
						message: "validateInput may return null but caller doesn't check",
						severity: "warning",
						ruleId: "ai-review/edge-case",
					},
				],
			}),
			fromAI: true,
			hostDelegation: false,
		};

		const result = await runAIReview(baseOptions);

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.tool).toBe("ai-review");
		expect(result.findings[0]?.severity).toBe("warning");
		expect(result.tier).toBe("mechanical");
		expect(result.skipped).toBe(false);
	});

	it("should cap severity to warning in mechanical mode", async () => {
		mockAIResult = {
			text: JSON.stringify({
				findings: [
					{
						file: "src/app.ts",
						line: 5,
						message: "bad",
						severity: "error",
						ruleId: "ai-review/contract",
					},
				],
			}),
			fromAI: true,
			hostDelegation: false,
		};

		const result = await runAIReview(baseOptions);
		expect(result.findings[0]?.severity).toBe("warning");
	});

	it("should allow error severity in deep mode", async () => {
		mockAIResult = {
			text: JSON.stringify({
				findings: [
					{
						file: "src/app.ts",
						line: 5,
						message: "spec violation",
						severity: "error",
						ruleId: "ai-review/spec-compliance",
					},
				],
			}),
			fromAI: true,
			hostDelegation: false,
		};

		const result = await runAIReview({ ...baseOptions, deep: true });
		expect(result.findings[0]?.severity).toBe("error");
		expect(result.tier).toBe("standard");
	});

	it("should skip gracefully when AI is unavailable", async () => {
		mockAIResult = { text: null, fromAI: false, hostDelegation: false };
		const result = await runAIReview(baseOptions);
		expect(result.findings).toHaveLength(0);
		expect(result.skipped).toBe(true);
	});

	it("should skip gracefully on malformed AI response", async () => {
		mockAIResult = { text: "not json", fromAI: true, hostDelegation: false };
		const result = await runAIReview(baseOptions);
		expect(result.findings).toHaveLength(0);
		expect(result.skipped).toBe(true);
	});

	it("should handle host delegation by skipping", async () => {
		mockAIResult = {
			text: "[HOST_DELEGATION] prompt here",
			fromAI: false,
			hostDelegation: true,
		};
		const result = await runAIReview(baseOptions);
		expect(result.skipped).toBe(true);
	});
});
