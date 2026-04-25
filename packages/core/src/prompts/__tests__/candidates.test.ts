import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES_DIR = join(import.meta.dir, "..", "candidates");

/**
 * C2 banned-phrase regex set — kept in lock-step with templates.test.ts
 * intentionally. Candidate prompts produce the strings end-users will see
 * in receipts, so the same copy discipline applies.
 */
const BANNED_C2_PHRASES = [
	/\b0\s+(?:findings?|issues?|problems?|errors?)(?:\(s\))?\b/i,
	/\bno\s+(?:issues?|errors?|problems?|findings?)(?:\s+(?:found|detected))?\b/i,
	/\bno\s+security\s+(?:findings?|concerns?|issues?)\b/i,
];

/** Drop teaching spans where prompts intentionally quote banned phrases —
 * same heuristic as templates.test.ts (BAD-marker → next blank line). */
function stripTeachingLines(content: string): string {
	const lines = content.split("\n");
	const out: string[] = [];
	let inSpan = false;
	for (const line of lines) {
		if (/\*{0,2}BAD(?:\s*\(.*?\))?\s*[:*]/i.test(line)) {
			inSpan = true;
			continue;
		}
		if (inSpan) {
			if (line.trim().length === 0) {
				inSpan = false;
				out.push(line);
			}
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

function listMd(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

describe("prompt candidates", () => {
	const files = listMd(CANDIDATES_DIR);

	test("candidates directory contains at least one candidate", () => {
		// If this ever drops to zero, `maina learn` has nothing to A/B test
		// against — keep at minimum one designed candidate around so the
		// flow stays exercised.
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const content = readFileSync(join(CANDIDATES_DIR, file), "utf-8");

		test(`${file}: includes {{constitution}} placeholder`, () => {
			expect(content).toContain("{{constitution}}");
		});

		test(`${file}: passes C2 copy discipline (no banned affirmations)`, () => {
			const stripped = stripTeachingLines(content);
			for (const banned of BANNED_C2_PHRASES) {
				expect(stripped).not.toMatch(banned);
			}
		});

		test(`${file}: requests [NEEDS CLARIFICATION] for ambiguity`, () => {
			// Every candidate should preserve the ambiguity-marker contract
			// so reviews don't silently guess past unclear diffs.
			expect(content).toContain("[NEEDS CLARIFICATION:");
		});
	}
});
