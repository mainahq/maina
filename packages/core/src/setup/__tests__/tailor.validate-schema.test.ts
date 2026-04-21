/**
 * tailorConstitution — single LLM call + schema validator + generic fallback.
 */

import { describe, expect, test } from "bun:test";
import type { Rule } from "../adopt";
import type { StackContext } from "../context";
import {
	renderFileLayoutSection,
	renderWorkflowSection,
	tailorConstitution,
	validateConstitution,
} from "../tailor";

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: "bunup",
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 10, bytes: 1234 },
	isEmpty: false,
	isLarge: false,
};

const RULE: Rule = {
	text: "Use Result<T, E> for errors.",
	source: "AGENTS.md:L1",
	sourceKind: "AGENTS.md",
	confidence: 1.0,
	category: "error-handling",
};

const GOOD_CONSTITUTION = `# Project Constitution

## Stack

- TypeScript + Bun

## Rules

- Use Result<T, E> for errors.

## Maina Workflow

(filled in by template)

## File Layout

(filled in by template)
`;

describe("validateConstitution", () => {
	test("accepts text with both required sections", () => {
		const result = validateConstitution(GOOD_CONSTITUTION);
		expect(result.ok).toBe(true);
	});

	test("rejects text missing ## Maina Workflow", () => {
		const bad = GOOD_CONSTITUTION.replace(
			/## Maina Workflow[\s\S]*## File Layout/,
			"## File Layout",
		);
		const result = validateConstitution(bad);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain("Maina Workflow");
	});

	test("rejects text missing ## File Layout", () => {
		const bad = GOOD_CONSTITUTION.replace(
			"## File Layout\n\n(filled in by template)\n",
			"",
		);
		const result = validateConstitution(bad);
		expect(result.ok).toBe(false);
	});
});

describe("tailorConstitution — fallback", () => {
	test("LLM returns garbage twice → falls through to generic builder", async () => {
		let calls = 0;
		const result = await tailorConstitution({
			acceptedRules: [RULE],
			stack: STACK,
			toplevelDirs: ["src", "tests"],
			languages: ["typescript"],
			generate: async () => {
				calls += 1;
				return "## Something Else\nnope\n";
			},
		});
		expect(calls).toBe(2); // one retry
		expect(result.degraded).toBe(true);
		expect(result.text).toContain("## Maina Workflow");
		expect(result.text).toContain("## File Layout");
		expect(result.reason).toBe("schema_violation");
	});

	test("LLM returns valid constitution on first try → no retry", async () => {
		let calls = 0;
		const goodOutput = `# Project Constitution

## Stack
- TypeScript

## Rules
- Use Result<T, E> for errors.

${renderWorkflowSection()}

${renderFileLayoutSection({
	languages: ["typescript"],
	toplevelDirs: ["src"],
})}
`;
		const result = await tailorConstitution({
			acceptedRules: [RULE],
			stack: STACK,
			toplevelDirs: ["src"],
			languages: ["typescript"],
			generate: async () => {
				calls += 1;
				return goodOutput;
			},
		});
		expect(calls).toBe(1);
		expect(result.degraded).toBe(false);
		expect(result.text).toContain("## Maina Workflow");
		expect(result.text).toContain("## File Layout");
	});

	test("LLM throws → falls through to generic builder", async () => {
		const result = await tailorConstitution({
			acceptedRules: [RULE],
			stack: STACK,
			toplevelDirs: ["src"],
			languages: ["typescript"],
			generate: async () => {
				throw new Error("provider down");
			},
		});
		expect(result.degraded).toBe(true);
		expect(result.text).toContain("## Maina Workflow");
		expect(result.text).toContain("## File Layout");
	});

	test("LLM fails first time, succeeds on retry", async () => {
		let calls = 0;
		const goodOutput = `# Project Constitution

${renderWorkflowSection()}

${renderFileLayoutSection({ languages: ["typescript"], toplevelDirs: ["src"] })}
`;
		const result = await tailorConstitution({
			acceptedRules: [RULE],
			stack: STACK,
			toplevelDirs: ["src"],
			languages: ["typescript"],
			generate: async () => {
				calls += 1;
				if (calls === 1) return "malformed";
				return goodOutput;
			},
		});
		expect(calls).toBe(2);
		expect(result.degraded).toBe(false);
	});
});

describe("template renderers", () => {
	test("renderWorkflowSection contains workflow arrow", () => {
		const text = renderWorkflowSection();
		expect(text).toContain("## Maina Workflow");
		expect(text).toContain("brainstorm → ticket → plan");
		expect(text).toContain("commit → review → pr");
	});

	test("renderFileLayoutSection substitutes languages and dirs", () => {
		const text = renderFileLayoutSection({
			languages: ["typescript", "python"],
			toplevelDirs: ["src", "tests"],
		});
		expect(text).toContain("## File Layout");
		expect(text).toContain("typescript");
		expect(text).toContain("python");
		expect(text).toContain("src");
		expect(text).toContain("tests");
	});

	test("renderFileLayoutSection handles empty dirs gracefully", () => {
		const text = renderFileLayoutSection({
			languages: [],
			toplevelDirs: [],
		});
		expect(text).toContain("## File Layout");
		// Placeholder should be replaced with a sensible default.
		expect(text).not.toContain("{toplevelDirs}");
		expect(text).not.toContain("{languages}");
	});
});
