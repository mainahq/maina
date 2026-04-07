import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dir, "..");

const SKILL_NAMES = [
	"verification-workflow",
	"context-generation",
	"plan-writing",
	"code-review",
	"tdd",
	"cloud-workflow",
];

function readSkill(name: string): string {
	const path = join(SKILLS_DIR, name, "SKILL.md");
	return readFileSync(path, "utf-8");
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;

	const raw = match[1];
	const result: Record<string, unknown> = {};

	let currentKey = "";
	let currentList: string[] | null = null;

	for (const line of raw.split("\n")) {
		const listItem = line.match(/^\s+-\s+"(.+)"$/);
		if (listItem && currentKey) {
			if (!currentList) currentList = [];
			currentList.push(listItem[1]);
			continue;
		}

		if (currentKey && currentList) {
			result[currentKey] = currentList;
			currentList = null;
		}

		const kvMatch = line.match(/^(\w+):\s*(.*)$/);
		if (kvMatch) {
			currentKey = kvMatch[1];
			const value = kvMatch[2].trim();
			if (value) {
				result[currentKey] = value;
			}
		}
	}

	if (currentKey && currentList) {
		result[currentKey] = currentList;
	}

	return result;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

describe("skills", () => {
	for (const name of SKILL_NAMES) {
		describe(name, () => {
			test("SKILL.md file exists", () => {
				const path = join(SKILLS_DIR, name, "SKILL.md");
				expect(existsSync(path)).toBe(true);
			});

			test("has valid frontmatter with name, description, and triggers", () => {
				const content = readSkill(name);
				const fm = parseFrontmatter(content);
				expect(fm).not.toBeNull();
				expect(fm?.name).toBe(name);
				expect(typeof fm?.description).toBe("string");
				expect(Array.isArray(fm?.triggers)).toBe(true);
				expect((fm?.triggers as string[]).length).toBeGreaterThan(0);
			});

			test("description is under 100 tokens", () => {
				const content = readSkill(name);
				const fm = parseFrontmatter(content);
				expect(fm).not.toBeNull();
				const desc = fm?.description as string;
				const tokens = estimateTokens(desc);
				expect(tokens).toBeLessThanOrEqual(100);
			});

			test("full content is under 5000 tokens", () => {
				const content = readSkill(name);
				const tokens = estimateTokens(content);
				expect(tokens).toBeLessThanOrEqual(5000);
			});

			test("has ## When to use section", () => {
				const content = readSkill(name);
				expect(content).toContain("## When to use");
			});

			test("has ## Steps section", () => {
				const content = readSkill(name);
				expect(content).toContain("## Steps");
			});
		});
	}

	test("README.md exists", () => {
		const readmePath = join(SKILLS_DIR, "README.md");
		expect(existsSync(readmePath)).toBe(true);
	});
});
