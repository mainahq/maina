import { describe, expect, it } from "bun:test";
import { parseSarif, runSemgrep } from "../semgrep";

// ─── parseSarif ────────────────────────────────────────────────────────────

describe("parseSarif", () => {
	it("should return empty array for empty SARIF", () => {
		const sarif = JSON.stringify({
			runs: [{ results: [] }],
		});
		const findings = parseSarif(sarif);
		expect(findings).toEqual([]);
	});

	it("should parse a single finding from SARIF", () => {
		const sarif = JSON.stringify({
			runs: [
				{
					results: [
						{
							ruleId: "javascript.express.security.audit.xss",
							message: { text: "Found potential XSS vulnerability" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "src/api.ts" },
										region: { startLine: 42, startColumn: 10 },
									},
								},
							],
							level: "error",
						},
					],
				},
			],
		});

		const findings = parseSarif(sarif);
		expect(findings.length).toBe(1);
		expect(findings[0]?.tool).toBe("semgrep");
		expect(findings[0]?.file).toBe("src/api.ts");
		expect(findings[0]?.line).toBe(42);
		expect(findings[0]?.column).toBe(10);
		expect(findings[0]?.message).toBe("Found potential XSS vulnerability");
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.ruleId).toBe("javascript.express.security.audit.xss");
	});

	it("should map SARIF levels to severity correctly", () => {
		const makeSarif = (level: string) =>
			JSON.stringify({
				runs: [
					{
						results: [
							{
								ruleId: "rule1",
								message: { text: "msg" },
								locations: [
									{
										physicalLocation: {
											artifactLocation: { uri: "file.ts" },
											region: { startLine: 1 },
										},
									},
								],
								level,
							},
						],
					},
				],
			});

		expect(parseSarif(makeSarif("error"))[0]?.severity).toBe("error");
		expect(parseSarif(makeSarif("warning"))[0]?.severity).toBe("warning");
		expect(parseSarif(makeSarif("note"))[0]?.severity).toBe("info");
		expect(parseSarif(makeSarif("none"))[0]?.severity).toBe("info");
		expect(parseSarif(makeSarif("unknown-level"))[0]?.severity).toBe("warning");
	});

	it("should handle multiple runs with multiple results", () => {
		const sarif = JSON.stringify({
			runs: [
				{
					results: [
						{
							ruleId: "rule-a",
							message: { text: "Issue A" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "a.ts" },
										region: { startLine: 10 },
									},
								},
							],
							level: "warning",
						},
					],
				},
				{
					results: [
						{
							ruleId: "rule-b",
							message: { text: "Issue B" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "b.ts" },
										region: { startLine: 20, startColumn: 5 },
									},
								},
							],
							level: "error",
						},
					],
				},
			],
		});

		const findings = parseSarif(sarif);
		expect(findings.length).toBe(2);
		expect(findings[0]?.file).toBe("a.ts");
		expect(findings[1]?.file).toBe("b.ts");
	});

	it("should handle results with no locations gracefully", () => {
		const sarif = JSON.stringify({
			runs: [
				{
					results: [
						{
							ruleId: "rule-x",
							message: { text: "No location" },
							locations: [],
							level: "warning",
						},
					],
				},
			],
		});

		const findings = parseSarif(sarif);
		expect(findings.length).toBe(1);
		expect(findings[0]?.file).toBe("");
		expect(findings[0]?.line).toBe(0);
	});

	it("should return empty array for invalid JSON", () => {
		const findings = parseSarif("not valid json {{{");
		expect(findings).toEqual([]);
	});

	it("should return empty array for malformed SARIF structure", () => {
		const findings = parseSarif(JSON.stringify({ unexpected: true }));
		expect(findings).toEqual([]);
	});

	it("should handle results with missing region fields", () => {
		const sarif = JSON.stringify({
			runs: [
				{
					results: [
						{
							ruleId: "rule-y",
							message: { text: "Partial location" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "partial.ts" },
									},
								},
							],
							level: "error",
						},
					],
				},
			],
		});

		const findings = parseSarif(sarif);
		expect(findings.length).toBe(1);
		expect(findings[0]?.file).toBe("partial.ts");
		expect(findings[0]?.line).toBe(0);
		expect(findings[0]?.column).toBeUndefined();
	});
});

// ─── runSemgrep ────────────────────────────────────────────────────────────

describe("runSemgrep", () => {
	it("should return skipped when availability is false", async () => {
		const result = await runSemgrep({ available: false });
		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
	});

	it("should return correct result shape", async () => {
		// Use available: false to avoid running the actual tool in tests
		const result = await runSemgrep({ available: false });
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
		expect(Array.isArray(result.findings)).toBe(true);
		expect(typeof result.skipped).toBe("boolean");
	});

	it("should accept options without crashing", async () => {
		const result = await runSemgrep({
			files: ["nonexistent-file.ts"],
			config: "auto",
			cwd: "/tmp",
			available: false,
		});
		// Should not throw
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
	});
});
