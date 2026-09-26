/**
 * Agent status line state (FR-RET-1, #347): what `render.ts` shows.
 *
 * Read from two places, both behind ports:
 *
 * - the resident runtime's `status` answer. No answer at all is the "off"
 *   state; an answer the client cannot use (another version, an error, a
 *   hang) is a degraded runtime; a healthy answer carries the wire
 *   `degraded` flag of the session's last gate decision (#456).
 * - the session's summary from the decision log (`summarise`, FR-RET-2).
 *
 * `readStatuslineState` never rejects: a port that fails leaves its part
 * out, and a failed probe reads as "off". The status line never spawns a
 * runtime; only a hook does.
 */

import type { SessionSummary } from "@mainahq/core";
import { createRequest, sendRequest } from "../ipc";

/** A part of Maina that is up but not running in full. */
export type DegradedPart =
	/** The runtime answered, but not in a way this client can use. */
	| "runtime"
	/** The session's last gate decision was degraded on the wire (#456). */
	| "gate";

export type StatuslineState =
	| Readonly<{ runtime: "off" }>
	| Readonly<{
			runtime: "on";
			degraded: readonly DegradedPart[];
			/** This session's decisions; null when none, or unreadable. */
			summary: SessionSummary | null;
	  }>;

/** What the host told the status line about its session. */
export type HostSession = Readonly<{ sessionId?: string; cwd?: string }>;

export type RuntimeProbe =
	| Readonly<{ kind: "down" }>
	| Readonly<{ kind: "unusable" }>
	| Readonly<{ kind: "up"; gateDegraded: boolean }>;

export type StatuslineStatePorts = Readonly<{
	probe: (sessionId?: string) => Promise<RuntimeProbe>;
	summary: (session: HostSession) => Promise<SessionSummary | null>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/**
 * The session in the JSON Claude Code pipes to a status line command
 * (`session_id`, `cwd`, `workspace.current_dir`). Anything else is an empty
 * session.
 */
export function parseHostInput(text: string): HostSession {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return {};
	}
	if (!isRecord(value)) return {};
	const sessionId = nonEmpty(value.session_id);
	const workspace = isRecord(value.workspace) ? value.workspace : {};
	const cwd = nonEmpty(value.cwd) ?? nonEmpty(workspace.current_dir);
	return {
		...(sessionId === undefined ? {} : { sessionId }),
		...(cwd === undefined ? {} : { cwd }),
	};
}

/**
 * The parts of a runtime `status` answer the status line reads, or null
 * when it has the wrong shape. No gate decision yet is not degraded.
 */
export function parseRuntimeStatus(
	value: unknown,
): Readonly<{ gateDegraded: boolean }> | null {
	if (!isRecord(value)) return null;
	const { version, protocol, lastGateDegraded } = value;
	if (typeof version !== "string" || typeof protocol !== "number") return null;
	if (lastGateDegraded !== null && typeof lastGateDegraded !== "boolean") {
		return null;
	}
	return { gateDegraded: lastGateDegraded === true };
}

type ProbeOptions = Readonly<{
	/** The runtime's socket (or pipe) address. */
	address: string;
	/** This client's version; the runtime must match it. */
	version: string;
	sessionId?: string;
	timeoutMs: number;
}>;

/** Asks the runtime at `address` for its status, once. Never rejects. */
export async function probeRuntime(
	options: ProbeOptions,
): Promise<RuntimeProbe> {
	const { address, version, sessionId, timeoutMs } = options;
	const params = sessionId === undefined ? undefined : { sessionId };
	const sent = await sendRequest(
		address,
		createRequest("status", params, version),
		timeoutMs,
	);
	if (!sent.ok) {
		return sent.error.kind === "connect_failed"
			? { kind: "down" }
			: { kind: "unusable" };
	}
	const response = sent.value;
	if (response.runtimeVersion !== version || !response.ok) {
		return { kind: "unusable" };
	}
	const status = parseRuntimeStatus(response.result);
	return status === null
		? { kind: "unusable" }
		: { kind: "up", gateDegraded: status.gateDegraded };
}

async function settle<T>(run: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await run();
	} catch {
		return fallback;
	}
}

/** The status line's state for `session`. Never rejects. */
export async function readStatuslineState(
	session: HostSession,
	ports: StatuslineStatePorts,
): Promise<StatuslineState> {
	const probe = await settle<RuntimeProbe>(
		() => ports.probe(session.sessionId),
		{ kind: "down" },
	);
	if (probe.kind === "down") return { runtime: "off" };
	const summary = await settle(() => ports.summary(session), null);
	const degraded: readonly DegradedPart[] =
		probe.kind === "unusable"
			? ["runtime"]
			: probe.gateDegraded
				? ["gate"]
				: [];
	return { runtime: "on", degraded, summary };
}
