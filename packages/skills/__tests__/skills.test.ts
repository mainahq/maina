/**
 * What each skill says. Their form (Agent Skills front matter, the v1 flow
 * set, where they ship) is `spec-compliance.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TOOLS, findRetiredTools } from "../../mcp/src/catalog";

const SKILLS_DIR = join(import.meta.dir, "..");

const SKILL_NAMES = readdirSync(SKILLS_DIR, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")))
	.sort();

function readSkill(name: string): string {
	return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

describe("skills", () => {
	test("there are skills", () => {
		expect(SKILL_NAMES.length).toBeGreaterThan(0);
	});

	for (const name of SKILL_NAMES) {
		describe(name, () => {
			// Agent Skills recommends a SKILL.md body under 5000 tokens.
			test("full content is under 5000 tokens", () => {
				expect(estimateTokens(readSkill(name))).toBeLessThanOrEqual(5000);
			});

			test("has ## When to use section", () => {
				expect(readSkill(name)).toContain("## When to use");
			});

			test("has ## Steps section", () => {
				expect(readSkill(name)).toContain("## Steps");
			});
		});
	}

	test("README.md exists", () => {
		expect(existsSync(join(SKILLS_DIR, "README.md"))).toBe(true);
	});
});

describe("MCP tool names", () => {
	for (const name of SKILL_NAMES) {
		test(`${name} names no retired MCP tool`, () => {
			expect(findRetiredTools(readSkill(name))).toEqual([]);
		});
	}

	test("every default MCP tool is taught by some skill", () => {
		const all = SKILL_NAMES.map(readSkill).join("\n");
		const missing = DEFAULT_TOOLS.filter(
			(tool) => !all.includes(`\`${tool}\``),
		);
		expect(missing).toEqual([]);
	});
});

describe("universal language", () => {
	const TOOL_SPECIFIC_PATTERNS = [
		/\buse the Read tool\b/i,
		/\buse the Write tool\b/i,
		/\buse the Edit tool\b/i,
		/\buse Claude to\b/i,
		/\bask Claude\b/i,
		/\bCursor's? (composer|chat|tab)\b/i,
		/\bCopilot Chat\b/i,
		/\buse the Bash tool\b/i,
	];

	for (const name of SKILL_NAMES) {
		test(`${name} has no tool-specific language`, () => {
			const content = readSkill(name);
			for (const pattern of TOOL_SPECIFIC_PATTERNS) {
				expect(content).not.toMatch(pattern);
			}
		});
	}

	for (const name of SKILL_NAMES) {
		test(`${name} mentions CLI and MCP usage`, () => {
			const content = readSkill(name);
			expect(content).toMatch(/\bmaina\b/);
			expect(content).toMatch(/\bMCP\b/);
		});
	}
});
