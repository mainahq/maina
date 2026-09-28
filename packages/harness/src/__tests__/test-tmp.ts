/**
 * Temp dirs for tests (#632). Every dir a test asks for lives under one
 * marked per-process root (`maina-test-*`), except a sandbox layout, which
 * is its own marked root (`maina-sbx-*`) directly in TMPDIR so srt's
 * sockets fit under it. Every root this process holds (those, and any
 * `maina-srt-*` a test left undisposed) is removed:
 *
 * - after the test file's last test (`afterAll`: `bun test` never emits
 *   `exit`), or on exit when a script uses the fixtures;
 * - on SIGINT/SIGTERM/SIGHUP, after which the signal is raised again so
 *   the process still dies of it;
 * - by a reaper, a detached `sh` per test root that waits for this process
 *   to go and then removes the root if it still carries its marker. That
 *   covers a SIGKILL or crash, and a `bun test` run over several files: bun
 *   shares one module registry across them, so `afterAll` above fires after
 *   the first file only, and nothing fires after the last;
 * - failing all of that, by the next process's stale sweep.
 */

import { afterAll } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
	makeTmpRoot,
	removeAllTmpRoots,
	sweepStaleTmpRoots,
	TMP_MARKER,
} from "../sandbox/tmp-root";

const TEST_ROOT_PREFIX = "maina-test-";
const LAYOUT_PREFIX = "maina-sbx-";

try {
	afterAll(removeAllTmpRoots);
} catch {
	// Not under `bun test` (the escape runner): the exit hook covers it.
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.once(signal, () => {
		removeAllTmpRoots();
		process.kill(process.pid, signal);
	});
}

let root: string | undefined;
let swept = false;

/** Sweeps what a killed test process left, once per process. */
function sweepOnce(): void {
	if (swept) return;
	swept = true;
	sweepStaleTmpRoots([TEST_ROOT_PREFIX, LAYOUT_PREFIX]);
	sweepStaleTmpRoots([TEST_ROOT_PREFIX], { parent: "/tmp" });
}

/**
 * Removes `dir` once this process is gone, however it went, unless it was
 * removed (its marker gone) first. Best effort: the sweep is the backstop.
 */
function reapAfterExit(dir: string): void {
	const script = `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; [ -f "$2/${TMP_MARKER}" ] && rm -rf "$2"`;
	try {
		Bun.spawn(
			["/bin/sh", "-c", script, "maina-tmp-reaper", String(process.pid), dir],
			{ stdio: ["ignore", "ignore", "ignore"], detached: true },
		).unref();
	} catch {
		// No sh: the stale sweep collects it.
	}
}

/** A marked root `<parent>/<prefix>XXXXXX`, reaped after this process. */
function markedRoot(prefix: string, parent?: string): string {
	sweepOnce();
	const made = makeTmpRoot(prefix, parent);
	if (!made.ok) throw new Error(`test temp root: ${made.error.message}`);
	reapAfterExit(made.value);
	return made.value;
}

function testRoot(): string {
	if (root !== undefined && existsSync(root)) return root;
	root = realpathSync(markedRoot(TEST_ROOT_PREFIX));
	return root;
}

/** A fresh `<prefix>XXXXXX` dir (real path) under this process's test root. */
export function testTmpDir(prefix: string): string {
	return realpathSync(mkdtempSync(join(testRoot(), prefix)));
}

/**
 * A fresh marked `maina-sbx-XXXXXX` dir (real path) directly in TMPDIR, for
 * a sandbox layout: an inner srt binds sockets in the layout's `tmp/`, and
 * under the test root that path is too long for macOS.
 */
export function layoutTmpDir(): string {
	return realpathSync(markedRoot(LAYOUT_PREFIX));
}

/**
 * A fresh marked dir directly under `/tmp`, for a test that hands it to a
 * process as TMPDIR: srt binds sockets under a wrap dir inside it, and a
 * dir under the test root is too deep for them on macOS. Removed with the
 * test root.
 */
export function shallowTmpDir(): string {
	return markedRoot(TEST_ROOT_PREFIX, "/tmp");
}
