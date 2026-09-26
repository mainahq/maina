/**
 * Records retention events (FR-RET-7) into this user's local history,
 * `~/.maina/retention.jsonl`. Local only: nothing here touches the network.
 * A recorder never rejects, so a surface (a hook, the status line, the
 * digest) is never held up or broken by it.
 *
 * The log is replaced whole (written to a temp file, then renamed over it),
 * so a reader never sees a half-written log. Each read-append-write runs
 * under an exclusive lock file next to the log, so a hook and the status
 * line recording at once (both fire at session start) never overwrite each
 * other's event.
 */

import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	type EnvPort,
	type FsPort,
	type RetentionEvent,
	recordRetentionEvent,
	retentionLogFile,
} from "@mainahq/core";
import { processEnv } from "./env";
import { nodeFs } from "./ports";

type RetentionRecorder = (event: RetentionEvent) => Promise<void>;

/** A recorder writing through `fs` under `home`; a no-op without a home. */
export function retentionRecorder(
	fs: FsPort,
	home: string | undefined,
): RetentionRecorder {
	return async (event) => {
		if (home === undefined) return;
		try {
			await recordRetentionEvent(fs, retentionLogFile(home), event);
		} catch {
			// Measurement must never break the surface that records it.
		}
	};
}

/** `nodeFs` whose writes replace the file atomically. */
const atomicFs: FsPort = {
	...nodeFs,
	writeFile: async (path, content) => {
		const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
		const written = await nodeFs.writeFile(tmp, content);
		if (!written.ok) return written;
		try {
			await rename(tmp, path);
			return { ok: true, value: undefined };
		} catch (error) {
			await rm(tmp, { force: true }).catch(() => undefined);
			return {
				ok: false,
				error: {
					kind: "io",
					path,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	},
};

/** `$HOME` (or `%USERPROFILE%`), as consent reads it; else the OS's answer. */
export function userHome(env: EnvPort = processEnv): string | undefined {
	const fromEnv = env.get("HOME") || env.get("USERPROFILE");
	if (fromEnv) return fromEnv;
	try {
		return homedir() || undefined;
	} catch {
		return undefined;
	}
}

/** How long a recorder waits for another one to finish before giving up. */
const LOCK_WAIT_MS = 1_000;
const LOCK_RETRY_MS = 5;
/** A lock older than this was left by a recorder that died; it is broken. */
const LOCK_STALE_MS = 10_000;

const pause = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorCode = (error: unknown): unknown =>
	typeof error === "object" && error !== null && "code" in error
		? error.code
		: undefined;

/** Creates `lock` exclusively; false when it stays taken or cannot be made. */
async function acquireLock(lock: string): Promise<boolean> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			await (await open(lock, "wx")).close();
			return true;
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT") {
				await mkdir(dirname(lock), { recursive: true });
				continue;
			}
			if (code !== "EEXIST") return false;
		}
		const age = await stat(lock).then(
			(s) => Date.now() - s.mtimeMs,
			() => 0,
		);
		if (age > LOCK_STALE_MS) {
			await rm(lock, { force: true });
			continue;
		}
		if (Date.now() >= deadline) return false;
		await pause(LOCK_RETRY_MS);
	}
}

/**
 * Records `event` in the current user's history, one recorder at a time.
 * Never rejects; when another recorder holds the log past `LOCK_WAIT_MS`,
 * the event is dropped rather than holding up the surface.
 */
export async function recordRetention(event: RetentionEvent): Promise<void> {
	const home = userHome();
	if (home === undefined) return;
	const lock = `${retentionLogFile(home)}.lock`;
	try {
		if (!(await acquireLock(lock))) return;
	} catch {
		return;
	}
	try {
		await retentionRecorder(atomicFs, home)(event);
	} finally {
		await rm(lock, { force: true }).catch(() => undefined);
	}
}
