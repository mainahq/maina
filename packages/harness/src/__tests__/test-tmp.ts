/**
 * Temp dirs for tests (#632). Every dir a test asks for lives under one
 * marked per-process root (`maina-test-*`). Every root this process holds
 * (that one, and any `maina-srt-*` a test left undisposed) is removed:
 *
 * - after the test file's last test (`afterAll`: `bun test` never emits
 *   `exit`), or on exit when a script uses the fixtures;
 * - on SIGINT/SIGTERM/SIGHUP, after which the signal is raised again so
 *   the process still dies of it;
 * - after a SIGKILL or crash, by the next process's stale sweep.
 */

import { afterAll } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
	makeTmpRoot,
	removeAllTmpRoots,
	sweepStaleTmpRoots,
} from "../sandbox/tmp-root";

const TEST_ROOT_PREFIX = "maina-test-";

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
	sweepStaleTmpRoots([TEST_ROOT_PREFIX]);
	sweepStaleTmpRoots([TEST_ROOT_PREFIX], { parent: "/tmp" });
}

function testRoot(): string {
	if (root !== undefined && existsSync(root)) return root;
	sweepOnce();
	const made = makeTmpRoot(TEST_ROOT_PREFIX);
	if (!made.ok) throw new Error(`test temp root: ${made.error.message}`);
	root = realpathSync(made.value);
	return root;
}

/** A fresh `<prefix>XXXXXX` dir (real path) under this process's test root. */
export function testTmpDir(prefix: string): string {
	return realpathSync(mkdtempSync(join(testRoot(), prefix)));
}

/**
 * A fresh marked dir directly under `/tmp`, for a test that hands it to a
 * process as TMPDIR: srt binds sockets under a wrap dir inside it, and a
 * dir under the test root is too deep for them on macOS. Removed with the
 * test root.
 */
export function shallowTmpDir(): string {
	sweepOnce();
	const made = makeTmpRoot(TEST_ROOT_PREFIX, "/tmp");
	if (!made.ok) throw new Error(`shallow temp dir: ${made.error.message}`);
	return made.value;
}
