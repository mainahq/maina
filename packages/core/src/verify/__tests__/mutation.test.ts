import { describe, expect, it } from "bun:test";
import { parseStrykerReport, runMutation } from "../mutation";

describe("Stryker Mutation Testing", () => {
	describe("parseStrykerReport", () => {
		it("should parse survived mutants into findings", () => {
			const json = JSON.stringify({
				files: {
					"src/app.ts": {
						mutants: [
							{
								id: "1",
								mutatorName: "ConditionalExpression",
								replacement: "false",
								status: "Survived",
								location: {
									start: { line: 10, column: 5 },
									end: { line: 10, column: 20 },
								},
								description: "Replaced x > 0 with false",
							},
							{
								id: "2",
								mutatorName: "ArithmeticOperator",
								replacement: "-",
								status: "Killed",
								location: {
									start: { line: 15, column: 3 },
									end: { line: 15, column: 10 },
								},
								description: "Replaced + with -",
							},
							{
								id: "3",
								mutatorName: "StringLiteral",
								replacement: '""',
								status: "Survived",
								location: {
									start: { line: 20, column: 1 },
									end: { line: 20, column: 15 },
								},
								description: 'Replaced "hello" with ""',
							},
						],
					},
				},
			});

			const findings = parseStrykerReport(json);

			// Only survived mutants should become findings
			expect(findings).toHaveLength(2);
			expect(findings[0]?.tool).toBe("stryker");
			expect(findings[0]?.file).toBe("src/app.ts");
			expect(findings[0]?.line).toBe(10);
			expect(findings[0]?.severity).toBe("warning");
			expect(findings[0]?.ruleId).toBe("stryker/ConditionalExpression");
			expect(findings[0]?.message).toContain("Survived");
			expect(findings[1]?.line).toBe(20);
		});

		it("should handle empty files object", () => {
			const json = JSON.stringify({ files: {} });
			expect(parseStrykerReport(json)).toHaveLength(0);
		});

		it("should handle malformed JSON", () => {
			expect(parseStrykerReport("not json")).toHaveLength(0);
		});

		it("should handle missing location gracefully", () => {
			const json = JSON.stringify({
				files: {
					"src/app.ts": {
						mutants: [
							{
								id: "1",
								mutatorName: "Test",
								status: "Survived",
								description: "some mutation",
							},
						],
					},
				},
			});
			const findings = parseStrykerReport(json);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.line).toBe(0);
		});

		it("should ignore killed, no coverage, and timeout mutants", () => {
			const json = JSON.stringify({
				files: {
					"src/app.ts": {
						mutants: [
							{
								id: "1",
								mutatorName: "A",
								status: "Killed",
								location: { start: { line: 1 } },
								description: "x",
							},
							{
								id: "2",
								mutatorName: "B",
								status: "NoCoverage",
								location: { start: { line: 2 } },
								description: "x",
							},
							{
								id: "3",
								mutatorName: "C",
								status: "Timeout",
								location: { start: { line: 3 } },
								description: "x",
							},
							{
								id: "4",
								mutatorName: "D",
								status: "Survived",
								location: { start: { line: 4 } },
								description: "x",
							},
						],
					},
				},
			});
			const findings = parseStrykerReport(json);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.line).toBe(4);
		});
	});

	describe("runMutation", () => {
		it("should skip when stryker is not available", async () => {
			const result = await runMutation({ available: false });
			expect(result.skipped).toBe(true);
			expect(result.findings).toHaveLength(0);
		});
	});
});
