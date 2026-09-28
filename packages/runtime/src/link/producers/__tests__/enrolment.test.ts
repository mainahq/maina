/**
 * Producers emit only while the device is enrolled (#591, spec §6.3): over
 * the real uplink and Link store, a device that is not enrolled enqueues
 * nothing and writes no outbox; once enrolled, every producer's event is
 * queued and reaches the cloud's ingest, which checks it against the
 * published schema.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DecisionRecord } from "@mainahq/core";
import { testTmpDir } from "../../../__tests__/test-tmp";
import { fakeCloud } from "../../__tests__/fake-cloud";
import { enrolDevice } from "../../enrol";
import { nodeLinkCrypto } from "../../keys";
import { fileLinkStore } from "../../store";
import { createUplink } from "../../uplink";
import { emitDecision } from "../decision";
import { createInventoryReporter } from "../inventory";
import { emitOverride } from "../override";
import { emitReceipt } from "../receipt";
import { emitSpend } from "../spend";
import { HASH_A, HASH_B, HASH_C } from "./helpers";

let dir: string;

beforeEach(() => {
	dir = testTmpDir("maina-link-producers-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const RECORD: DecisionRecord = {
	id: "d-1",
	ts: 1_000,
	type: "action.risk",
	inputHash: HASH_A,
	schemaHash: HASH_B,
	optionOrder: ["allow", "ask", "deny"],
	policyHash: HASH_B,
	modelHash: HASH_C,
	distribution: [
		{ answer: "allow", p: 0.8 },
		{ answer: "ask", p: 0.15 },
		{ answer: "deny", p: 0.05 },
	],
	answer: "allow",
	finalAction: "allow",
	latencyMs: 3,
};

/** One of every producer's events, through `sink`. */
function emitAll(sink: Parameters<typeof emitDecision>[0]) {
	return [
		emitDecision(sink, RECORD),
		emitOverride(sink, {
			decisionId: "d-1",
			decisionType: "action.risk",
			fromAction: "deny",
			toAction: "allow",
			reason: "member_override",
		}),
		emitReceipt(sink, { receiptHash: HASH_A, passed: true }),
		emitSpend(sink, {
			taskId: "t",
			task: "review",
			tier: "standard",
			model: "anthropic/claude-sonnet-4.5",
			inputTokens: 10,
			outputTokens: 1,
			costUsd: 0.0001,
		}),
	];
}

const INVENTORY = {
	runtimeVersion: "2.0.0",
	agents: [
		{
			agent: "claude-code",
			version: "2.3.1",
			hooks: "missing",
			mcpServers: 0,
			plugins: 0,
		},
	],
} as const;

describe("producers and enrolment", () => {
	test("a device that isn't enrolled enqueues nothing", () => {
		const cloud = fakeCloud({ ingest: true });
		const linkDir = join(dir, "link");
		const uplink = createUplink({
			http: cloud.http,
			store: fileLinkStore(linkDir),
			crypto: nodeLinkCrypto,
			clock: () => new Date("2026-09-28T09:00:00.000Z"),
		});
		for (const emitted of emitAll(uplink)) {
			expect(emitted).toEqual({
				ok: true,
				value: { queued: false, reason: "not_enrolled" },
			});
		}
		expect(createInventoryReporter(uplink).report(INVENTORY)).toEqual({
			ok: true,
			value: 0,
		});
		expect(uplink.status().outbox).toBeNull();
		expect(existsSync(join(linkDir, "outbox.log"))).toBe(false);
		expect(cloud.requests).toEqual([]);
	});

	test("an enrolled device queues every producer's event and the cloud accepts it", async () => {
		const cloud = fakeCloud({ ingest: true });
		const ports = {
			http: cloud.http,
			store: fileLinkStore(join(dir, "link")),
			crypto: nodeLinkCrypto,
			clock: () => new Date("2026-09-28T09:00:00.000Z"),
		};
		const enrolled = await enrolDevice(
			{ ...ports, sleep: async () => {} },
			{
				baseUrl: cloud.baseUrl,
				device: { os: "linux", arch: "x64", runtimeVersion: "2.0.0" },
			},
		);
		expect(enrolled.ok).toBe(true);
		const uplink = createUplink(ports);
		for (const emitted of emitAll(uplink)) {
			expect(emitted.ok && emitted.value.queued).toBe(true);
		}
		expect(createInventoryReporter(uplink).report(INVENTORY)).toEqual({
			ok: true,
			value: 1,
		});
		expect(uplink.status().outbox?.pending).toBe(5);
		await uplink.tick();
		expect(uplink.status().outbox?.pending).toBe(0);
		expect(uplink.status().lastError).toBeNull();
	});
});
