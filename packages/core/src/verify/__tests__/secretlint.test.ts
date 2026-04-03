import { describe, expect, it } from "bun:test";
import { parseSecretlintOutput, runSecretlint } from "../secretlint";

// ─── parseSecretlintOutput ─────────────────────────────────────────────────

describe("parseSecretlintOutput", () => {
	it("should return empty array for empty output", () => {
		const findings = parseSecretlintOutput("");
		expect(findings).toEqual([]);
	});

	it("should parse a single secret finding", () => {
		const output = JSON.stringify([
			{
				filePath: "src/config.ts",
				messages: [
					{
						ruleId: "@secretlint/secretlint-rule-preset-recommend",
						message: "Found AWS Access Key ID",
						range: [10, 30],
						loc: {
							start: { line: 5, column: 10 },
							end: { line: 5, column: 30 },
						},
						severity: 2,
					},
				],
			},
		]);

		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(1);
		expect(findings[0]?.tool).toBe("secretlint");
		expect(findings[0]?.file).toBe("src/config.ts");
		expect(findings[0]?.line).toBe(5);
		expect(findings[0]?.column).toBe(10);
		expect(findings[0]?.message).toBe("Found AWS Access Key ID");
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.ruleId).toBe(
			"@secretlint/secretlint-rule-preset-recommend",
		);
	});

	it("should map severity levels correctly", () => {
		const makeOutput = (severity: number) =>
			JSON.stringify([
				{
					filePath: "file.ts",
					messages: [
						{
							ruleId: "rule",
							message: "msg",
							loc: {
								start: { line: 1, column: 0 },
								end: { line: 1, column: 10 },
							},
							severity,
						},
					],
				},
			]);

		// severity 2 = error, 1 = warning, 0 = info
		expect(parseSecretlintOutput(makeOutput(2))[0]?.severity).toBe("error");
		expect(parseSecretlintOutput(makeOutput(1))[0]?.severity).toBe("warning");
		expect(parseSecretlintOutput(makeOutput(0))[0]?.severity).toBe("info");
	});

	it("should handle multiple files with multiple messages", () => {
		const output = JSON.stringify([
			{
				filePath: "a.ts",
				messages: [
					{
						ruleId: "rule-a",
						message: "Secret A",
						loc: {
							start: { line: 1, column: 0 },
							end: { line: 1, column: 10 },
						},
						severity: 2,
					},
					{
						ruleId: "rule-b",
						message: "Secret B",
						loc: {
							start: { line: 5, column: 3 },
							end: { line: 5, column: 20 },
						},
						severity: 1,
					},
				],
			},
			{
				filePath: "b.ts",
				messages: [
					{
						ruleId: "rule-c",
						message: "Secret C",
						loc: {
							start: { line: 10, column: 0 },
							end: { line: 10, column: 30 },
						},
						severity: 2,
					},
				],
			},
		]);

		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(3);
		expect(findings[0]?.file).toBe("a.ts");
		expect(findings[1]?.file).toBe("a.ts");
		expect(findings[2]?.file).toBe("b.ts");
	});

	it("should handle files with empty messages array", () => {
		const output = JSON.stringify([
			{
				filePath: "clean.ts",
				messages: [],
			},
		]);
		const findings = parseSecretlintOutput(output);
		expect(findings).toEqual([]);
	});

	it("should return empty array for invalid JSON", () => {
		const findings = parseSecretlintOutput("not valid json {{{");
		expect(findings).toEqual([]);
	});

	it("should return empty array for malformed structure", () => {
		const findings = parseSecretlintOutput(
			JSON.stringify({ unexpected: true }),
		);
		expect(findings).toEqual([]);
	});

	it("should handle messages with missing loc gracefully", () => {
		const output = JSON.stringify([
			{
				filePath: "file.ts",
				messages: [
					{
						ruleId: "rule-x",
						message: "No loc info",
						severity: 2,
					},
				],
			},
		]);
		const findings = parseSecretlintOutput(output);
		expect(findings.length).toBe(1);
		expect(findings[0]?.line).toBe(0);
		expect(findings[0]?.column).toBeUndefined();
	});
});

// ─── runSecretlint ─────────────────────────────────────────────────────────

describe("runSecretlint", () => {
	it("should skip when secretlint is not installed", async () => {
		const result = await runSecretlint();
		if (result.skipped) {
			expect(result.findings).toEqual([]);
			expect(result.skipped).toBe(true);
		} else {
			expect(Array.isArray(result.findings)).toBe(true);
			expect(result.skipped).toBe(false);
		}
	});

	it("should return correct result shape", async () => {
		const result = await runSecretlint();
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
		expect(Array.isArray(result.findings)).toBe(true);
		expect(typeof result.skipped).toBe("boolean");
	});

	it("should accept options without crashing", async () => {
		const result = await runSecretlint({
			files: ["nonexistent-file.ts"],
			cwd: "/tmp",
		});
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
	});
});
