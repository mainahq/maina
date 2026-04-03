import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Finding } from "../diff-filter";

// ─── Mock setup ──────────────────────────────────────────────────────────

// Mock the AI generate function
const mockGenerate = mock(() =>
	Promise.resolve({
		text: "",
		cached: false,
		model: "test-model",
		tokens: { input: 100, output: 50 },
	}),
);

// Mock the Prompt Engine
const mockBuildSystemPrompt = mock(() =>
	Promise.resolve({
		prompt: "You are a fix generator. Fix the issues.",
		hash: "prompt-hash-abc",
	}),
);

// Mock the cache manager
const mockCacheGet = mock(
	() =>
		null as {
			key: string;
			value: string;
			createdAt: number;
			ttl: number;
		} | null,
);
const mockCacheSet = mock(() => {});
const mockCacheHas = mock(() => false);
const mockCreateCacheManager = mock(() => ({
	get: mockCacheGet,
	set: mockCacheSet,
	has: mockCacheHas,
	invalidate: mock(() => {}),
	clear: mock(() => {}),
	stats: mock(() => ({
		l1Hits: 0,
		l2Hits: 0,
		misses: 0,
		totalQueries: 0,
		entriesL1: 0,
		entriesL2: 0,
	})),
}));

// Apply mocks before importing the module under test
mock.module("../../ai/index", () => ({
	generate: mockGenerate,
}));

mock.module("../../prompts/engine", () => ({
	buildSystemPrompt: mockBuildSystemPrompt,
}));

mock.module("../../cache/manager", () => ({
	createCacheManager: mockCreateCacheManager,
}));

// Now import the module under test
import {
	type FixOptions,
	type FixResult,
	type FixSuggestion,
	generateFixes,
	hashFinding,
	parseFixResponse,
} from "../fix";

// ─── Test data ───────────────────────────────────────────────────────────

const sampleFinding: Finding = {
	tool: "biome",
	file: "src/utils.ts",
	line: 42,
	column: 5,
	message: "Use const instead of let",
	severity: "warning",
	ruleId: "lint/style/useConst",
};

const sampleFinding2: Finding = {
	tool: "semgrep",
	file: "src/api.ts",
	line: 10,
	message: "Potential SQL injection",
	severity: "error",
	ruleId: "security/sql-injection",
};

const sampleAiResponse = `### Fix for finding: biome/lint/style/useConst at src/utils.ts:42

**Explanation:** The variable is never reassigned, so it should be declared with const instead of let for better immutability guarantees.

**Confidence:** high

\`\`\`diff
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -42,1 +42,1 @@
-  let result = computeValue();
+  const result = computeValue();
\`\`\`
`;

const multiFixAiResponse = `### Fix for finding: biome/lint/style/useConst at src/utils.ts:42

**Explanation:** The variable is never reassigned, so it should be declared with const instead of let.

**Confidence:** high

\`\`\`diff
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -42,1 +42,1 @@
-  let result = computeValue();
+  const result = computeValue();
\`\`\`

### Fix for finding: semgrep/security/sql-injection at src/api.ts:10

**Explanation:** Use parameterized queries to prevent SQL injection attacks.

**Confidence:** medium

\`\`\`diff
--- a/src/api.ts
+++ b/src/api.ts
@@ -10,1 +10,1 @@
-  const rows = db.query("SELECT * FROM users WHERE id = " + userId);
+  const rows = db.query("SELECT * FROM users WHERE id = ?", [userId]);
\`\`\`
`;

// ─── hashFinding ─────────────────────────────────────────────────────────

describe("hashFinding", () => {
	it("should return a deterministic hash for the same finding", () => {
		const hash1 = hashFinding(sampleFinding);
		const hash2 = hashFinding(sampleFinding);
		expect(hash1).toBe(hash2);
	});

	it("should return different hashes for different findings", () => {
		const hash1 = hashFinding(sampleFinding);
		const hash2 = hashFinding(sampleFinding2);
		expect(hash1).not.toBe(hash2);
	});

	it("should return a hex string", () => {
		const hash = hashFinding(sampleFinding);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});

	it("should include tool, file, line, message, and ruleId in the hash input", () => {
		// Same finding but different line → different hash
		const altered = { ...sampleFinding, line: 99 };
		expect(hashFinding(sampleFinding)).not.toBe(hashFinding(altered));

		// Same finding but different message → different hash
		const alteredMsg = { ...sampleFinding, message: "Different message" };
		expect(hashFinding(sampleFinding)).not.toBe(hashFinding(alteredMsg));
	});
});

// ─── parseFixResponse ────────────────────────────────────────────────────

describe("parseFixResponse", () => {
	it("should parse a single fix from AI response", () => {
		const findings = [sampleFinding];
		const suggestions = parseFixResponse(sampleAiResponse, findings);

		expect(suggestions.length).toBe(1);
		expect(suggestions[0]?.finding).toBe(sampleFinding);
		expect(suggestions[0]?.confidence).toBe("high");
		expect(suggestions[0]?.explanation).toContain("never reassigned");
		expect(suggestions[0]?.diff).toContain("-  let result");
		expect(suggestions[0]?.diff).toContain("+  const result");
	});

	it("should parse multiple fixes from AI response", () => {
		const findings = [sampleFinding, sampleFinding2];
		const suggestions = parseFixResponse(multiFixAiResponse, findings);

		expect(suggestions.length).toBe(2);

		// First fix
		expect(suggestions[0]?.finding).toBe(sampleFinding);
		expect(suggestions[0]?.confidence).toBe("high");

		// Second fix
		expect(suggestions[1]?.finding).toBe(sampleFinding2);
		expect(suggestions[1]?.confidence).toBe("medium");
		expect(suggestions[1]?.explanation).toContain("parameterized queries");
	});

	it("should default confidence to low when not parseable", () => {
		const badResponse = `### Fix for finding: biome/lint/style/useConst at src/utils.ts:42

**Explanation:** Just fix it.

\`\`\`diff
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -42,1 +42,1 @@
-  let result = computeValue();
+  const result = computeValue();
\`\`\`
`;
		const findings = [sampleFinding];
		const suggestions = parseFixResponse(badResponse, findings);

		expect(suggestions.length).toBe(1);
		expect(suggestions[0]?.confidence).toBe("low");
	});

	it("should return empty array for empty response", () => {
		const suggestions = parseFixResponse("", [sampleFinding]);
		expect(suggestions.length).toBe(0);
	});

	it("should return empty array for unparseable response", () => {
		const suggestions = parseFixResponse("I cannot fix this issue.", [
			sampleFinding,
		]);
		expect(suggestions.length).toBe(0);
	});
});

// ─── generateFixes ───────────────────────────────────────────────────────

describe("generateFixes", () => {
	const defaultOptions: FixOptions = {
		mainaDir: ".maina",
		cwd: "/project",
		contextText: "const computeValue = () => 42;",
	};

	beforeEach(() => {
		mockGenerate.mockClear();
		mockBuildSystemPrompt.mockClear();
		mockCacheGet.mockClear();
		mockCacheSet.mockClear();
		mockCacheHas.mockClear();
		mockCreateCacheManager.mockClear();

		// Reset default implementations
		mockCacheGet.mockImplementation(() => null);
		mockGenerate.mockImplementation(() =>
			Promise.resolve({
				text: sampleAiResponse,
				cached: false,
				model: "test-model",
				tokens: { input: 100, output: 50 },
			}),
		);
	});

	it("should return empty suggestions for empty findings", async () => {
		const result = await generateFixes([], defaultOptions);

		expect(result.suggestions.length).toBe(0);
		expect(result.cached).toBe(false);
		expect(mockGenerate).not.toHaveBeenCalled();
	});

	it("should call buildSystemPrompt with 'fix' task", async () => {
		await generateFixes([sampleFinding], defaultOptions);

		expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
			"fix",
			".maina",
			expect.objectContaining({
				findings: expect.any(String),
				source: expect.any(String),
			}),
		);
	});

	it("should call generate with assembled prompt", async () => {
		await generateFixes([sampleFinding], defaultOptions);

		expect(mockGenerate).toHaveBeenCalledTimes(1);
		expect(mockGenerate).toHaveBeenCalledWith(
			expect.objectContaining({
				task: "fix",
				systemPrompt: expect.any(String),
				userPrompt: expect.any(String),
				mainaDir: ".maina",
			}),
		);
	});

	it("should return parsed suggestions from AI response", async () => {
		const result = await generateFixes([sampleFinding], defaultOptions);

		expect(result.suggestions.length).toBe(1);
		expect(result.suggestions[0]?.finding).toBe(sampleFinding);
		expect(result.suggestions[0]?.confidence).toBe("high");
		expect(result.cached).toBe(false);
		expect(result.model).toBe("test-model");
	});

	it("should check cache before calling AI", async () => {
		// Simulate cache hit
		const cachedResult: FixResult = {
			suggestions: [
				{
					finding: sampleFinding,
					diff: "cached diff",
					explanation: "cached explanation",
					confidence: "high",
				},
			],
			cached: true,
			model: "cached-model",
		};

		mockCacheGet.mockImplementation(() => ({
			key: "test-key",
			value: JSON.stringify(cachedResult),
			createdAt: Date.now(),
			ttl: 0,
		}));

		const result = await generateFixes([sampleFinding], defaultOptions);

		expect(result.cached).toBe(true);
		expect(result.suggestions.length).toBe(1);
		expect(result.suggestions[0]?.diff).toBe("cached diff");
		// AI generate should NOT have been called
		expect(mockGenerate).not.toHaveBeenCalled();
	});

	it("should cache the result after AI call", async () => {
		await generateFixes([sampleFinding], defaultOptions);

		expect(mockCacheSet).toHaveBeenCalledTimes(1);
		expect(mockCacheSet).toHaveBeenCalledWith(
			expect.any(String), // cache key
			expect.any(String), // JSON stringified result
			expect.objectContaining({
				ttl: expect.any(Number),
			}),
		);
	});

	it("should return same fix on second call via cache", async () => {
		// First call: AI generates
		const result1 = await generateFixes([sampleFinding], defaultOptions);
		expect(result1.cached).toBe(false);
		expect(mockGenerate).toHaveBeenCalledTimes(1);

		// Set up cache to return what was stored
		const calls = mockCacheSet.mock.calls as unknown[][];
		const storedValue = (calls[0]?.[1] ?? "") as string;
		mockCacheGet.mockImplementation(() => ({
			key: "test-key",
			value: storedValue,
			createdAt: Date.now(),
			ttl: 0,
		}));

		// Second call: should hit cache
		const result2 = await generateFixes([sampleFinding], defaultOptions);
		expect(result2.cached).toBe(true);
		// AI should not be called a second time
		expect(mockGenerate).toHaveBeenCalledTimes(1);
	});

	it("should batch multiple findings into a single AI call", async () => {
		mockGenerate.mockImplementation(() =>
			Promise.resolve({
				text: multiFixAiResponse,
				cached: false,
				model: "test-model",
				tokens: { input: 200, output: 100 },
			}),
		);

		const result = await generateFixes(
			[sampleFinding, sampleFinding2],
			defaultOptions,
		);

		// Only one AI call for multiple findings
		expect(mockGenerate).toHaveBeenCalledTimes(1);
		expect(result.suggestions.length).toBe(2);
	});

	it("should handle AI call returning empty/unparseable response", async () => {
		mockGenerate.mockImplementation(() =>
			Promise.resolve({
				text: "Sorry, I cannot fix these issues.",
				cached: false,
				model: "test-model",
				tokens: { input: 100, output: 10 },
			}),
		);

		const result = await generateFixes([sampleFinding], defaultOptions);

		expect(result.suggestions.length).toBe(0);
		expect(result.cached).toBe(false);
	});

	it("should use contextText in the prompt when provided", async () => {
		await generateFixes([sampleFinding], {
			...defaultOptions,
			contextText: "function computeValue() { return 42; }",
		});

		expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
			"fix",
			".maina",
			expect.objectContaining({
				source: expect.stringContaining("computeValue"),
			}),
		);
	});

	it("should handle missing contextText gracefully", async () => {
		await generateFixes([sampleFinding], {
			mainaDir: ".maina",
		});

		expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
			"fix",
			".maina",
			expect.objectContaining({
				source: expect.any(String),
			}),
		);
	});
});

// ─── FixSuggestion type ──────────────────────────────────────────────────

describe("FixSuggestion type", () => {
	it("should have all required fields", () => {
		const suggestion: FixSuggestion = {
			finding: sampleFinding,
			diff: "--- a/file\n+++ b/file",
			explanation: "Fix explanation",
			confidence: "high",
		};

		expect(suggestion.finding).toBe(sampleFinding);
		expect(suggestion.diff).toBeTruthy();
		expect(suggestion.explanation).toBeTruthy();
		expect(suggestion.confidence).toBe("high");
	});
});

// ─── FixResult type ──────────────────────────────────────────────────────

describe("FixResult type", () => {
	it("should have suggestions, cached flag, and optional model", () => {
		const result: FixResult = {
			suggestions: [],
			cached: false,
			model: "gpt-4",
		};

		expect(Array.isArray(result.suggestions)).toBe(true);
		expect(typeof result.cached).toBe("boolean");
		expect(result.model).toBe("gpt-4");
	});
});
