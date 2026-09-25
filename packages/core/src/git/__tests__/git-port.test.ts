/**
 * Issue #291: every git read goes through a `GitPort` with an explicit
 * repository root. The in-memory fake stands in for the git binary.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeGit, createFakeProcess } from "../../ports/testing";
import {
	createProcessGit,
	getChangedFiles,
	getCurrentBranch,
	getDiffStats,
	getHeadCommitMessage,
	getRepoSlug,
	parseNumstat,
} from "../index";

describe("git functions over an injected GitPort", () => {
	test("run git in the given root through the port", async () => {
		const git = createFakeGit({ "rev-parse --abbrev-ref HEAD": "feat/x" });
		expect(await getCurrentBranch("/repo", git)).toBe("feat/x");
		expect(git.calls()).toEqual([
			{ root: "/repo", args: ["rev-parse", "--abbrev-ref", "HEAD"] },
		]);
	});

	test("a failing git run degrades to the empty value", async () => {
		const git = createFakeGit();
		expect(await getCurrentBranch("/repo", git)).toBe("");
		expect(await getChangedFiles("main", "/repo", git)).toEqual([]);
	});

	test("getRepoSlug parses the origin url from the port", async () => {
		const git = createFakeGit({
			"remote get-url origin": "git@github.com:mainahq/maina.git",
		});
		expect(await getRepoSlug("/repo", git)).toBe("mainahq/maina");
	});

	test("getHeadCommitMessage returns the HEAD message body", async () => {
		const git = createFakeGit({
			"log -1 --pretty=format:%B": "feat: x\n\nAgent: claude-code:opus",
		});
		expect(await getHeadCommitMessage("/repo", git)).toBe(
			"feat: x\n\nAgent: claude-code:opus",
		);
	});

	test("getDiffStats sums locale-independent numstat output", async () => {
		const git = createFakeGit({
			"diff --numstat --cached": "3\t1\tsrc/a.ts\n-\t-\tlogo.png\n0\t4\tb.md",
		});
		expect(await getDiffStats({ cwd: "/repo", staged: true, git })).toEqual({
			files: 3,
			additions: 3,
			deletions: 5,
		});
	});
});

describe("parseNumstat", () => {
	test("returns zeros for empty output", () => {
		expect(parseNumstat("")).toEqual({ files: 0, additions: 0, deletions: 0 });
	});

	test("counts binary files as changed with no line counts", () => {
		expect(parseNumstat("-\t-\timg.png\n2\t0\tx.ts\n")).toEqual({
			files: 2,
			additions: 2,
			deletions: 0,
		});
	});
});

describe("the git adapter over a ProcessPort (#420)", () => {
	test("spawns `git <args>` in the root and returns stdout", async () => {
		const proc = createFakeProcess({
			"git rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
		});
		const git = createProcessGit(proc);
		expect(
			await git.run("/repo", ["rev-parse", "--abbrev-ref", "HEAD"]),
		).toEqual({ ok: true, value: "main\n" });
		expect(proc.calls()).toEqual([
			{
				argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
				options: { cwd: "/repo" },
			},
		]);
	});

	test("a non-zero exit is a failed GitError carrying stderr", async () => {
		const git = createProcessGit(
			createFakeProcess({
				"git status": { exitCode: 128, stderr: "fatal: not a git repository" },
			}),
		);
		expect(await git.run("/r", ["status"])).toEqual({
			ok: false,
			error: {
				kind: "failed",
				exitCode: 128,
				stderr: "fatal: not a git repository",
			},
		});
	});

	test("a spawn failure is a failed GitError with exit code -1", async () => {
		const git = createProcessGit(createFakeProcess());
		expect(await git.run("/r", ["status"])).toEqual({
			ok: false,
			error: {
				kind: "failed",
				exitCode: -1,
				stderr: 'fake process: no response scripted for "git status"',
			},
		});
	});
});

describe("default git adapter ignores a leaked GIT_DIR (#408, #420)", () => {
	let base = "";
	let fixture = "";
	let outer = "";

	/** Run git with no inherited repo-local variables (test setup only). */
	function gitIn(cwd: string, args: readonly string[]): void {
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
		);
		const r = Bun.spawnSync(["git", ...args], { cwd, env });
		expect(r.stderr.toString()).toBe("");
		expect(r.exitCode).toBe(0);
	}

	function initRepo(dir: string, branch: string): void {
		gitIn(dir, ["init", "-q", "-b", branch]);
		gitIn(dir, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"init",
		]);
	}

	beforeAll(() => {
		base = realpathSync(mkdtempSync(join(tmpdir(), "maina-git-leak-")));
		fixture = join(base, "fixture");
		outer = join(base, "outer");
		mkdirSync(fixture);
		mkdirSync(outer);
		initRepo(fixture, "leak-fixture");
		initRepo(outer, "outer-branch");
	});

	afterAll(() => {
		rmSync(base, { recursive: true, force: true });
	});

	test("reads the explicit root, not the repo GIT_DIR points at", async () => {
		// A git hook (or a parent `git` process) starts maina with GIT_DIR set
		// for the outer repository; core must still read the root it was given.
		const host = [
			`import { getCurrentBranch } from ${JSON.stringify(join(import.meta.dir, "..", "index.ts"))};`,
			`process.stdout.write(await getCurrentBranch(${JSON.stringify(fixture)}));`,
		].join("\n");
		const proc = Bun.spawn([process.execPath, "-e", host], {
			cwd: base,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				GIT_DIR: join(outer, ".git"),
				GIT_INDEX_FILE: join(outer, ".git", "index"),
			},
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(stdout).toBe("leak-fixture");
	});

	test("inside a pre-commit hook of the same repo, `commit -a` staging stays visible", () => {
		// `git commit -a` / `git commit <path>` stage into a temporary index
		// and export GIT_INDEX_FILE to hooks. A `maina verify` pre-commit hook
		// must read that index, or it sees no staged files and checks nothing.
		const repo = join(base, "hooked");
		mkdirSync(repo);
		initRepo(repo, "hooked");
		writeFileSync(join(repo, "a.txt"), "a\n");
		gitIn(repo, ["add", "a.txt"]);
		gitIn(repo, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-qm",
			"a",
		]);
		writeFileSync(join(repo, "a.txt"), "a\nb\n");
		const out = join(base, "hook-out.txt");
		const probe = join(base, "hook-probe.ts");
		writeFileSync(
			probe,
			[
				`import { getStagedFiles } from ${JSON.stringify(join(import.meta.dir, "..", "index.ts"))};`,
				`await Bun.write(${JSON.stringify(out)}, (await getStagedFiles(${JSON.stringify(repo)})).join(","));`,
			].join("\n"),
		);
		const hook = join(repo, ".git", "hooks", "pre-commit");
		writeFileSync(
			hook,
			`#!/bin/sh\n'${process.execPath}' '${probe}'\nexit 1\n`,
		);
		chmodSync(hook, 0o755);
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
		);
		const commit = Bun.spawnSync(
			[
				"git",
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@t",
				"commit",
				"-a",
				"-m",
				"x",
			],
			{ cwd: repo, env },
		);
		// The hook exits 1, so the commit is aborted after the probe ran.
		expect(commit.exitCode).not.toBe(0);
		expect(readFileSync(out, "utf8")).toBe("a.txt");
	});
});
