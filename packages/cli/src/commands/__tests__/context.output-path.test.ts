/**
 * Wave 4 — `maina context` default output path is `.maina/CONTEXT.md`.
 *
 * Closes G8: the legacy behaviour wrote `CONTEXT.md` at the repo root,
 * forcing every user to .gitignore it. New behaviour:
 *
 *   - Default path is `<repoRoot>/.maina/CONTEXT.md`.
 *   - `--output <path>` overrides (resolved relative to cwd).
 *   - Existing `<repoRoot>/CONTEXT.md` is **preserved** (not overwritten,
 *     not deleted) unless `--force` is passed.
 *
 * These tests run `contextAction` through a module-level dependency
 * injection point — we avoid shelling out to the Commander program
 * because the context assembler reads real project files (slow, flaky).
 */
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
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mocks ───────────────────────────────────────────────────────────────────

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

// Stub assembleContext — fast, deterministic, no real codebase scan.
mock.module("@mainahq/core", () => ({
	assembleContext: async () => ({
		mode: "explore",
		tokens: 123,
		budget: { total: 1000 },
		layers: [
			{ name: "working", tokens: 50, entries: 2, included: true },
			{ name: "semantic", tokens: 73, entries: 5, included: true },
		],
		text: "# Context\n\nSample assembled context body.\n",
	}),
}));

afterAll(() => {
	mock.restore();
});

// ── Import modules under test AFTER mocks ───────────────────────────────────

const { contextAction } = await import("../context");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-context-path-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = makeTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("maina context — output path (G8)", () => {
	test("default writes to .maina/CONTEXT.md", async () => {
		await contextAction({ cwd: tmpDir });

		const mainaPath = join(tmpDir, ".maina", "CONTEXT.md");
		expect(existsSync(mainaPath)).toBe(true);
		const body = readFileSync(mainaPath, "utf-8");
		expect(body).toContain("Sample assembled context body");
	});

	test("default does NOT write to repo-root CONTEXT.md", async () => {
		await contextAction({ cwd: tmpDir });

		const rootPath = join(tmpDir, "CONTEXT.md");
		expect(existsSync(rootPath)).toBe(false);
	});

	test("creates .maina/ if it does not exist", async () => {
		await contextAction({ cwd: tmpDir });

		expect(existsSync(join(tmpDir, ".maina"))).toBe(true);
		expect(existsSync(join(tmpDir, ".maina", "CONTEXT.md"))).toBe(true);
	});

	test("--output <path> overrides the default", async () => {
		const custom = join(tmpDir, "docs", "MY_CONTEXT.md");
		await contextAction({ cwd: tmpDir, output: custom });

		expect(existsSync(custom)).toBe(true);
		// Default path must NOT exist — --output is exclusive.
		expect(existsSync(join(tmpDir, ".maina", "CONTEXT.md"))).toBe(false);
	});

	test("legacy repo-root CONTEXT.md is preserved without --force", async () => {
		const legacy = join(tmpDir, "CONTEXT.md");
		writeFileSync(legacy, "LEGACY CONTENT — must not be clobbered\n");

		await contextAction({ cwd: tmpDir });

		// Legacy untouched.
		expect(readFileSync(legacy, "utf-8")).toContain("LEGACY CONTENT");
		// New content written to `.maina/` instead.
		expect(existsSync(join(tmpDir, ".maina", "CONTEXT.md"))).toBe(true);
	});

	test("--force overwrites legacy repo-root CONTEXT.md", async () => {
		const legacy = join(tmpDir, "CONTEXT.md");
		writeFileSync(legacy, "LEGACY CONTENT\n");

		await contextAction({ cwd: tmpDir, force: true });

		// With --force, the caller explicitly asked to replace the legacy
		// file — it is now rewritten to the repo root as before.
		const body = readFileSync(legacy, "utf-8");
		expect(body).toContain("Sample assembled context body");
	});

	test("--show does not write anything", async () => {
		await contextAction({ cwd: tmpDir, show: true });

		expect(existsSync(join(tmpDir, ".maina", "CONTEXT.md"))).toBe(false);
		expect(existsSync(join(tmpDir, "CONTEXT.md"))).toBe(false);
	});
});
