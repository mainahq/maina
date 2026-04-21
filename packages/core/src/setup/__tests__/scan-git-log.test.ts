/**
 * scanGitLog — rules inferred from `git log` and `.github/workflows/`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanGitLog } from "../scan/git-log";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-scan-git-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function git(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@t.io",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@t.io",
		},
	});
	await proc.exited;
}

async function seedRepo(cwd: string, subjects: string[]): Promise<void> {
	await git(cwd, ["init", "-q", "-b", "main"]);
	await git(cwd, ["config", "user.email", "t@t.io"]);
	await git(cwd, ["config", "user.name", "t"]);
	await git(cwd, ["config", "commit.gpgsign", "false"]);
	for (let i = 0; i < subjects.length; i++) {
		writeFileSync(join(cwd, `f${i}.txt`), `${i}\n`);
		await git(cwd, ["add", "-A"]);
		await git(cwd, ["commit", "-q", "-m", subjects[i] ?? ""]);
	}
}

describe("scanGitLog", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("non-repo → empty array, no error", async () => {
		const res = await scanGitLog(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value).toEqual([]);
	});

	test("≥ 80 % conventional commits → emits conventional-commits rule", async () => {
		const subjects = [
			"feat(cli): thing",
			"fix(core): other",
			"chore: deps",
			"docs: clarify",
			"feat: x",
			"fix: y",
			"refactor: z",
			"test: add",
			"ci: release",
			"just a random one",
		];
		await seedRepo(tmpDir, subjects);
		const res = await scanGitLog(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const conventional = res.value.find((r) =>
			r.text.toLowerCase().includes("conventional"),
		);
		expect(conventional).toBeDefined();
		expect(conventional?.sourceKind).toBe("git-log");
		expect(conventional?.category).toBe("commits");
		expect(conventional?.confidence).toBeGreaterThanOrEqual(0.7);
	});

	test("< 80 % conventional → no conventional-commits rule emitted", async () => {
		const subjects = [
			"feat: one",
			"random subject",
			"some other commit",
			"yet another",
			"quick fix",
		];
		await seedRepo(tmpDir, subjects);
		const res = await scanGitLog(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const conventional = res.value.find((r) =>
			r.text.toLowerCase().includes("conventional"),
		);
		expect(conventional).toBeUndefined();
	});

	test("GitHub Actions workflow → emits CI check rule", async () => {
		await seedRepo(tmpDir, ["chore: init"]);
		mkdirSync(join(tmpDir, ".github", "workflows"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".github", "workflows", "ci.yml"),
			`name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun test
`,
		);
		const res = await scanGitLog(tmpDir);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const ciRule = res.value.find((r) => r.sourceKind === "workflows");
		expect(ciRule).toBeDefined();
		expect(ciRule?.category).toBe("ci");
	});
});
