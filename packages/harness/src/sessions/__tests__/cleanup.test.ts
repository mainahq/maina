import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, reclaim } from "../cleanup";
import { systemProcesses } from "../processes";
import { spawnPty } from "../pty";
import { createWorktree, readLease, type Worktree } from "../worktree";
import {
	alive,
	commitAll,
	eventually,
	gitIn,
	makeRepo,
	refExists,
} from "./repo-fixture";

const OWNER_FIXTURE = join(
	import.meta.dir,
	"..",
	"..",
	"__fixtures__",
	"session-owner.ts",
);

async function claim(root: string, runId: string): Promise<Worktree> {
	const created = await createWorktree(root, runId);
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

describe("cleanup", () => {
	test("a run with nothing to keep: worktree, branch and lease all go", async () => {
		const root = makeRepo();
		const wt = await claim(root, "empty");

		const cleaned = await cleanup("empty", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			runId: "empty",
			worktreeRemoved: true,
			branchDeleted: true,
			salvaged: false,
		});
		expect(existsSync(wt.path)).toBe(false);
		expect(refExists(root, wt.branch)).toBe(false);
		expect((await readLease(root, "empty")).ok).toBe(false);
		expect(gitIn(root, "worktree", "list").out.split("\n")).toHaveLength(1);
	});

	test("never deletes unmerged commits by default", async () => {
		const root = makeRepo();
		const wt = await claim(root, "unmerged");
		writeFileSync(join(wt.path, "feature.ts"), "export const x = 1;\n");
		commitAll(wt.path, "agent work");
		const tip = gitIn(wt.path, "rev-parse", "HEAD").out;

		const cleaned = await cleanup("unmerged", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			worktreeRemoved: true,
			branchDeleted: false,
			kept: "unmerged",
		});
		// The checkout is freed; the commit lives on in the run's branch.
		expect(existsSync(wt.path)).toBe(false);
		expect(gitIn(root, "rev-parse", wt.branch).out).toBe(tip);
	});

	test("keepUnmerged: true says the same thing out loud", async () => {
		const root = makeRepo();
		const wt = await claim(root, "explicit");
		writeFileSync(join(wt.path, "a.txt"), "a\n");
		commitAll(wt.path, "agent work");

		const cleaned = await cleanup("explicit", { root, keepUnmerged: true });
		expect(cleaned.ok).toBe(true);
		expect(refExists(root, wt.branch)).toBe(true);
	});

	test("uncommitted work is committed to the run's branch before the checkout goes", async () => {
		const root = makeRepo();
		const wt = await claim(root, "dirty");
		writeFileSync(join(wt.path, "README.md"), "edited\n");
		writeFileSync(join(wt.path, "untracked.txt"), "new file\n");

		const cleaned = await cleanup("dirty", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			salvaged: true,
			branchDeleted: false,
			kept: "unmerged",
		});
		expect(gitIn(root, "show", `${wt.branch}:README.md`).out).toBe("edited");
		expect(gitIn(root, "show", `${wt.branch}:untracked.txt`).out).toBe(
			"new file",
		);
		// The salvage never touches the base branch.
		expect(gitIn(root, "show", "main:README.md").out).toBe("base");
	});

	test("deletes unmerged commits only with keepUnmerged: false", async () => {
		const root = makeRepo();
		const wt = await claim(root, "discard");
		writeFileSync(join(wt.path, "a.txt"), "a\n");
		commitAll(wt.path, "throwaway");
		writeFileSync(join(wt.path, "b.txt"), "b\n");

		const cleaned = await cleanup("discard", { root, keepUnmerged: false });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			worktreeRemoved: true,
			branchDeleted: true,
			salvaged: false,
		});
		expect(refExists(root, wt.branch)).toBe(false);
	});

	test("a branch already merged into its base is deleted", async () => {
		const root = makeRepo();
		const wt = await claim(root, "merged");
		writeFileSync(join(wt.path, "a.txt"), "a\n");
		commitAll(wt.path, "merged work");
		gitIn(root, "merge", "-q", "--ff-only", wt.branch);

		const cleaned = await cleanup("merged", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value.branchDeleted).toBe(true);
	});

	test("keeps a checkout whose HEAD left the run's branch", async () => {
		const root = makeRepo();
		const wt = await claim(root, "wander");
		gitIn(wt.path, "checkout", "-q", "--detach");
		writeFileSync(join(wt.path, "a.txt"), "a\n");
		commitAll(wt.path, "detached work");

		const cleaned = await cleanup("wander", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			worktreeRemoved: false,
			branchDeleted: false,
			kept: "head_moved",
		});
		expect(existsSync(join(wt.path, "a.txt"))).toBe(true);
	});

	test("refuses a run another live process still owns", async () => {
		const root = makeRepo();
		const owner = Bun.spawn(["sleep", "30"]);
		const theirs = { ...systemProcesses, self: owner.pid };
		const created = await createWorktree(root, "theirs", {
			processes: theirs,
		});
		if (!created.ok) throw new Error(created.error.message);

		const cleaned = await cleanup("theirs", { root });
		expect(cleaned.ok).toBe(false);
		if (!cleaned.ok) expect(cleaned.error.code).toBe("in_use");
		expect(existsSync(created.value.path)).toBe(true);
		owner.kill("SIGKILL");
		await owner.exited;
	});

	test("a checkout deleted by hand is pruned, its commits still kept", async () => {
		const root = makeRepo();
		const wt = await claim(root, "deleted");
		writeFileSync(join(wt.path, "a.txt"), "a\n");
		commitAll(wt.path, "agent work");
		rmSync(wt.path, { recursive: true, force: true });

		const cleaned = await cleanup("deleted", { root });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toMatchObject({
			worktreeRemoved: true,
			kept: "unmerged",
		});
		expect(gitIn(root, "worktree", "list").out.split("\n")).toHaveLength(1);
		expect(refExists(root, wt.branch)).toBe(true);
	});

	test("refuses a lease that points at a checkout other than the run's own", async () => {
		const root = makeRepo();
		const mine = await claim(root, "honest");
		const victim = await claim(root, "victim");
		const lease = await readLease(root, "honest");
		if (!lease.ok) throw new Error(lease.error.message);
		writeFileSync(
			lease.value.file,
			JSON.stringify({ ...lease.value.lease, path: victim.path }),
		);

		const cleaned = await cleanup("honest", { root });
		expect(cleaned.ok).toBe(false);
		if (!cleaned.ok) expect(cleaned.error.code).toBe("corrupt_lease");
		expect(existsSync(victim.path)).toBe(true);
		expect(existsSync(mine.path)).toBe(true);
	});

	test("an unknown run is not_found", async () => {
		const root = makeRepo();
		const cleaned = await cleanup("nobody", { root });
		expect(cleaned.ok).toBe(false);
		if (!cleaned.ok) expect(cleaned.error.code).toBe("not_found");
	});

	test("stops the run's PTYs before removing the checkout", async () => {
		const root = makeRepo();
		const wt = await claim(root, "busy");
		const pty = spawnPty(
			{ name: "agent", command: "/bin/sh", args: ["-c", "sleep 60"] },
			wt.path,
			{ worktree: wt },
		);
		if (!pty.ok) throw new Error(pty.error.message);

		const cleaned = await cleanup("busy", { root, graceMs: 200 });
		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value.stopped).toEqual([pty.value.pid]);
		expect(await eventually(() => !alive(pty.value.pid))).toBe(true);
	});
});

describe("reclaim", () => {
	test("a crashed worker's PTY and worktree are reclaimed, its work kept", async () => {
		const root = makeRepo();
		const worker = Bun.spawn([process.execPath, OWNER_FIXTURE, root, "crash"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const reader = worker.stdout.getReader();
		const { value } = await reader.read();
		const held = JSON.parse(new TextDecoder().decode(value)) as {
			owner: number;
			path: string;
			branch: string;
			pty: number;
		};
		expect(held.owner).toBe(worker.pid);

		worker.kill("SIGKILL");
		await worker.exited;
		// The crash left both behind: nothing else cleans them up.
		expect(alive(held.pty)).toBe(true);
		expect(existsSync(held.path)).toBe(true);

		const report = await reclaim(root, { graceMs: 200 });
		expect(report.ok).toBe(true);
		if (!report.ok) return;
		expect(report.value.reclaimed.map((o) => o.runId)).toEqual(["crash"]);
		expect(report.value.failed).toEqual([]);
		expect(await eventually(() => !alive(held.pty))).toBe(true);
		expect(existsSync(held.path)).toBe(false);
		expect((await readLease(root, "crash")).ok).toBe(false);
		// The crashed agent's unsaved file survives on the run's branch.
		expect(gitIn(root, "show", `${held.branch}:work-in-progress.txt`).out).toBe(
			"unsaved agent work",
		);
	});

	test("leaves runs whose owner is alive alone", async () => {
		const root = makeRepo();
		const wt = await claim(root, "mine");

		const report = await reclaim(root);
		expect(report.ok).toBe(true);
		if (!report.ok) return;
		expect(report.value.reclaimed).toEqual([]);
		expect(report.value.live).toEqual(["mine"]);
		expect(existsSync(wt.path)).toBe(true);
	});

	test("never kills a process that merely reuses a recorded pid", async () => {
		const root = makeRepo();
		const wt = await claim(root, "reused");
		const bystander = Bun.spawn(["sleep", "30"]);
		// A lease that names the bystander's pid with another start time: the
		// PTY it recorded is gone and the pid now belongs to someone else.
		const dead = Bun.spawn(["true"]);
		await dead.exited;
		const lease = await readLease(root, "reused");
		if (!lease.ok) throw new Error(lease.error.message);
		writeFileSync(
			lease.value.file,
			JSON.stringify({
				...lease.value.lease,
				owner: { pid: dead.pid, start: "long ago" },
				ptys: [{ pid: bystander.pid, start: "long ago" }],
			}),
		);

		const report = await reclaim(root, { graceMs: 100 });
		expect(report.ok).toBe(true);
		expect(alive(bystander.pid)).toBe(true);
		expect(existsSync(wt.path)).toBe(false);
		bystander.kill("SIGKILL");
		await bystander.exited;
	});
});
