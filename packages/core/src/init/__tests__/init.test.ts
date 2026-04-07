import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../index";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("bootstrap", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates .maina/ directory", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(existsSync(join(tmpDir, ".maina"))).toBe(true);
			expect(result.value.directory).toBe(join(tmpDir, ".maina"));
		}
	});

	test("creates constitution.md with template", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const constitutionPath = join(tmpDir, ".maina", "constitution.md");
		expect(existsSync(constitutionPath)).toBe(true);

		const content = readFileSync(constitutionPath, "utf-8");
		expect(content).toContain("# Project Constitution");
		expect(content).toContain("## Stack");
		expect(content).toContain("## Architecture");
		expect(content).toContain("## Verification");
		expect(content).toContain("[NEEDS CLARIFICATION]");
	});

	test("creates AGENTS.md at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const agentsPath = join(tmpDir, "AGENTS.md");
		expect(existsSync(agentsPath)).toBe(true);

		const content = readFileSync(agentsPath, "utf-8");
		expect(content).toContain("# AGENTS.md");
		expect(content).toContain("maina verify");
		expect(content).toContain("maina commit");
		expect(content).toContain("maina context");
		expect(content).toContain("maina doctor");
		expect(content).toContain("constitution.md");
	});

	test("creates CI workflow", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ciPath = join(tmpDir, ".github", "workflows", "maina-ci.yml");
		expect(existsSync(ciPath)).toBe(true);

		const content = readFileSync(ciPath, "utf-8");
		expect(content).toContain("name: Maina CI");
		expect(content).toContain("actions/checkout@v4");
	});

	test("detects bun stack from package.json", async () => {
		// Create a Bun project
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.runtime).toBe("bun");
			expect(result.value.detectedStack.language).toBe("typescript");

			const ci = readFileSync(
				join(tmpDir, ".github", "workflows", "maina-ci.yml"),
				"utf-8",
			);
			expect(ci).toContain("oven-sh/setup-bun@v2");
			expect(ci).toContain("bun install");
		}
	});

	test("creates prompts directory with defaults", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const promptsDir = join(tmpDir, ".maina", "prompts");
		expect(existsSync(promptsDir)).toBe(true);

		const reviewPath = join(promptsDir, "review.md");
		expect(existsSync(reviewPath)).toBe(true);
		const reviewContent = readFileSync(reviewPath, "utf-8");
		expect(reviewContent.length).toBeGreaterThan(0);

		const commitPath = join(promptsDir, "commit.md");
		expect(existsSync(commitPath)).toBe(true);
		const commitContent = readFileSync(commitPath, "utf-8");
		expect(commitContent.length).toBeGreaterThan(0);
	});

	test("creates hooks directory", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const hooksDir = join(tmpDir, ".maina", "hooks");
		expect(existsSync(hooksDir)).toBe(true);
	});

	test("skips existing non-agent files (no overwrite)", async () => {
		// Pre-create constitution.md with custom content
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		const constitutionPath = join(mainaDir, "constitution.md");
		writeFileSync(constitutionPath, "# My Custom Constitution\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped).toContain(".maina/constitution.md");

			// Content should NOT have been overwritten
			const content = readFileSync(constitutionPath, "utf-8");
			expect(content).toBe("# My Custom Constitution\n");
		}
	});

	test("force flag overwrites existing", async () => {
		// Pre-create constitution.md with custom content
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		const constitutionPath = join(mainaDir, "constitution.md");
		writeFileSync(constitutionPath, "# My Custom Constitution\n");

		const result = await bootstrap(tmpDir, { force: true });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.created).toContain(".maina/constitution.md");
			expect(result.value.skipped).not.toContain(".maina/constitution.md");

			// Content should have been overwritten with template
			const content = readFileSync(constitutionPath, "utf-8");
			expect(content).toContain("# Project Constitution");
		}
	});

	test("returns correct created/skipped lists", async () => {
		// Pre-create one file
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(join(mainaDir, "constitution.md"), "existing\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			// constitution.md should be skipped
			expect(result.value.skipped).toContain(".maina/constitution.md");
			expect(result.value.created).not.toContain(".maina/constitution.md");

			// Other files should be created
			expect(result.value.created).toContain("AGENTS.md");
			expect(result.value.created).toContain(".github/workflows/maina-ci.yml");
			expect(result.value.created).toContain(".maina/prompts/review.md");
			expect(result.value.created).toContain(".maina/prompts/commit.md");

			// Total files should add up (created + skipped + updated)
			const total =
				result.value.created.length +
				result.value.skipped.length +
				result.value.updated.length;
			expect(total).toBeGreaterThanOrEqual(5);
		}
	});

	test("works on empty directory", async () => {
		// tmpDir is already empty
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.created.length).toBeGreaterThanOrEqual(5);
			expect(result.value.skipped.length).toBe(0);
			expect(result.value.directory).toBe(join(tmpDir, ".maina"));
		}
	});

	test("detects available verification tools in report", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedTools).toBeDefined();
			expect(Array.isArray(result.value.detectedTools)).toBe(true);
			// Each tool should have name and available flag
			for (const tool of result.value.detectedTools) {
				expect(typeof tool.name).toBe("string");
				expect(typeof tool.available).toBe("boolean");
			}
		}
	});

	test("auto-configures biome.json when no linter detected", async () => {
		// Project with no linter in dependencies
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const biomePath = join(tmpDir, "biome.json");
			expect(existsSync(biomePath)).toBe(true);

			const biomeConfig = JSON.parse(readFileSync(biomePath, "utf-8"));
			expect(biomeConfig.linter.enabled).toBe(true);
			expect(biomeConfig.linter.rules.recommended).toBe(true);
			expect(biomeConfig.formatter.enabled).toBe(true);

			expect(result.value.created).toContain("biome.json");
			expect(result.value.detectedStack.linter).toBe("biome");
		}
	});

	test("does not overwrite existing biome.json", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);
		writeFileSync(join(tmpDir, "biome.json"), '{"custom": true}');

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(join(tmpDir, "biome.json"), "utf-8");
		expect(JSON.parse(content)).toEqual({ custom: true });
	});

	test("skips biome.json when linter already detected", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { eslint: "^9.0.0" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(existsSync(join(tmpDir, "biome.json"))).toBe(false);
			expect(result.value.detectedStack.linter).toBe("eslint");
		}
	});

	// ── .mcp.json generation ──────────────────────────────────────────────

	test("creates .mcp.json at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".mcp.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers).toBeDefined();
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("maina");
		expect(content.mcpServers.maina.args).toEqual(["--mcp"]);
	});

	test("does not overwrite existing .mcp.json", async () => {
		writeFileSync(join(tmpDir, ".mcp.json"), '{"custom": true}');

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped).toContain(".mcp.json");
		}

		const content = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
		expect(JSON.parse(content)).toEqual({ custom: true });
	});

	// ── Agent instruction files ───────────────────────────────────────────

	test("creates CLAUDE.md at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const claudePath = join(tmpDir, "CLAUDE.md");
		expect(existsSync(claudePath)).toBe(true);

		const content = readFileSync(claudePath, "utf-8");
		expect(content).toContain("# CLAUDE.md");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("getContext");
		expect(content).toContain("maina verify");
	});

	test("creates GEMINI.md at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const geminiPath = join(tmpDir, "GEMINI.md");
		expect(existsSync(geminiPath)).toBe(true);

		const content = readFileSync(geminiPath, "utf-8");
		expect(content).toContain("# GEMINI.md");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("getContext");
	});

	test("creates .cursorrules at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const cursorPath = join(tmpDir, ".cursorrules");
		expect(existsSync(cursorPath)).toBe(true);

		const content = readFileSync(cursorPath, "utf-8");
		expect(content).toContain("Cursor Rules");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("maina verify");
	});

	test("merges maina section into existing agent files without ## Maina", async () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# My Custom CLAUDE.md\n");
		writeFileSync(join(tmpDir, "GEMINI.md"), "# My Custom GEMINI.md\n");
		writeFileSync(join(tmpDir, ".cursorrules"), "# My Custom Rules\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toContain("CLAUDE.md");
			expect(result.value.updated).toContain("GEMINI.md");
			expect(result.value.updated).toContain(".cursorrules");
			expect(result.value.skipped).not.toContain("CLAUDE.md");
			expect(result.value.skipped).not.toContain("GEMINI.md");
			expect(result.value.skipped).not.toContain(".cursorrules");
		}

		const claudeContent = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(claudeContent).toContain("# My Custom CLAUDE.md");
		expect(claudeContent).toContain("## Maina");
		expect(claudeContent).toContain("constitution.md");
		expect(claudeContent).toContain("getContext");

		const geminiContent = readFileSync(join(tmpDir, "GEMINI.md"), "utf-8");
		expect(geminiContent).toContain("# My Custom GEMINI.md");
		expect(geminiContent).toContain("## Maina");

		const cursorContent = readFileSync(join(tmpDir, ".cursorrules"), "utf-8");
		expect(cursorContent).toContain("# My Custom Rules");
		expect(cursorContent).toContain("## Maina");
	});

	test("skips agent files that already have ## Maina section", async () => {
		writeFileSync(
			join(tmpDir, "CLAUDE.md"),
			"# My CLAUDE.md\n\n## Maina\n\nAlready configured.\n",
		);
		writeFileSync(
			join(tmpDir, "GEMINI.md"),
			"# My GEMINI.md\n\n## Maina\n\nAlready configured.\n",
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped).toContain("CLAUDE.md");
			expect(result.value.skipped).toContain("GEMINI.md");
			expect(result.value.updated).not.toContain("CLAUDE.md");
			expect(result.value.updated).not.toContain("GEMINI.md");
		}

		// Content should not be modified
		const claudeContent = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(claudeContent).toBe(
			"# My CLAUDE.md\n\n## Maina\n\nAlready configured.\n",
		);
	});

	test("merges AGENTS.md with maina section", async () => {
		writeFileSync(
			join(tmpDir, "AGENTS.md"),
			"# My Agents File\n\nCustom content here.\n",
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toContain("AGENTS.md");
		}

		const content = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
		expect(content).toContain("# My Agents File");
		expect(content).toContain("Custom content here.");
		expect(content).toContain("## Maina");
		expect(content).toContain("brainstorm");
		expect(content).toContain("MCP Tools");
	});

	test("updated array is empty for fresh directory", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toEqual([]);
		}
	});

	// ── Workflow order in agent files ─────────────────────────────────────

	test("AGENTS.md includes workflow order", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
		expect(content).toContain("Workflow Order");
		expect(content).toContain("brainstorm");
		expect(content).toContain("ticket");
		expect(content).toContain("implement");
		expect(content).toContain("verify");
	});

	test("copilot instructions include workflow order", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"utf-8",
		);
		expect(content).toContain("Workflow Order");
		expect(content).toContain("brainstorm");
	});

	// ── MCP tools in agent files ──────────────────────────────────────────

	test("AGENTS.md includes MCP tools table", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
		expect(content).toContain("MCP Tools");
		expect(content).toContain("getContext");
		expect(content).toContain("checkSlop");
		expect(content).toContain("reviewCode");
		expect(content).toContain("suggestTests");
		expect(content).toContain("explainModule");
		expect(content).toContain("analyzeFeature");
	});

	// ── aiGenerate option ─────────────────────────────────────────────────

	test("aiGenerate defaults to false (backward compatible)", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			// Without aiGenerate, should not have AI-generated constitution
			expect(result.value.aiGenerated).toBeFalsy();
		}
	});

	test("aiGenerate falls back to static template when AI unavailable", async () => {
		// No API key in env, AI will fail
		const result = await bootstrap(tmpDir, { aiGenerate: true });
		expect(result.ok).toBe(true);
		if (result.ok) {
			// Constitution should still be created (fallback to static)
			expect(result.value.created).toContain(".maina/constitution.md");
			const content = readFileSync(
				join(tmpDir, ".maina", "constitution.md"),
				"utf-8",
			);
			expect(content).toContain("# Project Constitution");
		}
	});

	// ── Complete file manifest ────────────────────────────────────────────

	test("creates all expected files in fresh directory", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const expectedFiles = [
				".maina/constitution.md",
				".maina/prompts/review.md",
				".maina/prompts/commit.md",
				"AGENTS.md",
				".github/workflows/maina-ci.yml",
				".github/copilot-instructions.md",
				".mcp.json",
				"CLAUDE.md",
				"GEMINI.md",
				".cursorrules",
			];
			for (const f of expectedFiles) {
				expect(result.value.created).toContain(f);
			}
		}
	});
});
