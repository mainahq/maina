import { describe, expect, it } from "bun:test";
import { parseZapJson, runZap } from "../zap";

// ─── parseZapJson ─────────────────────────────────────────────────────────

describe("parseZapJson", () => {
	it("should return empty array for empty alerts", () => {
		const json = JSON.stringify({ site: [{ alerts: [] }] });
		const findings = parseZapJson(json);
		expect(findings).toEqual([]);
	});

	it("should parse a single alert from ZAP JSON output", () => {
		const json = JSON.stringify({
			site: [
				{
					alerts: [
						{
							pluginid: "10021",
							alert: "X-Content-Type-Options Header Missing",
							riskdesc: "Low (Medium)",
							desc: "The Anti-MIME-Sniffing header is not set.",
							instances: [
								{
									uri: "https://example.com/api/health",
									method: "GET",
								},
							],
						},
					],
				},
			],
		});

		const findings = parseZapJson(json);
		expect(findings.length).toBe(1);
		expect(findings[0]?.tool).toBe("zap");
		expect(findings[0]?.file).toBe("https://example.com/api/health");
		expect(findings[0]?.line).toBe(0);
		expect(findings[0]?.message).toContain(
			"X-Content-Type-Options Header Missing",
		);
		expect(findings[0]?.severity).toBe("info");
		expect(findings[0]?.ruleId).toBe("10021");
	});

	it("should map ZAP risk levels to severity correctly", () => {
		const makeZap = (riskdesc: string) =>
			JSON.stringify({
				site: [
					{
						alerts: [
							{
								pluginid: "10001",
								alert: "Test Alert",
								riskdesc,
								desc: "Test description",
								instances: [{ uri: "https://example.com", method: "GET" }],
							},
						],
					},
				],
			});

		expect(parseZapJson(makeZap("High (Medium)"))[0]?.severity).toBe("error");
		expect(parseZapJson(makeZap("Medium (Low)"))[0]?.severity).toBe("warning");
		expect(parseZapJson(makeZap("Low (Medium)"))[0]?.severity).toBe("info");
		expect(parseZapJson(makeZap("Informational (Low)"))[0]?.severity).toBe(
			"info",
		);
	});

	it("should handle multiple alerts with multiple instances", () => {
		const json = JSON.stringify({
			site: [
				{
					alerts: [
						{
							pluginid: "10021",
							alert: "Alert A",
							riskdesc: "High (Medium)",
							desc: "Description A",
							instances: [
								{ uri: "https://example.com/a", method: "GET" },
								{ uri: "https://example.com/b", method: "POST" },
							],
						},
						{
							pluginid: "10022",
							alert: "Alert B",
							riskdesc: "Low (Low)",
							desc: "Description B",
							instances: [{ uri: "https://example.com/c", method: "GET" }],
						},
					],
				},
			],
		});

		const findings = parseZapJson(json);
		expect(findings.length).toBe(3);
		expect(findings[0]?.file).toBe("https://example.com/a");
		expect(findings[1]?.file).toBe("https://example.com/b");
		expect(findings[2]?.file).toBe("https://example.com/c");
	});

	it("should handle alerts with no instances", () => {
		const json = JSON.stringify({
			site: [
				{
					alerts: [
						{
							pluginid: "10021",
							alert: "No Instances Alert",
							riskdesc: "Medium (Medium)",
							desc: "No instances",
							instances: [],
						},
					],
				},
			],
		});

		const findings = parseZapJson(json);
		expect(findings.length).toBe(1);
		expect(findings[0]?.file).toBe("");
		expect(findings[0]?.message).toContain("No Instances Alert");
	});

	it("should return empty array for invalid JSON", () => {
		const findings = parseZapJson("not valid json {{{");
		expect(findings).toEqual([]);
	});

	it("should return empty array for malformed structure", () => {
		const findings = parseZapJson(JSON.stringify({ unexpected: true }));
		expect(findings).toEqual([]);
	});

	it("should handle missing site array gracefully", () => {
		const findings = parseZapJson(JSON.stringify({ site: "not-an-array" }));
		expect(findings).toEqual([]);
	});

	it("should handle site entries without alerts", () => {
		const json = JSON.stringify({
			site: [{ name: "example.com" }],
		});
		const findings = parseZapJson(json);
		expect(findings).toEqual([]);
	});
});

// ─── runZap ───────────────────────────────────────────────────────────────

describe("runZap", () => {
	it("should skip when docker is not available", async () => {
		const result = await runZap({
			targetUrl: "https://example.com",
			cwd: "/tmp",
			available: false,
		});
		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
	});

	it("should skip when no targetUrl is provided", async () => {
		const result = await runZap({
			targetUrl: "",
			cwd: "/tmp",
			available: true,
		});
		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
	});

	it("should return correct result shape", async () => {
		const result = await runZap({
			targetUrl: "https://example.com",
			cwd: "/tmp",
			available: false,
		});
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
		expect(Array.isArray(result.findings)).toBe(true);
		expect(typeof result.skipped).toBe("boolean");
	});
});
