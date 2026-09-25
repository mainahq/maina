#!/usr/bin/env bun
/**
 * Fetches the public ~100k-LOC repository the code-graph bench runs
 * against (v1 task 5.5), pinned by commit so every run measures the same
 * tree. The checkout is cached: a directory already at the pinned commit is
 * reused without touching the network.
 *
 *     bun scripts/fixtures/fetch-100k-repo.ts [cache-dir]
 *
 * The cache directory defaults to `$MAINA_BENCH_CACHE` or `.cache/bench-repos`
 * under the repo root. The checkout's path is printed on stdout, alone, so a
 * caller can capture it.
 *
 * Pinned: colinhacks/zod (MIT), about 100k lines of TypeScript and
 * JavaScript across ~500 files, with a few hub modules (`v4/core/util.ts`,
 * `errors.ts`, `checks.ts`) much of the tree depends on. Bump `commit` deliberately and re-baseline.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export type PinnedRepo = Readonly<{
	name: string;
	url: string;
	/** Full 40-hex commit sha. */
	commit: string;
}>;

export const PINNED_REPO: PinnedRepo = {
	name: "zod",
	url: "https://github.com/colinhacks/zod",
	commit: "2bf7b0630d5378033e90bcee82cb32b0fe04628e",
};

/** Where the pinned checkout lives under `cacheRoot`. */
export function pinnedRepoDir(cacheRoot: string, repo: PinnedRepo): string {
	return join(cacheRoot, `${repo.name}-${repo.commit.slice(0, 12)}`);
}

/** The git invocations that check out exactly `repo.commit` in an empty directory. */
export function fetchPlan(repo: PinnedRepo): readonly (readonly string[])[] {
	return [
		["init", "--quiet"],
		["remote", "add", "origin", repo.url],
		["fetch", "--quiet", "--depth", "1", "--no-tags", "origin", repo.commit],
		["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"],
	];
}

/** Whether `git rev-parse HEAD` output names the pinned commit. */
export function isPinnedHead(revParse: string, repo: PinnedRepo): boolean {
	return revParse.trim() === repo.commit;
}

/**
 * The environment without `GIT_*` variables: run from a git hook, `GIT_DIR`
 * and friends would point these commands at maina's own repository instead
 * of the checkout in `cwd`.
 */
function gitEnv(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] =>
				!entry[0].startsWith("GIT_") && entry[1] !== undefined,
		),
	);
}

function git(
	cwd: string,
	args: readonly string[],
): { ok: boolean; out: string } {
	const proc = Bun.spawnSync(["git", ...args], {
		cwd,
		env: gitEnv(),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		ok: proc.exitCode === 0,
		out: proc.stdout.toString() + proc.stderr.toString(),
	};
}

/**
 * Returns the path of a checkout at the pinned commit, fetching it into
 * `cacheRoot` first when the cache does not hold it.
 */
export function ensurePinnedRepo(
	cacheRoot: string,
	repo: PinnedRepo = PINNED_REPO,
): { ok: true; dir: string } | { ok: false; message: string } {
	const dir = pinnedRepoDir(resolve(cacheRoot), repo);
	if (existsSync(join(dir, ".git"))) {
		const head = git(dir, ["rev-parse", "HEAD"]);
		if (head.ok && isPinnedHead(head.out, repo)) return { ok: true, dir };
	}
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const step of fetchPlan(repo)) {
		const ran = git(dir, step);
		if (!ran.ok) {
			rmSync(dir, { recursive: true, force: true });
			return {
				ok: false,
				message: `git ${step.join(" ")} failed: ${ran.out.trim()}`,
			};
		}
	}
	const head = git(dir, ["rev-parse", "HEAD"]);
	if (!head.ok || !isPinnedHead(head.out, repo)) {
		return {
			ok: false,
			message: `checkout is at ${head.out.trim()}, not ${repo.commit}`,
		};
	}
	return { ok: true, dir };
}

/** The cache root a caller gets when it names none. */
export function defaultCacheRoot(): string {
	return (
		process.env.MAINA_BENCH_CACHE ??
		join(import.meta.dir, "..", "..", ".cache", "bench-repos")
	);
}

if (import.meta.main) {
	const fetched = ensurePinnedRepo(process.argv[2] ?? defaultCacheRoot());
	if (!fetched.ok) {
		process.stderr.write(`fetch-100k-repo: ${fetched.message}\n`);
		process.exit(1);
	}
	process.stdout.write(`${fetched.dir}\n`);
}
