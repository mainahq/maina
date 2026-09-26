/**
 * Records retention events (FR-RET-7) into this user's local history,
 * `~/.maina/retention.jsonl`. Local only: nothing here touches the network.
 * A recorder never rejects, so a surface (a hook, the status line, the
 * digest) is never held up or broken by it.
 *
 * The log is replaced whole (written to a temp file, then renamed over it),
 * so a hook and the status line recording at once never read a half-written
 * log and write the truncated copy back.
 */

import { rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
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

/** Records `event` in the current user's history. Never rejects. */
export function recordRetention(event: RetentionEvent): Promise<void> {
	return retentionRecorder(atomicFs, userHome())(event);
}
