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

let mockPipelineResult = {
	passed: true,
	syntaxPassed: true,
	syntaxErrors: undefined as
		| Array<{ file: string; line: number; column: number; message: string }>
		| undefined,
	tools: [] as Array<{
		tool: string;
		findings: Array<{
			file: string;
			line: number;
			column?: number;
			message: string;
			severity: string;
			tool: string;
			ruleId?: string;
		}>;
		skipped: boolean;
		duration: number;
	}>,
	findings: [] as Array<{
		file: string;
		line: number;
		column?: number;
		message: string;
		severity: string;
		tool: string;
		ruleId?: string;
	}>,
	hiddenCount: 0,
	detectedTools: [] as Array<{
		name: string;
		command: string;
		version: string | null;
		available: boolean;
	}>,
	duration: 42,
};

let mockFixResult = {
	suggestions: [] as Array<{
		finding: {
			file: string;
			line: number;
			message: string;
			severity: string;
			tool: string;
		};
		diff: string;
		explanation: string;
		confidence: string;
	}>,
	cached: false,
	model: "test-model",
};

let mockStagedFiles: string[] = ["src/index.ts"];
let pipelineCalledWith: Record<string, unknown> | undefined;
let fixCalledWith: { findings: unknown[]; options: unknown } | undefined;

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockAuthResult: {
	ok: boolean;
	value?: { accessToken: string };
	error?: string;
} = {
	ok: true,
	value: { accessToken: "test-token-123" },
};

let mockDiffOutput =
	"diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts";

mock.module("@mainahq/core", () => ({
	runPipeline: async (opts?: Record<string, unknown>) => {
		pipelineCalledWith = opts;
		return mockPipelineResult;
	},
	generateFixes: async (findings: unknown[], options: unknown) => {
		fixCalledWith = { findings, options };
		return mockFixResult;
	},
	getStagedFiles: async () => mockStagedFiles,
	getTrackedFiles: async () => mockStagedFiles,
	// Also export symbols needed by doctor.ts to avoid cross-file mock conflicts
	detectTools: async () => [],
	createCacheManager: () => ({
		stats: () => ({
			l1Hits: 0,
			l2Hits: 0,
			misses: 0,
			totalQueries: 0,
			entriesL1: 0,
			entriesL2: 0,
		}),
		get: () => null,
		set: () => {},
		has: () => false,
		invalidate: () => {},
		clear: () => {},
	}),
	appendWorkflowStep: () => {},
	getCurrentBranch: async () => "feature/test-branch",
	getWorkflowId: () => "abc123def456",
	recordFeedbackAsync: () => {},
	checkAIAvailability: () => ({ available: true, method: "host-delegation" }),
	// Visual verification
	loadVisualConfig: () => ({
		urls: [],
		threshold: 0.001,
		viewport: { width: 1280, height: 720 },
	}),
	runVisualVerification: async () => ({
		findings: [],
		skipped: true,
		screenshotsTaken: 0,
		comparisons: 0,
	}),
	// Cloud
	loadAuthConfig: () => mockAuthResult,
	createCloudClient: () => ({}),
	getDiff: async () => mockDiffOutput,
	// Telemetry (feat 054) — verify.ts now emits maina.verify.{started,
	// completed}. Both functions are safe no-ops here since the mock
	// factory is what the consent-gated client ultimately reaches.
	buildUsageEvent: (
		event: string,
		properties: Record<string, unknown>,
		version: string,
	) => ({
		event,
		properties,
		timestamp: new Date().toISOString(),
		os: process.platform,
		runtime: "bun",
		version,
	}),
	captureUsage: () => {},
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
		message: () => {},
	}),
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { verifyAction, cloudVerifyAction } = await import("../verify");

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockStagedFiles = ["src/index.ts"];
	mockPipelineResult = {
		passed: true,
		syntaxPassed: true,
		syntaxErrors: undefined,
		tools: [],
		findings: [],
		hiddenCount: 0,
		detectedTools: [],
		duration: 42,
	};
	mockFixResult = {
		suggestions: [],
		cached: false,
		model: "test-model",
	};
	pipelineCalledWith = undefined;
	fixCalledWith = undefined;
	mockAuthResult = {
		ok: true,
		value: { accessToken: "test-token-123" },
	};
	mockDiffOutput =
		"diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts";
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("maina verify", () => {
	test("produces unified report with pass result", async () => {
		mockPipelineResult = {
			passed: true,
			syntaxPassed: true,
			syntaxErrors: undefined,
			tools: [
				{ tool: "slop", findings: [], skipped: false, duration: 10 },
				{ tool: "semgrep", findings: [], skipped: true, duration: 5 },
			],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 50,
		};

		const result = await verifyAction({ cwd: tmpDir });

		expect(result.passed).toBe(true);
		expect(result.findingsCount).toBe(0);
		expect(result.duration).toBe(50);
	});

	test("produces unified report with findings", async () => {
		const slopFinding = {
			file: "src/api.ts",
			line: 42,
			message: "console.log in production",
			severity: "warning" as const,
			tool: "slop",
		};
		const semgrepFinding = {
			file: "src/auth.ts",
			line: 18,
			message: "SQL injection risk",
			severity: "error" as const,
			tool: "semgrep",
			ruleId: "sql-injection",
		};
		const findings = [slopFinding, semgrepFinding];

		mockPipelineResult = {
			passed: false,
			syntaxPassed: true,
			syntaxErrors: undefined,
			tools: [
				{ tool: "slop", findings: [slopFinding], skipped: false, duration: 10 },
				{
					tool: "semgrep",
					findings: [semgrepFinding],
					skipped: false,
					duration: 15,
				},
			],
			findings,
			hiddenCount: 3,
			detectedTools: [],
			duration: 100,
		};

		const result = await verifyAction({ cwd: tmpDir });

		expect(result.passed).toBe(false);
		expect(result.findingsCount).toBe(2);
		expect(result.hiddenCount).toBe(3);
	});

	test("uses diff-only mode by default", async () => {
		await verifyAction({ cwd: tmpDir });

		expect(pipelineCalledWith).toBeDefined();
		// diffOnly should be true by default (or undefined, which defaults to true in pipeline)
		expect(pipelineCalledWith?.diffOnly).not.toBe(false);
	});

	test("passes --all flag to disable diff-only mode", async () => {
		await verifyAction({ all: true, cwd: tmpDir });

		expect(pipelineCalledWith).toBeDefined();
		expect(pipelineCalledWith?.diffOnly).toBe(false);
	});

	test("passes --base flag to pipeline", async () => {
		await verifyAction({ base: "develop", cwd: tmpDir });

		expect(pipelineCalledWith).toBeDefined();
		expect(pipelineCalledWith?.baseBranch).toBe("develop");
	});

	test("--json outputs structured JSON result", async () => {
		mockPipelineResult = {
			passed: true,
			syntaxPassed: true,
			syntaxErrors: undefined,
			tools: [{ tool: "slop", findings: [], skipped: false, duration: 10 }],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 42,
		};

		const result = await verifyAction({ json: true, cwd: tmpDir });

		expect(result.json).toBeDefined();
		const parsed = JSON.parse(result.json ?? "{}");
		expect(parsed.passed).toBe(true);
		expect(parsed.findings).toEqual([]);
		expect(parsed.duration).toBe(42);
	});

	test("--fix triggers AI fix generation when findings exist", async () => {
		const finding = {
			file: "src/api.ts",
			line: 42,
			message: "console.log in production",
			severity: "warning" as const,
			tool: "slop",
		};

		mockPipelineResult = {
			passed: false,
			syntaxPassed: true,
			syntaxErrors: undefined,
			tools: [
				{ tool: "slop", findings: [finding], skipped: false, duration: 10 },
			],
			findings: [finding],
			hiddenCount: 0,
			detectedTools: [],
			duration: 50,
		};

		mockFixResult = {
			suggestions: [
				{
					finding,
					diff: "--- a/src/api.ts\n+++ b/src/api.ts\n@@ -42 +42 @@\n-console.log('debug');\n+// removed",
					explanation: "Remove console.log from production",
					confidence: "high",
				},
			],
			cached: false,
			model: "test-model",
		};

		const result = await verifyAction({ fix: true, cwd: tmpDir });

		expect(fixCalledWith).toBeDefined();
		expect(fixCalledWith?.findings).toHaveLength(1);
		expect(result.fixSuggestions).toHaveLength(1);
	});

	test("--fix does not run when no findings", async () => {
		mockPipelineResult = {
			passed: true,
			syntaxPassed: true,
			syntaxErrors: undefined,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 20,
		};

		await verifyAction({ fix: true, cwd: tmpDir });

		// generateFixes should not be called with empty findings
		expect(fixCalledWith).toBeUndefined();
	});

	test("reports syntax errors when syntax guard fails", async () => {
		mockPipelineResult = {
			passed: false,
			syntaxPassed: false,
			syntaxErrors: [
				{
					file: "src/bad.ts",
					line: 5,
					column: 3,
					message: "Unexpected token",
				},
			],
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 8,
		};

		const result = await verifyAction({ cwd: tmpDir });

		expect(result.passed).toBe(false);
		expect(result.syntaxErrors).toHaveLength(1);
	});

	test("uses staged files by default (not --all)", async () => {
		mockStagedFiles = ["src/foo.ts", "src/bar.ts"];

		await verifyAction({ cwd: tmpDir });

		expect(pipelineCalledWith).toBeDefined();
		expect(pipelineCalledWith?.files).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	test("passes all tracked files when --all is set", async () => {
		await verifyAction({ all: true, cwd: tmpDir });

		expect(pipelineCalledWith).toBeDefined();
		// When --all is set, all tracked files are passed
		expect(Array.isArray(pipelineCalledWith?.files)).toBe(true);
		expect(pipelineCalledWith?.diffOnly).toBe(false);
	});
});

// ── Cloud Verify Tests ──────────────────────────────────────────────────────

/** Helper to build a mock CloudClient for tests. */
function createMockClient(overrides?: {
	submitVerify?: (...args: unknown[]) => Promise<unknown>;
	getVerifyStatus?: (...args: unknown[]) => Promise<unknown>;
	getVerifyResult?: (...args: unknown[]) => Promise<unknown>;
}) {
	return {
		health: async () => ({ ok: true as const, value: { status: "ok" } }),
		getPrompts: async () => ({ ok: true as const, value: [] }),
		putPrompts: async () => ({ ok: true as const, value: undefined }),
		getTeam: async () => ({
			ok: true as const,
			value: {
				id: "t1",
				name: "team",
				plan: "free",
				seats: { used: 1, total: 5 },
			},
		}),
		getTeamMembers: async () => ({ ok: true as const, value: [] }),
		inviteTeamMember: async () => ({
			ok: true as const,
			value: { invited: true },
		}),
		postFeedback: async () => ({
			ok: true as const,
			value: { recorded: true },
		}),
		submitVerify:
			overrides?.submitVerify ??
			(async () => ({
				ok: true as const,
				value: { jobId: "job-001" },
			})),
		getVerifyStatus:
			overrides?.getVerifyStatus ??
			(async () => ({
				ok: true as const,
				value: { status: "done", currentStep: "Complete" },
			})),
		getVerifyResult:
			overrides?.getVerifyResult ??
			(async () => ({
				ok: true as const,
				value: {
					id: "job-001",
					status: "done",
					passed: true,
					findings: [],
					findingsErrors: 0,
					findingsWarnings: 0,
					proofKey: "proof-abc123",
					durationMs: 1200,
				},
			})),
	};
}

/** No-op sleep for tests. */
const noopSleep = async () => {};

describe("maina verify --cloud", () => {
	test("passes when cloud verification succeeds with no findings", async () => {
		const client = createMockClient();

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(true);
		expect(result.findingsCount).toBe(0);
		expect(result.duration).toBe(1200);
		expect(result.proofKey).toBe("proof-abc123");
	});

	test("fails when cloud verification finds issues", async () => {
		const client = createMockClient({
			getVerifyResult: async () => ({
				ok: true,
				value: {
					id: "job-002",
					status: "done",
					passed: false,
					findings: [
						{
							tool: "semgrep",
							file: "src/auth.ts",
							line: 18,
							message: "SQL injection risk",
							severity: "error",
							ruleId: "sql-injection",
						},
						{
							tool: "slop",
							file: "src/api.ts",
							line: 42,
							message: "console.log in production",
							severity: "warning",
						},
					],
					findingsErrors: 1,
					findingsWarnings: 1,
					proofKey: null,
					durationMs: 2500,
				},
			}),
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
		expect(result.findingsCount).toBe(2);
		expect(result.proofKey).toBeNull();
	});

	test("returns JSON output when --json is set", async () => {
		const client = createMockClient();

		const result = await cloudVerifyAction(
			{ cloud: true, json: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.json).toBeDefined();
		const parsed = JSON.parse(result.json ?? "{}");
		expect(parsed.passed).toBe(true);
		expect(parsed.cloud).toBe(true);
		expect(parsed.proofKey).toBe("proof-abc123");
		expect(parsed.duration).toBe(1200);
	});

	test("fails when auth is not available and no client injected", async () => {
		mockAuthResult = {
			ok: false,
			error: "Not logged in. Run `maina login` first.",
		};

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{ sleepFn: noopSleep },
		);

		expect(result.passed).toBe(false);
		expect(result.findingsCount).toBe(0);
	});

	test("fails when diff is empty", async () => {
		mockDiffOutput = "";
		const client = createMockClient();

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
		expect(result.findingsCount).toBe(0);
	});

	test("fails when submit returns error", async () => {
		const client = createMockClient({
			submitVerify: async () => ({
				ok: false,
				error: "Rate limit exceeded",
			}),
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
		expect(result.findingsCount).toBe(0);
	});

	test("polls status until done", async () => {
		let pollCount = 0;
		const client = createMockClient({
			getVerifyStatus: async () => {
				pollCount++;
				if (pollCount < 3) {
					return {
						ok: true,
						value: {
							status: "running",
							currentStep: `Step ${pollCount}`,
						},
					};
				}
				return {
					ok: true,
					value: { status: "done", currentStep: "Complete" },
				};
			},
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(true);
		expect(pollCount).toBe(3);
	});

	test("fails when status poll returns error", async () => {
		const client = createMockClient({
			getVerifyStatus: async () => ({
				ok: false,
				error: "Internal server error",
			}),
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
	});

	test("fails when result fetch returns error", async () => {
		const client = createMockClient({
			getVerifyResult: async () => ({
				ok: false,
				error: "Job not found",
			}),
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
	});

	test("handles failed verification status", async () => {
		const client = createMockClient({
			getVerifyStatus: async () => ({
				ok: true,
				value: { status: "failed", currentStep: "Pipeline error" },
			}),
			getVerifyResult: async () => ({
				ok: true,
				value: {
					id: "job-003",
					status: "failed",
					passed: false,
					findings: [],
					findingsErrors: 0,
					findingsWarnings: 0,
					proofKey: null,
					durationMs: 500,
				},
			}),
		});

		const result = await cloudVerifyAction(
			{ cloud: true, cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(result.passed).toBe(false);
	});

	test("uses custom base branch", async () => {
		let submittedPayload: Record<string, unknown> | undefined;
		const client = createMockClient({
			submitVerify: async (payload: unknown) => {
				submittedPayload = payload as Record<string, unknown>;
				return { ok: true, value: { jobId: "job-004" } };
			},
		});

		await cloudVerifyAction(
			{ cloud: true, base: "develop", cwd: tmpDir },
			{
				client: client as unknown as import("@mainahq/core").CloudClient,
				sleepFn: noopSleep,
			},
		);

		expect(submittedPayload).toBeDefined();
		expect(submittedPayload?.baseBranch).toBe("develop");
	});
});
