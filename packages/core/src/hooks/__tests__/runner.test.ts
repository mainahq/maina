import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookContext, HookEvent } from "../runner";
import { executeHook, runHooks, scanHooks } from "../runner";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeHookScript(dir: string, event: HookEvent, body: string): string {
	const hooksDir = join(dir, "hooks");
	mkdirSync(hooksDir, { recursive: true });
	const scriptPath = join(hooksDir, `${event}.sh`);
	writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
	chmodSync(scriptPath, 0o755);
	return scriptPath;
}

function makeContext(event: HookEvent, mainaDir: string): HookContext {
	return {
		event,
		repoRoot: join(mainaDir, ".."),
		mainaDir,
		stagedFiles: ["src/index.ts"],
		branch: "main",
		timestamp: new Date().toISOString(),
	};
}

// ─── scanHooks ───────────────────────────────────────────────────────────────

describe("scanHooks", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns empty array when hooks directory does not exist", async () => {
		const result = await scanHooks(tmpDir, "pre-commit");
		expect(result).toEqual([]);
	});

	test("returns empty array when no hook for the event exists", async () => {
		mkdirSync(join(tmpDir, "hooks"), { recursive: true });
		const result = await scanHooks(tmpDir, "pre-commit");
		expect(result).toEqual([]);
	});

	test("finds a pre-commit hook script", async () => {
		const scriptPath = makeHookScript(tmpDir, "pre-commit", "exit 0");
		const result = await scanHooks(tmpDir, "pre-commit");
		expect(result).toEqual([scriptPath]);
	});

	test("does not return hooks for different events", async () => {
		makeHookScript(tmpDir, "post-commit", "exit 0");
		const result = await scanHooks(tmpDir, "pre-commit");
		expect(result).toEqual([]);
	});

	test("finds hooks for all supported events", async () => {
		const events: HookEvent[] = [
			"pre-commit",
			"post-commit",
			"pre-verify",
			"post-verify",
			"pre-review",
			"post-learn",
		];
		for (const event of events) {
			makeHookScript(tmpDir, event, "exit 0");
		}
		for (const event of events) {
			const result = await scanHooks(tmpDir, event);
			expect(result.length).toBe(1);
		}
	});
});

// ─── executeHook ─────────────────────────────────────────────────────────────

describe("executeHook", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("exit code 0 returns continue", async () => {
		const scriptPath = makeHookScript(tmpDir, "pre-commit", "exit 0");
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await executeHook(scriptPath, ctx);
		expect(result.status).toBe("continue");
	});

	test("exit code 2 returns block with message", async () => {
		const scriptPath = makeHookScript(
			tmpDir,
			"pre-commit",
			'echo "blocked by policy" >&2\nexit 2',
		);
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await executeHook(scriptPath, ctx);
		expect(result.status).toBe("block");
		if (result.status === "block") {
			expect(result.message).toContain("blocked by policy");
		}
	});

	test("other exit codes return warn with message", async () => {
		const scriptPath = makeHookScript(
			tmpDir,
			"pre-commit",
			'echo "something wrong" >&2\nexit 1',
		);
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await executeHook(scriptPath, ctx);
		expect(result.status).toBe("warn");
		if (result.status === "warn") {
			expect(result.message).toContain("something wrong");
		}
	});

	test("hook receives JSON context on stdin", async () => {
		// Script reads stdin and writes it to a file so we can verify
		const outputFile = join(tmpDir, "stdin-capture.json");
		const scriptPath = makeHookScript(
			tmpDir,
			"pre-commit",
			`cat > "${outputFile}"\nexit 0`,
		);
		const ctx = makeContext("pre-commit", tmpDir);
		await executeHook(scriptPath, ctx);

		const captured = await Bun.file(outputFile).text();
		const parsed = JSON.parse(captured);
		expect(parsed.event).toBe("pre-commit");
		expect(parsed.mainaDir).toBe(tmpDir);
		expect(parsed.stagedFiles).toEqual(["src/index.ts"]);
	});

	test("non-existent hook file returns warn", async () => {
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await executeHook(
			join(tmpDir, "hooks", "nonexistent.sh"),
			ctx,
		);
		expect(result.status).toBe("warn");
	});

	test("hook stderr is captured in block message", async () => {
		const scriptPath = makeHookScript(
			tmpDir,
			"pre-commit",
			'echo "line 1" >&2\necho "line 2" >&2\nexit 2',
		);
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await executeHook(scriptPath, ctx);
		expect(result.status).toBe("block");
		if (result.status === "block") {
			expect(result.message).toContain("line 1");
			expect(result.message).toContain("line 2");
		}
	});
});

// ─── runHooks ────────────────────────────────────────────────────────────────

describe("runHooks", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns continue when no hooks exist", async () => {
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("continue");
	});

	test("returns continue when hook exits 0", async () => {
		makeHookScript(tmpDir, "pre-commit", "exit 0");
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("continue");
	});

	test("returns block when hook exits 2", async () => {
		makeHookScript(tmpDir, "pre-commit", 'echo "nope" >&2\nexit 2');
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("block");
	});

	test("returns warn when hook exits with non-zero non-2 code", async () => {
		makeHookScript(tmpDir, "pre-commit", 'echo "warning" >&2\nexit 1');
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("warn");
	});
});

// ─── CommitGate integration ──────────────────────────────────────────────────

describe("CommitGate", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should execute .maina/hooks/pre-commit.sh if present", async () => {
		makeHookScript(tmpDir, "pre-commit", "exit 0");
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("continue");
	});

	it("pre-commit hook with exit 0 passes", async () => {
		makeHookScript(tmpDir, "pre-commit", "exit 0");
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("continue");
	});

	it("pre-commit hook with exit 2 blocks", async () => {
		makeHookScript(
			tmpDir,
			"pre-commit",
			'echo "commit blocked by hook" >&2\nexit 2',
		);
		const ctx = makeContext("pre-commit", tmpDir);
		const result = await runHooks(tmpDir, "pre-commit", ctx);
		expect(result.status).toBe("block");
		if (result.status === "block") {
			expect(result.message).toContain("commit blocked by hook");
		}
	});
});
