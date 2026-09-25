import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runParallel } from "../parallel";
import { spawnPty } from "../pty";
import type { Worktree } from "../worktree";
import { alive, eventually, gitIn, makeRepo, refExists } from "./repo-fixture";

const N = 6;

describe("runParallel", () => {
	test("N parallel runs never share a worktree", async () => {
		const root = makeRepo();
		const seen: Worktree[] = [];
		const tasks = Array.from({ length: N }, (_, i) => ({
			runId: `run-${i}`,
			run: async (wt: Worktree) => {
				seen.push(wt);
				writeFileSync(join(wt.path, "owner.txt"), wt.runId);
				// Let every run write before any run looks.
				await Bun.sleep(50);
				return readdirSync(wt.path).filter((f) => f === "owner.txt").length;
			},
		}));

		const runs = await runParallel(tasks, N, { root });

		expect(runs.map((r) => r.runId)).toEqual(tasks.map((t) => t.runId));
		for (const r of runs) expect(r.result).toEqual({ ok: true, value: 1 });
		expect(new Set(seen.map((wt) => wt.path)).size).toBe(N);
		expect(new Set(seen.map((wt) => wt.branch)).size).toBe(N);
		// Each run saw only its own file, and it was committed to its branch
		// on the way out, so no run's work landed in another's.
		for (const wt of seen) {
			expect(gitIn(root, "show", `${wt.branch}:owner.txt`).out).toBe(wt.runId);
			expect(existsSync(wt.path)).toBe(false);
		}
	});

	test("never runs more than n at once, and keeps input order", async () => {
		const root = makeRepo();
		let running = 0;
		let peak = 0;
		const tasks = Array.from({ length: 5 }, (_, i) => ({
			runId: `bounded-${i}`,
			run: async () => {
				running += 1;
				peak = Math.max(peak, running);
				await Bun.sleep(20 * (5 - i));
				running -= 1;
				return i;
			},
		}));

		const runs = await runParallel(tasks, 2, { root });
		expect(peak).toBe(2);
		expect(runs.map((r) => r.result)).toEqual(
			[0, 1, 2, 3, 4].map((value) => ({ ok: true, value })),
		);
	});

	test("a run id twice in one batch: the second never runs", async () => {
		const root = makeRepo();
		let calls = 0;
		const task = {
			runId: "dup",
			run: async () => {
				calls += 1;
				return calls;
			},
		};

		const runs = await runParallel([task, task], 2, { root });
		expect(calls).toBe(1);
		expect(runs[0]?.result.ok).toBe(true);
		expect(runs[1]?.result).toMatchObject({
			ok: false,
			error: { code: "in_use" },
		});
	});

	test("a crashed worker's PTY and worktree are reclaimed, the others finish", async () => {
		const root = makeRepo();
		let ptyPid = 0;
		let crashedPath = "";
		const runs = await runParallel(
			[
				{
					runId: "crasher",
					run: async (wt: Worktree) => {
						crashedPath = wt.path;
						const pty = spawnPty(
							{ name: "agent", command: "/bin/sh", args: ["-c", "sleep 60"] },
							wt.path,
							{ worktree: wt },
						);
						if (pty.ok) ptyPid = pty.value.pid;
						throw new Error("worker crashed");
					},
				},
				{ runId: "steady", run: async () => "done" },
			],
			2,
			{ root, graceMs: 200 },
		);

		expect(runs[0]?.result).toMatchObject({
			ok: false,
			error: { code: "task_failed" },
		});
		expect(
			runs[0]?.result.ok === false && runs[0].result.error.message,
		).toContain("worker crashed");
		expect(runs[0]?.cleanup?.ok).toBe(true);
		expect(runs[1]?.result).toEqual({ ok: true, value: "done" });
		expect(ptyPid).toBeGreaterThan(0);
		expect(await eventually(() => !alive(ptyPid))).toBe(true);
		expect(existsSync(crashedPath)).toBe(false);
	});

	test("keepUnmerged is passed through: false discards the runs' branches", async () => {
		const root = makeRepo();
		const runs = await runParallel(
			[
				{
					runId: "scratch",
					run: async (wt: Worktree) => {
						writeFileSync(join(wt.path, "tmp.txt"), "x");
					},
				},
			],
			1,
			{ root, keepUnmerged: false },
		);
		expect(runs[0]?.cleanup?.ok).toBe(true);
		expect(refExists(root, "maina/run/scratch")).toBe(false);
	});
});
