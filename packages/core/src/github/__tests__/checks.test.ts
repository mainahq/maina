import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Finding } from "../../verify/diff-filter";
import {
	createCheckRun,
	determineConclusion,
	formatAnnotations,
	formatSummary,
} from "../checks";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
	mockFetch = mock(() => Promise.resolve(new Response("", { status: 200 })));
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ── formatAnnotations ───────────────────────────────────────────────────

describe("formatAnnotations", () => {
	test("converts findings to GitHub annotation format", () => {
		const findings: Finding[] = [
			{
				tool: "biome",
				file: "src/index.ts",
				line: 42,
				message: "Unused variable",
				severity: "warning",
				ruleId: "no-unused-vars",
			},
		];

		const annotations = formatAnnotations(findings);
		expect(annotations).toHaveLength(1);
		expect(annotations[0]).toEqual({
			path: "src/index.ts",
			start_line: 42,
			end_line: 42,
			annotation_level: "warning",
			message: "[biome] Unused variable",
			title: "no-unused-vars",
		});
	});

	test("maps severity to annotation_level correctly", () => {
		const findings: Finding[] = [
			{ tool: "t", file: "a.ts", line: 1, message: "err", severity: "error" },
			{
				tool: "t",
				file: "b.ts",
				line: 2,
				message: "warn",
				severity: "warning",
			},
			{ tool: "t", file: "c.ts", line: 3, message: "info", severity: "info" },
		];

		const annotations = formatAnnotations(findings);
		expect(annotations[0]?.annotation_level).toBe("failure");
		expect(annotations[1]?.annotation_level).toBe("warning");
		expect(annotations[2]?.annotation_level).toBe("notice");
	});

	test("caps at 50 annotations", () => {
		const findings: Finding[] = Array.from({ length: 60 }, (_, i) => ({
			tool: "t",
			file: `f${i}.ts`,
			line: i,
			message: `finding ${i}`,
			severity: "warning" as const,
		}));

		const annotations = formatAnnotations(findings);
		expect(annotations).toHaveLength(50);
	});

	test("handles empty findings", () => {
		expect(formatAnnotations([])).toEqual([]);
	});
});

// ── determineConclusion ─────────────────────────────────────────────────

describe("determineConclusion", () => {
	test("returns success when no findings", () => {
		expect(determineConclusion([])).toBe("success");
	});

	test("returns failure when errors exist", () => {
		const findings: Finding[] = [
			{
				tool: "t",
				file: "a.ts",
				line: 1,
				message: "error",
				severity: "error",
			},
		];
		expect(determineConclusion(findings)).toBe("failure");
	});

	test("returns neutral for warnings only", () => {
		const findings: Finding[] = [
			{
				tool: "t",
				file: "a.ts",
				line: 1,
				message: "warn",
				severity: "warning",
			},
		];
		expect(determineConclusion(findings)).toBe("neutral");
	});

	test("returns neutral for info only", () => {
		const findings: Finding[] = [
			{ tool: "t", file: "a.ts", line: 1, message: "info", severity: "info" },
		];
		expect(determineConclusion(findings)).toBe("neutral");
	});
});

// ── formatSummary ───────────────────────────────────────────────────────

describe("formatSummary", () => {
	test("formats passed/findings summary", () => {
		expect(formatSummary(18, 2, 0)).toBe("18/20 passed · 2 warnings");
	});

	test("formats with errors", () => {
		expect(formatSummary(15, 3, 2)).toBe(
			"15/20 passed · 2 errors · 3 warnings",
		);
	});

	test("formats clean run", () => {
		expect(formatSummary(20, 0, 0)).toBe("20/20 passed");
	});
});

// ── createCheckRun ──────────────────────────────────────────────────────

describe("createCheckRun", () => {
	test("creates a check run with success conclusion", async () => {
		mockFetch.mockImplementationOnce(() =>
			jsonResponse({ id: 123, html_url: "https://github.com/..." }, 201),
		);

		const result = await createCheckRun({
			token: "test-tok",
			owner: "mainahq",
			repo: "maina",
			headSha: "abc123",
			findings: [],
			totalChecks: 20,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.checkRunId).toBe(123);
			expect(result.value.conclusion).toBe("success");
		}

		const call = mockFetch.mock.calls[0] as unknown[];
		const init = call[1] as RequestInit;
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.conclusion).toBe("success");
		expect(body.name).toBe("Maina verification");
	});

	test("creates a check run with failure conclusion on errors", async () => {
		mockFetch.mockImplementationOnce(() => jsonResponse({ id: 456 }, 201));

		const findings: Finding[] = [
			{
				tool: "biome",
				file: "src/bad.ts",
				line: 10,
				message: "Syntax error",
				severity: "error",
			},
		];

		const result = await createCheckRun({
			token: "test-tok",
			owner: "mainahq",
			repo: "maina",
			headSha: "def456",
			findings,
			totalChecks: 20,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.conclusion).toBe("failure");
		}
	});

	test("returns error on 403 (missing permission)", async () => {
		mockFetch.mockImplementationOnce(() => new Response("", { status: 403 }));

		const result = await createCheckRun({
			token: "test-tok",
			owner: "mainahq",
			repo: "maina",
			headSha: "abc",
			findings: [],
			totalChecks: 0,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("checks:write");
		}
	});

	test("returns error on network failure", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.reject(new Error("Network down")),
		);

		const result = await createCheckRun({
			token: "test-tok",
			owner: "mainahq",
			repo: "maina",
			headSha: "abc",
			findings: [],
			totalChecks: 0,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Network down");
		}
	});

	test("includes details_url when provided", async () => {
		mockFetch.mockImplementationOnce(() => jsonResponse({ id: 789 }, 201));

		await createCheckRun({
			token: "test-tok",
			owner: "mainahq",
			repo: "maina",
			headSha: "abc",
			findings: [],
			totalChecks: 10,
			detailsUrl: "https://mainahq.com/r/run-123",
		});

		const call = mockFetch.mock.calls[0] as unknown[];
		const init = call[1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.details_url).toBe("https://mainahq.com/r/run-123");
	});
});
