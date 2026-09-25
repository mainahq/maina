/**
 * Runtime registry: where a runtime lives on disk (ADR 0044).
 *
 * One runtime per user per version. `resolveEndpoint` derives, from the
 * runtime dir, the user and the version, the IPC address (a Unix socket, or a
 * named pipe on Windows), the pid file the running runtime holds, and the
 * spawn lock clients take so only one of them starts a daemon.
 *
 * The pid file is the runtime's exclusivity claim. A claim is stale, and is
 * taken over, when its process is gone or when it was written before the last
 * boot (so a pid reused after a reboot never blocks a start).
 */

import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "@mainahq/core";

export type Endpoint = Readonly<{
	/** Unix socket path, or `\\.\pipe\...` on Windows. */
	address: string;
	/** Held by the running runtime for its lifetime. */
	pidFile: string;
	/** Held by the one client that is spawning the runtime. */
	spawnLock: string;
}>;

type EndpointInputs = Readonly<{
	platform: NodeJS.Platform;
	/** Per-user runtime dir; see `defaultRuntimeDir`. */
	dir: string;
	user: string;
	version: string;
	/** Short fallback dir for sockets whose path would be too long. */
	tmpDir: string;
}>;

/** `sun_path` holds 104 bytes on macOS (108 on Linux), including the NUL. */
const MAX_SOCKET_PATH_BYTES = 103;

/** Keep only characters that are safe in a file or pipe name. */
const safeName = (value: string): string =>
	value.replace(/[^A-Za-z0-9._-]/g, "_") || "_";

export function resolveEndpoint(inputs: EndpointInputs): Endpoint {
	const { platform, dir, tmpDir } = inputs;
	const user = safeName(inputs.user);
	const version = safeName(inputs.version);
	const base = `rt-${version}`;
	const pidFile = join(dir, `${base}.pid`);
	const spawnLock = join(dir, `${base}.lock`);
	if (platform === "win32") {
		return {
			address: `\\\\.\\pipe\\maina-${user}-${version}`,
			pidFile,
			spawnLock,
		};
	}
	const socket = join(dir, `${base}.sock`);
	if (Buffer.byteLength(socket) <= MAX_SOCKET_PATH_BYTES) {
		return { address: socket, pidFile, spawnLock };
	}
	const digest = createHash("sha256")
		.update(`${user}\0${dir}`)
		.digest("hex")
		.slice(0, 12);
	return {
		address: join(tmpDir, `maina-${digest}-${version}.sock`),
		pidFile,
		spawnLock,
	};
}

/** `$XDG_RUNTIME_DIR/maina` when set, else `~/.maina/run`. */
export function defaultRuntimeDir(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string {
	const xdg = env.XDG_RUNTIME_DIR;
	return xdg ? join(xdg, "maina") : join(home, ".maina", "run");
}

export type RegistryError = Readonly<{ kind: "io_error"; message: string }>;

const message = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

const errorCode = (err: unknown): string | undefined =>
	typeof err === "object" && err !== null && "code" in err
		? String((err as { code: unknown }).code)
		: undefined;

/** Creates the dirs an endpoint lives in, private to the user. */
export function ensureEndpointDirs(
	endpoint: Endpoint,
	platform: NodeJS.Platform,
): Result<void, RegistryError> {
	const dirs = new Set([dirname(endpoint.pidFile)]);
	if (platform !== "win32") dirs.add(dirname(endpoint.address));
	try {
		for (const dir of dirs) mkdirSync(dir, { recursive: true, mode: 0o700 });
		return { ok: true, value: undefined };
	} catch (err) {
		return { ok: false, error: { kind: "io_error", message: message(err) } };
	}
}

function processAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM: the process exists but belongs to someone else.
		return errorCode(err) === "EPERM";
	}
}

type Holder = Readonly<{ pid: number; at: number }>;

/** A lock file that is still being written reads as empty for a moment. */
const FRESH_UNREADABLE_MS = 2000;

const readHolder = (path: string): Holder | null => {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return null;
		const { pid, at } = parsed as Record<string, unknown>;
		return typeof pid === "number" && typeof at === "number"
			? { pid, at }
			: null;
	} catch {
		return null;
	}
};

const ageMs = (path: string, now: number): number => {
	try {
		return now - statSync(path).mtimeMs;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
};

type HoldCheck = (holder: Holder, now: number) => boolean;

/**
 * Creates `path` exclusively with `{ pid, at }`. When it already exists and
 * `isHeld` says the holder is still valid, returns the holder's pid; a stale
 * holder is removed and the create retried once.
 */
function claimExclusive(
	path: string,
	pid: number,
	now: number,
	isHeld: HoldCheck,
): Result<null, Readonly<{ kind: "held"; pid: number }> | RegistryError> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(path, JSON.stringify({ pid, at: now }), {
				flag: "wx",
				mode: 0o600,
			});
			return { ok: true, value: null };
		} catch (err) {
			if (errorCode(err) !== "EEXIST") {
				return {
					ok: false,
					error: { kind: "io_error", message: message(err) },
				};
			}
			const holder = readHolder(path);
			const held =
				holder === null
					? ageMs(path, now) < FRESH_UNREADABLE_MS
					: isHeld(holder, now);
			if (held)
				return { ok: false, error: { kind: "held", pid: holder?.pid ?? 0 } };
			rmSync(path, { force: true });
		}
	}
	return {
		ok: false,
		error: { kind: "io_error", message: `could not claim ${path}` },
	};
}

/** Removes `path` if `pid` still holds it. */
function releaseExclusive(path: string, pid: number): void {
	if (readHolder(path)?.pid === pid) rmSync(path, { force: true });
}

export type ClaimError =
	| Readonly<{ kind: "already_running"; pid: number }>
	| RegistryError;

/** Wall-clock time of the last boot, in ms. */
const bootTime = (now: number): number => now - uptime() * 1000;

/** A pid file is live while its process runs and it post-dates the last boot. */
const pidFileHeld: HoldCheck = (holder, now) =>
	processAlive(holder.pid) && holder.at >= bootTime(now) - 1000;

/** Claims the endpoint for the runtime process `pid`. */
export function claimPidFile(
	endpoint: Endpoint,
	pid: number,
	now: number,
): Result<null, ClaimError> {
	const claimed = claimExclusive(endpoint.pidFile, pid, now, pidFileHeld);
	if (claimed.ok) return claimed;
	const { error } = claimed;
	return error.kind === "held"
		? { ok: false, error: { kind: "already_running", pid: error.pid } }
		: { ok: false, error };
}

export function releasePidFile(endpoint: Endpoint, pid: number): void {
	releaseExclusive(endpoint.pidFile, pid);
}

/** A spawn should never take this long; an older lock is abandoned. */
const SPAWN_LOCK_STALE_MS = 10_000;

const spawnLockHeld: HoldCheck = (holder, now) =>
	processAlive(holder.pid) && now - holder.at < SPAWN_LOCK_STALE_MS;

/** True when this client now holds the spawn lock. */
export function acquireSpawnLock(
	endpoint: Endpoint,
	pid: number,
	now: number,
): boolean {
	return claimExclusive(endpoint.spawnLock, pid, now, spawnLockHeld).ok;
}

export function releaseSpawnLock(endpoint: Endpoint, pid: number): void {
	releaseExclusive(endpoint.spawnLock, pid);
}
