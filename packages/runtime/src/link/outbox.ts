/**
 * The Link outbox (#590, spec §6.3 Offline): the events an enrolled device
 * has queued for its cloud, kept until the cloud holds them.
 *
 * `enqueue` gives each event a random `eventId` (the cloud dedupes on it)
 * and the device's next `seq` (see `sequence.ts`), checks it against the
 * published event schema and the org's data class (metadata unless a policy
 * says more), and appends it before returning, so a queued event survives a
 * crash.
 *
 * On disk it is `outbox.log` in the Link directory (`store.ts`), an
 * append-only journal: a plaintext header naming the format and the device,
 * then one record per line, each sealed with AES-256-GCM under a key derived
 * (HKDF-SHA256) from the device's private key and bound to the header
 * (`seal.ts`). So
 * the file is unreadable without the device key, a logout (which deletes
 * the key) leaves nothing to read, and a line cannot be moved from another
 * device's outbox. Acknowledged events leave by a journal record; the
 * journal is rewritten once it is mostly such records.
 *
 * The outbox is bounded by count, bytes and age (`bound.ts`). Events older than the age
 * bound expire. Past the size bound the oldest `run.step` events (progress
 * ticks, the lowest priority) are coalesced away first, down to 90% of the
 * bound; only when none are left do the oldest other events go. Every drop
 * writes a gap marker naming its seqs, its reason and its event types, so
 * nothing audit-relevant disappears silently: the marker stays in the
 * outbox status and the cloud sees the same seqs as a gap.
 */

import { randomBytes } from "node:crypto";
import type { Result } from "@mainahq/core";
import {
	type Entry,
	type Eviction,
	type GapMarker,
	keepMarkers,
	marker,
	type OutboxBounds,
	planEviction,
	removeRanges,
} from "./bound";
import type { CryptoFailure } from "./keys";
import {
	type DataClass,
	type EnvelopeAck,
	type LinkEvent,
	type LinkEventType,
	parseWire,
	type WireRefusal,
} from "./protocol/wire";
import { cryptoFailure, outboxKey, seal, unseal } from "./seal";
import { reconcile, type SeqRange, toRanges } from "./sequence";
import type { LinkStore, StoreError } from "./store";

/** What a producer hands `enqueue`; the outbox adds `eventId` and `seq`. */
export type EventInput = Readonly<{
	type: LinkEventType;
	data: Readonly<Record<string, unknown>>;
	runId?: string;
	/** Defaults to `metadata`; never above the org's data class. */
	dataClass?: DataClass;
	/** Defaults to the clock; informational only (the order is `seq`). */
	ts?: string;
}>;

const DEFAULT_BOUNDS: OutboxBounds = {
	maxEvents: 10_000,
	maxBytes: 8 * 1024 * 1024,
	maxAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export type OutboxError =
	| StoreError
	| CryptoFailure
	| WireRefusal
	| Readonly<{
			kind: "outbox_unreadable";
			reason: "corrupt" | "other_device" | "wrong_key";
			message: string;
	  }>
	| Readonly<{
			kind: "data_class_violation";
			dataClass: DataClass;
			allowed: DataClass;
	  }>;

type OutboxFile = Pick<
	LinkStore,
	"readOutbox" | "writeOutbox" | "appendOutbox"
>;

export type OpenOutboxOptions = Readonly<{
	file: OutboxFile;
	deviceId: string;
	/** The org's data class: no event above it is queued. */
	dataClass: DataClass;
	/** The device's PKCS#8 PEM; the outbox key is derived from it. */
	privateKey: string;
	clock: () => Date;
	bounds?: Partial<OutboxBounds>;
}>;

type OutboxStatus = Readonly<{
	deviceId: string;
	lastSeq: number;
	pending: number;
	bytes: number;
	/** The gap markers kept, oldest first. */
	gaps: readonly GapMarker[];
}>;

type Settled = Readonly<{ delivered: number; rejected: number }>;

export type Outbox = Readonly<{
	enqueue: (
		input: EventInput,
	) => Result<Readonly<{ eventId: string; seq: number }>, OutboxError>;
	/** The queued events, oldest first. */
	pending: () => readonly LinkEvent[];
	/** Applies the cloud's answer to the batch of `sent` seqs (see `reconcile`). */
	settle: (
		ack: EnvelopeAck,
		sent: readonly number[],
	) => Result<Settled, OutboxError>;
	status: () => OutboxStatus;
}>;

// ── Journal records (the plaintext inside each sealed line) ────────────────

type JournalRecord =
	| Readonly<{ r: "event"; event: LinkEvent; queuedAt: number }>
	| Readonly<{ r: "delivered"; ranges: readonly SeqRange[] }>
	| Readonly<{ r: "gap"; gap: GapMarker }>
	| Readonly<{ r: "floor"; seq: number }>;

const FORMAT = "maina-link-outbox";
const CLASS_RANK: Readonly<Record<DataClass, number>> = {
	metadata: 0,
	names: 1,
	rich: 2,
};

function openRecord(key: Buffer, aad: Buffer, line: string): unknown {
	const text = unseal(key, aad, line);
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headerLine(deviceId: string): string {
	return JSON.stringify({
		format: FORMAT,
		v: 1,
		deviceId,
		kdf: "hkdf-sha256",
		aead: "aes-256-gcm",
	});
}

type Loaded = {
	entries: Entry[];
	lastSeq: number;
	gaps: GapMarker[];
	lines: number;
	/** A torn or unreadable line was skipped: rewrite before appending. */
	damaged: boolean;
};

function unreadable(
	reason: "corrupt" | "other_device" | "wrong_key",
	message: string,
): Result<never, OutboxError> {
	return { ok: false, error: { kind: "outbox_unreadable", reason, message } };
}

function load(
	text: string,
	header: string,
	deviceId: string,
	key: Buffer,
): Result<Loaded, OutboxError> {
	const lines = text.split("\n");
	const first = lines[0] ?? "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(first);
	} catch {
		return unreadable("corrupt", "the outbox has no header");
	}
	if (!isRecord(parsed) || parsed.format !== FORMAT || parsed.v !== 1) {
		return unreadable("corrupt", "the outbox header is not a v1 outbox");
	}
	if (parsed.deviceId !== deviceId) {
		return unreadable("other_device", "the outbox is another enrolment's");
	}
	if (first !== header) {
		return unreadable("corrupt", "the outbox header is not this format");
	}
	const aad = Buffer.from(header, "utf-8");
	const state: Loaded = {
		entries: [],
		lastSeq: 0,
		gaps: [],
		lines: 0,
		damaged: !text.endsWith("\n"),
	};
	let sealed = 0;
	let opened = 0;
	for (const line of lines.slice(1)) {
		if (line === "") continue;
		sealed++;
		const record = openRecord(key, aad, line) as JournalRecord | undefined;
		if (!isRecord(record)) {
			state.damaged = true;
			continue;
		}
		opened++;
		state.lines++;
		switch (record.r) {
			case "event":
				state.entries.push({
					event: record.event,
					queuedAt: record.queuedAt,
					bytes: line.length + 1,
				});
				state.lastSeq = Math.max(state.lastSeq, record.event.seq);
				break;
			case "delivered":
				state.entries = removeRanges(state.entries, record.ranges);
				break;
			case "gap":
				state.entries = removeRanges(state.entries, record.gap.ranges);
				state.gaps.push(record.gap);
				break;
			case "floor":
				state.lastSeq = Math.max(state.lastSeq, record.seq);
				break;
			default: {
				// A record kind this version does not know: rewritten away.
				const _exhaustive: never = record;
				state.damaged = true;
			}
		}
	}
	if (sealed > 0 && opened === 0) {
		return unreadable("wrong_key", "no record opens under this device key");
	}
	state.entries.sort((a, b) => a.event.seq - b.event.seq);
	state.gaps = keepMarkers(state.gaps);
	return { ok: true, value: state };
}

/** Opens (or starts) the device's outbox. Never throws. */
export function openOutbox(
	options: OpenOutboxOptions,
): Result<Outbox, OutboxError> {
	const bounds: OutboxBounds = { ...DEFAULT_BOUNDS, ...options.bounds };
	const { file, deviceId, clock } = options;
	const key = outboxKey(options.privateKey, deviceId);
	if (!key.ok) return key;
	const header = headerLine(deviceId);
	const aad = Buffer.from(header, "utf-8");
	const sealRecord = (record: JournalRecord): string =>
		seal(key.value, aad, JSON.stringify(record));

	const read = file.readOutbox();
	if (!read.ok) return read;
	let state: Loaded = {
		entries: [],
		lastSeq: 0,
		gaps: [],
		lines: 0,
		damaged: true,
	};
	if (read.value !== null) {
		const loaded = load(read.value, header, deviceId, key.value);
		if (!loaded.ok) return loaded;
		state = loaded.value;
	}

	/** Rewrites the journal as the records that rebuild `next`. */
	function rewrite(next: Loaded): Result<Loaded, OutboxError> {
		const lines = [header, sealRecord({ r: "floor", seq: next.lastSeq })];
		for (const gap of next.gaps) lines.push(sealRecord({ r: "gap", gap }));
		const entries = next.entries.map((e) => {
			const line = sealRecord({
				r: "event",
				event: e.event,
				queuedAt: e.queuedAt,
			});
			lines.push(line);
			return { ...e, bytes: line.length + 1 };
		});
		const written = file.writeOutbox(`${lines.join("\n")}\n`);
		if (!written.ok) return written;
		return {
			ok: true,
			value: {
				...next,
				entries,
				lines: lines.length - 1,
				damaged: false,
			},
		};
	}

	/** Appends `records`; rewrites instead when the journal is mostly spent. */
	function commit(
		next: Loaded,
		records: readonly string[],
	): Result<void, OutboxError> {
		const lines = next.lines + records.length;
		if (next.damaged || lines > next.entries.length * 2 + 64) {
			const rewritten = rewrite(next);
			if (!rewritten.ok) return rewritten;
			state = rewritten.value;
			return { ok: true, value: undefined };
		}
		if (records.length > 0) {
			const appended = file.appendOutbox(`${records.join("\n")}\n`);
			if (!appended.ok) return appended;
		}
		state = { ...next, lines };
		return { ok: true, value: undefined };
	}

	if (state.damaged) {
		const rewritten = rewrite(state);
		if (!rewritten.ok) return rewritten;
		state = rewritten.value;
	}

	function evictionRecords(
		plan: readonly Eviction[],
		now: Date,
	): { records: string[]; markers: GapMarker[]; gone: Set<Entry> } {
		const records: string[] = [];
		const markers: GapMarker[] = [];
		const gone = new Set<Entry>();
		for (const step of plan) {
			const gap = marker(step.reason, step.entries, now);
			markers.push(gap);
			records.push(sealRecord({ r: "gap", gap }));
			for (const e of step.entries) gone.add(e);
		}
		return { records, markers, gone };
	}

	const outbox: Outbox = {
		enqueue: (input) => {
			const dataClass = input.dataClass ?? "metadata";
			if (CLASS_RANK[dataClass] > CLASS_RANK[options.dataClass]) {
				return {
					ok: false,
					error: {
						kind: "data_class_violation",
						dataClass,
						allowed: options.dataClass,
					},
				};
			}
			const now = clock();
			const candidate = {
				eventId: `evt_${randomBytes(16).toString("base64url")}`,
				seq: state.lastSeq + 1,
				ts: input.ts ?? now.toISOString(),
				type: input.type,
				dataClass,
				...(input.runId === undefined ? {} : { runId: input.runId }),
				data: input.data,
			};
			const event = parseWire("event", candidate);
			if (!event.ok) return event;
			let line: string;
			try {
				line = sealRecord({
					r: "event",
					event: event.value,
					queuedAt: now.getTime(),
				});
			} catch (e) {
				return { ok: false, error: cryptoFailure(e) };
			}
			const entry: Entry = {
				event: event.value,
				queuedAt: now.getTime(),
				bytes: line.length + 1,
			};
			const plan = planEviction(
				state.entries,
				entry.bytes,
				bounds,
				now.getTime(),
			);
			const { records, markers, gone } = evictionRecords(plan, now);
			const next: Loaded = {
				...state,
				entries: [...state.entries.filter((e) => !gone.has(e)), entry],
				lastSeq: entry.event.seq,
				gaps: keepMarkers([...state.gaps, ...markers]),
			};
			const committed = commit(next, [...records, line]);
			if (!committed.ok) return committed;
			return {
				ok: true,
				value: { eventId: entry.event.eventId, seq: entry.event.seq },
			};
		},

		pending: () => state.entries.map((e) => e.event),

		settle: (ack, sent) => {
			const r = reconcile(
				state.entries.map((e) => e.event.seq),
				sent,
				ack,
			);
			const records: string[] = [];
			const delivered = toRanges(r.delivered);
			if (delivered.length > 0) {
				records.push(sealRecord({ r: "delivered", ranges: delivered }));
			}
			const refused = new Set(r.rejected);
			const rejectedEntries = state.entries.filter((e) =>
				refused.has(e.event.seq),
			);
			const markers: GapMarker[] = [];
			if (rejectedEntries.length > 0) {
				const gap = marker("rejected", rejectedEntries, clock());
				markers.push(gap);
				records.push(sealRecord({ r: "gap", gap }));
			}
			const lastSeq = Math.max(state.lastSeq, r.floor);
			if (lastSeq > state.lastSeq) {
				records.push(sealRecord({ r: "floor", seq: lastSeq }));
			}
			const leaving = new Set([...r.delivered, ...r.rejected]);
			const next: Loaded = {
				...state,
				entries: state.entries.filter((e) => !leaving.has(e.event.seq)),
				lastSeq,
				gaps: keepMarkers([...state.gaps, ...markers]),
			};
			const committed = commit(next, records);
			if (!committed.ok) return committed;
			return {
				ok: true,
				value: { delivered: r.delivered.length, rejected: r.rejected.length },
			};
		},

		status: () => ({
			deviceId,
			lastSeq: state.lastSeq,
			pending: state.entries.length,
			bytes: state.entries.reduce((n, e) => n + e.bytes, 0),
			gaps: state.gaps,
		}),
	};
	return { ok: true, value: outbox };
}
