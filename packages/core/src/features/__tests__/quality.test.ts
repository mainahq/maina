import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoreSpec } from "../quality";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-quality-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("scoreSpec", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- Good spec with measurable verbs → score > 70 ---
	test("good spec with measurable verbs scores > 70", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Token Budget

## Problem Statement
The context engine needs a configurable token budget.

## User Stories
- As a developer, I want to configure token budgets per command.

## Success Criteria
- \`calculateTokens\` returns the correct token count for a given input
- \`assembleContext\` validates that tokens stay within budget of 4000
- \`parseConfig\` reads the \`.maina/config.json\` file and returns parsed settings
- The budget engine computes utilization as \`tokens / budget\`
- \`rejectOverBudget\` throws when context exceeds the configured limit

## Scope
- In scope: token counting, budget configuration
- Out of scope: streaming, multi-model

## Design Decisions
- Use tree-sitter for AST parsing
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.overall).toBeGreaterThan(70);
	});

	// --- Spec with vague verbs → measurability < 50 ---
	test("spec with vague verbs has measurability < 50", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Auth

## Problem Statement
We need auth.

## User Stories
- As a user, I want to log in.

## Success Criteria
- The system handles user authentication
- The module manages session state
- The service supports OAuth providers
- The component processes login requests
- The layer deals with token refresh

## Scope
- Auth

## Design Decisions
- TBD
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.measurability).toBeLessThan(50);
	});

	// --- Spec with weasel words → ambiguity < 50 ---
	test("spec with weasel words has ambiguity < 50", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Maybe Auth

## Problem Statement
This might possibly solve some authentication issues.

## User Stories
- As a user, I should possibly be able to log in maybe.

## Success Criteria
- The system should maybe validate credentials
- Various appropriate methods could be used
- Some users might possibly need sessions
- It should probably handle various edge cases
- The module could possibly support some providers
- Maybe it should also handle appropriate errors

## Scope
- Various things

## Design Decisions
- Possibly use some appropriate library
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ambiguity).toBeLessThan(50);
	});

	// --- Spec with all sections → completeness = 100 ---
	test("spec with all required sections has completeness 100", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Complete

## Problem Statement
Something.

## User Stories
- Story.

## Success Criteria
- Criterion.

## Scope
- Scope.

## Design Decisions
- Decision.
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.completeness).toBe(100);
	});

	// --- Spec missing sections → completeness < 100 ---
	test("spec missing sections has completeness < 100", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Incomplete

## Problem Statement
Something.

## Success Criteria
- Criterion.
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.completeness).toBeLessThan(100);
	});

	// --- Spec with [NEEDS CLARIFICATION] → completeness penalized ---
	test("spec with [NEEDS CLARIFICATION] has completeness penalized", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Unclear

## Problem Statement
Something. [NEEDS CLARIFICATION]

## User Stories
- Story. [NEEDS CLARIFICATION]

## Success Criteria
- Criterion validates input.

## Scope
- Scope.

## Design Decisions
- Decision.
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// All sections present = 100, minus 2 * 10 = 80
		expect(result.value.completeness).toBe(80);
	});

	// --- Spec with backtick identifiers → testability high ---
	test("spec with backtick identifiers has high testability", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Testable

## Problem Statement
Need testable criteria.

## User Stories
- As a developer, I want clear criteria.

## Success Criteria
- \`parseInput\` returns a valid AST node
- The output file is written to \`/tmp/output.json\`
- The function returns error code 404 when not found
- \`validateEmail\` rejects strings without @ symbol
- The response contains exactly 5 items

## Scope
- Parsing and validation

## Design Decisions
- Use tree-sitter
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.testability).toBeGreaterThan(70);
	});

	// --- Empty spec → score 0 ---
	test("empty spec scores 0", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(specPath, "");

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.overall).toBe(0);
	});

	// --- File not found → error Result ---
	test("file not found returns error Result", () => {
		const result = scoreSpec(join(tmpDir, "nonexistent.md"));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("not found");
	});

	// --- Details array is populated ---
	test("details array is populated with human-readable breakdown", () => {
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(
			specPath,
			`# Feature: Details

## Problem Statement
Something.

## User Stories
- Story.

## Success Criteria
- \`validate\` returns true for valid input

## Scope
- Scope.

## Design Decisions
- Decision.
`,
		);

		const result = scoreSpec(specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.details.length).toBeGreaterThan(0);
	});
});
