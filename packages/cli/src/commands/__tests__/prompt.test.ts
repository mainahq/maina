import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("prompt edit", () => {
	test("creates prompt file from default template if not exists", async () => {
		const { loadDefault } = await import("@maina/core");
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const filePath = join(promptsDir, "review.md");

		// Simulate what prompt edit does: create from default
		const defaultContent = await loadDefault("review");
		await Bun.write(filePath, defaultContent);

		expect(existsSync(filePath)).toBe(true);
		const content = await Bun.file(filePath).text();
		expect(content).toContain("{{constitution}}");
	});
});

describe("prompt list", () => {
	test("getPromptStats returns empty array when no feedback", async () => {
		const { getPromptStats } = await import("@maina/core");
		const stats = getPromptStats(tmpDir);
		expect(stats).toEqual([]);
	});
});
