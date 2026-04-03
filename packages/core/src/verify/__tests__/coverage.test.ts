import { describe, expect, it } from "bun:test";
import { parseDiffCoverJson, runCoverage } from "../coverage";

describe("diff-cover Coverage Integration", () => {
	describe("parseDiffCoverJson", () => {
		it("should parse diff-cover JSON into findings", () => {
			const json = JSON.stringify({
				report_name: "Diff Coverage",
				diff_name: "master...HEAD",
				src_stats: {
					"src/app.ts": {
						covered_lines: [10, 11, 12],
						violation_lines: [15, 16],
						percent_covered: 60.0,
					},
					"src/utils.ts": {
						covered_lines: [1, 2, 3, 4, 5],
						violation_lines: [],
						percent_covered: 100.0,
					},
				},
				total_num_lines: 10,
				total_num_violations: 2,
				total_percent_covered: 80.0,
			});

			const findings = parseDiffCoverJson(json);

			// Only files with violations should produce findings
			expect(findings).toHaveLength(2);
			expect(findings[0]?.tool).toBe("diff-cover");
			expect(findings[0]?.file).toBe("src/app.ts");
			expect(findings[0]?.line).toBe(15);
			expect(findings[0]?.severity).toBe("warning");
			expect(findings[0]?.ruleId).toBe("diff-cover/uncovered-line");
			expect(findings[1]?.line).toBe(16);
		});

		it("should handle empty src_stats", () => {
			const json = JSON.stringify({ src_stats: {} });
			expect(parseDiffCoverJson(json)).toHaveLength(0);
		});

		it("should handle malformed JSON", () => {
			expect(parseDiffCoverJson("not json")).toHaveLength(0);
		});

		it("should handle files with no violations", () => {
			const json = JSON.stringify({
				src_stats: {
					"src/clean.ts": {
						covered_lines: [1, 2, 3],
						violation_lines: [],
						percent_covered: 100.0,
					},
				},
			});
			expect(parseDiffCoverJson(json)).toHaveLength(0);
		});

		it("should include coverage percentage in message", () => {
			const json = JSON.stringify({
				src_stats: {
					"src/app.ts": {
						covered_lines: [1],
						violation_lines: [2],
						percent_covered: 50.0,
					},
				},
			});
			const findings = parseDiffCoverJson(json);
			expect(findings[0]?.message).toContain("50%");
		});
	});

	describe("runCoverage", () => {
		it("should skip when diff-cover is not available", async () => {
			const result = await runCoverage({ available: false });
			expect(result.skipped).toBe(true);
			expect(result.findings).toHaveLength(0);
		});
	});
});
