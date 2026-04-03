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

// ── Mock State ───────────────────────────────────────────────────────────────

let mockClackTextResponses: string[] = [];
let mockClackTextCallIndex = 0;

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
	text: async () => {
		const response = mockClackTextResponses[mockClackTextCallIndex] ?? "";
		mockClackTextCallIndex++;
		return response;
	},
	confirm: async () => true,
	isCancel: (v: unknown) => typeof v === "symbol",
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { designAction } = await import("../design");
type DesignDepsType = import("../design").DesignDeps;

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-design-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockClackTextResponses = [];
	mockClackTextCallIndex = 0;
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("designAction", () => {
	test("creates ADR with --title flag (non-interactive)", async () => {
		let scaffoldCalled = false;
		let capturedTitle = "";
		let capturedNumber = "";

		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async (_adrDir) => ({
				ok: true,
				value: "0001",
			}),
			scaffoldAdr: async (_adrDir, number, title) => {
				scaffoldCalled = true;
				capturedNumber = number;
				capturedTitle = title;
				return {
					ok: true,
					value: join(tmpDir, "adr", "0001-use-bun-runtime.md"),
				};
			},
			listAdrs: async (_adrDir) => ({
				ok: true,
				value: [],
			}),
			openInEditor: async () => {},
		};

		const result = await designAction(
			{ title: "Use Bun Runtime", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.path).toContain("0001-use-bun-runtime.md");
		expect(scaffoldCalled).toBe(true);
		expect(capturedTitle).toBe("Use Bun Runtime");
		expect(capturedNumber).toBe("0001");
	});

	test("--list flag shows existing ADRs", async () => {
		let listCalled = false;

		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async () => ({ ok: true, value: "0003" }),
			scaffoldAdr: async () => ({
				ok: true,
				value: join(tmpDir, "adr", "0001-test.md"),
			}),
			listAdrs: async () => {
				listCalled = true;
				return {
					ok: true,
					value: [
						{
							number: "0001",
							title: "Use Bun Runtime",
							status: "Accepted",
							path: join(tmpDir, "adr", "0001-use-bun-runtime.md"),
						},
						{
							number: "0002",
							title: "Use Biome",
							status: "Proposed",
							path: join(tmpDir, "adr", "0002-use-biome.md"),
						},
					],
				};
			},
			openInEditor: async () => {},
		};

		const result = await designAction({ list: true, cwd: tmpDir }, mockDeps);

		expect(result.listed).toBe(true);
		expect(listCalled).toBe(true);
	});

	test("missing title prompts user", async () => {
		mockClackTextResponses = ["Interactive ADR Title"];

		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async () => ({ ok: true, value: "0001" }),
			scaffoldAdr: async (_adrDir, _number, _title) => {
				return {
					ok: true,
					value: join(tmpDir, "adr", "0001-interactive-adr-title.md"),
				};
			},
			listAdrs: async () => ({ ok: true, value: [] }),
			openInEditor: async () => {},
		};

		const result = await designAction({ cwd: tmpDir }, mockDeps);

		expect(result.created).toBe(true);
		expect(result.path).toContain("0001-interactive-adr-title.md");
	});

	test("returns error when getNextAdrNumber fails", async () => {
		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async () => ({
				ok: false,
				error: "Permission denied",
			}),
			scaffoldAdr: async () => ({
				ok: true,
				value: join(tmpDir, "adr", "0001-test.md"),
			}),
			listAdrs: async () => ({ ok: true, value: [] }),
			openInEditor: async () => {},
		};

		const result = await designAction({ title: "Test", cwd: tmpDir }, mockDeps);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("Permission denied");
	});

	test("returns error when scaffoldAdr fails", async () => {
		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async () => ({ ok: true, value: "0001" }),
			scaffoldAdr: async () => ({
				ok: false,
				error: "Disk full",
			}),
			listAdrs: async () => ({ ok: true, value: [] }),
			openInEditor: async () => {},
		};

		const result = await designAction({ title: "Test", cwd: tmpDir }, mockDeps);

		expect(result.created).toBe(false);
		expect(result.reason).toContain("Disk full");
	});

	test("returns adrNumber in result on success", async () => {
		const mockDeps: DesignDepsType = {
			getNextAdrNumber: async () => ({ ok: true, value: "0005" }),
			scaffoldAdr: async () => ({
				ok: true,
				value: join(tmpDir, "adr", "0005-my-decision.md"),
			}),
			listAdrs: async () => ({ ok: true, value: [] }),
			openInEditor: async () => {},
		};

		const result = await designAction(
			{ title: "My Decision", cwd: tmpDir },
			mockDeps,
		);

		expect(result.created).toBe(true);
		expect(result.adrNumber).toBe("0005");
	});
});
