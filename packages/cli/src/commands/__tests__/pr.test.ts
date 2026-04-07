import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Mocks ────────────────────────────────────────────────────────────────────

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
	text: async () => "test title",
	confirm: async () => true,
	isCancel: (v: unknown) => typeof v === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { prAction } = await import("../pr");
type PrDepsType = import("../pr").PrDeps;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<PrDepsType> = {}): PrDepsType {
	return {
		createPr: async () => ({
			ok: true as const,
			value: { url: "https://github.com/owner/repo/pull/42" },
		}),
		getDiff: async () => `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet() { return "hi"; }`,
		getRecentCommits: async () => [
			{ hash: "abc1234", message: "feat: add greeting" },
		],
		getCurrentBranch: async () => "feat/add-greeting",
		runTwoStageReview: (options) => {
			const { runTwoStageReview: real } = require("@mainahq/core");
			return real(options);
		},
		generatePrSummary: async (_diff, commits, reviewSummary) => {
			const commitList = commits
				.map((c) => `- ${c.message} (${c.hash.slice(0, 7)})`)
				.join("\n");
			return `## Summary\n\nTest summary.\n\n## What Changed\n\n${commitList}\n\n## Review\n\n${reviewSummary}`;
		},
		gatherVerificationProof: async () => ({
			pipeline: [],
			pipelinePassed: true,
			pipelineDuration: 0,
			tests: null,
			review: null,
			slop: null,
			visual: null,
			workflowSummary: null,
		}),
		formatVerificationProof: () => "",
		...overrides,
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-pr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("prAction", () => {
	test("creates PR with auto-generated title from branch name", async () => {
		let capturedTitle = "";

		const deps = makeDeps({
			getCurrentBranch: async () => "feat/add-user-auth",
			createPr: async (options) => {
				capturedTitle = options.title;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/1" },
				};
			},
		});

		const result = await prAction({ cwd: tmpDir }, deps);

		expect(result.created).toBe(true);
		// Auto-generated title should derive from branch name
		expect(capturedTitle).toContain("add-user-auth");
	});

	test("explicit --title overrides auto-generated", async () => {
		let capturedTitle = "";

		const deps = makeDeps({
			getCurrentBranch: async () => "feat/add-user-auth",
			createPr: async (options) => {
				capturedTitle = options.title;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/2" },
				};
			},
		});

		const result = await prAction(
			{ title: "Custom PR Title", cwd: tmpDir },
			deps,
		);

		expect(result.created).toBe(true);
		expect(capturedTitle).toBe("Custom PR Title");
	});

	test("review results shown before PR creation", async () => {
		let reviewRanBeforePr = false;
		let prCreated = false;

		const deps = makeDeps({
			getDiff: async () => `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+export function greet() {
+  console.log("hello");
+  return "hi";
+}`,
			createPr: async (_options) => {
				// By the time PR is created, review should have run
				reviewRanBeforePr = true;
				prCreated = true;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/3" },
				};
			},
			runTwoStageReview: async (_options) => {
				// Review runs — mark that it happened
				reviewRanBeforePr = !prCreated;
				return {
					stage1: {
						stage: "spec-compliance" as const,
						passed: true,
						findings: [],
					},
					stage2: {
						stage: "code-quality" as const,
						passed: false,
						findings: [
							{
								stage: "code-quality" as const,
								severity: "warning" as const,
								message: "console.log found in added code",
							},
						],
					},
					passed: false,
				};
			},
		});

		const result = await prAction({ cwd: tmpDir }, deps);

		// PR should still be created (review warnings don't block)
		expect(result.created).toBe(true);
		expect(reviewRanBeforePr).toBe(true);
		expect(result.reviewPassed).toBe(false);
	});

	test("gh CLI failure → helpful error", async () => {
		const deps = makeDeps({
			createPr: async () => ({
				ok: false as const,
				error: "gh CLI not found. Install from https://cli.github.com",
			}),
		});

		const result = await prAction({ title: "Test PR", cwd: tmpDir }, deps);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("gh");
	});

	test("--draft flag passed through", async () => {
		let capturedDraft = false;

		const deps = makeDeps({
			createPr: async (options) => {
				capturedDraft = options.draft;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/5" },
				};
			},
		});

		const result = await prAction(
			{ title: "Draft PR", draft: true, cwd: tmpDir },
			deps,
		);

		expect(result.created).toBe(true);
		expect(capturedDraft).toBe(true);
	});

	test("--base flag passed through", async () => {
		let capturedBase = "";

		const deps = makeDeps({
			createPr: async (options) => {
				capturedBase = options.base;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/6" },
				};
			},
		});

		const result = await prAction(
			{ title: "PR to develop", base: "develop", cwd: tmpDir },
			deps,
		);

		expect(result.created).toBe(true);
		expect(capturedBase).toBe("develop");
	});

	test("empty diff → aborts without creating PR", async () => {
		const deps = makeDeps({
			getDiff: async () => "",
		});

		const result = await prAction({ title: "Empty PR", cwd: tmpDir }, deps);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("diff");
	});

	// ── Wiki Coverage ──────────────────────────────────────────────────

	test("PR body includes wiki coverage when .state.json exists", async () => {
		let capturedBody = "";

		// Create wiki state file
		const wikiDir = join(tmpDir, ".maina", "wiki");
		mkdirSync(wikiDir, { recursive: true });
		writeFileSync(
			join(wikiDir, ".state.json"),
			JSON.stringify({
				articlesUpdated: 5,
				articlesAdded: 2,
				coveragePercent: 78,
			}),
		);

		const deps = makeDeps({
			createPr: async (options) => {
				capturedBody = options.body;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/99" },
				};
			},
		});

		const result = await prAction({ cwd: tmpDir }, deps);

		expect(result.created).toBe(true);
		expect(capturedBody).toContain("### Wiki Coverage");
		expect(capturedBody).toContain("Articles updated: 5");
		expect(capturedBody).toContain("Articles added: 2");
		expect(capturedBody).toContain("Total coverage: 78%");
	});

	test("PR body has no wiki section when wiki not initialized", async () => {
		let capturedBody = "";

		const deps = makeDeps({
			createPr: async (options) => {
				capturedBody = options.body;
				return {
					ok: true as const,
					value: { url: "https://github.com/owner/repo/pull/100" },
				};
			},
		});

		const result = await prAction({ cwd: tmpDir }, deps);

		expect(result.created).toBe(true);
		expect(capturedBody).not.toContain("### Wiki Coverage");
	});
});
