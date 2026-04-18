import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assembleStackContext, contextHash, summarizeRepo } from "../context";
import { loadUniversalPrompt } from "../prompts";

// Resolve the maina repo root from this test file's location so the test
// works in any checkout (local, CI, dependency tree). __dirname here is
// `packages/core/src/setup/__tests__`, so go up four levels.
const MAINA_REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("assembleStackContext — happy path (maina repo)", () => {
	test("detects TypeScript, bun, biome, bun:test on this repo", async () => {
		const result = await assembleStackContext(MAINA_REPO_ROOT);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const ctx = result.value;
		expect(ctx.languages).toContain("typescript");
		expect(ctx.packageManager).toBe("bun");
		expect(ctx.linters).toContain("biome");
		expect(ctx.testRunners).toContain("bun:test");
		expect(ctx.buildTool).toBe("bunup");
		expect(ctx.isEmpty).toBe(false);
		expect(ctx.repoSize.files).toBeGreaterThan(0);
		expect(Array.isArray(ctx.subprojects)).toBe(true);
		// Monorepo with `packages/*` — should detect subprojects
		expect((ctx.subprojects ?? []).length).toBeGreaterThan(0);
	});
});

describe("assembleStackContext — edge cases", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty repo — isEmpty=true, no languages", async () => {
		// Just a .git dir, no files
		mkdirSync(join(tmpDir, ".git"), { recursive: true });
		const result = await assembleStackContext(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.isEmpty).toBe(true);
		expect(result.value.languages).toEqual([]);
		expect(result.value.packageManager).toBe("unknown");
	});

	test("no package.json — falls back to file extensions (Python)", async () => {
		writeFileSync(join(tmpDir, "main.py"), "print('hi')\n");
		writeFileSync(join(tmpDir, "utils.py"), "def foo(): pass\n");
		const result = await assembleStackContext(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.languages).toContain("python");
		expect(result.value.isEmpty).toBe(false);
	});

	test("detects pip package manager from requirements.txt", async () => {
		writeFileSync(join(tmpDir, "requirements.txt"), "requests==2.0\n");
		writeFileSync(join(tmpDir, "main.py"), "import requests\n");
		const result = await assembleStackContext(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.packageManager).toBe("pip");
		expect(result.value.languages).toContain("python");
	});

	test("detects github-actions CI", async () => {
		mkdirSync(join(tmpDir, ".github", "workflows"), { recursive: true });
		writeFileSync(join(tmpDir, ".github", "workflows", "ci.yml"), "name: ci\n");
		const result = await assembleStackContext(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.cicd).toContain("github-actions");
	});
});

describe("contextHash determinism", () => {
	test("same context yields same hash across runs", async () => {
		const r1 = await assembleStackContext(MAINA_REPO_ROOT);
		const r2 = await assembleStackContext(MAINA_REPO_ROOT);
		expect(r1.ok && r2.ok).toBe(true);
		if (!r1.ok || !r2.ok) return;
		// Zero out volatile fields (bytes/files counts can shift slightly on rebuild)
		const a = {
			...r1.value,
			repoSize: { files: 0, bytes: 0 },
			subprojects: [],
		};
		const b = {
			...r2.value,
			repoSize: { files: 0, bytes: 0 },
			subprojects: [],
		};
		expect(contextHash(a)).toBe(contextHash(b));
	});

	test("different contexts yield different hashes", () => {
		const base = {
			languages: ["typescript"],
			frameworks: [],
			packageManager: "bun" as const,
			buildTool: null,
			linters: [],
			testRunners: [],
			cicd: [],
			repoSize: { files: 0, bytes: 0 },
			isEmpty: false,
			isLarge: false,
		};
		const other = { ...base, languages: ["python"] };
		expect(contextHash(base)).not.toBe(contextHash(other));
	});

	test("array ordering does not affect hash", () => {
		const a = {
			languages: ["typescript", "python"],
			frameworks: ["react", "next"],
			packageManager: "bun" as const,
			buildTool: null,
			linters: ["biome", "eslint"],
			testRunners: [],
			cicd: [],
			repoSize: { files: 0, bytes: 0 },
			isEmpty: false,
			isLarge: false,
		};
		const b = {
			...a,
			languages: ["python", "typescript"],
			frameworks: ["next", "react"],
			linters: ["eslint", "biome"],
		};
		expect(contextHash(a)).toBe(contextHash(b));
	});
});

describe("summarizeRepo", () => {
	test("produces non-empty markdown under 40k chars for maina repo", async () => {
		const result = await assembleStackContext(MAINA_REPO_ROOT);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const summary = await summarizeRepo(MAINA_REPO_ROOT, result.value);
		expect(summary.length).toBeGreaterThan(0);
		expect(summary.length).toBeLessThanOrEqual(40_000);
		expect(summary).toContain("# Repo Summary");
	});
});

describe("loadUniversalPrompt", () => {
	test("loads template and substitutes {stack} and {repoSummary}", () => {
		const text = loadUniversalPrompt({
			stack: "STACK-TOKEN",
			repoSummary: "SUMMARY-TOKEN",
		});
		expect(text).toContain("STACK-TOKEN");
		expect(text).toContain("SUMMARY-TOKEN");
		// No unrendered placeholders remain
		expect(text).not.toContain("{stack}");
		expect(text).not.toContain("{repoSummary}");
	});
});
