import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let mockAIResult = {
	text: null as string | null,
	fromAI: false,
	hostDelegation: false,
};

mock.module("../../ai/try-generate", () => ({
	tryAIGenerate: async () => mockAIResult,
}));

afterAll(() => mock.restore());

// Import AFTER mocking
const { generateHldLld } = await import("../index");

describe("generateHldLld", () => {
	beforeEach(() => {
		mockAIResult = { text: null, fromAI: false, hostDelegation: false };
	});

	it("should return AI-generated HLD/LLD content when AI is available", async () => {
		const hldLldContent = `## High-Level Design

### System Overview
This adds AI review to the verify pipeline.

### Component Boundaries
- ai-review.ts: AI review logic

### Data Flow
Diff -> AI -> Findings

### External Dependencies
None

## Low-Level Design

### Interfaces & Types
AIReviewResult interface

### Function Signatures
runAIReview(options): Promise<AIReviewResult>

### DB Schema Changes
None

### Sequence of Operations
1. Get diff 2. Call AI

### Error Handling
Graceful skip on failure

### Edge Cases
Empty diff returns no findings`;

		mockAIResult = { text: hldLldContent, fromAI: true, hostDelegation: false };

		const result = await generateHldLld("Test spec content", ".maina");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toContain("## High-Level Design");
		expect(result.value).toContain("## Low-Level Design");
	});

	it("should return error when AI is unavailable", async () => {
		mockAIResult = { text: null, fromAI: false, hostDelegation: false };

		const result = await generateHldLld("Test spec", ".maina");

		expect(result.ok).toBe(false);
	});

	it("should use delegation text as content when host delegation active", async () => {
		mockAIResult = {
			text: "Generate HLD and LLD sections for this spec:\n\nTest spec content",
			fromAI: false,
			hostDelegation: true,
		};

		const result = await generateHldLld("Test spec content", ".maina");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toContain("Test spec content");
	});
});
