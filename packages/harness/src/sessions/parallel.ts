/**
 * Runs in parallel, each in a worktree of its own (FR-HAR-6).
 *
 * `runParallel(tasks, n, { root })` runs at most `n` tasks at once. Each
 * task gets a fresh worktree for its run id (`createWorktree`), and its
 * worktree is cleaned up when it finishes, however it finishes: a task that
 * throws is a crashed worker, and its PTYs and checkout are reclaimed on
 * the spot, its work kept on its branch unless `keepUnmerged: false`. A run
 * id that appears twice in one batch runs once; the repeat never starts.
 *
 * Results come back in task order and never reject.
 */

import type { Result } from "@mainahq/core";
import { type CleanupOutcome, cleanup } from "./cleanup";
import {
	createWorktree,
	type SessionDeps,
	type SessionError,
	type Worktree,
} from "./worktree";

export type RunTask<T> = Readonly<{
	runId: string;
	/** The worker: everything it does happens inside `worktree.path`. */
	run: (worktree: Worktree) => Promise<T>;
}>;

export type ParallelOptions = Readonly<{
	root: string;
	/** Passed to `cleanup`: only an explicit `false` deletes unmerged work. */
	keepUnmerged?: boolean;
	graceMs?: number;
	deps?: Partial<SessionDeps>;
}>;

export type ParallelRun<T> = Readonly<{
	runId: string;
	result: Result<T, SessionError>;
	/** How the worktree was cleaned up; absent when none was created. */
	cleanup?: Result<CleanupOutcome, SessionError>;
}>;

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

async function runOne<T>(
	task: RunTask<T>,
	options: ParallelOptions,
): Promise<ParallelRun<T>> {
	const created = await createWorktree(options.root, task.runId, options.deps);
	if (!created.ok) return { runId: task.runId, result: created };

	let result: Result<T, SessionError>;
	try {
		result = { ok: true, value: await task.run(created.value) };
	} catch (e) {
		result = {
			ok: false,
			error: {
				code: "task_failed",
				message: `run ${task.runId} failed: ${message(e)}`,
			},
		};
	}
	return {
		runId: task.runId,
		result,
		cleanup: await cleanup(task.runId, {
			root: options.root,
			keepUnmerged: options.keepUnmerged,
			graceMs: options.graceMs,
			deps: options.deps,
		}),
	};
}

export async function runParallel<T>(
	tasks: readonly RunTask<T>[],
	n: number,
	options: ParallelOptions,
): Promise<readonly ParallelRun<T>[]> {
	const seen = new Set<string>();
	const repeated = tasks.map((task) => {
		const again = seen.has(task.runId);
		seen.add(task.runId);
		return again;
	});

	const runs: ParallelRun<T>[] = new Array(tasks.length);
	let next = 0;
	const lane = async (): Promise<void> => {
		for (let i = next++; i < tasks.length; i = next++) {
			const task = tasks[i] as RunTask<T>;
			runs[i] = repeated[i]
				? {
						runId: task.runId,
						result: {
							ok: false,
							error: {
								code: "in_use",
								message: `run id ${task.runId} appears more than once in this batch`,
							},
						},
					}
				: await runOne(task, options);
		}
	};

	const width = Math.max(
		1,
		Math.min(Number.isFinite(n) ? Math.floor(n) : 1, tasks.length),
	);
	await Promise.all(Array.from({ length: width }, lane));
	return runs;
}
