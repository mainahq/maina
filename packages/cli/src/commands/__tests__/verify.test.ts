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

mock.module("@maina/core", () => ({
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

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { verifyAction } = await import("../verify");

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
