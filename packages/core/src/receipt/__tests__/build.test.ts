import { describe, expect, test } from "bun:test";
import type { PipelineResult } from "../../verify/pipeline";
import { buildReceipt } from "../build";
import { renderReceiptHtml } from "../render";
import { verifyReceipt } from "../verify";

function stubPipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
	return {
		passed: true,
		syntaxPassed: true,
		tools: [
			{
				tool: "builtin",
				findings: [],
				skipped: false,
				duration: 100,
			},
			{
				tool: "slop",
				findings: [],
				skipped: false,
				duration: 50,
			},
			{
				tool: "typecheck",
				findings: [],
				skipped: false,
				duration: 200,
			},
		],
		findings: [],
		hiddenCount: 0,
		detectedTools: [],
		duration: 350,
		cacheHits: 0,
		cacheMisses: 0,
		...overrides,
	};
}

describe("buildReceipt", () => {
	test("maps pipeline tools into v1 Check shape", async () => {
		const result = await buildReceipt({
			prTitle: "test PR",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// builtin → biome, slop → slop; typecheck dropped (not in v1 enum)
		expect(result.data.checks).toHaveLength(2);
		expect(result.data.checks.map((c) => c.tool).sort()).toEqual([
			"biome",
			"slop",
		]);
	});

	test("produces a receipt that round-trips through verifyReceipt", async () => {
		const result = await buildReceipt({
			prTitle: "round-trip PR",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const verified = verifyReceipt(result.data);
		expect(verified.ok).toBe(true);
	});

	test("retries cap forces partial status (C3)", async () => {
		const result = await buildReceipt({
			prTitle: "capped PR",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
			retries: 3,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.status).toBe("partial");
		expect(result.data.retries).toBe(3);
	});

	test("failed tool findings mark the check failed", async () => {
		const pipeline = stubPipeline({
			passed: false,
			tools: [
				{
					tool: "semgrep",
					findings: [
						{
							tool: "semgrep",
							file: "src/a.ts",
							line: 10,
							message: "dangerous pattern",
							severity: "error",
						},
					],
					skipped: false,
					duration: 100,
				},
			],
		});
		const result = await buildReceipt({
			prTitle: "failing PR",
			pipeline,
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.checks[0]?.status).toBe("failed");
		expect(result.data.status).toBe("failed");
	});

	test("skipped tools produce a skipped check", async () => {
		const pipeline = stubPipeline({
			tools: [
				{
					tool: "stryker",
					findings: [],
					skipped: true,
					duration: 0,
				},
			],
		});
		const result = await buildReceipt({
			prTitle: "skipped PR",
			pipeline,
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.checks[0]?.status).toBe("skipped");
	});
});

describe("renderReceiptHtml", () => {
	test("renders valid HTML that contains the affirmative framing", async () => {
		const result = await buildReceipt({
			prTitle: "render PR",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		if (!result.ok) throw new Error("build failed");
		const html = renderReceiptHtml(result.data);

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("render PR");
		expect(html).toMatch(/passed \d+ of \d+ checks/);
		// C2 — never "0 findings" / "no issues" framing
		expect(html).not.toMatch(/\b(0 findings?|no issues? found)\b/);
	});

	test("escapes user-controlled strings", async () => {
		const result = await buildReceipt({
			prTitle: "<script>alert('xss')</script>",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		});
		if (!result.ok) throw new Error("build failed");
		const html = renderReceiptHtml(result.data);
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});

	test("shows a retry badge when retries > 0", async () => {
		const result = await buildReceipt({
			prTitle: "retried PR",
			pipeline: stubPipeline(),
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
			retries: 2,
		});
		if (!result.ok) throw new Error("build failed");
		const html = renderReceiptHtml(result.data);
		expect(html).toContain("retried 2 times");
	});
});
