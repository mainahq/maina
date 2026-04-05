import { describe, expect, it } from "bun:test";
import { parseLighthouseJson, runLighthouse } from "../lighthouse";

// ─── parseLighthouseJson ──────────────────────────────────────────────────

describe("parseLighthouseJson", () => {
	it("should return empty findings when all scores are above thresholds", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: 0.95 },
				accessibility: { score: 0.92 },
				seo: { score: 0.98 },
			},
		});

		const result = parseLighthouseJson(json);
		expect(result.findings).toEqual([]);
		expect(result.scores).toEqual({
			performance: 95,
			accessibility: 92,
			seo: 98,
		});
	});

	it("should generate findings when scores fall below default thresholds", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: 0.72 },
				accessibility: { score: 0.85 },
				seo: { score: 0.6 },
			},
		});

		const result = parseLighthouseJson(json);
		expect(result.findings.length).toBe(3);

		const perfFinding = result.findings.find((f) =>
			f.message.includes("performance"),
		);
		expect(perfFinding?.tool).toBe("lighthouse");
		expect(perfFinding?.severity).toBe("warning");
		expect(perfFinding?.message).toContain("72");
		expect(perfFinding?.message).toContain("90");

		const a11yFinding = result.findings.find((f) =>
			f.message.includes("accessibility"),
		);
		expect(a11yFinding?.severity).toBe("warning");

		const seoFinding = result.findings.find((f) => f.message.includes("seo"));
		expect(seoFinding?.severity).toBe("warning");
	});

	it("should use custom thresholds when provided", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: 0.72 },
				accessibility: { score: 0.85 },
				seo: { score: 0.6 },
			},
		});

		const result = parseLighthouseJson(json, {
			performance: 70,
			accessibility: 80,
			seo: 50,
		});

		// All scores are above custom thresholds
		expect(result.findings).toEqual([]);
	});

	it("should generate error severity for very low scores", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: 0.3 },
				accessibility: { score: 0.4 },
				seo: { score: 0.25 },
			},
		});

		const result = parseLighthouseJson(json);
		for (const finding of result.findings) {
			expect(finding.severity).toBe("error");
		}
	});

	it("should handle missing categories gracefully", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: 0.95 },
			},
		});

		const result = parseLighthouseJson(json);
		expect(result.findings).toEqual([]);
		expect(result.scores).toEqual({ performance: 95 });
	});

	it("should return empty findings for invalid JSON", () => {
		const result = parseLighthouseJson("not valid json {{{");
		expect(result.findings).toEqual([]);
		expect(result.scores).toEqual({});
	});

	it("should return empty findings for malformed structure", () => {
		const result = parseLighthouseJson(JSON.stringify({ unexpected: true }));
		expect(result.findings).toEqual([]);
		expect(result.scores).toEqual({});
	});

	it("should handle categories with null scores", () => {
		const json = JSON.stringify({
			categories: {
				performance: { score: null },
				accessibility: { score: 0.95 },
			},
		});

		const result = parseLighthouseJson(json);
		expect(result.scores).toEqual({ accessibility: 95 });
	});

	it("should include the URL in findings when provided", () => {
		const json = JSON.stringify({
			requestedUrl: "https://example.com",
			categories: {
				performance: { score: 0.5 },
			},
		});

		const result = parseLighthouseJson(json);
		expect(result.findings.length).toBe(1);
		expect(result.findings[0]?.file).toBe("https://example.com");
	});

	it("should handle best-practices category", () => {
		const json = JSON.stringify({
			categories: {
				"best-practices": { score: 0.7 },
			},
		});

		const result = parseLighthouseJson(json);
		// best-practices is not in default thresholds, so no findings
		expect(result.findings).toEqual([]);
		expect(result.scores).toEqual({ "best-practices": 70 });
	});

	it("should generate findings for best-practices when threshold set", () => {
		const json = JSON.stringify({
			categories: {
				"best-practices": { score: 0.7 },
			},
		});

		const result = parseLighthouseJson(json, {
			"best-practices": 90,
		});
		expect(result.findings.length).toBe(1);
		expect(result.findings[0]?.message).toContain("best-practices");
	});
});

// ─── runLighthouse ────────────────────────────────────────────────────────

describe("runLighthouse", () => {
	it("should skip when lighthouse is not available", async () => {
		const result = await runLighthouse({
			url: "https://example.com",
			cwd: "/tmp",
			available: false,
		});
		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
		expect(result.scores).toEqual({});
	});

	it("should skip when no URL is provided", async () => {
		const result = await runLighthouse({
			url: "",
			cwd: "/tmp",
			available: true,
		});
		expect(result.findings).toEqual([]);
		expect(result.skipped).toBe(true);
		expect(result.scores).toEqual({});
	});

	it("should return correct result shape", async () => {
		const result = await runLighthouse({
			url: "https://example.com",
			cwd: "/tmp",
			available: false,
		});
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
		expect(result).toHaveProperty("scores");
		expect(Array.isArray(result.findings)).toBe(true);
		expect(typeof result.skipped).toBe("boolean");
		expect(typeof result.scores).toBe("object");
	});

	it("should accept custom thresholds without crashing", async () => {
		const result = await runLighthouse({
			url: "https://example.com",
			cwd: "/tmp",
			available: false,
			thresholds: { performance: 80, accessibility: 85 },
		});
		expect(result).toHaveProperty("findings");
		expect(result).toHaveProperty("skipped");
		expect(result).toHaveProperty("scores");
	});
});
