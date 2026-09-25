import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBaseBranch } from "../../git/index";
import { type Finding, filterByDiff } from "../diff-filter";

// Regression for #364: base branch defaulted to "main"; in master-based repos
// `git diff main` failed and the filter fell open, showing every finding.

const dirs: string[] = [];

const git = (cwd: string, ...args: string[]): void => {
	const proc = Bun.spawnSync(["git", ...args], {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
	});
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
};

const makeRepo = (defaultBranch: string): string => {
	const dir = mkdtempSync(join(tmpdir(), "maina-base-"));
	dirs.push(dir);
	git(dir, "init", "-q", "-b", defaultBranch);
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	git(dir, "config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "old.ts"), "export const a = 1;\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "init");
	return dir;
};

const finding = (file: string, line: number): Finding => ({
	tool: "tsc",
	file,
	line,
	message: "boom",
	severity: "error",
});

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolveBaseBranch", () => {
	test("returns master when only master exists", async () => {
		const dir = makeRepo("master");
		expect(await resolveBaseBranch(dir)).toBe("master");
	});

	test("returns main when only main exists", async () => {
		const dir = makeRepo("main");
		expect(await resolveBaseBranch(dir)).toBe("main");
	});

	test("falls back to HEAD when neither exists", async () => {
		const dir = makeRepo("trunk");
		expect(await resolveBaseBranch(dir)).toBe("HEAD");
	});
});

describe("filterByDiff without an explicit base", () => {
	test("hides findings on untouched files in a master-based repo", async () => {
		const dir = makeRepo("master");
		git(dir, "checkout", "-q", "-b", "feature");
		writeFileSync(join(dir, "new.md"), "# hello\n");
		git(dir, "add", "new.md");

		const result = await filterByDiff(
			[finding("old.ts", 1), finding("new.md", 1)],
			undefined,
			dir,
		);

		expect(result.shown.map((f) => f.file)).toEqual(["new.md"]);
		expect(result.hidden).toBe(1);
	});

	test("an unresolvable explicit base never falls open", async () => {
		const dir = makeRepo("master");
		git(dir, "checkout", "-q", "-b", "feature");
		writeFileSync(join(dir, "new.md"), "# hello\n");
		git(dir, "add", "new.md");

		const result = await filterByDiff(
			[finding("old.ts", 1), finding("new.md", 1)],
			"main",
			dir,
		);

		expect(result.shown.map((f) => f.file)).toEqual(["new.md"]);
	});

	test("a repo with no commits yet uses the staged diff, not fall-open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maina-base-"));
		dirs.push(dir);
		git(dir, "init", "-q", "-b", "master");
		writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
		git(dir, "add", "a.ts");

		const result = await filterByDiff(
			[finding("a.ts", 1), finding("elsewhere.ts", 3)],
			undefined,
			dir,
		);

		expect(result.shown.map((f) => f.file)).toEqual(["a.ts"]);
		expect(result.hidden).toBe(1);
	});
});
