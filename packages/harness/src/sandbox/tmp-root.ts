/**
 * Maina-owned temp directories (#632): each one is a private dir under the
 * system temp dir that carries a marker file naming the process that made
 * it. Whatever lands inside (a sandbox wrap's settings, and the CA material
 * and sockets sandbox-runtime makes under its own TMPDIR) goes with it.
 *
 * A root is removed three ways: by its owner when done (`removeTmpRoot`), at
 * the latest when its process exits (an `exit` hook), and, when the process
 * died without running that hook (SIGKILL, a crash), by the next run's
 * `sweepStaleTmpRoots`, which only touches marked dirs whose owner is gone.
 */

import {
	chmodSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@mainahq/core";

/** The file that marks a dir as maina's; it holds the owner's pid. */
export const TMP_MARKER = ".maina-tmp";

/** Roots this process made and has not removed yet. */
const live = new Set<string>();
let exitHooked = false;

function hookExit(): void {
	if (exitHooked) return;
	exitHooked = true;
	process.once("exit", removeAllTmpRoots);
}

type TmpRootError = Readonly<{ code: "io"; message: string }>;

/** A 0700 dir `<parent>/<prefix>XXXXXX` carrying the marker, removed on exit. */
export function makeTmpRoot(
	prefix: string,
	parent: string = tmpdir(),
): Result<string, TmpRootError> {
	try {
		const dir = mkdtempSync(join(parent, prefix));
		chmodSync(dir, 0o700);
		writeFileSync(join(dir, TMP_MARKER), `${process.pid}\n`, { mode: 0o600 });
		live.add(dir);
		hookExit();
		return { ok: true, value: dir };
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "io",
				message: e instanceof Error ? e.message : String(e),
			},
		};
	}
}

/**
 * Removes `dir` if it carries the marker, so a path from elsewhere is never
 * taken. Never throws: a leftover is the sweep's to collect.
 */
export function removeTmpRoot(dir: string): void {
	live.delete(dir);
	try {
		if (!lstatSync(join(dir, TMP_MARKER)).isFile()) return;
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// Already gone, or not ours.
	}
}

/** Removes every root this process still holds. */
export function removeAllTmpRoots(): void {
	for (const dir of [...live]) removeTmpRoot(dir);
}

/** Whether process `pid` exists (EPERM: it does, as another user). */
function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

type SweepOptions = Readonly<{
	parent?: string;
	/** Only markers older than this are considered; 1 hour by default. */
	maxAgeMs?: number;
	alive?: (pid: number) => boolean;
}>;

const STALE_MS = 60 * 60 * 1000;

/**
 * Removes the `prefixes` dirs under `parent` that a dead process left: each
 * must carry the marker, be older than `maxAgeMs`, and name a pid that is
 * not running. Returns what it removed.
 */
export function sweepStaleTmpRoots(
	prefixes: readonly string[],
	options: SweepOptions = {},
): string[] {
	const parent = options.parent ?? tmpdir();
	const maxAgeMs = options.maxAgeMs ?? STALE_MS;
	const alive = options.alive ?? pidAlive;
	let names: string[];
	try {
		names = readdirSync(parent);
	} catch {
		return [];
	}
	const now = Date.now();
	const removed: string[] = [];
	for (const name of names) {
		if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
		const dir = join(parent, name);
		try {
			const marker = join(dir, TMP_MARKER);
			const stat = lstatSync(marker);
			if (!stat.isFile() || now - stat.mtimeMs < maxAgeMs) continue;
			const pid = Number.parseInt(readFileSync(marker, "utf8"), 10);
			if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
			rmSync(dir, { recursive: true, force: true });
			removed.push(dir);
		} catch {
			// Unmarked, unreadable, or raced by another sweep: leave it.
		}
	}
	return removed;
}
