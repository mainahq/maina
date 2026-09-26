/**
 * Resident runtime (FR-GATE-1, FR-MCP-5, FR-S1-5; ADR 0044).
 *
 * `startRuntime` claims the endpoint for this process (one runtime per user
 * per version), listens on its socket, and serves the IPC protocol. It exits
 * on its own when idle for `idleTtlMs`, and when a client of another version
 * connects, so that client can start a runtime of its own version.
 *
 * Request handling lives behind ports: `gate` answers `hook.evaluate`, and the
 * optional `handlers` answer `decide`, `graph.query` and `verify.run`. A
 * method without a port answers `not_implemented`. The optional `observe`
 * port sees each hook event first and runs background work beside the gate,
 * such as the graph hooks' incremental syncs (FR-GRAPH-2).
 *
 * A `session.stop` hook event is not a gate event: the optional `stop` port
 * answers it (verify on the session's changes, FR-VER-7) and the gate never
 * sees it. Without the port a stop is let through silently.
 */

import { chmodSync, existsSync, rmdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Result } from "@mainahq/core";
import type { Socket, UnixSocketListener } from "bun";
import {
	type GateDecision,
	type GateEvaluator,
	type GateEvent,
	parseGateDecision,
	parseGateEvent,
} from "./gate";
import {
	createLineSplitter,
	createWriter,
	decodeRequest,
	encodeMessage,
	MAX_MESSAGE_BYTES,
	type Method,
	PROTOCOL_VERSION,
	type Request,
	type Response,
	type RpcError,
	type Writer,
} from "./ipc";
import { createIdleTimer } from "./lifecycle";
import {
	type ClaimError,
	claimPidFile,
	type Endpoint,
	ensureEndpointDirs,
	holdsPidFile,
	type RegistryError,
	releasePidFile,
} from "./registry";
import { QUIET_STOP, SESSION_STOP } from "./stop-verify";

/** Methods served by an optional handler port. */
export type DelegatedMethod = Exclude<Method, "hook.evaluate" | "status">;

/** A handler port: may return a value or a promise; a throw is `handler_failed`. */
export type RequestHandler = (params: unknown) => unknown;

export type RuntimePorts = Readonly<{
	gate: GateEvaluator;
	handlers?: Readonly<Partial<Record<DelegatedMethod, RequestHandler>>>;
	/**
	 * Sees every valid hook event before the gate evaluates it, for background
	 * work such as keeping the code graph current (FR-GRAPH-2). Returns the
	 * work's promise, or null for none.
	 */
	observe?: (event: GateEvent) => Promise<unknown> | null;
	/**
	 * Answers a `session.stop` event with the stop decision host adapters
	 * render through their stop contracts (see `adapters/stop.ts`): `deny`
	 * blocks the stop, an `allow` reason is the summary to show.
	 */
	stop?: (event: GateEvent) => GateDecision | Promise<GateDecision>;
}>;

type RuntimeConfig = Readonly<{
	endpoint: Endpoint;
	version: string;
	/** Exit after this long with no request in flight. */
	idleTtlMs: number;
	/** How often to check the pid file is still ours; `CLAIM_CHECK_MS` by default. */
	claimCheckMs?: number;
}>;

/**
 * `orphaned`: the pid file is gone (a plugin uninstall deleted its data
 * dir, #341) or another runtime took it over.
 */
export type StopReason = "stopped" | "idle" | "version_mismatch" | "orphaned";

/** A runtime notices within this long that its claim is gone. */
const CLAIM_CHECK_MS = 5_000;

export type Runtime = Readonly<{
	endpoint: Endpoint;
	address: string;
	version: string;
	pid: number;
	/** Stops at once; idempotent. */
	stop: () => void;
	/** Resolves once the runtime has stopped and released its endpoint. */
	closed: Promise<StopReason>;
}>;

type StartError =
	| ClaimError
	| RegistryError
	| Readonly<{ kind: "listen_failed"; message: string }>;

type Conn = { writer: Writer; split: ReturnType<typeof createLineSplitter> };

/** How long a stopping runtime waits for a client to read its last answer. */
const STOP_GRACE_MS = 1000;

type Outcome = Result<unknown, RpcError>;

const rpcError = (code: RpcError["code"], message: string): Outcome => ({
	ok: false,
	error: { code, message },
});

const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

/** Runs a port, turning a throw or a rejection into `handler_failed`. */
async function runPort(run: () => unknown): Promise<Outcome> {
	try {
		return { ok: true, value: await run() };
	} catch (err) {
		return rpcError("handler_failed", errorMessage(err));
	}
}

/** Removes `dir` when it is empty; anything else leaves it. */
function removeEmptyDir(dir: string): void {
	try {
		rmdirSync(dir);
	} catch {
		// Not empty (another runtime's socket) or already gone.
	}
}

/** A handler can return a value JSON cannot encode (a BigInt, a cycle). */
function encodeSafely(response: Response): string {
	try {
		return encodeMessage(response);
	} catch (err) {
		const { v, id, runtimeVersion } = response;
		return encodeMessage({
			v,
			id,
			runtimeVersion,
			ok: false,
			error: {
				code: "handler_failed",
				message: `result could not be serialised: ${errorMessage(err)}`,
			},
		});
	}
}

async function evaluateHook(
	ports: RuntimePorts,
	params: unknown,
	observe: (event: GateEvent) => void,
): Promise<Outcome> {
	const event = parseGateEvent(params);
	if (event === null) return rpcError("bad_request", "invalid gate event");
	observe(event);
	if (event.kind === SESSION_STOP) return stopSession(ports.stop, event);
	const ran = await runPort(() => ports.gate(event));
	if (!ran.ok) return ran;
	const decision = parseGateDecision(ran.value);
	return decision === null
		? rpcError("handler_failed", "gate returned an invalid decision")
		: { ok: true, value: decision };
}

/** The `session.stop` handler: the stop port's decision, or a quiet allow. */
async function stopSession(
	stop: RuntimePorts["stop"],
	event: GateEvent,
): Promise<Outcome> {
	if (stop === undefined) return { ok: true, value: QUIET_STOP };
	const ran = await runPort(() => stop(event));
	if (!ran.ok) return ran;
	const decision = parseGateDecision(ran.value);
	return decision === null
		? rpcError("handler_failed", "stop returned an invalid decision")
		: { ok: true, value: decision };
}

export function startRuntime(
	ports: RuntimePorts,
	config: RuntimeConfig,
): Result<Runtime, StartError> {
	const { endpoint, version, idleTtlMs } = config;
	const claimCheckMs = config.claimCheckMs ?? CLAIM_CHECK_MS;
	const pid = process.pid;
	const startedAt = Date.now();
	const isPipe = process.platform === "win32";

	const dirs = ensureEndpointDirs(endpoint, process.platform);
	if (!dirs.ok) return dirs;
	const claimed = claimPidFile(endpoint, pid, startedAt);
	if (!claimed.ok) return claimed;

	let requests = 0;
	let stopping: StopReason | null = null;
	const { promise: closed, resolve: resolveClosed } =
		Promise.withResolvers<StopReason>();
	const conns = new Set<Socket<Conn>>();
	let listener: UnixSocketListener<Conn> | null = null;
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	let claimTimer: ReturnType<typeof setInterval> | undefined;

	const finalize = (): void => {
		clearTimeout(graceTimer);
		listener?.stop(true);
		if (stopping) resolveClosed(stopping);
	};

	/**
	 * Frees the endpoint synchronously (no new connections, socket and pid
	 * file removed) so a successor can claim it at once. Open connections get
	 * a grace period to read their last answer unless `now` is set.
	 */
	const beginStop = (reason: StopReason, now: boolean): void => {
		if (stopping) {
			if (now) finalize();
			return;
		}
		stopping = reason;
		idle.cancel();
		clearInterval(claimTimer);
		listener?.stop(false);
		// A runtime displaced from its claim must not unlink the socket path,
		// which now belongs to the runtime that holds the pid file. With no
		// pid file at all the path is nobody else's. (On Linux, Bun unlinks
		// the path itself when the listener stops.)
		const unclaimed = !existsSync(endpoint.pidFile);
		if (!isPipe && (unclaimed || holdsPidFile(endpoint, pid))) {
			rmSync(endpoint.address, { force: true });
			// A socket too deep for its runtime dir lives in a private dir
			// under tmp; once the runtime dir is gone, nothing else removes it.
			const socketDir = dirname(endpoint.address);
			if (unclaimed && socketDir !== dirname(endpoint.pidFile)) {
				removeEmptyDir(socketDir);
			}
		}
		releasePidFile(endpoint, pid);
		if (now || conns.size === 0) finalize();
		else graceTimer = setTimeout(finalize, STOP_GRACE_MS);
	};

	const idle = createIdleTimer(idleTtlMs, () => beginStop("idle", true));

	const status = () => ({
		version,
		protocol: PROTOCOL_VERSION,
		pid,
		startedAt,
		uptimeMs: Date.now() - startedAt,
		requests,
		idleTtlMs,
	});

	/**
	 * Hands an event to the observer port without waiting for its work,
	 * which keeps the runtime from going idle until it finishes. An observer
	 * that throws or rejects never affects the gate.
	 */
	const observe = (event: GateEvent): void => {
		if (!ports.observe) return;
		let work: Promise<unknown> | null;
		try {
			work = ports.observe(event);
		} catch {
			return;
		}
		if (work === null) return;
		idle.begin();
		work.then(
			() => idle.end(),
			() => idle.end(),
		);
	};

	const dispatch = (req: Request): Promise<Outcome> => {
		switch (req.method) {
			case "status":
				return Promise.resolve({ ok: true, value: status() });
			case "hook.evaluate":
				return evaluateHook(ports, req.params, observe);
			case "decide":
			case "graph.query":
			case "verify.run": {
				const handler = ports.handlers?.[req.method];
				return handler
					? runPort(() => handler(req.params))
					: Promise.resolve(
							rpcError("not_implemented", `${req.method} is not available yet`),
						);
			}
			default: {
				const unreachable: never = req.method;
				return Promise.resolve(
					rpcError("unknown_method", `unknown method ${String(unreachable)}`),
				);
			}
		}
	};

	const reply = (
		socket: Socket<Conn>,
		id: string | null,
		outcome: Outcome,
	): void => {
		const base = { v: PROTOCOL_VERSION, id, runtimeVersion: version } as const;
		const response: Response = outcome.ok
			? { ...base, ok: true, result: outcome.value }
			: { ...base, ok: false, error: outcome.error };
		socket.data.writer.write(socket, encodeSafely(response));
	};

	const handleLine = async (socket: Socket<Conn>, line: string) => {
		const decoded = decodeRequest(line);
		if (!decoded.ok) {
			const { id, code, message } = decoded.error;
			if (code === "version_mismatch") beginStop("version_mismatch", false);
			reply(socket, id, rpcError(code, message));
			return;
		}
		const req = decoded.value;
		if (req.clientVersion !== version) {
			// Free the endpoint before answering: the client spawns its own
			// version as soon as it reads this.
			beginStop("version_mismatch", false);
			reply(
				socket,
				req.id,
				rpcError(
					"version_mismatch",
					`runtime ${version} does not serve client ${req.clientVersion}`,
				),
			);
			return;
		}
		requests++;
		idle.begin();
		const outcome = await dispatch(req);
		idle.end();
		reply(socket, req.id, outcome);
	};

	try {
		if (!isPipe) rmSync(endpoint.address, { force: true });
		listener = Bun.listen<Conn>({
			unix: endpoint.address,
			socket: {
				open: (socket) => {
					socket.data = {
						writer: createWriter(),
						split: createLineSplitter(MAX_MESSAGE_BYTES),
					};
					conns.add(socket);
				},
				drain: (socket) => socket.data.writer.drain(socket),
				data: (socket, chunk) => {
					const lines = socket.data.split(chunk);
					if (!lines.ok) return void socket.end();
					for (const line of lines.value) void handleLine(socket, line);
				},
				close: (socket) => {
					conns.delete(socket);
					if (stopping && conns.size === 0) finalize();
				},
				error: (socket) => {
					conns.delete(socket);
				},
			},
		});
		if (!isPipe) chmodSync(endpoint.address, 0o600);
		// A runtime that lost its pid file stops: nothing can find it any
		// more, and a host plugin's uninstall removed it on purpose.
		claimTimer = setInterval(() => {
			if (!holdsPidFile(endpoint, pid)) beginStop("orphaned", true);
		}, claimCheckMs);
		claimTimer.unref();
	} catch (err) {
		// `chmodSync` can fail after the listener is up: take it down too.
		idle.cancel();
		listener?.stop(true);
		if (!isPipe) {
			try {
				rmSync(endpoint.address, { force: true });
			} catch {
				// Nothing more to do; the next start removes it.
			}
		}
		releasePidFile(endpoint, pid);
		return {
			ok: false,
			error: { kind: "listen_failed", message: errorMessage(err) },
		};
	}

	return {
		ok: true,
		value: {
			endpoint,
			address: endpoint.address,
			version,
			pid,
			stop: () => beginStop("stopped", true),
			closed,
		},
	};
}
