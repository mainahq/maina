import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
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
let mockSpecQuestions: Array<{
	question: string;
	type: "text" | "select";
	options?: string[];
	reason: string;
}> = [];
let mockClackTextResponses: string[] = [];
let mockClackTextCallIndex = 0;
let mockClackSelectResponses: string[] = [];
let mockClackSelectCallIndex = 0;

// ── Mocks ────────────────────────────────────────────────────────────────────

// Re-export generateTestStubs from the real module so the test can use it
const realCore = await import("@maina/core");

mock.module("@maina/core", () => ({
	getCurrentBranch: async (_cwd?: string) => mockCurrentBranch,
	generateTestStubs: realCore.generateTestStubs,
	generateSpecQuestions: async (_planContent: string, _mainaDir: string) => ({
		ok: true,
		value: mockSpecQuestions,
	}),
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
	text: async () => {
		const response = mockClackTextResponses[mockClackTextCallIndex] ?? "";
		mockClackTextCallIndex++;
		return response;
	},
	select: async () => {
		const response = mockClackSelectResponses[mockClackSelectCallIndex] ?? "";
		mockClackSelectCallIndex++;
		return response;
	},
	isCancel: (v: unknown) => typeof v === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ─────────────────────────────────

const { specAction } = await import("../spec");
const { generateTestStubs } = await import("@maina/core");
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
	mockSpecQuestions = [];
	mockClackTextResponses = [];
	mockClackTextCallIndex = 0;
	mockClackSelectResponses = [];
	mockClackSelectCallIndex = 0;
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
		runTests: async (_testPath: string, _cwd: string) => ({
			passCount: 0,
			failCount: 3,
		}),
		...overrides,
	};
}

// ── generateTestStubs tests ──────────────────────────────────────────────────

describe("generateTestStubs", () => {
	test("plan with 3 tasks generates multiple it() blocks per task (happy + edge + error)", () => {
		const plan = `# Implementation Plan

## Tasks

- T001: Implement login with email format validation
- T002: Add error messages for failed login attempts
- T003: Create session management middleware
`;

		const output = generateTestStubs(plan, "user-auth");

		// Each non-ambiguous task generates 3+ it() blocks (happy path + edge case + error)
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks).not.toBeNull();
		expect(itBlocks?.length ?? 0).toBeGreaterThanOrEqual(9); // 3 tasks × 3 stubs minimum
		// Should have happy path, edge case, and error stubs
		expect(output).toContain("happy path:");
		expect(output).toContain("edge case:");
		expect(output).toContain("error:");
	});

	test("each it() block has failing expect (red phase)", () => {
		const plan = `## Tasks

- T001: Implement login
- T002: Add logout
`;

		const output = generateTestStubs(plan, "user-auth");

		// Every it() block should have expect(true).toBe(false) for red phase
		const failingExpects = output.match(/expect\(true\)\.toBe\(false\)/g);
		expect(failingExpects).not.toBeNull();
		expect(failingExpects?.length ?? 0).toBeGreaterThanOrEqual(6); // 2 tasks × 3 stubs
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

		// All 3 tasks should be parsed
		expect(output).toContain("T001");
		expect(output).toContain("T002");
		expect(output).toContain("T003");

		// Each generates 3+ stubs
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks).not.toBeNull();
		expect(itBlocks?.length ?? 0).toBeGreaterThanOrEqual(9);
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

	test("task descriptions appear in describe block names", () => {
		const plan = `## Tasks

- T001: Implement login with email format validation
`;

		const output = generateTestStubs(plan, "user-auth");

		expect(output).toContain(
			"T001: Implement login with email format validation",
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

		// T001 and T003 get multiple stubs, T002 gets 1 ambiguous stub
		const itBlocks = output.match(/\bit\(/g);
		expect(itBlocks?.length ?? 0).toBeGreaterThanOrEqual(7); // 2×3 + 1

		// Only T002 should have clarification
		expect(output).toContain("[NEEDS CLARIFICATION]");
		expect(output).toContain("T002");
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
		expect(result.taskCount).toBeGreaterThanOrEqual(3); // 1 task × 3 stubs
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
		expect(result.taskCount).toBeGreaterThanOrEqual(6); // 2 tasks × 3 stubs
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
		expect(result.taskCount).toBeGreaterThanOrEqual(9); // 3 tasks × 3 stubs
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

	// ── Red-green enforcement tests ─────────────────────────────────────────

	test("red-green verified when all stubs fail", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps({
				runTests: async () => ({ passCount: 0, failCount: 3 }),
			}),
		);

		expect(result.generated).toBe(true);
		expect(result.redPhaseVerified).toBe(true);
		expect(result.redGreenWarning).toBeUndefined();
	});

	test("warning when stubs pass immediately", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n- T002: Add logout\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps({
				runTests: async () => ({ passCount: 2, failCount: 4 }),
			}),
		);

		expect(result.generated).toBe(true);
		expect(result.redPhaseVerified).toBe(false);
		expect(result.redGreenWarning).toContain("2 stub(s) passed immediately");
	});

	test("red-green skipped when noRedGreen option is true", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir, noRedGreen: true },
			createMockDeps({
				runTests: async () => ({ passCount: 0, failCount: 3 }),
			}),
		);

		expect(result.generated).toBe(true);
		expect(result.redPhaseVerified).toBeUndefined();
		expect(result.redGreenWarning).toBeUndefined();
	});

	test("red-green check failure does not block spec generation", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps({
				runTests: async () => {
					throw new Error("bun test not found");
				},
			}),
		);

		expect(result.generated).toBe(true);
		expect(result.redPhaseVerified).toBeUndefined();
		expect(result.redGreenWarning).toBeUndefined();
	});

	// ── Interactive question phase tests ────────────────────────────────────

	test("interactive mode asks clarifying questions and records answers in spec.md", async () => {
		mockSpecQuestions = [
			{
				question: "Should login support OAuth?",
				type: "text",
				reason: "Not specified",
			},
			{
				question: "Rate limit strategy?",
				type: "select",
				options: ["Per-user", "Per-IP", "Both"],
				reason: "Ambiguous",
			},
		];
		mockClackTextResponses = ["Yes, OAuth2 via Google"];
		mockClackSelectResponses = ["Both"];

		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);
		writeFileSync(join(featureDir, "spec.md"), "# Feature: User Auth\n");

		const result = await specAction(
			{ featureDir, cwd: tmpDir },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.questionsAsked).toBe(2);

		// Answers should be appended to spec.md
		const specContent = readFileSync(join(featureDir, "spec.md"), "utf-8");
		expect(specContent).toContain("## Clarifications");
		expect(specContent).toContain("Should login support OAuth?");
		expect(specContent).toContain("Yes, OAuth2 via Google");
		expect(specContent).toContain("Rate limit strategy?");
		expect(specContent).toContain("Both");
	});

	test("--no-interactive skips question phase entirely", async () => {
		mockSpecQuestions = [
			{
				question: "Should never see this?",
				type: "text",
				reason: "Should be skipped",
			},
		];

		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(
			join(featureDir, "plan.md"),
			`## Tasks\n\n- T001: Implement login\n`,
		);
		writeFileSync(join(featureDir, "spec.md"), "# Feature: User Auth\n");

		const result = await specAction(
			{ featureDir, cwd: tmpDir, noInteractive: true },
			createMockDeps(),
		);

		expect(result.generated).toBe(true);
		expect(result.questionsAsked).toBeUndefined();

		// spec.md should NOT have Clarifications
		const specContent = readFileSync(join(featureDir, "spec.md"), "utf-8");
		expect(specContent).not.toContain("## Clarifications");
	});

	test("no questions from AI skips question phase gracefully", async () => {
		mockSpecQuestions = [];

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
		expect(result.questionsAsked).toBeUndefined();
	});
});
