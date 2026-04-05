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

	test("skips existing files (no overwrite)", async () => {
		// Pre-create constitution.md with custom content
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		const constitutionPath = join(mainaDir, "constitution.md");
		writeFileSync(constitutionPath, "# My Custom Constitution\n");

		// Pre-create AGENTS.md with custom content
		const agentsPath = join(tmpDir, "AGENTS.md");
		writeFileSync(agentsPath, "# My Custom Agents\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped).toContain(".maina/constitution.md");
			expect(result.value.skipped).toContain("AGENTS.md");

			// Content should NOT have been overwritten
			const content = readFileSync(constitutionPath, "utf-8");
			expect(content).toBe("# My Custom Constitution\n");

			const agentsContent = readFileSync(agentsPath, "utf-8");
			expect(agentsContent).toBe("# My Custom Agents\n");
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

			// Total files should add up
			const total = result.value.created.length + result.value.skipped.length;
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
});
