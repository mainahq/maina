/**
 * Shared by the session tests: a throwaway git repository with one commit
 * on `main`, and a way to run git in it and in its worktrees.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripRepoLocalGitEnv } from "@mainahq/core";

// A test run inside a git hook inherits GIT_DIR and friends for the outer
// repository; git must read the throwaway one instead.
const env = stripRepoLocalGitEnv(process.env);

type GitRun = Readonly<{ code: number; out: string; err: string }>;

export function gitIn(cwd: string, ...args: string[]): GitRun {
	const r = Bun.spawnSync(["git", ...args], { cwd, env });
	return {
		code: r.exitCode,
		out: r.stdout.toString().trim(),
		err: r.stderr.toString().trim(),
	};
}

/** Commits everything in `cwd` as the test identity. */
export function commitAll(cwd: string, message: string): GitRun {
	gitIn(cwd, "add", "-A");
	return gitIn(cwd, "commit", "-q", "--no-verify", "-m", message);
}

export function makeRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "maina-sessions-")));
	gitIn(root, "init", "-q", "-b", "main");
	gitIn(root, "config", "user.name", "Session Test");
	gitIn(root, "config", "user.email", "sessions@test.invalid");
	gitIn(root, "config", "commit.gpgsign", "false");
	writeFileSync(join(root, "README.md"), "base\n");
	commitAll(root, "base");
	return root;
}

/** Whether `ref` names a commit in the repository at `root`. */
export const refExists = (root: string, ref: string): boolean =>
	gitIn(root, "rev-parse", "--verify", "-q", `${ref}^{commit}`).code === 0;

/** Whether process `pid` is running (a zombie counts as gone). */
export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]);
	return !stat.stdout.toString().trim().startsWith("Z");
}

/** Polls until `check` holds or `ms` runs out. */
export async function eventually(
	check: () => boolean,
	ms = 3000,
): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return true;
		await Bun.sleep(25);
	}
	return check();
}
