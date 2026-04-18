import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAllAgentFiles } from "../index";

const ctx = {
	languages: ["typescript"],
	frameworks: ["react"],
	packageManager: "bun",
	buildTool: "bunup",
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 10, bytes: 100 },
	isEmpty: false,
	isLarge: false,
};

describe("writeAllAgentFiles", () => {
	test("writes all five files when agents is omitted", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-all-"));
		const result = await writeAllAgentFiles(dir, ctx, "- quickRef");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
		expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
		expect(existsSync(join(dir, ".cursor", "rules", "maina.mdc"))).toBe(true);
		expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(
			true,
		);
		expect(existsSync(join(dir, ".windsurf", "rules", "maina.md"))).toBe(true);
		expect(result.value.written.length).toBe(5);
	});

	test("scopes to only specified agents", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-scope-"));
		const result = await writeAllAgentFiles(dir, ctx, "- qr", [
			"cursor",
			"claude",
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
		expect(existsSync(join(dir, ".cursor", "rules", "maina.mdc"))).toBe(true);
		expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
		expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(
			false,
		);
		expect(existsSync(join(dir, ".windsurf", "rules", "maina.md"))).toBe(false);
		expect(result.value.written.length).toBe(2);
	});

	test("does not throw on read-only parent; emits warning", async () => {
		// Point cwd at a path where creating files would fail: a non-writable
		// directory. We simulate by using an existing file as cwd (parent of
		// target becomes something under a regular file → mkdir fails).
		const dir = mkdtempSync(join(tmpdir(), "maina-ro-"));
		// Create a regular file named ".cursor" so `.cursor/rules` cannot be made
		await Bun.write(join(dir, ".cursor"), "blocker");
		const result = await writeAllAgentFiles(dir, ctx, "- qr", ["cursor"]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.warnings.length).toBeGreaterThan(0);
		expect(result.value.written).not.toContain(".cursor/rules/maina.mdc");
	});
});
