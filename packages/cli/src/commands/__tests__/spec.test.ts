import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

let mockCurrentBranch = "feature/001-user-auth";

// ── Mocks ────────────────────────────────────────────────────────────────────

mock.module("@maina/core", () => ({
	getCurrentBranch: async (_cwd?: string) => mockCurrentBranch,
}));

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({
		start: () => {},
		stop: () => {},
	}),
}));

// ── Import the module under test AFTER mocks ─────────────────────────────────

const { generateTestStubs, specAction } = await import("../spec");
type SpecDepsType = import("../spec").SpecDeps;

// ── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockCurrentBranch = "feature/001-user-auth";
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Default mock deps ────────────────────────────────────────────────────────

function createMockDeps(overrides?: Partial<SpecDepsType>): SpecDepsType {
	return {
		getCurrentBranch: async (_cwd: string) => mockCurrentBranch,
		...overrides,
	};
}

// ── generateTestStubs tests ──────────────────────────────────────────────────

describe("generateTestStubs", () => {
	test("plan with 3 tasks generates 3 it() blocks", () => {
		const plan = `# Implementation Plan

## Tasks

- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
- T003: Create session management middleware
`;

		const output = generateTestStubs(plan, "user-auth");

		// Count it() blocks
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks).not.toBeNull();
		expect(itBlocks?.length).toBe(3);
	});

	test("each it() block has failing expect (red phase)", () => {
		const plan = `## Tasks

- T001: Implement login
- T002: Add logout
`;

		const output = generateTestStubs(plan, "user-auth");

		// Each it() block should have expect(true).toBe(false) for red phase
		const failingExpects = output.match(/expect\(true\)\.toBe\(false\)/g);
		expect(failingExpects).not.toBeNull();
		expect(failingExpects?.length).toBe(2);
	});

	test('task with ambiguous language "maybe" adds [NEEDS CLARIFICATION] comment', () => {
		const plan = `## Tasks

- T001: Implement login
- T002: Maybe add OAuth support
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain("[NEEDS CLARIFICATION]");
		// The clarification should be associated with T002
		expect(output).toContain("T002");
	});

	test('task with "TBD" adds [NEEDS CLARIFICATION] comment', () => {
		const plan = `## Tasks

- T001: Implement login
- T002: TBD error handling approach
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain("[NEEDS CLARIFICATION]");
	});

	test('task with "possibly" adds [NEEDS CLARIFICATION] comment', () => {
		const plan = `## Tasks

- T001: Possibly add rate limiting
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain("[NEEDS CLARIFICATION]");
	});

	test('task with "might" adds [NEEDS CLARIFICATION] comment', () => {
		const plan = `## Tasks

- T001: Might need caching layer
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain("[NEEDS CLARIFICATION]");
	});

	test('task with ambiguous "or" adds [NEEDS CLARIFICATION] comment', () => {
		const plan = `## Tasks

- T001: Use Redis or Memcached for caching
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain("[NEEDS CLARIFICATION]");
	});

	test("empty plan returns minimal test file with no it() blocks", () => {
		const plan = `# Implementation Plan

## Architecture

Some description here.
`;

		const output = generateTestStubs(plan, "user-auth");

		// Should still be a valid test file structure
		expect(output).toContain('import { describe, expect, it } from "bun:test"');
		expect(output).toContain("describe(");

		// But no it() blocks
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks).toBeNull();
	});

	test("tasks with checkbox format (- [x] T001:) are still parsed correctly", () => {
		const plan = `## Tasks

- [x] T001: Implement login
- [ ] T002: Add logout
- [x] T003: Create middleware
`;

		const output = generateTestStubs(plan, "user-auth");

		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks).not.toBeNull();
		expect(itBlocks?.length).toBe(3);

		expect(output).toContain("T001");
		expect(output).toContain("T002");
		expect(output).toContain("T003");
	});

	test('output imports describe, expect, it from "bun:test"', () => {
		const plan = `## Tasks

- T001: Implement login
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain('import { describe, expect, it } from "bun:test"');
	});

	test("uses feature name in describe block", () => {
		const plan = `## Tasks

- T001: Implement login
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain('describe("Feature: user-auth"');
	});

	test("task descriptions appear in it() block names", () => {
		const plan = `## Tasks

- T001: Implement login with email format validation
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain(
			"T001: should implement login with email format validation",
		);
	});

	test("non-ambiguous tasks do not have [NEEDS CLARIFICATION]", () => {
		const plan = `## Tasks

- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).not.toContain("[NEEDS CLARIFICATION]");
	});

	test("mixed ambiguous and non-ambiguous tasks", () => {
		const plan = `## Tasks

- T001: Implement login with email format validation
- T002: Maybe add OAuth support
- T003: Add error messages for failed login attempts
`;

		const output = generateTestStubs(plan, "user-auth");

		// 3 it() blocks
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks?.length).toBe(3);

		// Only T002 should have clarification
		const lines = output.split("\n");
		const clarificationLines = lines.filter((l) =>
			l.includes("[NEEDS CLARIFICATION]"),
		);
		// There should be clarification comments for T002 (before it() and inside it())
		expect(clarificationLines.length).toBeGreaterThan(0);

		// T001 and T003 lines should not have NEEDS CLARIFICATION
		const t001Line = lines.find((l) => l.includes("T001"));
		const t003Line = lines.find((l) => l.includes("T003"));
		expect(t001Line).not.toContain("[NEEDS CLARIFICATION]");
		expect(t003Line).not.toContain("[NEEDS CLARIFICATION]");
	});
});

// ── specAction tests ─────────────────────────────────────────────────────────

describe("specAction", () => {
	test("auto-detects feature dir from branch name", async () => {
		mockCurrentBranch = "feature/001-user-auth";

		// Create the feature dir with a plan.md
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction({ cwd: tmpDir }, createMockDeps());

		expect(result.generated).toBe(true);
		expect(result.taskCount).toBe(1);
		expect(result.outputPath).toBeDefined();
	});

	test("explicit feature dir overrides auto-detect", async () => {
		mockCurrentBranch = "feature/001-user-auth";

		// Create an explicit feature dir (different from what auto-detect would find)
		const explicitDir = join(tmpDir, "my-custom-feature");
		mkdirSync(explicitDir, { recursive: true });
		writeFileSync(
			join(explicitDir, "plan.md"),
			`## Tasks\n\n- T001: Custom task\n- T002: Another task\n`,
		);

		const result = await specAction(
			{ featureDir: explicitDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.taskCount).toBe(2);
	});

	test("missing plan.md returns error", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		// No plan.md written

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(false);
		expect(result.reason).toContain("plan.md");
	});

	test("writes output file to correct location", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.outputPath).toBeDefined();
		expect(existsSync(result.outputPath as string)).toBe(true);

		const content = readFileSync(result.outputPath as string, "utf-8");
		expect(content).toContain("T001");
		expect(content).toContain(
			'import { describe, expect, it } from "bun:test"',
		);
	});

	test("returns correct task count", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Task one\n- T002: Task two\n- T003: Task three\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.taskCount).toBe(3);
	});

	test("custom output path is respected", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const customOutput = join(tmpDir, "custom-tests.ts");

		const result = await specAction(
			{ featureDir, output: customOutput, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.outputPath).toBe(customOutput);
		expect(existsSync(customOutput)).toBe(true);
	});

	test("feature dir not found returns error", async () => {
		mockCurrentBranch = "feature/999-nonexistent";

		const result = await specAction({ cwd: tmpDir }, createMockDeps());

		expect(result.generated).toBe(false);
		expect(result.reason).toBeDefined();
	});

	test("non-feature branch without explicit dir returns error", async () => {
		mockCurrentBranch = "main";

		const result = await specAction({ cwd: tmpDir }, createMockDeps());

		expect(result.generated).toBe(false);
		expect(result.reason).toBeDefined();
	});

	test("default output path is spec-tests.ts in feature dir", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.outputPath).toBe(join(featureDir, "spec-tests.ts"));
	});
});
