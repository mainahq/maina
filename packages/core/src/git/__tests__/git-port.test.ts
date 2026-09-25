/**
 * Issue #291: every git read goes through a `GitPort` with an explicit
 * repository root. The in-memory fake stands in for the git binary.
 */

import { describe, expect, test } from "bun:test";
import { createFakeGit } from "../../ports/testing";
import {
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
