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
	chmodSync,
	lstatSync,
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
	// A private per-user dir under tmp, never the shared tmp dir itself:
	// `ensureEndpointDirs` creates it 0700 and refuses one it does not own.
	return {
		address: join(tmpDir, `maina-${digest}`, `${base}.sock`),
		pidFile,
		spawnLock,
	};
}

/**
 * Under a host plugin, `run/` in the plugin's data dir (`PLUGIN_DATA`, else
 * `CLAUDE_PLUGIN_DATA`, as the launcher picks it): uninstalling the plugin
 * deletes that dir, and with it everything the runtime keeps (#341).
 * Otherwise `$XDG_RUNTIME_DIR/maina` when set, else `~/.maina/run`.
 */
export function defaultRuntimeDir(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string {
	const pluginData = env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA;
	if (pluginData) return join(pluginData, "run");
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

/**
 * Checks that `dir` is private to this user: a real directory (not a
 * symlink), owned by this uid, with no group or other access. A loose dir of
 * ours is tightened to 0700. Anything else is an error, because whoever
 * controls the socket's dir can bind a socket that answers for the runtime.
 */
function ensurePrivateDir(dir: string): string | null {
	const stat = lstatSync(dir);
	if (!stat.isDirectory()) return `${dir} is not a directory`;
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) {
		return `${dir} is not owned by this user`;
	}
	if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
	return null;
}

/**
 * Creates the dirs an endpoint lives in, private to the user, and checks
 * that the socket's dir is private (see `ensurePrivateDir`).
 */
export function ensureEndpointDirs(
	endpoint: Endpoint,
	platform: NodeJS.Platform,
): Result<void, RegistryError> {
	const dirs = new Set([dirname(endpoint.pidFile)]);
	if (platform !== "win32") dirs.add(dirname(endpoint.address));
	try {
		for (const dir of dirs) mkdirSync(dir, { recursive: true, mode: 0o700 });
		const refused =
			platform === "win32" ? null : ensurePrivateDir(dirname(endpoint.address));
		return refused === null
			? { ok: true, value: undefined }
			: { ok: false, error: { kind: "io_error", message: refused } };
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

type HeldError = Readonly<{ kind: "held"; pid: number }>;
type Claim = Result<null, HeldError | RegistryError>;

const CLAIMED: Claim = { ok: true, value: null };
const heldBy = (pid: number): Claim => ({
	ok: false,
	error: { kind: "held", pid },
});

/** Creates `path` only if it does not exist; false when it already does. */
function writeClaim(path: string, pid: number, now: number): boolean {
	try {
		writeFileSync(path, JSON.stringify({ pid, at: now }), {
			flag: "wx",
			mode: 0o600,
		});
		return true;
	} catch (err) {
		if (errorCode(err) === "EEXIST") return false;
		throw err;
	}
}

type ClaimState =
	| Readonly<{ state: "absent" }>
	| Readonly<{ state: "held"; pid: number }>
	| Readonly<{ state: "stale" }>;

function inspectClaim(
	path: string,
	now: number,
	isHeld: HoldCheck,
): ClaimState {
	const holder = readHolder(path);
	if (holder !== null) {
		return isHeld(holder, now)
			? { state: "held", pid: holder.pid }
			: { state: "stale" };
	}
	const age = ageMs(path, now);
	if (age === Number.POSITIVE_INFINITY) return { state: "absent" };
	return age < FRESH_UNREADABLE_MS
		? { state: "held", pid: 0 }
		: { state: "stale" };
}

/** A takeover marker older than this was left by a claimant that crashed. */
const TAKEOVER_STALE_MS = 5000;

/**
 * Creates `path` exclusively with `{ pid, at }`. When it already exists and
 * `isHeld` says the holder is still valid, returns the holder's pid.
 *
 * A stale claim is taken over under an exclusive marker directory
 * (`<path>.takeover`), and only a marker holder ever removes a claim. Since
 * `wx` never replaces an existing claim, the claim a marker holder re-reads
 * as stale cannot change before it removes it, so two claimants can never
 * both remove the old claim and both succeed.
 */
function claimExclusive(
	path: string,
	pid: number,
	now: number,
	isHeld: HoldCheck,
): Claim {
	try {
		if (writeClaim(path, pid, now)) return CLAIMED;
		const seen = inspectClaim(path, now, isHeld);
		if (seen.state === "held") return heldBy(seen.pid);
		const marker = `${path}.takeover`;
		if (ageMs(marker, now) >= TAKEOVER_STALE_MS) {
			rmSync(marker, { recursive: true, force: true });
		}
		try {
			mkdirSync(marker);
		} catch (err) {
			if (errorCode(err) === "EEXIST") return heldBy(0);
			throw err;
		}
		try {
			const current = inspectClaim(path, now, isHeld);
			if (current.state === "held") return heldBy(current.pid);
			if (current.state === "stale") rmSync(path, { force: true });
			return writeClaim(path, pid, now)
				? CLAIMED
				: heldBy(readHolder(path)?.pid ?? 0);
		} finally {
			rmSync(marker, { recursive: true, force: true });
		}
	} catch (err) {
		return { ok: false, error: { kind: "io_error", message: message(err) } };
	}
}

/** Removes `path` if `pid` still holds it. Best effort: never throws. */
function releaseExclusive(path: string, pid: number): void {
	try {
		if (readHolder(path)?.pid === pid) rmSync(path, { force: true });
	} catch {
		// Left behind; the next claimant sees a dead holder and takes over.
	}
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

/** True while `pid` still holds the endpoint's pid file. */
export function holdsPidFile(endpoint: Endpoint, pid: number): boolean {
	return readHolder(endpoint.pidFile)?.pid === pid;
}

/**
 * True once `pid` has certainly lost the endpoint's pid file: it is gone, or
 * it names another process. A file that cannot be read right now (EACCES,
 * EMFILE) is not a loss, so a transient error never stops a live runtime.
 */
export function lostPidFile(endpoint: Endpoint, pid: number): boolean {
	const holder = readHolder(endpoint.pidFile);
	if (holder !== null) return holder.pid !== pid;
	try {
		statSync(endpoint.pidFile);
		return false;
	} catch (err) {
		const code = errorCode(err);
		return code === "ENOENT" || code === "ENOTDIR";
	}
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
