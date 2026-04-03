import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
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
	text: async () => "",
	confirm: async () => true,
	isCancel: (v: unknown) => typeof v === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { reviewDesignAction } = await import("../review-design");
type ReviewDesignDepsType = import("../review-design").ReviewDesignDeps;

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-review-design-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("reviewDesignAction", () => {
	test("reviews ADR by number (finds file in adr/)", async () => {
		const adrDir = join(tmpDir, "adr");
		mkdirSync(adrDir, { recursive: true });
		const adrPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(
			adrPath,
			"# 0001. Use Bun\n\n## Status\n\nAccepted\n\n## Context\n\nNeed fast runtime.\n\n## Decision\n\nUse Bun.\n\n## Consequences\n\n- Fast\n",
		);

		const mockDeps: ReviewDesignDepsType = {
			buildReviewContext: async (_adrPath, _adrDir, _mainaDir) => ({
				ok: true,
				value: {
					targetAdr: {
						path: adrPath,
						content:
							"# 0001. Use Bun\n\n## Status\n\nAccepted\n\n## Context\n\nNeed fast runtime.\n\n## Decision\n\nUse Bun.\n\n## Consequences\n\n- Fast\n",
						title: "Use Bun",
					},
					existingAdrs: [],
					constitution: null,
				},
			}),
			reviewDesign: (_context) => ({
				ok: true,
				value: {
					adrPath,
					findings: [],
					passed: true,
					sectionsPresent: ["Status", "Context", "Decision", "Consequences"],
					sectionsMissing: [],
				},
			}),
			findAdrByNumber: async (_adrDir, _num) => ({
				ok: true,
				value: adrPath,
			}),
		};

		const result = await reviewDesignAction(
			{ adr: "0001", cwd: tmpDir },
			mockDeps,
		);

		expect(result.reviewed).toBe(true);
		expect(result.passed).toBe(true);
	});

	test("reviews ADR by path", async () => {
		const adrDir = join(tmpDir, "adr");
		mkdirSync(adrDir, { recursive: true });
		const adrPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(
			adrPath,
			"# 0001. Use Bun\n\n## Status\n\nAccepted\n\n## Context\n\nRuntime.\n\n## Decision\n\nBun.\n\n## Consequences\n\n- Fast\n",
		);

		const mockDeps: ReviewDesignDepsType = {
			buildReviewContext: async (_adrPath, _adrDir, _mainaDir) => ({
				ok: true,
				value: {
					targetAdr: {
						path: adrPath,
						content:
							"# 0001. Use Bun\n\n## Status\n\nAccepted\n\n## Context\n\nRuntime.\n\n## Decision\n\nBun.\n\n## Consequences\n\n- Fast\n",
						title: "Use Bun",
					},
					existingAdrs: [],
					constitution: null,
				},
			}),
			reviewDesign: (_context) => ({
				ok: true,
				value: {
					adrPath,
					findings: [],
					passed: true,
					sectionsPresent: ["Status", "Context", "Decision", "Consequences"],
					sectionsMissing: [],
				},
			}),
			findAdrByNumber: async () => ({
				ok: false,
				error: "not needed",
			}),
		};

		const result = await reviewDesignAction(
			{ adr: adrPath, cwd: tmpDir },
			mockDeps,
		);

		expect(result.reviewed).toBe(true);
		expect(result.passed).toBe(true);
	});

	test("displays findings", async () => {
		const adrPath = join(tmpDir, "adr", "0002-no-status.md");

		const mockDeps: ReviewDesignDepsType = {
			buildReviewContext: async () => ({
				ok: true,
				value: {
					targetAdr: {
						path: adrPath,
						content: "# 0002. No Status\n\n## Context\n\nSomething.\n",
						title: "No Status",
					},
					existingAdrs: [],
					constitution: null,
				},
			}),
			reviewDesign: (_context) => ({
				ok: true,
				value: {
					adrPath,
					findings: [
						{
							severity: "error" as const,
							message: 'Missing required section: "## Status"',
							section: "Status",
						},
						{
							severity: "error" as const,
							message: 'Missing required section: "## Decision"',
							section: "Decision",
						},
						{
							severity: "error" as const,
							message: 'Missing required section: "## Consequences"',
							section: "Consequences",
						},
					],
					passed: false,
					sectionsPresent: ["Context"],
					sectionsMissing: ["Status", "Decision", "Consequences"],
				},
			}),
			findAdrByNumber: async () => ({
				ok: true,
				value: adrPath,
			}),
		};

		const result = await reviewDesignAction(
			{ adr: "0002", cwd: tmpDir },
			mockDeps,
		);

		expect(result.reviewed).toBe(true);
		expect(result.passed).toBe(false);
		expect(result.findings?.length).toBe(3);
	});

	test("handles missing ADR gracefully", async () => {
		const mockDeps: ReviewDesignDepsType = {
			buildReviewContext: async () => ({
				ok: false,
				error: "Target ADR not found",
			}),
			reviewDesign: (_context) => ({
				ok: true,
				value: {
					adrPath: "",
					findings: [],
					passed: true,
					sectionsPresent: [],
					sectionsMissing: [],
				},
			}),
			findAdrByNumber: async () => ({
				ok: false,
				error: "No ADR found with number 9999",
			}),
		};

		const result = await reviewDesignAction(
			{ adr: "9999", cwd: tmpDir },
			mockDeps,
		);

		expect(result.reviewed).toBe(false);
		expect(result.reason).toBeDefined();
	});
});
