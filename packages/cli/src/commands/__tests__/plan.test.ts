import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

let mockNextNumber = "001";
let mockNextNumberError: string | null = null;
let mockCreateDirResult: {
	ok: boolean;
	value?: string;
	error?: string;
} | null = null;
let mockScaffoldResult: { ok: boolean; value?: undefined; error?: string } = {
	ok: true,
	value: undefined,
};
let mockVerifyResult: {
	ok: boolean;
	value?: {
		passed: boolean;
		checks: Array<{ name: string; passed: boolean; details: string[] }>;
	};
	error?: string;
} = {
	ok: true,
	value: { passed: true, checks: [] },
};

// Track calls for assertions
let getNextFeatureNumberCalls: string[] = [];
let createFeatureDirCalls: Array<{
	mainaDir: string;
	number: string;
	name: string;
}> = [];
let scaffoldFeatureCalls: string[] = [];
let verifyPlanCalls: Array<{ planPath: string; specPath: string }> = [];

// ── Mocks ────────────────────────────────────────────────────────────────────

mock.module("@maina/core", () => ({
	getNextFeatureNumber: async (mainaDir: string) => {
		getNextFeatureNumberCalls.push(mainaDir);
		if (mockNextNumberError) {
			return { ok: false, error: mockNextNumberError };
		}
		return { ok: true, value: mockNextNumber };
	},
	createFeatureDir: async (mainaDir: string, num: string, name: string) => {
		createFeatureDirCalls.push({ mainaDir, number: num, name });
		if (mockCreateDirResult) return mockCreateDirResult;
		const dir = join(mainaDir, ".maina", "features", `${num}-${name}`);
		mkdirSync(dir, { recursive: true });
		return { ok: true, value: dir };
	},
	scaffoldFeature: async (dir: string) => {
		scaffoldFeatureCalls.push(dir);
		return mockScaffoldResult;
	},
	verifyPlan: (planPath: string, specPath: string) => {
		verifyPlanCalls.push({ planPath, specPath });
		return mockVerifyResult;
	},
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

const { planAction } = await import("../plan");
type PlanDepsType = import("../plan").PlanDeps;

// ── Default mock deps (git operations) ───────────────────────────────────────

let gitCheckoutCalls: Array<{ branch: string; cwd: string }> = [];
let gitAddCalls: Array<{ files: string[]; cwd: string }> = [];
let gitCommitCalls: Array<{ message: string; cwd: string }> = [];

let mockGitCheckoutExitCode = 0;
let mockGitCheckoutStderr = "";
let mockGitCommitExitCode = 0;
let mockGitCommitStdout =
	"[feature/001-test abc1234] feat(core): plan test\n 3 files changed";
let mockGitCommitStderr = "";

const mockDeps: PlanDepsType = {
	gitCheckout: async (branch: string, cwd: string) => {
		gitCheckoutCalls.push({ branch, cwd });
		return { exitCode: mockGitCheckoutExitCode, stderr: mockGitCheckoutStderr };
	},
	gitAdd: async (files: string[], cwd: string) => {
		gitAddCalls.push({ files, cwd });
		return { exitCode: 0 };
	},
	gitCommit: async (message: string, cwd: string) => {
		gitCommitCalls.push({ message, cwd });
		return {
			exitCode: mockGitCommitExitCode,
			stdout: mockGitCommitStdout,
			stderr: mockGitCommitStderr,
		};
	},
};

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockNextNumber = "001";
	mockNextNumberError = null;
	mockCreateDirResult = null;
	mockScaffoldResult = { ok: true, value: undefined };
	mockVerifyResult = {
		ok: true,
		value: { passed: true, checks: [] },
	};

	// Reset call trackers
	getNextFeatureNumberCalls = [];
	createFeatureDirCalls = [];
	scaffoldFeatureCalls = [];
	verifyPlanCalls = [];
	gitCheckoutCalls = [];
	gitAddCalls = [];
	gitCommitCalls = [];

	// Reset git mock state
	mockGitCheckoutExitCode = 0;
	mockGitCheckoutStderr = "";
	mockGitCommitExitCode = 0;
	mockGitCommitStdout =
		"[feature/001-test abc1234] feat(core): plan test\n 3 files changed";
	mockGitCommitStderr = "";
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("planAction", () => {
	test("creates feature directory with correct number (001 for first)", async () => {
		mockNextNumber = "001";

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.featureNumber).toBe("001");
		expect(createFeatureDirCalls.length).toBe(1);
		expect(createFeatureDirCalls[0]?.number).toBe("001");
		expect(createFeatureDirCalls[0]?.name).toBe("user-auth");
	});

	test("creates correct branch name (feature/001-kebab-name)", async () => {
		mockNextNumber = "001";

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.branch).toBe("feature/001-user-auth");
		expect(gitCheckoutCalls.length).toBe(1);
		expect(gitCheckoutCalls[0]?.branch).toBe("feature/001-user-auth");
	});

	test("scaffolds spec.md, plan.md, tasks.md", async () => {
		mockNextNumber = "001";

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(scaffoldFeatureCalls.length).toBe(1);
		// scaffoldFeature should receive the feature directory path
		expect(scaffoldFeatureCalls[0]).toContain("001-user-auth");
	});

	test("returns correct featureNumber and branch in result", async () => {
		mockNextNumber = "003";

		const result = await planAction(
			{ name: "api-gateway", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.featureNumber).toBe("003");
		expect(result.branch).toBe("feature/003-api-gateway");
		expect(result.featureDir).toContain("003-api-gateway");
	});

	test("runs verification checklist when noVerify is false", async () => {
		mockNextNumber = "001";

		await planAction(
			{ name: "user-auth", noVerify: false, cwd: tmpDir },
			mockDeps,
		);

		expect(verifyPlanCalls.length).toBe(1);
		expect(verifyPlanCalls[0]?.planPath).toContain("plan.md");
		expect(verifyPlanCalls[0]?.specPath).toContain("spec.md");
	});

	test("skips verification when noVerify is true", async () => {
		mockNextNumber = "001";

		await planAction(
			{ name: "user-auth", noVerify: true, cwd: tmpDir },
			mockDeps,
		);

		expect(verifyPlanCalls.length).toBe(0);
	});

	test("handles error from getNextFeatureNumber gracefully", async () => {
		mockNextNumberError = "Permission denied: cannot read features dir";

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("feature number");
	});

	test("second feature gets number 002", async () => {
		mockNextNumber = "002";

		const result = await planAction(
			{ name: "data-sync", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.featureNumber).toBe("002");
		expect(result.branch).toBe("feature/002-data-sync");
		expect(createFeatureDirCalls[0]?.number).toBe("002");
	});

	test("handles git checkout failure gracefully", async () => {
		mockNextNumber = "001";
		mockGitCheckoutExitCode = 128;
		mockGitCheckoutStderr =
			"fatal: A branch named 'feature/001-user-auth' already exists.";

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("branch");
	});

	test("handles createFeatureDir failure gracefully", async () => {
		mockNextNumber = "001";
		mockCreateDirResult = {
			ok: false,
			error: "Feature directory already exists",
		};

		const result = await planAction(
			{ name: "user-auth", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("feature directory");
	});

	test("stages scaffolded files and commits", async () => {
		mockNextNumber = "001";

		await planAction({ name: "user-auth", cwd: tmpDir }, mockDeps);

		// Should have called gitAdd with the feature files
		expect(gitAddCalls.length).toBe(1);
		expect(gitAddCalls[0]?.files.length).toBeGreaterThan(0);

		// Should have called gitCommit
		expect(gitCommitCalls.length).toBe(1);
		expect(gitCommitCalls[0]?.message).toContain("001-user-auth");
	});

	test("shows verification warnings without blocking", async () => {
		mockNextNumber = "001";
		mockVerifyResult = {
			ok: true,
			value: {
				passed: false,
				checks: [
					{
						name: "spec-coverage",
						passed: false,
						details: ["Criterion not covered: user login"],
					},
				],
			},
		};

		// Verification warnings should not block creation (the templates
		// always have [NEEDS CLARIFICATION] markers, so warnings are expected)
		const result = await planAction(
			{ name: "user-auth", noVerify: false, cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(verifyPlanCalls.length).toBe(1);
	});

	test("converts feature name with spaces to kebab-case for branch", async () => {
		mockNextNumber = "001";

		const result = await planAction(
			{ name: "My Cool Feature", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		// Branch name should use kebab-case
		expect(result.branch).toBe("feature/001-my-cool-feature");
	});
});
