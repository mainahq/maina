/**
 * Issue #328 (FR-VER-1, FR-VER-2): verify checks the working tree by default
 * (staged + unstaged + untracked vs the base) and never reports a pass it did
 * not earn. `--staged` keeps the old staged-only scope.
 *
 * Pipeline cases run against a real throwaway git repository (git reads go
 * through the real binary); every tool process goes through a fake port that
 * fails to start, so only the in-process checks (builtin, slop) produce
 * evidence.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveScopeFiles } from "../../git/scope";
import { createFakeGit, createFakeProcess } from "../../ports/testing";
import { filterByDiff } from "../diff-filter";
import { runPipeline } from "../pipeline";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

/** Env for setup git calls, without any repo-local GIT_* leaked by a hook. */
const gitEnv = (): Record<string, string> => {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(Bun.env)) {
		if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
	}
	return env;
};

function git(root: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: root,
		env: gitEnv(),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
	}
}

const CLEAN = "export const a = 1;\n";
const LEAKY = `export const a = 1;\nconst password = "hunter2-prod-value";\n`;

/** A repo on `main` with one clean committed file, `src/app.ts`. */
function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "maina-scope-"));
	dirs.push(root);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "Test");
	git(root, "config", "commit.gpgsign", "false");
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src", "app.ts"), CLEAN);
	git(root, "add", "src/app.ts");
	git(root, "commit", "-q", "-m", "init");
	return root;
}

/**
 * The syntax guard (biome) reports clean; no other tool process can start,
 * so only in-process checks produce evidence.
 */
const noProcesses = () =>
	createFakeProcess((argv) =>
		argv.includes("--reporter=json")
			? { ok: true, value: { exitCode: 0, stdout: "", stderr: "" } }
			: {
					ok: false,
					error: { kind: "spawn_failed", message: `not installed: ${argv[0]}` },
				},
	);

const run = (root: string, extra: Record<string, unknown> = {}) =>
	runPipeline({
		cwd: root,
		languages: ["typescript"],
		env: {},
		process: noProcesses(),
		...extra,
	});

const secretFindings = (findings: readonly { ruleId?: string }[]) =>
	findings.filter((f) => f.ruleId === "hardcoded-secret");

describe("working-tree scope (default)", () => {
	test("an unstaged edit with a finding is reported", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "app.ts"), LEAKY);

		const result = await run(root);

		expect(result.scope.kind).toBe("working-tree");
		expect(result.scope.files).toEqual(["src/app.ts"]);
		const secrets = secretFindings(result.findings);
		expect(secrets).toHaveLength(1);
		expect(secrets[0]).toMatchObject({ file: "src/app.ts", line: 2 });
		expect(result.status).toBe("failed");
		expect(result.passed).toBe(false);
	});

	test("an untracked new file with a finding is reported", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "new.ts"), LEAKY);

		const result = await run(root);

		expect(result.scope.files).toContain("src/new.ts");
		const secrets = secretFindings(result.findings);
		expect(secrets).toHaveLength(1);
		expect(secrets[0]).toMatchObject({ file: "src/new.ts", line: 2 });
		expect(result.status).toBe("failed");
	});

	test("a clean edit passes because a tool ran on the changed file", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "app.ts"), `${CLEAN}export const b = 2;\n`);

		const result = await run(root);

		expect(result.status).toBe("passed");
		expect(result.passed).toBe(true);
		const builtin = result.tools.find((t) => t.tool === "builtin");
		expect(builtin?.skipped).toBe(false);
	});
});

describe("honest results", () => {
	test("an empty scope is skipped, never passed", async () => {
		const root = makeRepo();

		const result = await run(root);

		expect(result.scope).toEqual({ kind: "working-tree", files: [] });
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		expect(result.tools).toHaveLength(0);
	});

	test("passed requires at least one tool to have run on a changed file", async () => {
		const root = makeRepo();

		// The file in scope is gone: no in-process check can read it and no
		// external tool can start, so nothing actually ran on it.
		const result = await run(root, {
			files: ["src/gone.ts"],
			diffOnly: false,
		});

		expect(result.scope).toEqual({ kind: "files", files: ["src/gone.ts"] });
		expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		const builtin = result.tools.find((t) => t.tool === "builtin");
		expect(builtin?.skipped).toBe(true);
	});
});

describe("--staged keeps the old behaviour", () => {
	test("unstaged edits are out of scope", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "app.ts"), LEAKY);

		const result = await run(root, { scope: "staged" });

		expect(result.scope).toEqual({ kind: "staged", files: [] });
		expect(secretFindings(result.findings)).toEqual([]);
		expect(result.status).toBe("skipped");
	});

	test("staged edits are checked", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "app.ts"), LEAKY);
		writeFileSync(join(root, "src", "other.ts"), LEAKY);
		git(root, "add", "src/app.ts");

		const result = await run(root, { scope: "staged" });

		expect(result.scope).toEqual({ kind: "staged", files: ["src/app.ts"] });
		expect(secretFindings(result.findings)).toHaveLength(1);
		expect(result.status).toBe("failed");
	});
});

describe("resolveScopeFiles", () => {
	test("working-tree unions the diff vs the merge-base with untracked files", async () => {
		const port = createFakeGit({
			"merge-base main HEAD": "abc123\n",
			"diff --name-only --diff-filter=d abc123": "src/a.ts\nsrc/b.ts\n",
			"ls-files --others --exclude-standard": "src/new.ts\nsrc/a.ts\n",
		});

		const files = await resolveScopeFiles("working-tree", {
			cwd: "/repo",
			base: "main",
			git: port,
		});

		expect(files).toEqual(["src/a.ts", "src/b.ts", "src/new.ts"]);
	});

	test("working-tree falls back to index + worktree diffs before the first commit", async () => {
		const port = createFakeGit({
			"diff --cached --name-only --diff-filter=d": "src/a.ts\n",
			"diff --name-only --diff-filter=d": "src/b.ts\n",
			"ls-files --others --exclude-standard": "",
		});

		const files = await resolveScopeFiles("working-tree", {
			cwd: "/repo",
			base: "HEAD",
			git: port,
		});

		expect(files).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("staged lists the index only", async () => {
		const port = createFakeGit({
			"diff --cached --name-only": "src/a.ts\n",
		});

		const files = await resolveScopeFiles("staged", {
			cwd: "/repo",
			base: "main",
			git: port,
		});

		expect(files).toEqual(["src/a.ts"]);
	});

	test("range lists what the branch committed since the base", async () => {
		const port = createFakeGit({
			"diff --name-only --diff-filter=d main...HEAD": "src/c.ts\n",
		});

		const files = await resolveScopeFiles("range", {
			cwd: "/repo",
			base: "main",
			git: port,
		});

		expect(files).toEqual(["src/c.ts"]);
	});
});

describe("diff filter with untracked files", () => {
	test("findings in untracked files are shown, not hidden as pre-existing", async () => {
		const root = makeRepo();
		writeFileSync(join(root, "src", "new.ts"), LEAKY);
		const finding = {
			tool: "builtin",
			file: "src/new.ts",
			line: 2,
			message: "secret",
			severity: "error" as const,
		};
		const old = { ...finding, file: "src/app.ts", line: 1 };

		const result = await filterByDiff([finding, old], "main", root, {
			includeUntracked: true,
		});

		expect(result.shown).toEqual([finding]);
		expect(result.hidden).toBe(1);
	});
});
