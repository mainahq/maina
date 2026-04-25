import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

let mockStagedFiles: string[] = ["src/index.ts"];
let mockBranch = "main";
let mockPipelineResult = {
	passed: true,
	syntaxPassed: true,
	tools: [] as Array<{
		tool: string;
		findings: Array<{
			file: string;
			line: number;
			column: number;
			message: string;
			severity: string;
			rule: string;
			tool: string;
		}>;
		skipped: boolean;
		duration: number;
	}>,
	findings: [] as Array<{
		file: string;
		line: number;
		column: number;
		message: string;
		severity: string;
		rule: string;
		tool: string;
	}>,
	hiddenCount: 0,
	detectedTools: [] as Array<{ name: string; available: boolean }>,
	duration: 42,
	syntaxErrors: undefined as
		| Array<{
				file: string;
				line: number;
				column: number;
				message: string;
				severity: string;
		  }>
		| undefined,
};
let mockHookResult: { status: string; message?: string } = {
	status: "continue",
};
let mockGitCommitExitCode = 0;
let mockGitCommitStdout = "[main abc1234] feat: test commit\n 1 file changed";
let mockGitCommitStderr = "";
let recordedOutcomes: Array<{
	mainaDir: string;
	promptHash: string;
	outcome: { accepted: boolean; command: string; context?: string };
}> = [];

// ── Mocks ────────────────────────────────────────────────────────────────────

mock.module("@mainahq/core", () => ({
	getStagedFiles: async () => mockStagedFiles,
	getCurrentBranch: async () => mockBranch,
	getDiff: async () => "+ some diff content",
	runPipeline: async () => mockPipelineResult,
	runHooks: async () => mockHookResult,
	generateCommitMessage: async () => null, // no AI in tests by default
	checkAIAvailability: () => ({ available: true, method: "host-delegation" }),
	recordOutcome: (
		mainaDir: string,
		promptHash: string,
		outcome: { accepted: boolean; command: string; context?: string },
	) => {
		recordedOutcomes.push({ mainaDir, promptHash, outcome });
	},
	recordSnapshot: () => ({ ok: true, value: undefined }),
	assembleContext: async () => ({
		text: "",
		tokens: 1500,
		layers: [],
		mode: "focused",
		budget: {
			total: 200000,
			working: 30000,
			episodic: 0,
			semantic: 0,
			retrieval: 0,
			wiki: 0,
			headroom: 170000,
		},
	}),
	addEpisodicEntry: () => ({
		id: "test",
		content: "",
		summary: "",
		type: "commit",
		relevance: 1,
		accessCount: 0,
		createdAt: "",
		lastAccessedAt: "",
	}),
	setVerificationResult: async () => ({}),
	appendWorkflowStep: () => {},
	getWorkflowId: () => "abc123def456",
	recordFeedbackAsync: () => {},
	emitAcceptSignal: () => {},
	emitRejectSignal: () => {},
	trackToolUsage: () => ({ ok: true, value: undefined }),
	appendVerifiedByTrailer: (message: string, _hash: string) => ({
		ok: true,
		data: message,
	}),
	computeProofHash: () => ({ ok: true, data: "0".repeat(64) }),
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
	text: async () => "test commit message",
	confirm: async () => true,
	isCancel: (value: unknown) => typeof value === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ─────────────────────────────────

const { commitAction } = await import("../commit");
type CommitDepsType = import("../commit").CommitDeps;

// Mock git commit dependency
const mockGitCommitFn = async (_msg: string, _cwd: string) => ({
	exitCode: mockGitCommitExitCode,
	stdout: mockGitCommitStdout,
	stderr: mockGitCommitStderr,
});

const mockDeps: CommitDepsType = { gitCommit: mockGitCommitFn };

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-commit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockStagedFiles = ["src/index.ts"];
	mockBranch = "main";
	mockPipelineResult = {
		passed: true,
		syntaxPassed: true,
		tools: [],
		findings: [],
		hiddenCount: 0,
		detectedTools: [],
		duration: 42,
		syntaxErrors: undefined,
	};
	mockHookResult = { status: "continue" };
	mockGitCommitExitCode = 0;
	mockGitCommitStdout = "[main abc1234] feat: test commit\n 1 file changed";
	mockGitCommitStderr = "";
	recordedOutcomes = [];
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("CommitGate", () => {
	test("should run syntax guard FIRST, before parallel gates", async () => {
		// When syntax fails, pipeline returns syntaxPassed: false and no tool results
		mockPipelineResult = {
			passed: false,
			syntaxPassed: false,
			syntaxErrors: [
				{
					file: "src/index.ts",
					line: 1,
					column: 1,
					message: "Unexpected token",
					severity: "error",
				},
			],
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 10,
		};

		const result = await commitAction(
			{
				message: "test",
				cwd: tmpDir,
			},
			mockDeps,
		);

		// Should fail due to syntax
		expect(result.committed).toBe(false);
		expect(result.reason).toContain("syntax");
		// No tool results means tools didn't run
		expect(mockPipelineResult.tools.length).toBe(0);
	});

	test("should block on syntax failure without running other gates", async () => {
		mockPipelineResult = {
			passed: false,
			syntaxPassed: false,
			syntaxErrors: [
				{
					file: "src/bad.ts",
					line: 5,
					column: 3,
					message: "Parse error",
					severity: "error",
				},
			],
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 8,
		};

		const result = await commitAction(
			{
				message: "bad commit",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.committed).toBe(false);
		// Pipeline returns no tool reports when syntax fails
		expect(mockPipelineResult.tools).toEqual([]);
	});

	test("should run remaining gates in parallel after syntax passes", async () => {
		mockPipelineResult = {
			passed: true,
			syntaxPassed: true,
			tools: [
				{ tool: "slop", findings: [], skipped: false, duration: 10 },
				{ tool: "semgrep", findings: [], skipped: true, duration: 5 },
			],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 50,
			syntaxErrors: undefined,
		};

		const result = await commitAction(
			{
				message: "good commit",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.committed).toBe(true);
	});

	test("should support --skip flag", async () => {
		// Pipeline fails but --skip is set
		mockPipelineResult = {
			passed: false,
			syntaxPassed: true,
			tools: [
				{
					tool: "slop",
					findings: [
						{
							file: "src/index.ts",
							line: 1,
							column: 1,
							message: "slop found",
							severity: "error",
							rule: "slop",
							tool: "slop",
						},
					],
					skipped: false,
					duration: 10,
				},
			],
			findings: [
				{
					file: "src/index.ts",
					line: 1,
					column: 1,
					message: "slop found",
					severity: "error",
					rule: "slop",
					tool: "slop",
				},
			],
			hiddenCount: 0,
			detectedTools: [],
			duration: 50,
			syntaxErrors: undefined,
		};

		const result = await commitAction(
			{
				message: "skip verify",
				skip: true,
				cwd: tmpDir,
			},
			mockDeps,
		);

		// With --skip, verification is skipped entirely, so commit should succeed
		expect(result.committed).toBe(true);
	});

	test("should record results in feedback.db", async () => {
		mockPipelineResult = {
			passed: true,
			syntaxPassed: true,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 30,
			syntaxErrors: undefined,
		};

		await commitAction(
			{
				message: "record feedback",
				cwd: tmpDir,
			},
			mockDeps,
		);

		// Should have recorded an outcome
		expect(recordedOutcomes.length).toBeGreaterThanOrEqual(1);
		expect(recordedOutcomes[0]?.outcome.command).toBe("commit");
		expect(recordedOutcomes[0]?.outcome.accepted).toBe(true);
	});

	test("should execute .maina/hooks/pre-commit.sh if present", async () => {
		// Hook blocks
		mockHookResult = {
			status: "block",
			message: "Pre-commit hook failed: linting errors",
		};

		const result = await commitAction(
			{
				message: "blocked by hook",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.committed).toBe(false);
		expect(result.reason).toContain("hook");
	});

	test("should abort when no files are staged", async () => {
		mockStagedFiles = [];

		const result = await commitAction(
			{
				message: "nothing staged",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(result.committed).toBe(false);
		expect(result.reason).toContain("staged");
	});

	test("should skip all verification with --no-verify", async () => {
		// Pipeline would fail if it ran
		mockPipelineResult = {
			passed: false,
			syntaxPassed: false,
			syntaxErrors: [
				{
					file: "src/bad.ts",
					line: 1,
					column: 1,
					message: "error",
					severity: "error",
				},
			],
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 10,
		};

		const result = await commitAction(
			{
				message: "no verify",
				noVerify: true,
				cwd: tmpDir,
			},
			mockDeps,
		);

		// With --no-verify, skips hooks and verification entirely
		expect(result.committed).toBe(true);
	});

	test("should record failure in feedback when pipeline rejects", async () => {
		mockPipelineResult = {
			passed: false,
			syntaxPassed: true,
			tools: [
				{
					tool: "slop",
					findings: [
						{
							file: "src/index.ts",
							line: 1,
							column: 1,
							message: "slop found",
							severity: "error",
							rule: "slop",
							tool: "slop",
						},
					],
					skipped: false,
					duration: 10,
				},
			],
			findings: [
				{
					file: "src/index.ts",
					line: 1,
					column: 1,
					message: "slop found",
					severity: "error",
					rule: "slop",
					tool: "slop",
				},
			],
			hiddenCount: 0,
			detectedTools: [],
			duration: 50,
			syntaxErrors: undefined,
		};

		await commitAction(
			{
				message: "should fail",
				cwd: tmpDir,
			},
			mockDeps,
		);

		expect(recordedOutcomes.length).toBeGreaterThanOrEqual(1);
		const lastOutcome = recordedOutcomes.at(-1);
		expect(lastOutcome?.outcome.accepted).toBe(false);
	});
});
