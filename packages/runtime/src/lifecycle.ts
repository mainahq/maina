/**
 * Runtime lifecycle (FR-GATE-1, FR-S1-5; ADR 0044): the idle clock that ends
 * a resident runtime, the spawner that starts the daemon, and the
 * single-flight `ensureRuntime` a client runs when no runtime answers.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "@mainahq/core";
import { createRequest, sendRequest } from "./ipc";
import { acquireSpawnLock, type Endpoint, releaseSpawnLock } from "./registry";

type IdleTimer = Readonly<{
	/** A request started: the clock stops while any request is in flight. */
	begin: () => void;
	/** A request finished: the clock restarts once none is in flight. */
	end: () => void;
	cancel: () => void;
}>;

/** Calls `onIdle` once `ttlMs` passes with no request in flight. */
export function createIdleTimer(ttlMs: number, onIdle: () => void): IdleTimer {
	let inFlight = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const arm = (): void => {
		clearTimeout(timer);
		if (!cancelled && inFlight === 0) timer = setTimeout(onIdle, ttlMs);
	};
	arm();
	return {
		begin: () => {
			inFlight++;
			clearTimeout(timer);
		},
		end: () => {
			inFlight = Math.max(0, inFlight - 1);
			arm();
		},
		cancel: () => {
			cancelled = true;
			clearTimeout(timer);
		},
	};
}

export type SpawnError = Readonly<{ kind: "spawn_failed"; message: string }>;

/** Starts a runtime process in the background; does not wait for it. */
export type SpawnRuntime = () => Result<Readonly<{ pid: number }>, SpawnError>;

type DaemonOptions = Readonly<{
	endpoint: Endpoint;
	version: string;
	idleTtlMs: number;
	/** Bun executable; defaults to the one running this process. */
	execPath?: string;
}>;

const DAEMON_ENTRY = fileURLToPath(new URL("./daemon.ts", import.meta.url));

/** Spawns `daemon.ts` detached from this process, with stdio closed. */
export function daemonSpawner(options: DaemonOptions): SpawnRuntime {
	const { endpoint, version, idleTtlMs } = options;
	const argv = [
		options.execPath ?? process.execPath,
		DAEMON_ENTRY,
		"--address",
		endpoint.address,
		"--pid-file",
		endpoint.pidFile,
		"--spawn-lock",
		endpoint.spawnLock,
		"--version",
		version,
		"--idle-ttl-ms",
		String(idleTtlMs),
	];
	return () => {
		try {
			const proc = Bun.spawn(argv, {
				cwd: dirname(endpoint.pidFile),
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
			});
			proc.unref();
			return { ok: true, value: { pid: proc.pid } };
		} catch (err) {
			return {
				ok: false,
				error: {
					kind: "spawn_failed",
					message: err instanceof Error ? err.message : String(err),
				},
			};
		}
	};
}

type EnsureError = SpawnError | Readonly<{ kind: "timeout"; message: string }>;

type EnsureOptions = Readonly<{
	endpoint: Endpoint;
	version: string;
	spawn: SpawnRuntime;
	/** Absolute `Date.now()` deadline. */
	deadline: number;
}>;

const POLL_MS = 10;
const PROBE_TIMEOUT_MS = 250;

/** True when a runtime of `version` answers `status` on the endpoint. */
async function answers(
	endpoint: Endpoint,
	version: string,
	deadline: number,
): Promise<boolean> {
	const budget = Math.min(PROBE_TIMEOUT_MS, deadline - Date.now());
	if (budget <= 0) return false;
	const sent = await sendRequest(
		endpoint.address,
		createRequest("status", undefined, version),
		budget,
	);
	return sent.ok && sent.value.ok && sent.value.runtimeVersion === version;
}

/**
 * Makes sure a runtime of `version` is serving the endpoint by `deadline`.
 * Single flight: only the client holding the spawn lock spawns; the others
 * wait for the runtime to answer. A client that finds the lock abandoned
 * (its holder gave up or died) takes it over. The runtime's own pid file
 * claim is the second guard against duplicate daemons.
 */
export async function ensureRuntime(
	options: EnsureOptions,
): Promise<Result<null, EnsureError>> {
	const { endpoint, version, spawn, deadline } = options;
	const pid = process.pid;
	let holdsLock = false;
	try {
		for (;;) {
			if (await answers(endpoint, version, deadline)) {
				return { ok: true, value: null };
			}
			if (!holdsLock && acquireSpawnLock(endpoint, pid, Date.now())) {
				holdsLock = true;
				// The previous holder may have released it because its runtime
				// just came up: look once more before spawning another.
				if (await answers(endpoint, version, deadline)) {
					return { ok: true, value: null };
				}
				const spawned = spawn();
				if (!spawned.ok) return spawned;
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return {
					ok: false,
					error: {
						kind: "timeout",
						message: "runtime did not come up in time",
					},
				};
			}
			await Bun.sleep(Math.min(POLL_MS, remaining));
		}
	} finally {
		if (holdsLock) releaseSpawnLock(endpoint, pid);
	}
}
