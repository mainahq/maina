import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPty } from "../pty";
import { createWorktree, readLease } from "../worktree";
import { alive, eventually, makeRepo } from "./repo-fixture";

const CWD = realpathSync(mkdtempSync(join(tmpdir(), "maina-pty-")));

const sh = (script: string) => ({
	name: "sh",
	command: "/bin/sh",
	args: ["-c", script],
});

describe("spawnPty", () => {
	test("runs the command in cwd on a real terminal", async () => {
		const spawned = spawnPty(
			sh("pwd; if [ -t 1 ]; then echo on-a-tty; fi"),
			CWD,
		);
		expect(spawned.ok).toBe(true);
		if (!spawned.ok) return;
		expect(await spawned.value.exited).toBe(0);
		const out = spawned.value.output();
		expect(out).toContain(CWD);
		expect(out).toContain("on-a-tty");
	});

	test("passes the command's environment through", async () => {
		const spawned = spawnPty(
			{ ...sh('echo "run=$MAINA_RUN"'), env: { MAINA_RUN: "317" } },
			CWD,
		);
		if (!spawned.ok) throw new Error(spawned.error.message);
		await spawned.value.exited;
		expect(spawned.value.output()).toContain("run=317");
	});

	test("write reaches the process's stdin", async () => {
		const spawned = spawnPty(sh("read line; echo got:$line"), CWD);
		if (!spawned.ok) throw new Error(spawned.error.message);
		spawned.value.write("hello\n");
		expect(await spawned.value.exited).toBe(0);
		expect(spawned.value.output()).toContain("got:hello");
	});

	test("stop ends the whole process group, children included", async () => {
		const spawned = spawnPty(sh("sleep 60 & echo child=$!; wait"), CWD);
		if (!spawned.ok) throw new Error(spawned.error.message);
		const pty = spawned.value;
		expect(await eventually(() => /child=\d+/.test(pty.output()))).toBe(true);
		const child = Number(pty.output().match(/child=(\d+)/)?.[1]);
		expect(alive(child)).toBe(true);

		await pty.stop(500);
		expect(alive(pty.pid)).toBe(false);
		expect(await eventually(() => !alive(child))).toBe(true);
	});

	test("an unstartable command is an error, not a throw", () => {
		const spawned = spawnPty(
			{ name: "missing", command: "/definitely/not/here-317" },
			CWD,
		);
		expect(spawned.ok).toBe(false);
		if (spawned.ok) return;
		expect(spawned.error.code).toBe("spawn_failed");
	});

	test("a missing cwd is an error, not a throw", () => {
		const spawned = spawnPty(sh("true"), join(CWD, "gone"));
		expect(spawned.ok).toBe(false);
		if (spawned.ok) return;
		expect(spawned.error.code).toBe("spawn_failed");
	});

	test("records itself in the run's lease so a reclaim can find it", async () => {
		const root = makeRepo();
		const created = await createWorktree(root, "pty-lease");
		if (!created.ok) throw new Error(created.error.message);
		const wt = created.value;

		const spawned = spawnPty(sh("sleep 60"), wt.path, { worktree: wt });
		if (!spawned.ok) throw new Error(spawned.error.message);

		const lease = await readLease(root, "pty-lease");
		expect(lease.ok).toBe(true);
		if (!lease.ok) return;
		expect(lease.value.lease.ptys.map((p) => p.pid)).toEqual([
			spawned.value.pid,
		]);
		await spawned.value.stop(200);
	});
});
