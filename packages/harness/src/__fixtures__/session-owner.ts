/**
 * Test fixture: a worker that crashes. It claims a worktree for `runId`,
 * leaves an uncommitted file in it, starts a PTY that shrugs off SIGHUP (as
 * a real agent's child might), reports what it holds as one JSON line, and
 * then waits to be killed. The reclaim test SIGKILLs it, so it never gets to
 * clean up after itself.
 *
 * Usage: bun session-owner.ts <root> <runId>
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnPty } from "../sessions/pty";
import { createWorktree } from "../sessions/worktree";

const [root, runId] = process.argv.slice(2);
if (root === undefined || runId === undefined) {
	process.stderr.write("usage: session-owner.ts <root> <runId>\n");
	process.exit(2);
}

const created = await createWorktree(root, runId);
if (!created.ok) {
	process.stderr.write(`${created.error.message}\n`);
	process.exit(1);
}
const wt = created.value;
writeFileSync(join(wt.path, "work-in-progress.txt"), "unsaved agent work\n");

const pty = spawnPty(
	{ name: "agent", command: "/bin/sh", args: ["-c", "trap '' HUP; sleep 60"] },
	wt.path,
	{ worktree: wt },
);
if (!pty.ok) {
	process.stderr.write(`${pty.error.message}\n`);
	process.exit(1);
}

process.stdout.write(
	`${JSON.stringify({ owner: process.pid, path: wt.path, branch: wt.branch, pty: pty.value.pid })}\n`,
);
setInterval(() => undefined, 1 << 30);
