/**
 * Remote control over Link (#594, cloud plan Task 8.4, FR-RUN-3, spec §6.3):
 * the run board's `stop` and `revision_grant` control messages, delivered to
 * the run they name and applied by the harness.
 *
 * The cloud keeps each device's messages and serves them on `GET
 * /link/v1/control/wait` (a long poll resumed after a cursor). A process that
 * holds a run registers it here, and `poll` fetches the device's messages
 * while it holds any. Each message then goes through `receive`:
 *
 * - **Routing.** A `stop` or `revision_grant` for a run this process does
 *   not hold is left alone (`not_ours`): nothing is recorded, so the
 *   process that holds the run still accepts it. The run id is read before
 *   the message is verified, but only to pick who verifies it.
 * - **Signed or ignored.** A message acts only when it verifies under a
 *   link-control key pinned at enrolment and passes every other check of
 *   `acceptControlMessage` (this device, its org, unexpired, not applied
 *   before). While the cloud's signer is dark it marks messages unsigned
 *   (`keyId: "unsigned"`, an all-zero `sig`). No pinned key verifies them,
 *   so they are ignored, like a policy bundle or an approval that is not
 *   signed: a remote instruction the org's key did not sign changes
 *   nothing, not even a stop.
 * - **Once.** A message id is applied once (`acceptControlMessage` keeps
 *   applied ids until they expire), and a revision grant id once per run,
 *   even when the cloud sends it again under a new message id. The run
 *   itself takes one revision at most (`grantRevision` answers false after
 *   the first).
 * - **Audited.** Every message this process acts on or ignores is handed
 *   to the `audit` port with what happened to it (the system port appends
 *   it to `control.jsonl` in the Link directory): ids, labels and the
 *   refusal code only.
 *
 * A `key_rotation` is applied by `acceptControlMessage` whichever process
 * reads it first; the others then see it as a replay.
 */

import { createLinkClient } from "./client";
import { backoffDelay } from "./sequence";
import type { LinkPorts } from "./token";
import { acceptControlMessage } from "./trust";

/** What the harness does with a run's control messages. */
export type RunControlHandle = Readonly<{
	/** Halts the run's worker and ends the run stopped (with a report). */
	stop: (reason: string | undefined) => void;
	/** Enters the one bounded revision; false when the run already had it. */
	grantRevision: (grantId: string) => boolean;
}>;

export type ControlOutcome =
	| "applied"
	| "duplicate"
	| "ignored_unsigned"
	| "refused"
	| "failed"
	| "not_ours";

/** One audit record: what one control message did on this device. */
export type ControlAuditEntry = Readonly<{
	/** When it was handled (ISO 8601, the Link clock). */
	at: string;
	outcome: Exclude<ControlOutcome, "not_ours">;
	kind?: string;
	messageId?: string;
	runId?: string;
	grantId?: string;
	/** The stop's reason, a label. */
	reason?: string;
	/** Why it was refused: the refusal's kind. */
	code?: string;
}>;

type ControlPorts = LinkPorts &
	Readonly<{
		audit: (entry: ControlAuditEntry) => void;
		/** In [0, 1): the backoff jitter. Defaults to `Math.random`. */
		random?: () => number;
	}>;

type ControlOptions = Readonly<{
	/** How long the cloud may hold one poll, in seconds (at most 25). */
	waitSeconds?: number;
	/** The wait while there is nothing to poll for. */
	idleMs?: number;
	backoff?: Readonly<{ baseMs: number; maxMs: number }>;
}>;

type RemoteControl = Readonly<{
	/** Delivers `runId`'s messages to `handle` until the returned function runs. */
	register: (runId: string, handle: RunControlHandle) => () => void;
	/** Verifies and applies one message; never throws. */
	receive: (raw: unknown) => ControlOutcome;
	/** One long poll; resolves to the milliseconds until the next. */
	poll: () => Promise<number>;
}>;

/** The cloud's control long poll (cloud Task 8.3); v1 enrolments name no endpoint for it. */
const CONTROL_WAIT_PATH = "/link/v1/control/wait";

const DEFAULTS = {
	waitSeconds: 20,
	idleMs: 5_000,
	backoff: { baseMs: 1_000, maxMs: 60_000 },
} as const;

/** The pause between polls the cloud answered. */
const POLL_GAP_MS = 250;
/** Revision grant ids remembered for the dedupe; the oldest go first. */
const MAX_GRANTS = 1024;

/** How the dark signer marks a message (cloud adr/0014 §6). */
const DARK_KEY_ID = "unsigned";
const DARK_SIG = "A".repeat(86);

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const LABEL = /^[a-z][a-z0-9_.-]{0,63}$/;
const KINDS = ["stop", "revision_grant", "key_rotation"];
/** The cloud's cursor: a positive integer. */
const CURSOR = /^[1-9][0-9]{0,15}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const matching = (value: unknown, pattern: RegExp): value is string =>
	typeof value === "string" && pattern.test(value);

type Seen = Readonly<{
	kind?: string;
	messageId?: string;
	runId?: string;
	grantId?: string;
	reason?: string;
}>;

/** What a message says it is, each field only when it has a safe shape. */
function peek(raw: unknown): Seen {
	if (!isRecord(raw)) return {};
	const body = isRecord(raw.body) ? raw.body : {};
	const pick = (key: string, value: unknown, pattern: RegExp) =>
		matching(value, pattern) ? { [key]: value } : {};
	return {
		...(typeof raw.kind === "string" && KINDS.includes(raw.kind)
			? { kind: raw.kind }
			: {}),
		...pick("messageId", raw.messageId, ID),
		...pick("runId", body.runId, ID),
		...pick("grantId", body.grantId, ID),
		...pick("reason", body.reason, LABEL),
	};
}

const isDark = (raw: unknown): boolean =>
	isRecord(raw) && raw.keyId === DARK_KEY_ID && raw.sig === DARK_SIG;

export function createRemoteControl(
	ports: ControlPorts,
	options: ControlOptions = {},
): RemoteControl {
	const waitSeconds = Math.min(
		25,
		Math.max(0, options.waitSeconds ?? DEFAULTS.waitSeconds),
	);
	const idleMs = options.idleMs ?? DEFAULTS.idleMs;
	const backoff = options.backoff ?? DEFAULTS.backoff;
	const random = ports.random ?? Math.random;
	const client = createLinkClient(ports);
	const runs = new Map<string, RunControlHandle>();
	const grants = new Set<string>();
	let cursor: string | null = null;
	let failures = 0;

	function record(
		outcome: ControlAuditEntry["outcome"],
		seen: Seen,
		code?: string,
	): ControlOutcome {
		try {
			ports.audit({
				at: ports.clock().toISOString(),
				outcome,
				...seen,
				...(code === undefined ? {} : { code }),
			});
		} catch {
			// The audit is a local record: a failed write never changes the outcome.
		}
		return outcome;
	}

	/** Remembers `key`; false when it was already there. */
	function firstGrant(key: string): boolean {
		if (grants.has(key)) return false;
		for (const oldest of grants) {
			if (grants.size < MAX_GRANTS) break;
			grants.delete(oldest);
		}
		grants.add(key);
		return true;
	}

	function receive(raw: unknown): ControlOutcome {
		try {
			const seen = peek(raw);
			const forRun = seen.kind === "stop" || seen.kind === "revision_grant";
			if (forRun && seen.runId !== undefined && !runs.has(seen.runId)) {
				return "not_ours";
			}
			if (isDark(raw)) return record("ignored_unsigned", seen);
			const accepted = acceptControlMessage(ports, raw);
			if (!accepted.ok) {
				const { kind } = accepted.error;
				return record(
					kind === "replayed" ? "duplicate" : "refused",
					seen,
					kind,
				);
			}
			const message = accepted.value;
			switch (message.kind) {
				case "key_rotation":
					return record("applied", seen);
				case "stop": {
					const handle = runs.get(message.body.runId);
					if (handle === undefined) return record("failed", seen, "no_run");
					handle.stop(message.body.reason);
					return record("applied", seen);
				}
				case "revision_grant": {
					const { runId, grantId } = message.body;
					const handle = runs.get(runId);
					if (handle === undefined) return record("failed", seen, "no_run");
					if (!firstGrant(`${runId}\n${grantId}`)) {
						return record("duplicate", seen);
					}
					return record(
						handle.grantRevision(grantId) ? "applied" : "duplicate",
						seen,
					);
				}
				default: {
					const unknown: never = message;
					return unknown;
				}
			}
		} catch {
			return record("failed", peek(raw));
		}
	}

	function failed(): number {
		failures++;
		return backoffDelay(failures, backoff, random);
	}

	return {
		register: (runId, handle) => {
			runs.set(runId, handle);
			return () => {
				if (runs.get(runId) === handle) runs.delete(runId);
			};
		},
		receive,
		poll: async () => {
			if (runs.size === 0) return idleMs;
			const read = ports.store.readState();
			if (!read.ok || read.value === null || read.value.revokedAt !== null) {
				return idleMs;
			}
			const sent = await client.send({
				method: "GET",
				path: CONTROL_WAIT_PATH,
				query: {
					timeout: String(waitSeconds),
					...(cursor === null ? {} : { after: cursor }),
				},
				timeoutMs: (waitSeconds + 5) * 1000,
			});
			if (!sent.ok) return failed();
			const data = sent.value.data;
			if (!isRecord(data) || !Array.isArray(data.messages)) return failed();
			failures = 0;
			for (const raw of data.messages) receive(raw);
			if (matching(data.cursor, CURSOR)) cursor = data.cursor;
			return POLL_GAP_MS;
		},
	};
}
