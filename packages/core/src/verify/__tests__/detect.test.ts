import { describe, expect, it, setDefaultTimeout, test } from "bun:test";
import {
	detectTool,
	detectTools,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolName,
} from "../detect";

// Tests run from the repository; pass it as the explicit root (#290).
const ROOT = process.cwd();

// detectTools spawns every registered tool's version probe for real. The
// isolated runner runs 8 test files at once, and when this file shares a
// batch with the other detect suite the probes queue past bun's 5s default.
setDefaultTimeout(30_000);

// ─── Type checks ────────────────────────────────────────────────────────────

describe("detect types", () => {
	test("TOOL_REGISTRY has all expected tools", () => {
		const expectedTools: ToolName[] = [
			"biome",
			"semgrep",
			"trivy",
			"secretlint",
			"sonarqube",
			"stryker",
		];
		for (const tool of expectedTools) {
			expect(TOOL_REGISTRY[tool]).toBeDefined();
			expect(typeof TOOL_REGISTRY[tool].command).toBe("string");
			expect(typeof TOOL_REGISTRY[tool].versionFlag).toBe("string");
		}
	});

	test("TOOL_REGISTRY maps sonarqube to sonar-scanner command", () => {
		expect(TOOL_REGISTRY.sonarqube.command).toBe("sonar-scanner");
	});
});

// ─── detectTool ─────────────────────────────────────────────────────────────

describe("detectTool", () => {
	test("returns a DetectedTool shape", async () => {
		const result = await detectTool("biome", ROOT);
		expect(result).toHaveProperty("name");
		expect(result).toHaveProperty("command");
		expect(result).toHaveProperty("version");
		expect(result).toHaveProperty("available");
		expect(typeof result.name).toBe("string");
		expect(typeof result.command).toBe("string");
		expect(typeof result.available).toBe("boolean");
	});

	test("detects biome as available (installed in project)", async () => {
		const result = await detectTool("biome", ROOT);
		expect(result.name).toBe("biome");
		// command may be "biome" (global) or a local node_modules/.bin path
		expect(result.command).toContain("biome");
		expect(result.available).toBe(true);
		expect(result.version).not.toBeNull();
		expect(typeof result.version).toBe("string");
	});

	test("detects sonarqube status correctly", async () => {
		const result = await detectTool("sonarqube", ROOT);
		expect(result.name).toBe("sonarqube");
		expect(result.command).toBe("sonar-scanner");
		// sonarqube may or may not be installed — just verify shape
		expect(typeof result.available).toBe("boolean");
	});
});

// ─── detectTools ────────────────────────────────────────────────────────────

describe("detectTools", () => {
	test("returns an array of DetectedTool for all registered tools", async () => {
		const results = await detectTools(ROOT);
		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBe(Object.keys(TOOL_REGISTRY).length);
	});

	test("each result has the correct shape", async () => {
		const results = await detectTools(ROOT);
		for (const tool of results) {
			expect(typeof tool.name).toBe("string");
			expect(typeof tool.command).toBe("string");
			expect(typeof tool.available).toBe("boolean");
			// version is string or null
			if (tool.available) {
				expect(typeof tool.version).toBe("string");
			} else {
				expect(tool.version).toBeNull();
			}
		}
	});

	test("should auto-detect installed tools", async () => {
		const results = await detectTools(ROOT);
		const biome = results.find((t) => t.name === "biome");
		expect(biome).toBeDefined();
		expect(biome?.available).toBe(true);
		expect(biome?.version).not.toBeNull();
	});

	test("detects sonarqube status in detectTools", async () => {
		const results = await detectTools(ROOT);
		const sonarqube = results.find((t) => t.name === "sonarqube");
		expect(sonarqube).toBeDefined();
		expect(typeof sonarqube?.available).toBe("boolean");
	});

	test("detects tools in parallel (all results returned)", async () => {
		const results = await detectTools(ROOT);
		const names = results.map((t) => t.name);
		expect(names).toContain("biome");
		expect(names).toContain("semgrep");
		expect(names).toContain("trivy");
		expect(names).toContain("secretlint");
		expect(names).toContain("sonarqube");
		expect(names).toContain("stryker");
	});
});

// ─── isToolAvailable ────────────────────────────────────────────────────────

describe("isToolAvailable", () => {
	test("returns true for biome", async () => {
		const available = await isToolAvailable("biome", ROOT);
		expect(available).toBe(true);
	});

	test("returns boolean for sonarqube", async () => {
		const available = await isToolAvailable("sonarqube", ROOT);
		expect(typeof available).toBe("boolean");
	});
});

// ─── Language-specific linter tools ─────────────────────────────────────────

describe("language-specific linter tools", () => {
	it("should have ruff in tool registry", () => {
		expect(TOOL_REGISTRY.ruff).toBeDefined();
		expect(TOOL_REGISTRY.ruff.command).toBe("ruff");
	});

	it("should have golangci-lint in tool registry", () => {
		expect(TOOL_REGISTRY["golangci-lint"]).toBeDefined();
	});

	it("should have cargo-clippy in tool registry", () => {
		expect(TOOL_REGISTRY["cargo-clippy"]).toBeDefined();
	});

	it("should have cargo-audit in tool registry", () => {
		expect(TOOL_REGISTRY["cargo-audit"]).toBeDefined();
	});
});

// ─── VerifyPipeline (TDD contract from Sprint 3) ───────────────────────────

describe("VerifyPipeline", () => {
	it("should auto-detect installed tools", async () => {
		const results = await detectTools(ROOT);
		const installed = results.filter((t) => t.available);
		expect(installed.length).toBeGreaterThan(0);
		// biome is always installed in this project
		const biome = installed.find((t) => t.name === "biome");
		expect(biome).toBeDefined();
		expect(biome?.version).not.toBeNull();
	});

	it("should skip missing tools with info note", async () => {
		const results = await detectTools(ROOT);
		const missing = results.filter((t) => !t.available);
		expect(missing.length).toBeGreaterThan(0);
		for (const tool of missing) {
			expect(tool.available).toBe(false);
			expect(tool.version).toBeNull();
		}
	});
});
