import { describe, expect, test } from "bun:test";
import { parseCommentExtras } from "../extras";

describe("parseCommentExtras", () => {
	test("accepts criteria, verify scope, gate tally and url", () => {
		const raw = {
			criteria: [
				{ id: "AC-1", text: "retries", status: "met", evidence: ["tests"] },
			],
			verifyScope: { kind: "range", base: "origin/main", files: 3 },
			gate: {
				blocked: 0,
				asked: 1,
				allowed: 9,
				overrides: [{ decisionId: "action.risk:1", summary: "rm -rf dist" }],
			},
			url: "https://example.com/r",
		};
		const result = parseCommentExtras(raw);
		expect(result).toEqual({ ok: true, value: raw } as typeof result);
	});

	test("every field is optional", () => {
		expect(parseCommentExtras({})).toEqual({ ok: true, value: {} });
	});

	test("rejects a wrong shape with the offending path", () => {
		const result = parseCommentExtras({
			criteria: [{ id: "AC-1", text: "x", status: "done", evidence: [] }],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain("criteria[0].status");
	});

	test("refuses unknown keys so a typo is not silently dropped", () => {
		const result = parseCommentExtras({ critera: [] });
		expect(result.ok).toBe(false);
	});
});
