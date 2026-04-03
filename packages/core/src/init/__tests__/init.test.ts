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
		expect(content).toContain("maina plan");
		expect(content).toContain("maina analyze");
		expect(content).toContain("[NEEDS CLARIFICATION]");
	});

	test("creates CI workflow", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);

		const ciPath = join(tmpDir, ".github", "workflows", "maina-ci.yml");
		expect(existsSync(ciPath)).toBe(true);

		const content = readFileSync(ciPath, "utf-8");
		expect(content).toContain("name: Maina CI");
		expect(content).toContain("actions/checkout@v4");
		expect(content).toContain("oven-sh/setup-bun@v2");
		expect(content).toContain("bun install");
		expect(content).toContain("bun run check");
		expect(content).toContain("bun run typecheck");
		expect(content).toContain("bun run test");
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
});
