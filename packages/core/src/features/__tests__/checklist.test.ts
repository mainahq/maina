import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPlan } from "../checklist";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-checklist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const VALID_SPEC = `# Feature: User Auth

## User stories
- As a user, I want to log in with email/password

## Acceptance criteria
- Login form validates email format
- Failed login shows specific error message
- Password reset sends email within 30 seconds

## [NEEDS CLARIFICATION]
- Should we support OAuth?
`;

const VALID_PLAN = `# Implementation Plan

## Architecture
- JWT with RS256 signing

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: Implement error messages for failed login attempts
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
`;

describe("verifyPlan", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- Missing spec file ---
	test("missing spec file returns error Result", () => {
		const planPath = join(tmpDir, "plan.md");
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(planPath, VALID_PLAN);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("spec");
		}
	});

	// --- Missing plan file ---
	test("missing plan file returns error Result", () => {
		const planPath = join(tmpDir, "plan.md");
		const specPath = join(tmpDir, "spec.md");
		writeFileSync(specPath, VALID_SPEC);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("plan");
		}
	});

	// --- Spec criterion coverage ---
	test("plan missing a spec criterion fails with specific message", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");

		writeFileSync(specPath, VALID_SPEC);
		// Plan only covers email validation — missing "error message" and "password reset"
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- Simple approach

## Tasks
- T001: Implement email format validation for login form
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const coverage = result.value.checks.find(
			(c) => c.name === "spec-coverage",
		);
		expect(coverage).toBeDefined();
		expect(coverage?.passed).toBe(false);
		// Should mention the missing criteria
		expect(
			coverage?.details.some((d) => d.toLowerCase().includes("error message")),
		).toBe(true);
		expect(
			coverage?.details.some((d) => d.toLowerCase().includes("password reset")),
		).toBe(true);
	});

	test("plan covering all spec criteria passes", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(planPath, VALID_PLAN);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const coverage = result.value.checks.find(
			(c) => c.name === "spec-coverage",
		);
		expect(coverage).toBeDefined();
		expect(coverage?.passed).toBe(true);
		expect(coverage?.details).toHaveLength(0);
	});

	// --- No TODO/TBD/PLACEHOLDER markers ---
	test("plan with TODO marker fails and reports the line", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- JWT with RS256 signing

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: TODO: Implement error messages for failed login attempts
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const placeholders = result.value.checks.find(
			(c) => c.name === "no-placeholders",
		);
		expect(placeholders).toBeDefined();
		expect(placeholders?.passed).toBe(false);
		expect(placeholders?.details.some((d) => d.includes("TODO"))).toBe(true);
		// Should report the line number
		expect(placeholders?.details.some((d) => /line \d+/i.test(d))).toBe(true);
	});

	test("plan with TBD marker fails", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- TBD architecture decisions

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: Implement error messages for failed login attempts
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const placeholders = result.value.checks.find(
			(c) => c.name === "no-placeholders",
		);
		expect(placeholders).toBeDefined();
		expect(placeholders?.passed).toBe(false);
		expect(placeholders?.details.some((d) => d.includes("TBD"))).toBe(true);
	});

	test("plan with PLACEHOLDER marker fails", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- JWT with RS256 signing

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: Implement error messages for failed login attempts
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
- T006: PLACEHOLDER for future work
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const placeholders = result.value.checks.find(
			(c) => c.name === "no-placeholders",
		);
		expect(placeholders).toBeDefined();
		expect(placeholders?.passed).toBe(false);
		expect(placeholders?.details.some((d) => d.includes("PLACEHOLDER"))).toBe(
			true,
		);
	});

	test("plan with FIXME marker fails", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- JWT with RS256 signing

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: Implement error messages for failed login attempts FIXME
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const placeholders = result.value.checks.find(
			(c) => c.name === "no-placeholders",
		);
		expect(placeholders).toBeDefined();
		expect(placeholders?.passed).toBe(false);
		expect(placeholders?.details.some((d) => d.includes("FIXME"))).toBe(true);
	});

	test("plan with [NEEDS CLARIFICATION] passes (allowed marker)", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Architecture
- JWT with RS256 signing
- [NEEDS CLARIFICATION] OAuth support decision pending

## Tasks
- T001: Write tests for email validation and login form
- T002: Implement login endpoint with email format validation
- T003: Implement error messages for failed login attempts
- T004: Write tests for password reset flow
- T005: Implement password reset with email sending within 30 seconds
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const placeholders = result.value.checks.find(
			(c) => c.name === "no-placeholders",
		);
		expect(placeholders).toBeDefined();
		expect(placeholders?.passed).toBe(true);
		expect(placeholders?.details).toHaveLength(0);
	});

	// --- Function/type name consistency ---
	test("consistent function names across tasks passes", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(
			specPath,
			`# Feature: API

## Acceptance criteria
- User creation works
`,
		);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Tasks
- T001: Write tests for \`createUser\` function
- T002: Implement \`createUser\` in user service
- T003: Wire \`createUser\` to the API route
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const nameCheck = result.value.checks.find(
			(c) => c.name === "name-consistency",
		);
		expect(nameCheck).toBeDefined();
		expect(nameCheck?.passed).toBe(true);
		expect(nameCheck?.details).toHaveLength(0);
	});

	test("identifiers used only once are tracked without issues", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(
			specPath,
			`# Feature: API

## Acceptance criteria
- User creation works
- User deletion works
`,
		);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Tasks
- T001: Implement \`createUser\` in user service
- T002: Implement \`deleteUser\` in user service
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const nameCheck = result.value.checks.find(
			(c) => c.name === "name-consistency",
		);
		expect(nameCheck).toBeDefined();
		// Single-use names are fine — no inconsistency to detect
		expect(nameCheck?.passed).toBe(true);
	});

	// --- Test-first ordering ---
	test("test task before implementation passes", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(
			specPath,
			`# Feature: Auth

## Acceptance criteria
- Login works
`,
		);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Tasks
- T001: Write tests for login endpoint
- T002: Implement login endpoint
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const testFirst = result.value.checks.find((c) => c.name === "test-first");
		expect(testFirst).toBeDefined();
		expect(testFirst?.passed).toBe(true);
		expect(testFirst?.details).toHaveLength(0);
	});

	test("implementation task before test task fails with warning", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(
			specPath,
			`# Feature: Auth

## Acceptance criteria
- Login works
`,
		);
		writeFileSync(
			planPath,
			`# Implementation Plan

## Tasks
- T001: Implement login endpoint
- T002: Write tests for login endpoint
`,
		);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const testFirst = result.value.checks.find((c) => c.name === "test-first");
		expect(testFirst).toBeDefined();
		expect(testFirst?.passed).toBe(false);
		expect(testFirst?.details.length).toBeGreaterThan(0);
		// Should mention which test task comes after implementation
		expect(testFirst?.details.some((d) => d.includes("login"))).toBe(true);
	});

	// --- Fully valid plan ---
	test("fully valid plan passes all checks", () => {
		const specPath = join(tmpDir, "spec.md");
		const planPath = join(tmpDir, "plan.md");
		writeFileSync(specPath, VALID_SPEC);
		writeFileSync(planPath, VALID_PLAN);

		const result = verifyPlan(planPath, specPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.passed).toBe(true);
		for (const check of result.value.checks) {
			expect(check.passed).toBe(true);
			expect(check.details).toHaveLength(0);
		}
		expect(result.value.checks).toHaveLength(4);
	});
});
