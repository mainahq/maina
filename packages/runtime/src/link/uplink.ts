/**
 * The Link uplink (#590, spec §6.3 Event uplink and Offline): delivers the
 * outbox to the enrolled device's cloud.
 *
 * - Nothing is queued or sent unless the device is enrolled and not
 *   revoked; the device state is read on every call, so an enrolment, a
 *   logout or a revocation takes effect without a restart.
 * - Each `tick` sends at most one batch: the oldest queued events, capped by
 *   count and bytes, in a `LinkEnvelope` signed by the device key and
 *   checked against the published schema before it leaves.
 * - The cloud's `EnvelopeAck` settles that batch (`sequence.ts`): what it
 *   holds leaves, its gaps are resent, rejected events leave with a gap
 *   marker and `nextExpectedSeq` lifts the device's seq. Events outside the
 *   batch (queued meanwhile, or past the cap) wait for their own.
 * - A failure, or an ack that settles nothing, backs off exponentially
 *   (with jitter, capped); the next success resets it. A backlog is sent
 *   batch after batch, so reconnecting replays everything in `seq` order.
 *
 * `tick` resolves to the milliseconds until the next one; the resident
 * runtime runs it on a background loop (`lifecycle.ts` `startLoop`), off
 * the gate path. An outbox that cannot be read (a torn header, another
 * enrolment's file) is set aside as `outbox.log.unreadable` and a fresh one
 * started; the cloud sees whatever it held as a gap.
 */

import type { Result } from "@mainahq/core";
import type { OutboxBounds } from "./bound";
import { createLinkClient } from "./client";
import type { LinkFailure } from "./http";
import { deviceSigningInput } from "./keys";
import {
	type EventInput,
	type Outbox,
	type OutboxError,
	openOutbox,
} from "./outbox";
import { type LinkEvent, parseWire } from "./protocol/wire";
import { backoffDelay } from "./sequence";
import type { DeviceState } from "./store";
import type { LinkPorts } from "./token";

type UplinkPorts = LinkPorts &
	Readonly<{
		/** In [0, 1): the backoff jitter. Defaults to `Math.random`. */
		random?: () => number;
	}>;

export type UplinkOptions = Readonly<{
	/** Events per envelope; the schema allows up to 1000. */
	maxBatchEvents?: number;
	/** Serialised event bytes per envelope. */
	maxBatchBytes?: number;
	backoff?: Readonly<{ baseMs: number; maxMs: number }>;
	/** The wait when there is nothing to send. */
	idleMs?: number;
	bounds?: Partial<OutboxBounds>;
}>;

type UplinkError =
	| OutboxError
	| LinkFailure
	| Readonly<{ kind: "no_progress"; nextExpectedSeq: number }>;

type EnqueueResult =
	| Readonly<{ queued: false; reason: "not_enrolled" | "revoked" }>
	| Readonly<{ queued: true; eventId: string; seq: number }>;

type UplinkStatus = Readonly<{
	/** Consecutive failed deliveries (0 after a success). */
	failures: number;
	lastError: UplinkError | null;
	/** The open outbox's status; null until the device is enrolled. */
	outbox: ReturnType<Outbox["status"]> | null;
}>;

type Uplink = Readonly<{
	enqueue: (input: EventInput) => Result<EnqueueResult, UplinkError>;
	tick: () => Promise<number>;
	status: () => UplinkStatus;
}>;

const DEFAULTS = {
	maxBatchEvents: 200,
	maxBatchBytes: 256 * 1024,
	backoff: { baseMs: 1_000, maxMs: 5 * 60_000 },
	idleMs: 5_000,
} as const;

type Current =
	| Readonly<{ kind: "skip"; reason: "not_enrolled" | "revoked" }>
	| Readonly<{ kind: "ready"; state: DeviceState; outbox: Outbox }>;

/** The oldest events that fit one envelope; always at least one. */
function takeBatch(
	events: readonly LinkEvent[],
	maxEvents: number,
	maxBytes: number,
): readonly LinkEvent[] {
	const batch: LinkEvent[] = [];
	let bytes = 0;
	for (const event of events) {
		if (batch.length >= maxEvents) break;
		const size = Buffer.byteLength(JSON.stringify(event), "utf-8");
		if (batch.length > 0 && bytes + size > maxBytes) break;
		batch.push(event);
		bytes += size;
	}
	return batch;
}

export function createUplink(
	ports: UplinkPorts,
	options: UplinkOptions = {},
): Uplink {
	const maxBatchEvents = Math.min(
		1000,
		options.maxBatchEvents ?? DEFAULTS.maxBatchEvents,
	);
	const maxBatchBytes = options.maxBatchBytes ?? DEFAULTS.maxBatchBytes;
	const backoff = options.backoff ?? DEFAULTS.backoff;
	const idleMs = options.idleMs ?? DEFAULTS.idleMs;
	const random = ports.random ?? Math.random;
	const client = createLinkClient(ports);

	/** The outbox of the current enrolment (its key changes with a re-enrol). */
	let open: Readonly<{
		deviceId: string;
		publicKey: string;
		dataClass: string;
		outbox: Outbox;
	}> | null = null;
	let failures = 0;
	let lastError: UplinkError | null = null;

	function privateKey(): Result<string, UplinkError> {
		const key = ports.store.readPrivateKey();
		if (!key.ok) return key;
		if (key.value === null) {
			return {
				ok: false,
				error: {
					kind: "store",
					op: "read",
					message:
						"the device key is missing; run `maina cloud logout` and enrol again",
				},
			};
		}
		return { ok: true, value: key.value };
	}

	function openFor(state: DeviceState): Result<Outbox, UplinkError> {
		const deviceId = state.enrolment.deviceId;
		if (
			open !== null &&
			open.deviceId === deviceId &&
			open.publicKey === state.publicKey &&
			open.dataClass === state.dataClass
		) {
			return { ok: true, value: open.outbox };
		}
		const key = privateKey();
		if (!key.ok) return key;
		const request = {
			file: ports.store,
			deviceId,
			dataClass: state.dataClass,
			privateKey: key.value,
			clock: ports.clock,
			...(options.bounds === undefined ? {} : { bounds: options.bounds }),
		};
		let opened = openOutbox(request);
		if (!opened.ok && opened.error.kind === "outbox_unreadable") {
			const aside = ports.store.setAsideOutbox("unreadable");
			if (!aside.ok) return aside;
			opened = openOutbox(request);
		}
		if (!opened.ok) return opened;
		open = {
			deviceId,
			publicKey: state.publicKey,
			dataClass: state.dataClass,
			outbox: opened.value,
		};
		return opened;
	}

	function current(): Result<Current, UplinkError> {
		const read = ports.store.readState();
		if (!read.ok) return read;
		const state = read.value;
		if (state === null || state.revokedAt !== null) {
			open = null;
			return {
				ok: true,
				value: {
					kind: "skip",
					reason: state === null ? "not_enrolled" : "revoked",
				},
			};
		}
		const outbox = openFor(state);
		if (!outbox.ok) return outbox;
		return { ok: true, value: { kind: "ready", state, outbox: outbox.value } };
	}

	function fail(error: UplinkError): number {
		failures++;
		lastError = error;
		return backoffDelay(failures, backoff, random);
	}

	async function deliver(
		ready: Extract<Current, { kind: "ready" }>,
	): Promise<number> {
		const { state, outbox } = ready;
		const batch = takeBatch(outbox.pending(), maxBatchEvents, maxBatchBytes);
		const first = batch[0];
		const last = batch.at(-1);
		if (first === undefined || last === undefined) {
			failures = 0;
			lastError = null;
			return idleMs;
		}
		const unsigned = {
			v: 1,
			deviceId: state.enrolment.deviceId,
			seqFrom: first.seq,
			seqTo: last.seq,
			sentAt: ports.clock().toISOString(),
			events: batch,
		} as const;
		const key = privateKey();
		if (!key.ok) return fail(key.error);
		const input = deviceSigningInput("envelope", unsigned, "sig");
		if (!input.ok) return fail(input.error);
		const sig = ports.crypto.sign(key.value, input.value);
		if (!sig.ok) return fail(sig.error);
		const envelope = parseWire("envelope", { ...unsigned, sig: sig.value });
		if (!envelope.ok) return fail(envelope.error);

		const sent = await client.send({
			method: "POST",
			path: state.enrolment.endpoints.events,
			body: envelope.value,
		});
		if (!sent.ok) {
			if (sent.error.kind === "revoked") open = null;
			return fail(sent.error);
		}
		const ack = parseWire("envelope-ack", sent.value.data);
		if (!ack.ok) return fail(ack.error);
		const settled = outbox.settle(
			ack.value,
			batch.map((e) => e.seq),
		);
		if (!settled.ok) return fail(settled.error);
		if (settled.value.delivered + settled.value.rejected === 0) {
			return fail({
				kind: "no_progress",
				nextExpectedSeq: ack.value.nextExpectedSeq,
			});
		}
		failures = 0;
		lastError = null;
		return outbox.pending().length > 0 ? 0 : idleMs;
	}

	return {
		enqueue: (input) => {
			const cur = current();
			if (!cur.ok) return cur;
			if (cur.value.kind === "skip") {
				return { ok: true, value: { queued: false, reason: cur.value.reason } };
			}
			const queued = cur.value.outbox.enqueue(input);
			if (!queued.ok) return queued;
			return { ok: true, value: { queued: true, ...queued.value } };
		},
		tick: async () => {
			const cur = current();
			if (!cur.ok) return fail(cur.error);
			if (cur.value.kind === "skip") {
				failures = 0;
				return idleMs;
			}
			return deliver(cur.value);
		},
		status: () => ({
			failures,
			lastError,
			outbox: open === null ? null : open.outbox.status(),
		}),
	};
}
