import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { listStories, loadStory } from "../story-loader";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-stories-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function createStory(
	name: string,
	config: Record<string, unknown>,
	spec = "# Test Spec\n",
	testContent = 'test("stub", () => {});',
) {
	const storyDir = join(tmpDir, name);
	mkdirSync(join(storyDir, "tests"), { recursive: true });
	writeFileSync(join(storyDir, "story.json"), JSON.stringify(config));
	writeFileSync(join(storyDir, "spec.md"), spec);
	writeFileSync(join(storyDir, "tests", "test.ts"), testContent);
}

describe("listStories", () => {
	test("returns empty array when stories directory does not exist", () => {
		const result = listStories(join(tmpDir, "nonexistent"));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([]);
		}
	});

	test("lists stories with valid story.json", () => {
		createStory("mitt", {
			name: "mitt",
			description: "Event emitter",
			tier: 1,
			source: "https://github.com/developit/mitt",
			testFiles: ["tests/test.ts"],
			metrics: { expectedTests: 18, originalLOC: 80, complexity: "easy" },
		});
		createStory("ms", {
			name: "ms",
			description: "Time converter",
			tier: 2,
			source: "https://github.com/vercel/ms",
			testFiles: ["tests/test.ts"],
			metrics: { expectedTests: 50, originalLOC: 200, complexity: "medium" },
		});

		const result = listStories(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			expect(result.value.map((s) => s.name).sort()).toEqual(["mitt", "ms"]);
		}
	});

	test("skips directories without story.json", () => {
		createStory("valid", {
			name: "valid",
			description: "V",
			tier: 1,
			source: "s",
			testFiles: ["tests/test.ts"],
			metrics: { expectedTests: 1, originalLOC: 10, complexity: "easy" },
		});
		mkdirSync(join(tmpDir, "no-config"), { recursive: true });

		const result = listStories(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0]?.name).toBe("valid");
		}
	});
});

describe("loadStory", () => {
	test("loads a valid story with config, spec, and tests", () => {
		createStory(
			"mitt",
			{
				name: "mitt",
				description: "Event emitter",
				tier: 1,
				source: "https://github.com/developit/mitt",
				testFiles: ["tests/test.ts"],
				metrics: { expectedTests: 18, originalLOC: 80, complexity: "easy" },
			},
			"# Mitt Spec\nRequirements here.",
			'import { test } from "bun:test";\ntest("foo", () => {});',
		);

		const result = loadStory(tmpDir, "mitt");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.config.name).toBe("mitt");
			expect(result.value.specContent).toContain("# Mitt Spec");
			expect(result.value.testFiles).toHaveLength(1);
			expect(result.value.testFiles[0]?.content).toContain('test("foo"');
		}
	});

	test("returns error for nonexistent story", () => {
		const result = loadStory(tmpDir, "nonexistent");
		expect(result.ok).toBe(false);
	});

	test("returns error for missing spec.md", () => {
		const storyDir = join(tmpDir, "bad");
		mkdirSync(storyDir, { recursive: true });
		writeFileSync(
			join(storyDir, "story.json"),
			JSON.stringify({
				name: "bad",
				description: "B",
				tier: 1,
				source: "s",
				testFiles: [],
				metrics: { expectedTests: 0, originalLOC: 0, complexity: "easy" },
			}),
		);

		const result = loadStory(tmpDir, "bad");
		expect(result.ok).toBe(false);
	});

	test("returns error for invalid story.json", () => {
		const storyDir = join(tmpDir, "invalid");
		mkdirSync(storyDir, { recursive: true });
		writeFileSync(join(storyDir, "story.json"), "not json");
		writeFileSync(join(storyDir, "spec.md"), "# Spec\n");

		const result = loadStory(tmpDir, "invalid");
		expect(result.ok).toBe(false);
	});
});
