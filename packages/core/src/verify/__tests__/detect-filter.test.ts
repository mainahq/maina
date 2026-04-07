import { describe, expect, test } from "bun:test";
import { detectTools, getToolsForLanguages, TOOL_REGISTRY } from "../detect";

// ─── TOOL_REGISTRY metadata ────────────────────────────────────────────────

describe("TOOL_REGISTRY metadata", () => {
	test("every tool entry has a languages array", () => {
		for (const [_name, entry] of Object.entries(TOOL_REGISTRY)) {
			expect(entry.languages).toBeDefined();
			expect(Array.isArray(entry.languages)).toBe(true);
			expect(entry.languages.length).toBeGreaterThan(0);
		}
	});

	test("every tool entry has a tier field", () => {
		for (const [_name, entry] of Object.entries(TOOL_REGISTRY)) {
			expect(entry.tier).toBeDefined();
			expect(["essential", "recommended", "optional"]).toContain(entry.tier);
		}
	});

	test("biome is essential for typescript/javascript", () => {
		expect(TOOL_REGISTRY.biome.languages).toContain("typescript");
		expect(TOOL_REGISTRY.biome.languages).toContain("javascript");
		expect(TOOL_REGISTRY.biome.tier).toBe("essential");
	});

	test("semgrep is universal and recommended", () => {
		expect(TOOL_REGISTRY.semgrep.languages).toContain("*");
		expect(TOOL_REGISTRY.semgrep.tier).toBe("recommended");
	});

	test("trivy is universal and recommended", () => {
		expect(TOOL_REGISTRY.trivy.languages).toContain("*");
		expect(TOOL_REGISTRY.trivy.tier).toBe("recommended");
	});

	test("secretlint is universal and recommended", () => {
		expect(TOOL_REGISTRY.secretlint.languages).toContain("*");
		expect(TOOL_REGISTRY.secretlint.tier).toBe("recommended");
	});

	test("ruff is essential for python", () => {
		expect(TOOL_REGISTRY.ruff.languages).toContain("python");
		expect(TOOL_REGISTRY.ruff.tier).toBe("essential");
	});

	test("golangci-lint is essential for go", () => {
		expect(TOOL_REGISTRY["golangci-lint"].languages).toContain("go");
		expect(TOOL_REGISTRY["golangci-lint"].tier).toBe("essential");
	});

	test("cargo-clippy is essential for rust", () => {
		expect(TOOL_REGISTRY["cargo-clippy"].languages).toContain("rust");
		expect(TOOL_REGISTRY["cargo-clippy"].tier).toBe("essential");
	});

	test("cargo-audit is recommended for rust", () => {
		expect(TOOL_REGISTRY["cargo-audit"].languages).toContain("rust");
		expect(TOOL_REGISTRY["cargo-audit"].tier).toBe("recommended");
	});

	test("checkstyle is essential for java", () => {
		expect(TOOL_REGISTRY.checkstyle.languages).toContain("java");
		expect(TOOL_REGISTRY.checkstyle.tier).toBe("essential");
	});

	test("spotbugs is recommended for java", () => {
		expect(TOOL_REGISTRY.spotbugs.languages).toContain("java");
		expect(TOOL_REGISTRY.spotbugs.tier).toBe("recommended");
	});

	test("pmd is recommended for java", () => {
		expect(TOOL_REGISTRY.pmd.languages).toContain("java");
		expect(TOOL_REGISTRY.pmd.tier).toBe("recommended");
	});

	test("dotnet-format is essential for dotnet", () => {
		expect(TOOL_REGISTRY["dotnet-format"].languages).toContain("dotnet");
		expect(TOOL_REGISTRY["dotnet-format"].tier).toBe("essential");
	});

	test("stryker is optional for typescript/javascript", () => {
		expect(TOOL_REGISTRY.stryker.languages).toContain("typescript");
		expect(TOOL_REGISTRY.stryker.languages).toContain("javascript");
		expect(TOOL_REGISTRY.stryker.tier).toBe("optional");
	});

	test("playwright is optional for typescript/javascript", () => {
		expect(TOOL_REGISTRY.playwright.languages).toContain("typescript");
		expect(TOOL_REGISTRY.playwright.languages).toContain("javascript");
		expect(TOOL_REGISTRY.playwright.tier).toBe("optional");
	});

	test("lighthouse is optional for typescript/javascript", () => {
		expect(TOOL_REGISTRY.lighthouse.languages).toContain("typescript");
		expect(TOOL_REGISTRY.lighthouse.languages).toContain("javascript");
		expect(TOOL_REGISTRY.lighthouse.tier).toBe("optional");
	});

	test("sonarqube is universal and optional", () => {
		expect(TOOL_REGISTRY.sonarqube.languages).toContain("*");
		expect(TOOL_REGISTRY.sonarqube.tier).toBe("optional");
	});

	test("diff-cover is universal and optional", () => {
		expect(TOOL_REGISTRY["diff-cover"].languages).toContain("*");
		expect(TOOL_REGISTRY["diff-cover"].tier).toBe("optional");
	});

	test("zap is universal and optional", () => {
		expect(TOOL_REGISTRY.zap.languages).toContain("*");
		expect(TOOL_REGISTRY.zap.tier).toBe("optional");
	});
});

// ─── getToolsForLanguages ──────────────────────────────────────────────────

describe("getToolsForLanguages", () => {
	test("returns only typescript-relevant tools for ['typescript']", () => {
		const tools = getToolsForLanguages(["typescript"]);
		const names = tools.map((t) => t.name);

		// Must include TS-specific tools
		expect(names).toContain("biome");
		expect(names).toContain("stryker");
		expect(names).toContain("playwright");
		expect(names).toContain("lighthouse");

		// Must include universal tools
		expect(names).toContain("semgrep");
		expect(names).toContain("trivy");
		expect(names).toContain("secretlint");
		expect(names).toContain("sonarqube");
		expect(names).toContain("diff-cover");
		expect(names).toContain("zap");

		// Must NOT include language-specific tools for other languages
		expect(names).not.toContain("ruff");
		expect(names).not.toContain("golangci-lint");
		expect(names).not.toContain("cargo-clippy");
		expect(names).not.toContain("cargo-audit");
		expect(names).not.toContain("checkstyle");
		expect(names).not.toContain("spotbugs");
		expect(names).not.toContain("pmd");
		expect(names).not.toContain("dotnet-format");
	});

	test("returns only python-relevant tools for ['python']", () => {
		const tools = getToolsForLanguages(["python"]);
		const names = tools.map((t) => t.name);

		expect(names).toContain("ruff");
		expect(names).toContain("semgrep"); // universal
		expect(names).toContain("trivy"); // universal

		expect(names).not.toContain("biome");
		expect(names).not.toContain("golangci-lint");
		expect(names).not.toContain("cargo-clippy");
	});

	test("returns only go-relevant tools for ['go']", () => {
		const tools = getToolsForLanguages(["go"]);
		const names = tools.map((t) => t.name);

		expect(names).toContain("golangci-lint");
		expect(names).toContain("semgrep"); // universal

		expect(names).not.toContain("biome");
		expect(names).not.toContain("ruff");
	});

	test("returns only rust-relevant tools for ['rust']", () => {
		const tools = getToolsForLanguages(["rust"]);
		const names = tools.map((t) => t.name);

		expect(names).toContain("cargo-clippy");
		expect(names).toContain("cargo-audit");
		expect(names).toContain("semgrep"); // universal

		expect(names).not.toContain("biome");
		expect(names).not.toContain("ruff");
	});

	test("returns only java-relevant tools for ['java']", () => {
		const tools = getToolsForLanguages(["java"]);
		const names = tools.map((t) => t.name);

		expect(names).toContain("checkstyle");
		expect(names).toContain("spotbugs");
		expect(names).toContain("pmd");
		expect(names).toContain("semgrep"); // universal

		expect(names).not.toContain("biome");
		expect(names).not.toContain("ruff");
	});

	test("returns only dotnet-relevant tools for ['dotnet']", () => {
		const tools = getToolsForLanguages(["dotnet"]);
		const names = tools.map((t) => t.name);

		expect(names).toContain("dotnet-format");
		expect(names).toContain("semgrep"); // universal

		expect(names).not.toContain("biome");
		expect(names).not.toContain("ruff");
	});

	test("multi-language returns union of tools", () => {
		const tools = getToolsForLanguages(["typescript", "python"]);
		const names = tools.map((t) => t.name);

		// TS tools
		expect(names).toContain("biome");
		expect(names).toContain("stryker");
		// Python tools
		expect(names).toContain("ruff");
		// Universal
		expect(names).toContain("semgrep");

		// Not Go/Rust/Java/Dotnet
		expect(names).not.toContain("golangci-lint");
		expect(names).not.toContain("cargo-clippy");
	});

	test("['unknown'] returns all tools (no filtering)", () => {
		const allTools = getToolsForLanguages(["unknown"]);
		const allNames: string[] = allTools.map((t) => t.name);
		const registryNames = Object.keys(TOOL_REGISTRY);

		expect(allNames.length).toBe(registryNames.length);
		for (const name of registryNames) {
			expect(allNames).toContain(name);
		}
	});

	test("returns ToolRegistryEntry objects with name, languages, tier", () => {
		const tools = getToolsForLanguages(["typescript"]);
		for (const tool of tools) {
			expect(tool.name).toBeDefined();
			expect(tool.command).toBeDefined();
			expect(tool.versionFlag).toBeDefined();
			expect(tool.languages).toBeDefined();
			expect(tool.tier).toBeDefined();
		}
	});

	test("no duplicate tools when languages overlap in universal", () => {
		const tools = getToolsForLanguages(["typescript", "python", "go"]);
		const names = tools.map((t) => t.name);
		const unique = [...new Set(names)];
		expect(names.length).toBe(unique.length);
	});
});

// ─── detectTools with language filter ──────────────────────────────────────

describe("detectTools with language filter", () => {
	test("without languages parameter returns all tools (backward compatible)", async () => {
		const results = await detectTools();
		expect(results.length).toBe(Object.keys(TOOL_REGISTRY).length);
	});

	test("with ['typescript'] only detects relevant tools", async () => {
		const results = await detectTools(["typescript"]);
		const names = results.map((t) => t.name);

		// Should include TS and universal tools
		expect(names).toContain("biome");
		expect(names).toContain("semgrep");

		// Should NOT include Python/Go/Rust/Java/Dotnet-specific tools
		expect(names).not.toContain("ruff");
		expect(names).not.toContain("golangci-lint");
		expect(names).not.toContain("cargo-clippy");
		expect(names).not.toContain("checkstyle");
		expect(names).not.toContain("dotnet-format");
	});

	test("with ['python'] only detects relevant tools", async () => {
		const results = await detectTools(["python"]);
		const names = results.map((t) => t.name);

		expect(names).toContain("ruff");
		expect(names).toContain("semgrep");
		expect(names).not.toContain("biome");
		expect(names).not.toContain("golangci-lint");
	});

	test("with ['unknown'] detects all tools", async () => {
		const results = await detectTools(["unknown"]);
		expect(results.length).toBe(Object.keys(TOOL_REGISTRY).length);
	});

	test("each filtered result has correct DetectedTool shape", async () => {
		const results = await detectTools(["go"]);
		for (const tool of results) {
			expect(typeof tool.name).toBe("string");
			expect(typeof tool.command).toBe("string");
			expect(typeof tool.available).toBe("boolean");
		}
	});
});
