/**
 * The Link uplink (#590, spec §6.3 Event uplink and Offline): the outbox is
 * sent in signed, size-capped batches; delivery backs off exponentially
 * while the cloud is unreachable, replays on reconnect and honours the
 * cloud's `nextExpectedSeq`. Nothing is queued or sent unless the device is
 * enrolled. The cloud here is the fake ingest: it verifies each envelope's
 * signature and schema and dedupes by `eventId`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import type { EventInput } from "../outbox";
import { fileLinkStore } from "../store";
import { createUplink, type UplinkOptions } from "../uplink";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-link-uplink-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-09-28T09:00:00.000Z");
const H = `sha256:${"b".repeat(64)}`;

const step = (n: number): EventInput => ({
	type: "run.step",
	runId: "run_1",
	data: { step: n, toolClass: "shell.exec", verdict: "allow" },
});

const decision = (): EventInput => ({
	type: "decision",
	runId: "run_1",
	data: {
		decisionType: "action.risk",
		inputHash: H,
		policyHash: H,
		modelHash: H,
		finalAction: "allow",
		confidenceBp: 9000,
		latencyMs: 4,
	},
});

function harness(cloud: FakeCloud, options: UplinkOptions = {}) {
	let now = T0;
	const ports = {
		http: cloud.http,
		store: fileLinkStore(join(dir, "link")),
		crypto: nodeLinkCrypto,
		clock: () => new Date(now),
		random: () => 1,
	};
	return {
		ports,
		/** A fresh uplink over the same files: a restarted runtime. */
		start: () => createUplink(ports, options),
		advance: (ms: number) => {
			now += ms;
		},
		set: (ms: number) => {
			now = ms;
		},
		enrol: async () => {
			const done = await enrolDevice(
				{ ...ports, sleep: async () => {} },
				{
					baseUrl: cloud.baseUrl,
					device: { os: "linux", arch: "x64", runtimeVersion: "1.8.1" },
				},
			);
			if (!done.ok) throw new Error(JSON.stringify(done.error));
		},
	};
}

/**
 * Ticks (at least once: a restarted uplink opens its outbox on the first)
 * until the outbox is empty or `limit` ticks, advancing the clock.
 */
async function drain(
	h: ReturnType<typeof harness>,
	uplink: ReturnType<ReturnType<typeof harness>["start"]>,
	limit = 100,
): Promise<number> {
	let ticks = 0;
	do {
		h.advance(await uplink.tick());
		ticks++;
	} while (ticks < limit && (uplink.status().outbox?.pending ?? 0) > 0);
	return ticks;
}

describe("enrolment gates everything", () => {
	test("nothing is queued or sent unless the device is enrolled", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		const uplink = h.start();
		const r = uplink.enqueue(decision());
		expect(r).toEqual({
			ok: true,
			value: { queued: false, reason: "not_enrolled" },
		});
		await uplink.tick();
		expect(cloud.requests).toEqual([]);
	});

	test("a revoked device queues nothing more and stops sending", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		const uplink = h.start();
		expect(uplink.enqueue(decision()).ok).toBe(true);
		cloud.state.revoked = true;
		await uplink.tick();
		const calls = cloud.requests.length;
		expect(uplink.enqueue(decision())).toEqual({
			ok: true,
			value: { queued: false, reason: "revoked" },
		});
		await uplink.tick();
		expect(cloud.requests.length).toBe(calls);
	});
});

describe("delivery", () => {
	test("sends signed, size-capped batches the cloud verifies", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud, { maxBatchEvents: 25 });
		await h.enrol();
		const uplink = h.start();
		for (let i = 0; i < 60; i++) expect(uplink.enqueue(step(i)).ok).toBe(true);
		await drain(h, uplink);
		expect(cloud.state.envelopes).toEqual([25, 25, 10]);
		expect(cloud.state.received.map((e) => e.seq)).toEqual(
			Array.from({ length: 60 }, (_, i) => i + 1),
		);
	});

	test("a batch is capped by bytes as well as by count", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud, { maxBatchBytes: 2048 });
		await h.enrol();
		const uplink = h.start();
		for (let i = 0; i < 40; i++) uplink.enqueue(decision());
		await drain(h, uplink);
		expect(cloud.state.envelopes.length).toBeGreaterThan(1);
		expect(cloud.state.received).toHaveLength(40);
	});

	test("a simulated day offline, then replay, delivers every event in order", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud, { backoff: { baseMs: 1_000, maxMs: 300_000 } });
		await h.enrol();
		const uplink = h.start();
		cloud.state.offline = true;

		// One event a minute for 24 hours, the uplink retrying as it goes.
		const delays: number[] = [];
		let nextTry = 0;
		for (let minute = 0; minute < 24 * 60; minute++) {
			expect(
				uplink.enqueue(minute % 7 === 0 ? decision() : step(minute)).ok,
			).toBe(true);
			h.advance(60_000);
			nextTry -= 60_000;
			if (nextTry <= 0) {
				const delay = await uplink.tick();
				delays.push(delay);
				nextTry = delay;
			}
		}
		// Exponential, then capped.
		expect(delays.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000]);
		expect(Math.max(...delays)).toBe(300_000);
		expect(cloud.state.received).toEqual([]);

		cloud.state.offline = false;
		await drain(h, uplink, 50);
		const seqs = cloud.state.received.map((e) => e.seq);
		expect(seqs).toEqual(Array.from({ length: 24 * 60 }, (_, i) => i + 1));
		expect(new Set(cloud.state.received.map((e) => e.eventId)).size).toBe(
			24 * 60,
		);
		expect(cloud.state.gaps).toEqual([]);
		expect(uplink.status().outbox?.pending).toBe(0);
		expect(uplink.status().failures).toBe(0);
	});

	test("a crash after send and before acknowledgement redelivers, and the cloud dedupes", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		const first = h.start();
		for (let i = 0; i < 10; i++) first.enqueue(decision());
		cloud.state.loseAcks = 1;
		await first.tick();
		expect(cloud.state.received).toHaveLength(10);
		expect(first.status().outbox?.pending).toBe(10);

		// The runtime dies here; the next one replays the same outbox.
		const second = h.start();
		await drain(h, second);
		expect(cloud.state.duplicates).toBe(10);
		expect(cloud.state.received).toHaveLength(10);
		expect(second.status().outbox?.pending).toBe(0);
	});

	test("clock skew doesn't break the sequence", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		const uplink = h.start();
		for (let i = 0; i < 5; i++) uplink.enqueue(step(i));
		h.set(T0 - 2 * 3600_000); // the clock jumps back two hours
		for (let i = 0; i < 5; i++) uplink.enqueue(decision());
		h.set(T0 + 3 * 3600_000); // and forward three
		for (let i = 0; i < 5; i++) uplink.enqueue(step(i));
		await drain(h, uplink);
		expect(cloud.state.received.map((e) => e.seq)).toEqual(
			Array.from({ length: 15 }, (_, i) => i + 1),
		);
		expect(cloud.state.gaps).toEqual([]);
		expect(uplink.status().outbox?.gaps).toEqual([]);
	});

	test("honours nextExpectedSeq: a cloud ahead lifts the local seq", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		cloud.state.seqFloor = 500;
		const uplink = h.start();
		uplink.enqueue(decision());
		await drain(h, uplink);
		const next = uplink.enqueue(decision());
		expect(next.ok && next.value.queued && next.value.seq).toBe(501);
	});

	test("a gap the cloud reports is filled from the outbox", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		const uplink = h.start();
		for (let i = 0; i < 6; i++) uplink.enqueue(decision());
		cloud.state.forget = new Set([3, 4]);
		await uplink.tick();
		expect(cloud.state.gaps).toEqual([{ from: 3, to: 4 }]);
		expect(uplink.status().outbox?.pending).toBe(2);
		await drain(h, uplink);
		expect(cloud.state.gaps).toEqual([]);
		expect(
			cloud.state.received.map((e) => e.seq).sort((a, b) => a - b),
		).toEqual([1, 2, 3, 4, 5, 6]);
	});

	test("events dropped at the bound show as the cloud's gaps, matching the local markers", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud, { bounds: { maxEvents: 10 } });
		await h.enrol();
		const uplink = h.start();
		for (let i = 0; i < 40; i++) {
			expect(uplink.enqueue(i % 4 === 0 ? decision() : step(i)).ok).toBe(true);
		}
		await drain(h, uplink);
		const markers = uplink.status().outbox?.gaps ?? [];
		expect(markers.length).toBeGreaterThan(0);
		const local = markers.flatMap((g) => g.ranges.map(([a, b]) => [a, b]));
		const seqs = new Set(cloud.state.received.map((e) => e.seq));
		for (const [a, b] of local) {
			for (let s = a ?? 0; s <= (b ?? 0); s++) expect(seqs.has(s)).toBe(false);
		}
		expect(cloud.state.gaps.length).toBeGreaterThan(0);
	});

	test("an ack that makes no progress backs off instead of spinning", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud, { backoff: { baseMs: 1_000, maxMs: 60_000 } });
		await h.enrol();
		const uplink = h.start();
		uplink.enqueue(decision());
		cloud.state.forget = new Set([1]);
		expect(await uplink.tick()).toBe(1_000);
		expect(uplink.status().failures).toBe(1);
	});

	test("an unreadable outbox is set aside and the uplink starts afresh, never crashes", async () => {
		const cloud = fakeCloud({ ingest: true });
		const h = harness(cloud);
		await h.enrol();
		const uplink = h.start();
		uplink.enqueue(decision());
		const { writeFileSync, existsSync } = await import("node:fs");
		const path = join(dir, "link", "outbox.log");
		writeFileSync(path, "not an outbox\n");
		const fresh = h.start();
		const r = fresh.enqueue(decision());
		expect(r.ok).toBe(true);
		expect(existsSync(`${path}.unreadable`)).toBe(true);
		await drain(h, fresh);
		expect(cloud.state.received).toHaveLength(1);
	});
});
