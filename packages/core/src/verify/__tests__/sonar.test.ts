import { describe, expect, it } from "bun:test";
import { parseSonarReport, runSonar } from "../sonar";

describe("SonarQube Integration", () => {
	describe("parseSonarReport", () => {
		it("should parse SonarQube JSON issues into findings", () => {
			const json = JSON.stringify({
				issues: [
					{
						rule: "typescript:S1854",
						severity: "MAJOR",
						component: "src/app.ts",
						line: 42,
						message: 'Remove this useless assignment to local variable "x".',
					},
					{
						rule: "typescript:S3776",
						severity: "CRITICAL",
						component: "src/utils.ts",
						line: 10,
						message:
							"Refactor this function to reduce its Cognitive Complexity.",
					},
				],
			});

			const findings = parseSonarReport(json);

			expect(findings).toHaveLength(2);
			expect(findings[0]?.tool).toBe("sonarqube");
			expect(findings[0]?.file).toBe("src/app.ts");
			expect(findings[0]?.line).toBe(42);
			expect(findings[0]?.severity).toBe("warning");
			expect(findings[0]?.ruleId).toBe("typescript:S1854");
			expect(findings[1]?.severity).toBe("error");
		});

		it("should handle empty issues array", () => {
			const json = JSON.stringify({ issues: [] });
			expect(parseSonarReport(json)).toHaveLength(0);
		});

		it("should handle malformed JSON", () => {
			expect(parseSonarReport("not json")).toHaveLength(0);
		});

		it("should handle missing fields gracefully", () => {
			const json = JSON.stringify({
				issues: [{ rule: "test:rule" }],
			});
			const findings = parseSonarReport(json);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.file).toBe("");
			expect(findings[0]?.line).toBe(0);
		});

		it("should map SonarQube severities correctly", () => {
			const json = JSON.stringify({
				issues: [
					{
						rule: "r1",
						severity: "BLOCKER",
						component: "a.ts",
						line: 1,
						message: "blocker",
					},
					{
						rule: "r2",
						severity: "CRITICAL",
						component: "a.ts",
						line: 2,
						message: "critical",
					},
					{
						rule: "r3",
						severity: "MAJOR",
						component: "a.ts",
						line: 3,
						message: "major",
					},
					{
						rule: "r4",
						severity: "MINOR",
						component: "a.ts",
						line: 4,
						message: "minor",
					},
					{
						rule: "r5",
						severity: "INFO",
						component: "a.ts",
						line: 5,
						message: "info",
					},
				],
			});
			const findings = parseSonarReport(json);
			expect(findings[0]?.severity).toBe("error"); // BLOCKER
			expect(findings[1]?.severity).toBe("error"); // CRITICAL
			expect(findings[2]?.severity).toBe("warning"); // MAJOR
			expect(findings[3]?.severity).toBe("warning"); // MINOR
			expect(findings[4]?.severity).toBe("info"); // INFO
		});
	});

	describe("runSonar", () => {
		it("should skip when sonarqube is not available", async () => {
			const result = await runSonar({ available: false });
			expect(result.skipped).toBe(true);
			expect(result.findings).toHaveLength(0);
		});
	});
});
