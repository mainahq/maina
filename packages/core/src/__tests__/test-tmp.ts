/**
 * Temp dirs for core tests (#637): the core twin of harness's
 * `src/__tests__/test-tmp.ts` (core cannot import harness). Every dir a test
 * asks for lives under one per-process `maina-test-*` root carrying the same
 * `.maina-tmp` pid marker as harness's roots, so harness's stale sweep also
 * collects one this helper failed to remove. The root is removed:
 *
 * - after the test file's last test (`afterAll`), or on exit in a script;
 * - on SIGINT/SIGTERM/SIGHUP, after which the signal is raised again;
 * - by a detached `sh` reaper that waits for this process to go and then
 *   removes the root if it still carries its marker: a SIGKILL, a crash, or
 *   a `bun test` run over several files, where `afterAll` fires after the
 *   first file only.
 */

import { afterAll } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = ".maina-tmp";

let root: string | undefined;

function removeRoot(): void {
	if (root === undefined) return;
	const dir = root;
	root = undefined;
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// Busy or raced: the reaper, or harness's stale sweep, collects it.
	}
}

try {
	afterAll(removeRoot);
} catch {
	// Not under `bun test`: the exit hook covers it.
}
process.once("exit", removeRoot);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.once(signal, () => {
		removeRoot();
		process.kill(process.pid, signal);
	});
}

/** Removes `dir` once this process is gone, unless its marker went first. */
function reapAfterExit(dir: string): void {
	const script = `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; [ -f "$2/${MARKER}" ] && rm -rf "$2"`;
	Bun.spawn(
		["/bin/sh", "-c", script, "maina-tmp-reaper", String(process.pid), dir],
		{ stdio: ["ignore", "ignore", "ignore"], detached: true },
	).unref();
}

function testRoot(): string {
	if (root !== undefined && existsSync(root)) return root;
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-test-")));
	chmodSync(dir, 0o700);
	writeFileSync(join(dir, MARKER), `${process.pid}\n`, { mode: 0o600 });
	reapAfterExit(dir);
	root = dir;
	return dir;
}

/** A fresh `<prefix>XXXXXX` dir (real path) under this process's test root. */
export function testTmpDir(prefix: string): string {
	return realpathSync(mkdtempSync(join(testRoot(), prefix)));
}
