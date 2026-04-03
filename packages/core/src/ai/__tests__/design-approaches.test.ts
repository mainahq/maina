import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// ── Mock State ──────────────────────────────────────────────────────────────

let mockAIResponse: string | null = null;

// ── Mocks ───────────────────────────────────────────────────────────────────

mock.module("../try-generate", () => ({
	tryAIGenerate: async (
		_task: string,
		_mainaDir: string,
		_variables: Record<string, string>,
		_userPrompt: string,
	) => ({
		text: mockAIResponse,
		fromAI: mockAIResponse !== null,
		hostDelegation: false,
	}),
}));

afterAll(() => {
	mock.restore();
});

// ── Import after mocks ──────────────────────────────────────────────────────

const { generateDesignApproaches } = await import("../design-approaches");

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateDesignApproaches", () => {
	beforeEach(() => {
		mockAIResponse = null;
	});

	// ── Happy Path ──────────────────────────────────────────────────────────

	describe("happy path", () => {
		test("returns parsed approaches from valid AI JSON response", async () => {
			mockAIResponse = JSON.stringify([
				{
					name: "Event-driven",
					description: "Steps emit events consumed by next step.",
					pros: ["Parallel", "Decoupled"],
					cons: ["Complex debugging"],
					recommended: true,
				},
				{
					name: "Middleware chain",
					description: "Sequential middleware functions.",
					pros: ["Simple"],
					cons: ["No parallelism"],
					recommended: false,
				},
			]);

			const result = await generateDesignApproaches(
				"Design a verification pipeline",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]?.name).toBe("Event-driven");
				expect(result.value[0]?.recommended).toBe(true);
				expect(result.value[0]?.pros).toEqual(["Parallel", "Decoupled"]);
				expect(result.value[1]?.name).toBe("Middleware chain");
				expect(result.value[1]?.recommended).toBe(false);
			}
		});

		test("returns empty array when AI says no approaches needed", async () => {
			mockAIResponse = "[]";

			const result = await generateDesignApproaches(
				"Simple decision",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});
	});

	// ── Edge Cases ──────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("returns empty array when context is empty", async () => {
			const result = await generateDesignApproaches("", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("handles AI response with markdown fences around JSON", async () => {
			mockAIResponse =
				'```json\n[{"name":"A","description":"D","pros":["p"],"cons":["c"],"recommended":true}]\n```';

			const result = await generateDesignApproaches("Test context", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(1);
				expect(result.value[0]?.name).toBe("A");
			}
		});

		test("caps approaches at 3 even if AI returns more", async () => {
			const fourApproaches = Array.from({ length: 4 }, (_, i) => ({
				name: `Approach ${i + 1}`,
				description: `Description ${i + 1}`,
				pros: ["pro"],
				cons: ["con"],
				recommended: i === 0,
			}));
			mockAIResponse = JSON.stringify(fourApproaches);

			const result = await generateDesignApproaches("Test context", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBeLessThanOrEqual(3);
			}
		});
	});

	// ── Error Handling ──────────────────────────────────────────────────────

	describe("error handling", () => {
		test("returns empty array when AI is not available", async () => {
			mockAIResponse = null;

			const result = await generateDesignApproaches("Test context", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("returns empty array when AI returns malformed JSON", async () => {
			mockAIResponse = "not valid json at all";

			const result = await generateDesignApproaches("Test context", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("filters out approaches missing required fields", async () => {
			mockAIResponse = JSON.stringify([
				{
					name: "Valid",
					description: "D",
					pros: ["p"],
					cons: ["c"],
					recommended: true,
				},
				{
					description: "Missing name",
					pros: ["p"],
					cons: ["c"],
					recommended: false,
				},
				{
					name: "Also valid",
					description: "D2",
					pros: ["p"],
					cons: ["c"],
					recommended: false,
				},
			]);

			const result = await generateDesignApproaches("Test context", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]?.name).toBe("Valid");
				expect(result.value[1]?.name).toBe("Also valid");
			}
		});
	});
});
