/**
 * The Link outbox (#590, spec §6.3 Offline): events wait here, encrypted
 * under a key derived from the device key, each with its `eventId` and the
 * device's next `seq`. It is bounded by size and age: at the bound the
 * low-priority `run.step` events go first and every drop leaves a gap
 * marker, so nothing audit-relevant disappears silently.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeLinkCrypto } from "../keys";
import {
	type EventInput,
	type OpenOutboxOptions,
	type Outbox,
	openOutbox,
} from "../outbox";
import { linkHash } from "../privacy";
import { reconcile, toRanges } from "../sequence";
import { fileLinkStore } from "../store";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-link-outbox-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const H = `sha256:${"a".repeat(64)}`;
const T0 = Date.parse("2026-09-28T09:00:00.000Z");

function keyPair() {
	const pair = nodeLinkCrypto.generateKeyPair();
	if (!pair.ok) throw new Error(pair.error.message);
	return pair.value;
}

const step = (n: number, runId = "run_1"): EventInput => ({
	type: "run.step",
	runId,
	data: { step: n, toolClass: "shell.exec", verdict: "allow" },
});

const decision = (latencyMs = 3): EventInput => ({
	type: "decision",
	runId: "run_1",
	data: {
		decisionType: "action.risk",
		inputHash: H,
		policyHash: H,
		modelHash: H,
		finalAction: "allow",
		confidenceBp: 9000,
		latencyMs,
	},
});

function setup(overrides: Partial<OpenOutboxOptions> = {}) {
	const privateKey = overrides.privateKey ?? keyPair().privateKey;
	let now = T0;
	const options: OpenOutboxOptions = {
		file: fileLinkStore(join(dir, "link")),
		deviceId: "dev_1",
		dataClass: "metadata",
		privateKey,
		clock: () => new Date(now),
		...overrides,
	};
	const open = (): Outbox => {
		const outbox = openOutbox(options);
		if (!outbox.ok) throw new Error(JSON.stringify(outbox.error));
		return outbox.value;
	};
	return {
		options,
		privateKey,
		open,
		advance: (ms: number) => {
			now += ms;
		},
		path: join(dir, "link", "outbox.log"),
	};
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!r.ok) throw new Error(JSON.stringify(r.error));
	return r.value;
}

describe("enqueue", () => {
	test("assigns an eventId and the next seq, and keeps both across a restart", () => {
		const box = setup();
		const outbox = box.open();
		const a = must(outbox.enqueue(decision()));
		const b = must(outbox.enqueue(step(1)));
		expect(a.seq).toBe(1);
		expect(b.seq).toBe(2);
		expect(a.eventId).toMatch(/^evt_[A-Za-z0-9_-]{22,}$/);
		expect(a.eventId).not.toBe(b.eventId);

		const again = box.open();
		expect(again.pending().map((e) => [e.seq, e.eventId])).toEqual([
			[1, a.eventId],
			[2, b.eventId],
		]);
		expect(must(again.enqueue(step(2))).seq).toBe(3);
	});

	test("stamps ts from the clock and the data class metadata by default", () => {
		const box = setup();
		const outbox = box.open();
		must(outbox.enqueue(step(1)));
		const [event] = outbox.pending();
		expect(event?.ts).toBe("2026-09-28T09:00:00.000Z");
		expect(event?.dataClass).toBe("metadata");
	});

	test("refuses an event its schema rejects, and writes nothing for it", () => {
		const box = setup();
		const outbox = box.open();
		const bad = outbox.enqueue({
			type: "run.step",
			data: { step: 1, toolClass: "shell.exec", verdict: "allow", cmd: "ls" },
		});
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error.kind).toBe("invalid_message");
		expect(outbox.status().lastSeq).toBe(0);
		expect(box.open().pending()).toEqual([]);
	});

	test("refuses an event above the org's data class (metadata-only by default)", () => {
		const box = setup();
		const outbox = box.open();
		const names = outbox.enqueue({
			type: "run.started",
			dataClass: "names",
			data: { agent: "claude-code" },
		});
		expect(names.ok).toBe(false);
		if (!names.ok) expect(names.error.kind).toBe("data_class_violation");
		expect(outbox.pending()).toEqual([]);
	});
});

describe("encryption at rest", () => {
	test("the outbox file is unreadable without the device key", () => {
		const box = setup();
		const outbox = box.open();
		const queued = must(outbox.enqueue(decision()));
		must(outbox.enqueue(step(1)));

		const raw = readFileSync(box.path, "utf-8");
		for (const plain of [queued.eventId, "run.step", "decision", H, "run_1"]) {
			expect(raw).not.toContain(plain);
		}

		const stranger = openOutbox({
			...box.options,
			privateKey: keyPair().privateKey,
		});
		expect(stranger.ok).toBe(false);
		if (!stranger.ok) {
			expect(stranger.error.kind).toBe("outbox_unreadable");
			expect(JSON.stringify(stranger.error)).not.toContain(queued.eventId);
		}
		expect(box.open().pending()).toHaveLength(2);
	});

	test("an outbox from another enrolment is not read", () => {
		const box = setup();
		must(box.open().enqueue(decision()));
		const other = openOutbox({ ...box.options, deviceId: "dev_2" });
		expect(other.ok).toBe(false);
		if (!other.ok) expect(other.error.kind).toBe("outbox_unreadable");
	});

	test("the file is owner-only", () => {
		if (process.platform === "win32") return;
		const box = setup();
		must(box.open().enqueue(decision()));
		expect(statSync(box.path).mode & 0o777).toBe(0o600);
	});

	test("a line torn by a crash mid-append is skipped, not fatal", () => {
		const box = setup();
		const outbox = box.open();
		must(outbox.enqueue(decision()));
		must(outbox.enqueue(decision()));
		writeFileSync(box.path, `${readFileSync(box.path, "utf-8")}AbCdEf`);
		const again = box.open();
		expect(again.pending().map((e) => e.seq)).toEqual([1, 2]);
		expect(must(again.enqueue(step(1))).seq).toBe(3);
	});
});

describe("the bound", () => {
	test("reaching the bound coalesces run.step events, writes a gap marker and never crashes", () => {
		const box = setup({ bounds: { maxEvents: 20 } });
		const outbox = box.open();
		const decisions: number[] = [];
		for (let i = 0; i < 100; i++) {
			const r = outbox.enqueue(i % 10 === 0 ? decision() : step(i));
			expect(r.ok).toBe(true);
			if (r.ok && i % 10 === 0) decisions.push(r.value.seq);
		}
		const status = outbox.status();
		expect(status.pending).toBeLessThanOrEqual(20);
		expect(status.lastSeq).toBe(100);
		// Every decision is still waiting; only run.step events were dropped.
		const kept = outbox.pending();
		expect(decisions.every((s) => kept.some((e) => e.seq === s))).toBe(true);
		expect(status.gaps.length).toBeGreaterThan(0);
		expect(status.gaps.every((g) => g.reason === "coalesced")).toBe(true);
		expect(
			status.gaps.every((g) => Object.keys(g.types).join() === "run.step"),
		).toBe(true);
		const dropped = status.gaps.reduce((n, g) => n + g.count, 0);
		expect(dropped + status.pending).toBe(100);

		// The markers survive a restart.
		expect(box.open().status().gaps).toEqual(status.gaps);
	});

	test("with nothing left to coalesce, the oldest audit events go loudly, never silently", () => {
		const box = setup({ bounds: { maxEvents: 10 } });
		const outbox = box.open();
		for (let i = 0; i < 30; i++)
			expect(outbox.enqueue(decision()).ok).toBe(true);
		const status = outbox.status();
		expect(status.pending).toBeLessThanOrEqual(10);
		const overflow = status.gaps.filter((g) => g.reason === "overflow");
		const dropped = overflow.reduce((n, g) => n + (g.types.decision ?? 0), 0);
		expect(dropped + status.pending).toBe(30);
		// The newest are the ones kept.
		expect(outbox.pending().at(-1)?.seq).toBe(30);
	});

	test("the byte bound holds too", () => {
		const box = setup({ bounds: { maxBytes: 8 * 1024 } });
		const outbox = box.open();
		for (let i = 0; i < 200; i++) expect(outbox.enqueue(step(i)).ok).toBe(true);
		expect(outbox.status().bytes).toBeLessThanOrEqual(8 * 1024);
		expect(outbox.status().gaps.length).toBeGreaterThan(0);
	});

	test("events older than the age bound expire with a gap marker", () => {
		const box = setup({ bounds: { maxAgeMs: 60_000 } });
		const outbox = box.open();
		must(outbox.enqueue(decision()));
		box.advance(61_000);
		must(outbox.enqueue(decision()));
		expect(outbox.pending().map((e) => e.seq)).toEqual([2]);
		expect(outbox.status().gaps).toMatchObject([
			{ reason: "expired", ranges: [[1, 1]], count: 1 },
		]);
	});

	test("the journal is compacted as acknowledged events leave", () => {
		const box = setup();
		const outbox = box.open();
		for (let i = 0; i < 300; i++) must(outbox.enqueue(step(i)));
		const before = readFileSync(box.path, "utf-8").length;
		must(
			outbox.settle({
				v: 1,
				accepted: 300,
				duplicates: 0,
				rejected: [],
				nextExpectedSeq: 301,
				gaps: [],
			}),
		);
		expect(outbox.pending()).toEqual([]);
		expect(readFileSync(box.path, "utf-8").length).toBeLessThan(before / 10);
		const again = box.open();
		expect(again.pending()).toEqual([]);
		expect(must(again.enqueue(step(1))).seq).toBe(301);
	});
});

describe("settle", () => {
	test("drops what the cloud holds, keeps its gaps, and lifts the seq to nextExpectedSeq", () => {
		const box = setup();
		const outbox = box.open();
		for (let i = 0; i < 5; i++) must(outbox.enqueue(decision()));
		const settled = must(
			outbox.settle({
				v: 1,
				accepted: 4,
				duplicates: 0,
				rejected: [],
				nextExpectedSeq: 40,
				gaps: [{ from: 3, to: 3 }],
			}),
		);
		expect(settled.delivered).toBe(4);
		expect(outbox.pending().map((e) => e.seq)).toEqual([3]);
		expect(must(outbox.enqueue(decision())).seq).toBe(40);
	});

	test("an event the cloud rejects leaves with a gap marker and is not resent", () => {
		const box = setup();
		const outbox = box.open();
		must(outbox.enqueue(decision()));
		const settled = must(
			outbox.settle({
				v: 1,
				accepted: 0,
				duplicates: 0,
				rejected: [{ seq: 1, reason: "invalid_event" }],
				nextExpectedSeq: 2,
				gaps: [],
			}),
		);
		expect(settled.rejected).toBe(1);
		expect(outbox.pending()).toEqual([]);
		expect(outbox.status().gaps).toMatchObject([
			{ reason: "rejected", ranges: [[1, 1]], types: { decision: 1 } },
		]);
	});
});

describe("sequence", () => {
	test("toRanges folds seqs into inclusive ranges", () => {
		expect(toRanges([1, 2, 3, 5, 7, 8])).toEqual([
			[1, 3],
			[5, 5],
			[7, 8],
		]);
		expect(toRanges([])).toEqual([]);
	});

	test("reconcile trusts nextExpectedSeq and the gaps, not the batch alone", () => {
		const r = reconcile([1, 2, 3, 4, 9], {
			v: 1,
			accepted: 3,
			duplicates: 0,
			rejected: [{ seq: 4, reason: "invalid_event" }],
			nextExpectedSeq: 6,
			gaps: [{ from: 2, to: 2 }],
		});
		expect(r.delivered).toEqual([1, 3]);
		expect(r.rejected).toEqual([4]);
		expect(r.floor).toBe(5);
	});
});

describe("linkHash", () => {
	test("keys an identifier with the org link salt, in the schema's sha256 form", () => {
		const salt = {
			id: "lsalt_1",
			value: Buffer.alloc(32, 7).toString("base64url"),
		};
		const other = {
			id: "lsalt_2",
			value: Buffer.alloc(32, 8).toString("base64url"),
		};
		const a = linkHash(salt, "github.com/acme/app");
		expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(linkHash(salt, "github.com/acme/app")).toBe(a);
		expect(linkHash(other, "github.com/acme/app")).not.toBe(a);
		expect(a).not.toContain("acme");
	});
});
