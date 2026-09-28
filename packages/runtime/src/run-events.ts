/**
 * Run events in the resident runtime (#594, cloud plan Task 8.4, FR-RUN-1):
 * wires the runtime's ports so runs reach the Link uplink.
 *
 * - Plugin sessions: every hook event goes to `runs.observe` (a
 *   `session.start` opens the session's run, a `session.stop` ends it) and
 *   the gate's verdict on each tool event to `runs.decided`, after the host
 *   has its answer: the uplink is never on the gate path.
 * - `maina run` workers: the `run.event` request carries one run fact
 *   (`parseRunFact`), queued on the uplink as it is. The uplink's outbox
 *   has one writer, the resident runtime, so a `maina run` process hands
 *   its facts over with `createRunEventClient`, in order.
 */

import type { GateDecision, GateEvent } from "./gate";
import { createRequest, sendRequest } from "./ipc";
import { ensureRuntime, type SpawnRuntime } from "./lifecycle";
import { type EventSink, isLabel } from "./link/producers/emit";
import {
	emitRun,
	isRunVerdict,
	parseRunFact,
	type RunFact,
	type RunSource,
} from "./link/producers/run";
import { type Endpoint, ensureEndpointDirs } from "./registry";
import type { RuntimePorts } from "./server";
import { SESSION_START, SESSION_STOP } from "./stop-verify";

// ── Plugin sessions ────────────────────────────────────────────────────────

/** An open run of a plugin session. */
type PluginRun = Readonly<{
	runId: string;
	source: RunSource;
	agent: string;
	/** Milliseconds, from `now`. */
	startedAt: number;
	steps: number;
}>;

type PluginRunsPorts = Readonly<{
	/** The uplink's `enqueue`. */
	sink: EventSink;
	/** Whether this runtime runs in a CI job: its sessions are `ci` runs. */
	ci: boolean;
	/** Milliseconds, for a run's duration. */
	now: () => number;
	newRunId: () => string;
	/** An event the uplink could not queue; the run goes on without it. */
	onError?: (error: unknown) => void;
}>;

type PluginRuns = Readonly<{
	/** A hook event, as the runtime sees it before the gate. */
	observe: (event: GateEvent) => void;
	/** The gate's verdict on a tool event. */
	decided: (event: GateEvent, verdict: string) => void;
	/** The open run of `host`'s session `sessionId`. */
	current: (host: string, sessionId: string) => PluginRun | undefined;
}>;

/** Open runs kept; the oldest go first past this (their stop was lost). */
const MAX_OPEN_RUNS = 1024;

const isText = (value: unknown): value is string =>
	typeof value === "string" && value !== "";

/** The session an event belongs to: its host and session id, both usable. */
function sessionOf(
	event: GateEvent,
): Readonly<{ host: string; sessionId: string }> | null {
	const { host, sessionId } = event.input;
	if (!isLabel(host) || !isText(sessionId)) return null;
	return { host, sessionId };
}

const keyOf = (host: string, sessionId: string): string =>
	`${host}\n${sessionId}`;

/**
 * The runs of plugin sessions. A session start opens one; each gated tool
 * call is a step with the gate's verdict; the session's stop ends it
 * `succeeded`. Claude Code's Stop fires when a turn ends, so a session's
 * turns are runs of their own: a tool call with no open run opens one, and
 * a resumed start keeps the open run (and its id).
 */
export function createPluginRuns(ports: PluginRunsPorts): PluginRuns {
	const open = new Map<string, PluginRun>();
	const source: RunSource = ports.ci ? "ci" : "plugin";

	function send(fact: RunFact): void {
		try {
			const emitted = emitRun(ports.sink, fact);
			if (!emitted.ok) ports.onError?.(emitted.error);
		} catch (error) {
			// Evidence, not the gate: a lost event never reaches the hook.
			ports.onError?.(error);
		}
	}

	function start(host: string, sessionId: string): PluginRun {
		const key = keyOf(host, sessionId);
		const known = open.get(key);
		if (known !== undefined) return known;
		for (const oldest of open.keys()) {
			if (open.size < MAX_OPEN_RUNS) break;
			open.delete(oldest);
		}
		const run: PluginRun = {
			runId: ports.newRunId(),
			source,
			agent: host,
			startedAt: ports.now(),
			steps: 0,
		};
		open.set(key, run);
		send({ type: "run.started", runId: run.runId, source, agent: host, host });
		return run;
	}

	return {
		observe: (event) => {
			const session = sessionOf(event);
			if (session === null) return;
			if (event.kind === SESSION_START) {
				start(session.host, session.sessionId);
				return;
			}
			if (event.kind !== SESSION_STOP) return;
			const key = keyOf(session.host, session.sessionId);
			const run = open.get(key);
			if (run === undefined) return;
			open.delete(key);
			send({
				type: "run.finished",
				runId: run.runId,
				outcome: "succeeded",
				durationMs: ports.now() - run.startedAt,
				steps: run.steps,
			});
		},
		decided: (event, verdict) => {
			const session = sessionOf(event);
			if (
				session === null ||
				!isRunVerdict(verdict) ||
				event.kind === SESSION_START ||
				event.kind === SESSION_STOP
			) {
				return;
			}
			const run = start(session.host, session.sessionId);
			const next: PluginRun = { ...run, steps: run.steps + 1 };
			open.set(keyOf(session.host, session.sessionId), next);
			send({
				type: "run.step",
				runId: run.runId,
				step: next.steps,
				toolClass: event.kind,
				verdict,
			});
		},
		current: (host, sessionId) => open.get(keyOf(host, sessionId)),
	};
}

// ── The runtime's ports ────────────────────────────────────────────────────

type RunEventDeps = Readonly<{
	runs: PluginRuns;
	/** The uplink's `enqueue`, for `maina run` workers' events. */
	sink: EventSink;
}>;

type RunEventAnswer =
	| Readonly<{ queued: true }>
	| Readonly<{ queued: false; reason: string }>;

/** The `run.event` request: one run fact for the uplink. */
function runEventHandler(sink: EventSink) {
	return (params: unknown): RunEventAnswer => {
		const fact = parseRunFact(params);
		if (fact === null) return { queued: false, reason: "invalid" };
		const emitted = emitRun(sink, fact);
		if (!emitted.ok) return { queued: false, reason: emitted.error.kind };
		return emitted.value.queued
			? { queued: true }
			: { queued: false, reason: emitted.value.reason };
	};
}

/** `ports` with plugin sessions' runs observed and `run.event` served. */
export function withRunEvents(
	ports: RuntimePorts,
	deps: RunEventDeps,
): RuntimePorts {
	const { gate, observe } = ports;
	const later = (event: GateEvent, decision: GateDecision): void => {
		setImmediate(() => {
			try {
				// A gate that answered with the wrong shape records no step.
				deps.runs.decided(event, String(decision?.verdict));
			} catch {
				// A lost step never reaches the gate or the daemon.
			}
		});
	};
	return {
		...ports,
		gate: async (event) => {
			const decision = await gate(event);
			later(event, decision);
			return decision;
		},
		observe: (event) => {
			deps.runs.observe(event);
			return observe === undefined ? null : observe(event);
		},
		handlers: {
			...ports.handlers,
			"run.event": runEventHandler(deps.sink),
		},
	};
}

type RunEventClientConfig = Readonly<{
	endpoint: Endpoint;
	version: string;
	/** Starts a runtime when none answers (or one of another version). */
	spawn: SpawnRuntime;
	/** How long one event may take, runtime spawn included. */
	timeoutMs?: number;
}>;

/** One event's budget: long enough to start a runtime. */
const EVENT_TIMEOUT_MS = 3_000;

/**
 * Sends run facts to the resident runtime's `run.event`, one at a time in
 * the order given, starting a runtime when none answers. An event the
 * runtime cannot take is dropped: the run board misses it, the run goes
 * on. `flush` waits (at most `maxMs`) for what was sent so far.
 */
export function createRunEventClient(config: RunEventClientConfig): Readonly<{
	send: (fact: unknown) => void;
	flush: (maxMs: number) => Promise<void>;
}> {
	const { endpoint, version, spawn } = config;
	const timeoutMs = config.timeoutMs ?? EVENT_TIMEOUT_MS;
	let queue: Promise<void> = Promise.resolve();

	async function deliver(fact: unknown): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		// Only a runtime behind a private socket dir is trusted with them.
		if (!ensureEndpointDirs(endpoint, process.platform).ok) return;
		const request = createRequest("run.event", fact, version);
		for (let retried = false; ; retried = true) {
			const left = deadline - Date.now();
			if (left <= 0) return;
			const sent = await sendRequest(endpoint.address, request, left);
			const otherVersion =
				sent.ok &&
				(sent.value.runtimeVersion !== version ||
					(!sent.value.ok && sent.value.error.code === "version_mismatch"));
			const needsRuntime = sent.ok
				? otherVersion
				: sent.error.kind === "connect_failed";
			if (!needsRuntime || retried) return;
			const up = await ensureRuntime({ endpoint, version, spawn, deadline });
			if (!up.ok) return;
		}
	}

	return {
		send: (fact) => {
			queue = queue.then(
				() => deliver(fact).catch(() => undefined),
				() => undefined,
			);
		},
		flush: async (maxMs) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const late = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, Math.max(0, maxMs));
			});
			await Promise.race([queue, late]);
			clearTimeout(timer);
		},
	};
}
