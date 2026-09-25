import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateClaudeMd, writeClaudeMd } from "../claude-md";
import { MAINA_REGION_END, MAINA_REGION_START } from "../region";

const fakeCtx = {
	languages: ["typescript"],
	frameworks: ["react"],
	packageManager: "bun",
	buildTool: "bunup",
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 100, bytes: 1024 },
	isEmpty: false,
	isLarge: false,
};

const quickRef = "- TDD always\n- No console.log";

describe("generateClaudeMd", () => {
	test("includes stack info and quickRef", () => {
		const md = generateClaudeMd(fakeCtx, quickRef);
		expect(md).toContain("typescript");
		expect(md).toContain("biome");
		expect(md).toContain("TDD always");
	});
});

describe("writeClaudeMd", () => {
	test("creates new file when none exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-claude-"));
		const result = await writeClaudeMd(
			dir,
			generateClaudeMd(fakeCtx, quickRef),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action).toBe("created");
		const content = readFileSync(result.value.path, "utf-8");
		expect(content).toContain(MAINA_REGION_START);
		expect(content).toContain(MAINA_REGION_END);
	});

	test("preserves existing user content above and below managed region", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-claude-"));
		const existingPath = join(dir, "CLAUDE.md");
		writeFileSync(
			existingPath,
			"# My custom CLAUDE.md\n\nUser authored rules.\n",
			"utf-8",
		);
		const result = await writeClaudeMd(
			dir,
			generateClaudeMd(fakeCtx, quickRef),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action).toBe("merged");
		const content = readFileSync(result.value.path, "utf-8");
		expect(content).toContain("User authored rules.");
		expect(content).toContain("My custom CLAUDE.md");
		expect(content).toContain(MAINA_REGION_START);
	});

	test("idempotent — re-run yields same output", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-claude-"));
		const managed = generateClaudeMd(fakeCtx, quickRef);
		const first = await writeClaudeMd(dir, managed);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const afterFirst = readFileSync(first.value.path, "utf-8");
		const second = await writeClaudeMd(dir, managed);
		expect(second.ok).toBe(true);
		const afterSecond = readFileSync(first.value.path, "utf-8");
		expect(afterSecond).toBe(afterFirst);
	});
});
