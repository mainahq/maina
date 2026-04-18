import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAllAgentFiles } from "../index";

const fakeCtx = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: null,
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: [],
	repoSize: { files: 10, bytes: 100 },
	isEmpty: false,
	isLarge: false,
};

describe("cursor rules", () => {
	test("creates .cursor/rules/maina.mdc", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-cursor-"));
		const result = await writeAllAgentFiles(dir, fakeCtx, "- quickRef", [
			"cursor",
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const expected = join(dir, ".cursor", "rules", "maina.mdc");
		expect(existsSync(expected)).toBe(true);
		const content = readFileSync(expected, "utf-8");
		expect(content).toContain("typescript");
	});
});

describe("windsurf rules", () => {
	test("creates .windsurf/rules/maina.md", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-ws-"));
		const result = await writeAllAgentFiles(dir, fakeCtx, "- qr", ["windsurf"]);
		expect(result.ok).toBe(true);
		const expected = join(dir, ".windsurf", "rules", "maina.md");
		expect(existsSync(expected)).toBe(true);
	});
});
