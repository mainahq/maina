import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, runBranch } from "../worktree";
import { gitIn, makeRepo } from "./repo-fixture";

describe("createWorktree", () => {
	test("checks the run out on its own branch, outside the working tree", async () => {
		const root = makeRepo();
		const created = await createWorktree(root, "run-1");
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const wt = created.value;

		expect(wt.runId).toBe("run-1");
		expect(wt.branch).toBe(runBranch("run-1"));
		expect(wt.baseSha).toBe(gitIn(root, "rev-parse", "HEAD").out);
		expect(wt.baseRef).toBe("main");
		expect(readFileSync(join(wt.path, "README.md"), "utf8")).toBe("base\n");
		expect(gitIn(wt.path, "branch", "--show-current").out).toBe(wt.branch);
		// Kept inside the git directory: the root's tools and `git status`
		// never see a run's checkout.
		expect(wt.path.startsWith(join(root, ".git"))).toBe(true);
		expect(gitIn(root, "status", "--porcelain").out).toBe("");
	});

	test("resolves the repository from any directory inside it", async () => {
		const root = makeRepo();
		const fromWorktree = await createWorktree(root, "outer");
		if (!fromWorktree.ok) throw new Error(fromWorktree.error.message);
		// A run started from inside another run's worktree still lands in the
		// shared git directory, not nested in that worktree.
		const inner = await createWorktree(fromWorktree.value.path, "inner");
		expect(inner.ok).toBe(true);
		if (!inner.ok) return;
		expect(inner.value.path.startsWith(join(root, ".git"))).toBe(true);
		expect(inner.value.baseRef).toBe(runBranch("outer"));
	});

	test.each([
		"",
		"../escape",
		"a/b",
		"has space",
		".hidden",
		"x".repeat(65),
	])("rejects the run id %p", async (runId) => {
		const root = makeRepo();
		const created = await createWorktree(root, runId);
		expect(created.ok).toBe(false);
		if (created.ok) return;
		expect(created.error.code).toBe("invalid_run_id");
	});

	test("never hands out a run id that is already in use", async () => {
		const root = makeRepo();
		const first = await createWorktree(root, "twice");
		expect(first.ok).toBe(true);
		const second = await createWorktree(root, "twice");
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.error.code).toBe("in_use");
	});

	test("two concurrent claims on one run id: exactly one wins", async () => {
		const root = makeRepo();
		const results = await Promise.all(
			Array.from({ length: 4 }, () => createWorktree(root, "race")),
		);
		expect(results.filter((r) => r.ok)).toHaveLength(1);
		for (const r of results.filter((r) => !r.ok)) {
			if (!r.ok) expect(r.error.code).toBe("in_use");
		}
	});

	test("refuses a run id whose branch survives from an earlier run", async () => {
		const root = makeRepo();
		gitIn(root, "branch", runBranch("kept"));
		const created = await createWorktree(root, "kept");
		expect(created.ok).toBe(false);
		if (created.ok) return;
		expect(created.error.code).toBe("in_use");
		// The failed claim leaves nothing behind: no lease, no worktree.
		expect(gitIn(root, "worktree", "list").out.split("\n")).toHaveLength(1);
	});

	test("fails with not_a_repo outside a git repository", async () => {
		const plain = realpathSync(mkdtempSync(join(tmpdir(), "maina-no-repo-")));
		const created = await createWorktree(plain, "x");
		expect(created.ok).toBe(false);
		if (created.ok) return;
		expect(created.error.code).toBe("not_a_repo");
	});
});
