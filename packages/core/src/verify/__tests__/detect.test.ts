import { describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import {
	detectTool,
	detectTools,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolName,
} from "../detect";

// Tests run from the repository; pass it as the explicit root (#290).
const ROOT = process.cwd();

// Only the "real-tool smoke" tests spawn version probes for real. The
// isolated runner runs 8 test files at once and those probes can queue past
// bun's 5s default, so the suite declares an explicit timeout (#434).
// Everything else runs over a scripted ProcessPort.
setDefaultTimeout(30_000);

/** Scripted probes: only biome answers, every other tool is "not installed". */
const onlyBiome = () =>
	createFakeProcess({ "biome --version": { stdout: "Version: 2.3.4" } });

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

// ─── Real-tool smoke (spawns for real) ──────────────────────────────────────

describe("real-tool smoke", () => {
	test("detects biome as available (installed in project)", async () => {
		const result = await detectTool("biome", ROOT);
		expect(result.name).toBe("biome");
		// command may be "biome" (global) or a local node_modules/.bin path
		expect(result.command).toContain("biome");
		expect(result.available).toBe(true);
		expect(typeof result.version).toBe("string");
	});

	test("detectTools probes every registered tool on the real system", async () => {
		const results = await detectTools(ROOT);
		expect(results.map((t) => t.name)).toEqual(
			Object.keys(TOOL_REGISTRY) as ToolName[],
		);
		const biome = results.find((t) => t.name === "biome");
		expect(biome?.available).toBe(true);
		expect(biome?.version).not.toBeNull();
	});
});

// ─── detectTool ─────────────────────────────────────────────────────────────

describe("detectTool", () => {
	test("returns a DetectedTool shape", async () => {
		const result = await detectTool("biome", ROOT, onlyBiome());
		expect(result).toEqual({
			name: "biome",
			command: "biome",
			version: "2.3.4",
			available: true,
		});
	});

	test("detects sonarqube status correctly", async () => {
		const result = await detectTool("sonarqube", ROOT, onlyBiome());
		expect(result.name).toBe("sonarqube");
		expect(result.command).toBe("sonar-scanner");
		expect(result.available).toBe(false);
		expect(result.version).toBeNull();
	});
});

// ─── detectTools ────────────────────────────────────────────────────────────

describe("detectTools", () => {
	test("returns an array of DetectedTool for all registered tools", async () => {
		const results = await detectTools(ROOT, undefined, onlyBiome());
		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBe(Object.keys(TOOL_REGISTRY).length);
	});

	test("each result has the correct shape", async () => {
		const results = await detectTools(ROOT, undefined, onlyBiome());
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
		const results = await detectTools(ROOT, undefined, onlyBiome());
		const biome = results.find((t) => t.name === "biome");
		expect(biome).toBeDefined();
		expect(biome?.available).toBe(true);
		expect(biome?.version).toBe("2.3.4");
	});

	test("detects sonarqube status in detectTools", async () => {
		const results = await detectTools(ROOT, undefined, onlyBiome());
		const sonarqube = results.find((t) => t.name === "sonarqube");
		expect(sonarqube).toBeDefined();
		expect(sonarqube?.available).toBe(false);
	});

	test("detects tools in parallel (all results returned)", async () => {
		const results = await detectTools(ROOT, undefined, onlyBiome());
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
		expect(await isToolAvailable("biome", ROOT, onlyBiome())).toBe(true);
	});

	test("returns false for a tool whose probe fails", async () => {
		expect(await isToolAvailable("sonarqube", ROOT, onlyBiome())).toBe(false);
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
		const results = await detectTools(ROOT, undefined, onlyBiome());
		const installed = results.filter((t) => t.available);
		expect(installed.length).toBeGreaterThan(0);
		const biome = installed.find((t) => t.name === "biome");
		expect(biome).toBeDefined();
		expect(biome?.version).not.toBeNull();
	});

	it("should skip missing tools with info note", async () => {
		const results = await detectTools(ROOT, undefined, onlyBiome());
		const missing = results.filter((t) => !t.available);
		expect(missing.length).toBeGreaterThan(0);
		for (const tool of missing) {
			expect(tool.available).toBe(false);
			expect(tool.version).toBeNull();
		}
	});
});
