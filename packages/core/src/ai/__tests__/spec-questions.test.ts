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

const { generateSpecQuestions } = await import("../spec-questions");

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateSpecQuestions", () => {
	beforeEach(() => {
		mockAIResponse = null;
	});

	// ── Happy Path ──────────────────────────────────────────────────────────

	describe("happy path", () => {
		test("returns parsed questions from valid AI JSON response", async () => {
			mockAIResponse = JSON.stringify([
				{
					question: "Should cache invalidate on branch switch?",
					type: "select",
					options: ["Yes", "No", "Both"],
					reason: "Not specified in plan",
				},
				{
					question: "What error message for missing API key?",
					type: "text",
					reason: "Error handling unspecified",
				},
			]);

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Add cache",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]?.question).toBe(
					"Should cache invalidate on branch switch?",
				);
				expect(result.value[0]?.type).toBe("select");
				expect(result.value[0]?.options).toEqual(["Yes", "No", "Both"]);
				expect(result.value[1]?.type).toBe("text");
			}
		});

		test("returns empty array when AI says plan is clear", async () => {
			mockAIResponse = "[]";

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Clear task",
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
		test("returns empty array when plan content is empty", async () => {
			const result = await generateSpecQuestions("", ".maina");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("handles AI response with markdown fences around JSON", async () => {
			mockAIResponse =
				'```json\n[{"question":"Test?","type":"text","reason":"r"}]\n```';

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Test",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(1);
				expect(result.value[0]?.question).toBe("Test?");
			}
		});

		test("caps questions at 5 even if AI returns more", async () => {
			const sixQuestions = Array.from({ length: 6 }, (_, i) => ({
				question: `Question ${i + 1}?`,
				type: "text",
				reason: `Reason ${i + 1}`,
			}));
			mockAIResponse = JSON.stringify(sixQuestions);

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Test",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBeLessThanOrEqual(5);
			}
		});
	});

	// ── Error Handling ──────────────────────────────────────────────────────

	describe("error handling", () => {
		test("returns empty array when AI is not available (null response)", async () => {
			mockAIResponse = null;

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Test",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("returns empty array when AI returns malformed JSON", async () => {
			mockAIResponse = "not valid json at all";

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Test",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});

		test("filters out questions missing required fields", async () => {
			mockAIResponse = JSON.stringify([
				{ question: "Valid?", type: "text", reason: "Valid reason" },
				{ type: "text", reason: "Missing question field" },
				{
					question: "Also valid?",
					type: "select",
					options: ["A", "B"],
					reason: "OK",
				},
			]);

			const result = await generateSpecQuestions(
				"## Tasks\n- T001: Test",
				".maina",
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]?.question).toBe("Valid?");
				expect(result.value[1]?.question).toBe("Also valid?");
			}
		});
	});
});
