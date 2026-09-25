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

	test("creates CI workflow with maina verify and fallback", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ciPath = join(tmpDir, ".github", "workflows", "maina-ci.yml");
		expect(existsSync(ciPath)).toBe(true);

		const content = readFileSync(ciPath, "utf-8");
		expect(content).toContain("name: Maina CI");
		expect(content).toContain("actions/checkout@v4");
		// Primary job uses maina verify (#82)
		expect(content).toContain("maina verify");
		// Cloud option is commented out for user to enable
		expect(content).toContain("mainahq/verify-action@v1");
		// Fallback raw commands are present but disabled
		expect(content).toContain("verify-fallback");
	}, 30_000);

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

	// ── CI workflow uses actual script names (#79) ───────────────────────

	test("CI workflow uses 'bun run lint' when project has lint script but no check script", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				devDependencies: { "@types/bun": "latest" },
				scripts: { lint: "biome check .", test: "bun test" },
			}),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ci = readFileSync(
			join(tmpDir, ".github", "workflows", "maina-ci.yml"),
			"utf-8",
		);
		expect(ci).toContain("bun run lint");
		expect(ci).not.toContain("bun run check");
	}, 30_000);

	test("CI workflow uses 'bun run check' when project has check script", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				devDependencies: { "@types/bun": "latest" },
				scripts: { check: "biome check .", lint: "biome lint ." },
			}),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ci = readFileSync(
			join(tmpDir, ".github", "workflows", "maina-ci.yml"),
			"utf-8",
		);
		expect(ci).toContain("bun run check");
	}, 30_000);

	test("CI workflow uses 'npm run lint' for node projects with lint script", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				dependencies: { express: "^4" },
				scripts: { lint: "eslint .", test: "jest" },
			}),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ci = readFileSync(
			join(tmpDir, ".github", "workflows", "maina-ci.yml"),
			"utf-8",
		);
		expect(ci).toContain("npm run lint");
	}, 30_000);

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

	test("creates .mcp.json at repo root with npx for node runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { express: "^4" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".mcp.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers).toBeDefined();
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("creates .mcp.json with bunx for bun runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".mcp.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers.maina.command).toBe("bunx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
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

	// ── Constitution architecture for monorepos (#83) ───────────────────

	test("constitution includes workspace layout and package names for monorepos", async () => {
		// Create a monorepo with workspace packages
		mkdirSync(join(tmpDir, "packages", "auth"), { recursive: true });
		mkdirSync(join(tmpDir, "packages", "cache"), { recursive: true });
		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "my-toolkit",
				description: "Cloudflare Workers toolkit",
				workspaces: ["packages/*", "apps/*"],
				devDependencies: { "@types/bun": "latest" },
			}),
		);
		writeFileSync(
			join(tmpDir, "packages", "auth", "package.json"),
			JSON.stringify({ name: "@toolkit/auth" }),
		);
		writeFileSync(
			join(tmpDir, "packages", "cache", "package.json"),
			JSON.stringify({ name: "@toolkit/cache" }),
		);
		writeFileSync(
			join(tmpDir, "apps", "web", "package.json"),
			JSON.stringify({ name: "@toolkit/web" }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.monorepo).toBe(true);
			expect(result.value.detectedStack.workspacePatterns).toEqual([
				"packages/*",
				"apps/*",
			]);
			expect(result.value.detectedStack.workspacePackages).toContain(
				"@toolkit/auth",
			);
			expect(result.value.detectedStack.workspacePackages).toContain(
				"@toolkit/cache",
			);
			expect(result.value.detectedStack.workspacePackages).toContain(
				"@toolkit/web",
			);

			const constitution = readFileSync(
				join(tmpDir, ".maina", "constitution.md"),
				"utf-8",
			);
			expect(constitution).toContain("packages/*");
			expect(constitution).toContain("apps/*");
			expect(constitution).toContain("@toolkit/auth");
			expect(constitution).toContain("Cloudflare Workers toolkit");
		}
	}, 30_000);

	test("constitution works for non-monorepo projects", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "my-app",
				description: "My cool app",
				dependencies: { express: "^4" },
			}),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.monorepo).toBe(false);
			expect(result.value.detectedStack.workspacePatterns).toEqual([]);

			const constitution = readFileSync(
				join(tmpDir, ".maina", "constitution.md"),
				"utf-8",
			);
			expect(constitution).toContain("My cool app");
			expect(constitution).not.toContain("Monorepo layout");
		}
	}, 30_000);

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
				".claude/settings.json",
				"CLAUDE.md",
				"GEMINI.md",
				".cursorrules",
				".windsurfrules",
				".clinerules",
				".continue/config.yaml",
				".continue/mcpServers/maina.json",
				".roo/mcp.json",
				".roo/rules/maina.md",
				".amazonq/mcp.json",
				".aider.conf.yml",
				"CONVENTIONS.md",
			];
			for (const f of expectedFiles) {
				expect(result.value.created).toContain(f);
			}
		}
	});

	// ── .claude/settings.json generation ──────────────────────────────────

	test("creates .claude/settings.json for Claude Code MCP config", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const settingsPath = join(tmpDir, ".claude", "settings.json");
		expect(existsSync(settingsPath)).toBe(true);

		const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(content.mcpServers).toBeDefined();
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("bunx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test(".claude/settings.json uses npx for node runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { express: "^4" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const settingsPath = join(tmpDir, ".claude", "settings.json");
		expect(existsSync(settingsPath)).toBe(true);

		const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	// ── CLAUDE.md includes wiki commands ─────────────────────────────────

	test("CLAUDE.md includes wiki commands", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("maina wiki init");
		expect(content).toContain("maina wiki query");
		expect(content).toContain("maina wiki compile");
		expect(content).toContain("maina wiki status");
		expect(content).toContain("maina wiki lint");
		expect(content).toContain("maina brainstorm");
		expect(content).toContain("maina ticket");
		expect(content).toContain("maina design");
		expect(content).toContain("maina spec");
		expect(content).toContain("maina slop");
		expect(content).toContain("maina explain");
		expect(content).toContain("maina status");
	});

	// ── MCP_TOOLS_TABLE includes wiki tools ──────────────────────────────

	test("MCP tools table includes wikiQuery and wikiStatus", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		// Check multiple agent files that embed the MCP tools table
		const claudeContent = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(claudeContent).toContain("wikiQuery");
		expect(claudeContent).toContain("wikiStatus");

		const agentsContent = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
		expect(agentsContent).toContain("wikiQuery");
		expect(agentsContent).toContain("wikiStatus");
	});

	// ── Wiki section in agent files ──────────────────────────────────────

	test("agent files include wiki section", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const claudeContent = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(claudeContent).toContain("## Wiki");
		expect(claudeContent).toContain("wikiQuery");

		const agentsContent = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
		expect(agentsContent).toContain("## Wiki");

		const geminiContent = readFileSync(join(tmpDir, "GEMINI.md"), "utf-8");
		expect(geminiContent).toContain("## Wiki");

		const cursorContent = readFileSync(join(tmpDir, ".cursorrules"), "utf-8");
		expect(cursorContent).toContain("## Wiki");

		const copilotContent = readFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"utf-8",
		);
		expect(copilotContent).toContain("## Wiki");
	});

	// ── Windsurf ──────────────────────────────────────────────────────────

	test("creates .windsurfrules at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const filePath = join(tmpDir, ".windsurfrules");
		expect(existsSync(filePath)).toBe(true);

		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("Windsurf Rules");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("maina verify");
		expect(content).toContain("getContext");
		expect(content).toContain("checkSlop");
	});

	test(".windsurfrules includes MCP tools table", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const content = readFileSync(join(tmpDir, ".windsurfrules"), "utf-8");
		expect(content).toContain("MCP Tools");
		expect(content).toContain("getContext");
		expect(content).toContain("reviewCode");
		expect(content).toContain("wikiQuery");
	});

	test("merges maina section into existing .windsurfrules", async () => {
		writeFileSync(join(tmpDir, ".windsurfrules"), "# My Windsurf Rules\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toContain(".windsurfrules");
		}

		const content = readFileSync(join(tmpDir, ".windsurfrules"), "utf-8");
		expect(content).toContain("# My Windsurf Rules");
		expect(content).toContain("## Maina");
	});

	// ── Cline ─────────────────────────────────────────────────────────────

	test("creates .clinerules at repo root", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const filePath = join(tmpDir, ".clinerules");
		expect(existsSync(filePath)).toBe(true);

		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("Cline Rules");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("maina verify");
		expect(content).toContain("getContext");
		expect(content).toContain("checkSlop");
	});

	test("merges maina section into existing .clinerules", async () => {
		writeFileSync(join(tmpDir, ".clinerules"), "# My Cline Rules\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toContain(".clinerules");
		}

		const content = readFileSync(join(tmpDir, ".clinerules"), "utf-8");
		expect(content).toContain("# My Cline Rules");
		expect(content).toContain("## Maina");
	});

	// ── Continue.dev ──────────────────────────────────────────────────────

	test("creates .continue/mcpServers/maina.json", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".continue", "mcpServers", "maina.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.maina).toBeDefined();
		expect(content.maina.command).toBe("npx");
		expect(content.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("creates .continue/config.yaml", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const configPath = join(tmpDir, ".continue", "config.yaml");
		expect(existsSync(configPath)).toBe(true);

		const content = readFileSync(configPath, "utf-8");
		expect(content).toContain("customInstructions");
		expect(content).toContain("Maina");
		expect(content).toContain("constitution.md");
	});

	test(".continue/mcpServers/maina.json uses bunx for bun runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".continue", "mcpServers", "maina.json");
		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.maina.command).toBe("bunx");
	});

	// ── Roo Code ──────────────────────────────────────────────────────────

	test("creates .roo/mcp.json", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".roo", "mcp.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers).toBeDefined();
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("creates .roo/rules/maina.md with MCP tools", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const rulesPath = join(tmpDir, ".roo", "rules", "maina.md");
		expect(existsSync(rulesPath)).toBe(true);

		const content = readFileSync(rulesPath, "utf-8");
		expect(content).toContain("# Maina");
		expect(content).toContain("constitution.md");
		expect(content).toContain("getContext");
		expect(content).toContain("checkSlop");
		expect(content).toContain("reviewCode");
		expect(content).toContain("wikiQuery");
	});

	test(".roo/mcp.json uses bunx for bun runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".roo", "mcp.json");
		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers.maina.command).toBe("bunx");
	});

	// ── Amazon Q ──────────────────────────────────────────────────────────

	test("creates .amazonq/mcp.json", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".amazonq", "mcp.json");
		expect(existsSync(mcpPath)).toBe(true);

		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers).toBeDefined();
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test(".amazonq/mcp.json uses bunx for bun runtime", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/bun": "latest" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const mcpPath = join(tmpDir, ".amazonq", "mcp.json");
		const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
		expect(content.mcpServers.maina.command).toBe("bunx");
	});

	// ── Aider ─────────────────────────────────────────────────────────────

	test("creates .aider.conf.yml", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const configPath = join(tmpDir, ".aider.conf.yml");
		expect(existsSync(configPath)).toBe(true);

		const content = readFileSync(configPath, "utf-8");
		expect(content).toContain("CONVENTIONS.md");
		expect(content).toContain("constitution.md");
		expect(content).toContain("auto-commits: false");
	});

	test("creates CONVENTIONS.md", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const convPath = join(tmpDir, "CONVENTIONS.md");
		expect(existsSync(convPath)).toBe(true);

		const content = readFileSync(convPath, "utf-8");
		expect(content).toContain("# Conventions");
		expect(content).toContain("constitution.md");
		expect(content).toContain("brainstorm");
		expect(content).toContain("getContext");
		expect(content).toContain("checkSlop");
		expect(content).toContain("reviewCode");
		expect(content).toContain("maina verify");
		expect(content).toContain("wikiQuery");
	});

	test("merges maina section into existing CONVENTIONS.md", async () => {
		writeFileSync(join(tmpDir, "CONVENTIONS.md"), "# My Conventions\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.updated).toContain("CONVENTIONS.md");
		}

		const content = readFileSync(join(tmpDir, "CONVENTIONS.md"), "utf-8");
		expect(content).toContain("# My Conventions");
		expect(content).toContain("## Maina");
	});

	// ── All rules files consistent ───────────────────────────────────────

	test("all rules files contain MCP tools table", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const rulesFiles = [
			".cursorrules",
			".windsurfrules",
			".clinerules",
			".roo/rules/maina.md",
			"CONVENTIONS.md",
		];

		for (const f of rulesFiles) {
			const content = readFileSync(join(tmpDir, f), "utf-8");
			expect(content).toContain("getContext");
			expect(content).toContain("checkSlop");
			expect(content).toContain("reviewCode");
			expect(content).toContain("suggestTests");
			expect(content).toContain("wikiQuery");
		}
	});
});
