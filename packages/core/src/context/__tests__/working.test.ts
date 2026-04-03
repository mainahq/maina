import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// We mock getCurrentBranch before importing the module under test.
// Use the absolute path so it matches how working.ts resolves its import.
const GIT_MODULE = resolve(import.meta.dir, "../../git/index");

// Import real module first so we can spread its exports
const realGit = await import("../../git/index");

const mockGetCurrentBranch = mock(async (_cwd?: string) => "main");

mock.module(GIT_MODULE, () => ({
	...realGit,
	getCurrentBranch: mockGetCurrentBranch,
}));

// Import after mocking
const {
	loadWorkingContext,
	saveWorkingContext,
	trackFile,
	setVerificationResult,
	resetWorkingContext,
	assembleWorkingText,
} = await import("../working");

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
	const dir = join(
		tmpdir(),
		`maina-working-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("loadWorkingContext", () => {
	let mainaDir: string;
	let repoRoot: string;

	beforeEach(() => {
		mainaDir = makeTempDir();
		repoRoot = makeTempDir();
		mockGetCurrentBranch.mockImplementation(async () => "main");
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("returns empty context when no file exists", async () => {
		const ctx = await loadWorkingContext(mainaDir, repoRoot);
		expect(ctx.branch).toBe("main");
		expect(ctx.planContent).toBeNull();
		expect(ctx.touchedFiles).toEqual([]);
		expect(ctx.lastVerification).toBeNull();
		expect(typeof ctx.updatedAt).toBe("string");
	});

	it("round-trips save and load", async () => {
		const ctx = await loadWorkingContext(mainaDir, repoRoot);
		ctx.touchedFiles = ["src/foo.ts", "src/bar.ts"];
		ctx.branch = "main";
		await saveWorkingContext(mainaDir, ctx);

		const loaded = await loadWorkingContext(mainaDir, repoRoot);
		expect(loaded.touchedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
		expect(loaded.branch).toBe("main");
	});

	it("resets context when branch has changed since last save", async () => {
		// Save a context recorded on branch "feature"
		const ctx = resetWorkingContext(mainaDir);
		ctx.branch = "feature";
		ctx.touchedFiles = ["old-file.ts"];
		await saveWorkingContext(mainaDir, ctx);

		// Now git says we are on "main"
		mockGetCurrentBranch.mockImplementation(async () => "main");

		const loaded = await loadWorkingContext(mainaDir, repoRoot);
		expect(loaded.branch).toBe("main");
		expect(loaded.touchedFiles).toEqual([]);
	});

	it("loads PLAN.md content from repoRoot if it exists", async () => {
		await Bun.write(join(repoRoot, "PLAN.md"), "# My Plan\nDo the thing.");
		const ctx = await loadWorkingContext(mainaDir, repoRoot);
		expect(ctx.planContent).toBe("# My Plan\nDo the thing.");
	});

	it("keeps planContent null when PLAN.md is absent", async () => {
		const ctx = await loadWorkingContext(mainaDir, repoRoot);
		expect(ctx.planContent).toBeNull();
	});
});

describe("trackFile", () => {
	let mainaDir: string;
	let repoRoot: string;

	beforeEach(() => {
		mainaDir = makeTempDir();
		repoRoot = makeTempDir();
		mockGetCurrentBranch.mockImplementation(async () => "main");
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("adds a file to touchedFiles and persists", async () => {
		const ctx = await trackFile(mainaDir, repoRoot, "src/hello.ts");
		expect(ctx.touchedFiles).toContain("src/hello.ts");

		const reloaded = await loadWorkingContext(mainaDir, repoRoot);
		expect(reloaded.touchedFiles).toContain("src/hello.ts");
	});

	it("does not duplicate files already tracked", async () => {
		await trackFile(mainaDir, repoRoot, "src/hello.ts");
		const ctx = await trackFile(mainaDir, repoRoot, "src/hello.ts");
		const occurrences = ctx.touchedFiles.filter((f) => f === "src/hello.ts");
		expect(occurrences.length).toBe(1);
	});
});

describe("setVerificationResult", () => {
	let mainaDir: string;
	let repoRoot: string;

	beforeEach(() => {
		mainaDir = makeTempDir();
		repoRoot = makeTempDir();
		mockGetCurrentBranch.mockImplementation(async () => "main");
	});

	afterEach(() => {
		rmSync(mainaDir, { recursive: true, force: true });
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("stores the last verification result and persists it", async () => {
		const result = {
			passed: true,
			checks: [{ name: "lint", passed: true, output: "ok" }],
			timestamp: new Date().toISOString(),
		};

		const ctx = await setVerificationResult(mainaDir, repoRoot, result);
		expect(ctx.lastVerification).toEqual(result);

		const reloaded = await loadWorkingContext(mainaDir, repoRoot);
		expect(reloaded.lastVerification).toEqual(result);
	});
});

describe("assembleWorkingText", () => {
	it("includes branch name and touched files count", () => {
		const ctx = {
			branch: "feature/foo",
			planContent: null,
			touchedFiles: ["a.ts", "b.ts"],
			lastVerification: null,
			updatedAt: new Date().toISOString(),
		};
		const text = assembleWorkingText(ctx);
		expect(text).toContain("feature/foo");
		expect(text).toContain("2");
	});

	it("includes individual touched file paths", () => {
		const ctx = {
			branch: "main",
			planContent: null,
			touchedFiles: ["src/foo.ts", "src/bar.ts"],
			lastVerification: null,
			updatedAt: new Date().toISOString(),
		};
		const text = assembleWorkingText(ctx);
		expect(text).toContain("src/foo.ts");
		expect(text).toContain("src/bar.ts");
	});

	it("includes PLAN.md content when present", () => {
		const ctx = {
			branch: "main",
			planContent: "# Plan\nDo stuff.",
			touchedFiles: [],
			lastVerification: null,
			updatedAt: new Date().toISOString(),
		};
		const text = assembleWorkingText(ctx);
		expect(text).toContain("# Plan\nDo stuff.");
	});

	it("includes verification status when present", () => {
		const ctx = {
			branch: "main",
			planContent: null,
			touchedFiles: [],
			lastVerification: {
				passed: false,
				checks: [{ name: "typecheck", passed: false, output: "3 errors" }],
				timestamp: new Date().toISOString(),
			},
			updatedAt: new Date().toISOString(),
		};
		const text = assembleWorkingText(ctx);
		expect(text.toLowerCase()).toContain("fail");
	});
});
