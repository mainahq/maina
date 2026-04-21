/**
 * Snapshot test for `.cursor/rules/maina.mdc` rendering.
 *
 * The MDC format is sensitive — it needs `---` frontmatter with the right
 * keys, the rest as markdown. This test locks the exact output for a
 * known stack so accidental template changes are caught.
 */

import { describe, expect, test } from "bun:test";
import { generateCursorRules } from "../cursor-rules";
import type { StackContext } from "../types";

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: ["hono"],
	packageManager: "bun",
	buildTool: null,
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: [],
	repoSize: { files: 120, bytes: 500_000 },
	isEmpty: false,
	isLarge: false,
};

const QUICK_REF = "- TDD always\n- Diff-only review";

const EXPECTED_MDC = `---
description: Maina verification-first rules
alwaysApply: true
---

# Maina

**Stack:** typescript | hono | pm=bun

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for the full project DNA.

## Workflow
\`brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr\`

## Constitution Quick Reference
- TDD always
- Diff-only review

## MCP Tools
- \`getContext\`, \`verify\`, \`checkSlop\`, \`reviewCode\`, \`suggestTests\`
- \`wikiQuery\` — search codebase knowledge

## Rules
- TDD always
- Conventional commits
- No \`console.log\` in production
- Diff-only: only report findings on changed lines
- \`Result<T, E>\` — never throw
- Lint: biome
- Test: bun:test
`;

describe("cursor-rules snapshot", () => {
	test("MDC output matches exact expected string for typescript+hono+bun stack", () => {
		const out = generateCursorRules(STACK, QUICK_REF);
		expect(out).toBe(EXPECTED_MDC);
	});

	test("frontmatter is syntactically valid", () => {
		const out = generateCursorRules(STACK, QUICK_REF);
		// Must start with `---\n`, contain `alwaysApply: true`, end frontmatter
		// with another `---\n`.
		expect(out.startsWith("---\n")).toBe(true);
		expect(out).toContain("alwaysApply: true");
		const fmEnd = out.indexOf("---\n", 4);
		expect(fmEnd).toBeGreaterThan(0);
		// Exactly two `---` lines (open + close).
		const frontMatter = out.slice(0, fmEnd + 4);
		expect(frontMatter.split(/^---$/m).length).toBe(3);
	});

	test("output omits linter/test lines when stack has none", () => {
		const bare: StackContext = {
			...STACK,
			linters: [],
			testRunners: [],
		};
		const out = generateCursorRules(bare, QUICK_REF);
		expect(out).not.toContain("Lint:");
		expect(out).not.toContain("Test:");
	});
});
