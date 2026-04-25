import { describe, expect, test } from "bun:test";
import {
	baselineWalkthrough,
	generateWalkthrough,
	type WalkthroughInput,
} from "../walkthrough";

function input(overrides: Partial<WalkthroughInput> = {}): WalkthroughInput {
	return {
		prTitle: "feat: add receipt walkthrough",
		diff: { additions: 120, deletions: 8, files: 3 },
		status: "passed",
		retries: 0,
		checks: [
			{ name: "Biome", tool: "biome", status: "passed", findingsCount: 0 },
			{ name: "Semgrep", tool: "semgrep", status: "passed", findingsCount: 0 },
		],
		...overrides,
	};
}

describe("baselineWalkthrough", () => {
	test("emits exactly three sentences (or close to it)", () => {
		const text = baselineWalkthrough(input());
		const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
		expect(sentences.length).toBe(3);
	});

	test("uses affirmative framing per C2", () => {
		const text = baselineWalkthrough(input());
		expect(text).not.toMatch(
			/\b(0\s+findings?|no\s+issues?\s+found|no\s+errors?)\b/i,
		);
	});

	test("names the diff and the check counts", () => {
		const text = baselineWalkthrough(input());
		expect(text).toContain("+120");
		expect(text).toContain("3 file");
		expect(text).toContain("passed 2 of 2");
	});

	test("explains retry-cap when partial+capped", () => {
		const text = baselineWalkthrough(input({ status: "partial", retries: 3 }));
		expect(text).toContain("retried 3 times");
	});

	test("explains failure when status is failed", () => {
		const text = baselineWalkthrough(
			input({
				status: "failed",
				checks: [
					{
						name: "Semgrep",
						tool: "semgrep",
						status: "failed",
						findingsCount: 1,
					},
				],
			}),
		);
		expect(text).toMatch(/failed/i);
		expect(text).toMatch(/not yet safe to merge/i);
	});

	test("handles zero-check input without crashing", () => {
		const text = baselineWalkthrough(input({ checks: [] }));
		expect(text).toContain("empty check set");
		// C2 — never use vague absence framing in the baseline
		expect(text).not.toMatch(
			/\b(0\s+findings?|no\s+issues?\s+found|no\s+errors?)\b/i,
		);
	});
});

describe("generateWalkthrough", () => {
	test("returns ai-source when AI output passes validation", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: "Adds the receipt walkthrough generator. Maina ran 2 checks — both passed. Verified — passed 2 of 2 policy checks.",
				fromAI: true,
				hostDelegation: false,
			}),
		});
		expect(result.source).toBe("ai");
		expect(result.text).toContain("walkthrough generator");
	});

	test("falls back to baseline when AI output violates C2", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: "Tweaks the renderer. 0 findings emerged. Safe to merge.",
				fromAI: true,
				hostDelegation: false,
			}),
		});
		expect(result.source).toBe("baseline");
	});

	test("falls back when AI emits a NEEDS CLARIFICATION marker", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: "Some change. [NEEDS CLARIFICATION: what scope?] All passed.",
				fromAI: true,
				hostDelegation: false,
			}),
		});
		expect(result.source).toBe("baseline");
	});

	test("falls back when AI sentence count is wrong", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: "Adds X. Maina ran checks. They passed. Looks good. Merge it. Final word. Done.",
				fromAI: true,
				hostDelegation: false,
			}),
		});
		expect(result.source).toBe("baseline");
	});

	test("falls back when AI is unavailable", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: null,
				fromAI: false,
				hostDelegation: false,
			}),
		});
		expect(result.source).toBe("baseline");
	});

	test("falls back under host delegation (no concrete text yet)", async () => {
		const result = await generateWalkthrough(input(), {
			tryAI: async () => ({
				text: "host-delegated prompt body",
				fromAI: false,
				hostDelegation: true,
			}),
		});
		expect(result.source).toBe("baseline");
	});
});
