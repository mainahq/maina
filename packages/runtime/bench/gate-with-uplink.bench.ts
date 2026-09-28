/**
 * Gate round trip while the Link uplink is busy (#590; v1 gate budget:
 * 50 ms p95).
 *
 * Starts a runtime in process on a temporary endpoint with an enrolled
 * device, a backlog of queued events and the uplink draining it on the
 * runtime's background loop against the fake cloud (which verifies every
 * envelope's signature and schema, on this same event loop) behind a slow
 * network. Every gate request also queues a decision event, as a producer
 * would. Times `hookClient.evaluate` end to end, prints p50/p95/p99 and the
 * events delivered, and exits 1 when p95 is over budget or the uplink
 * delivered nothing.
 *
 *   bun packages/runtime/bench/gate-with-uplink.bench.ts [iterations]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpPort } from "@mainahq/core";
import { createHookClient } from "../src/client/hook-client";
import { startLoop } from "../src/lifecycle";
import { fakeCloud } from "../src/link/__tests__/fake-cloud";
import { enrolDevice } from "../src/link/enrol";
import { nodeLinkCrypto } from "../src/link/keys";
import type { EventInput } from "../src/link/outbox";
import { fileLinkStore } from "../src/link/store";
import { createUplink } from "../src/link/uplink";
import { resolveEndpoint } from "../src/registry";
import { startRuntime } from "../src/server";

const BUDGET_P95_MS = 50;
const WARMUP = 50;
const BACKLOG = 5_000;
const NETWORK_MS = 25;
const iterations = Number(process.argv[2] ?? 2000);
const version = "bench";

const dir = mkdtempSync(join(tmpdir(), "maina-bench-uplink-"));

function bail(message: string): never {
	process.stderr.write(`${message}\n`);
	rmSync(dir, { recursive: true, force: true });
	process.exit(1);
}

const cloud = fakeCloud({ ingest: true });
const slow: HttpPort = {
	request: async (req) => {
		await new Promise((resolve) => setTimeout(resolve, NETWORK_MS));
		return cloud.http.request(req);
	},
};
const ports = {
	http: slow,
	store: fileLinkStore(join(dir, "link")),
	crypto: nodeLinkCrypto,
	clock: () => new Date(),
};
const enrolled = await enrolDevice(
	{ ...ports, http: cloud.http, sleep: async () => {} },
	{
		baseUrl: cloud.baseUrl,
		device: { os: "linux", arch: "x64", runtimeVersion: version },
	},
);
if (!enrolled.ok) bail(`enrolment failed: ${JSON.stringify(enrolled.error)}`);

const H = `sha256:${"c".repeat(64)}`;
const decision: EventInput = {
	type: "decision",
	runId: "run_bench",
	data: {
		decisionType: "action.risk",
		inputHash: H,
		policyHash: H,
		modelHash: H,
		finalAction: "allow",
		confidenceBp: 9000,
		latencyMs: 2,
	},
};

const uplink = createUplink(ports, { idleMs: 10 });
for (let i = 0; i < BACKLOG; i++) {
	const queued = uplink.enqueue(decision);
	if (!queued.ok || !queued.value.queued) {
		bail(`enqueue failed: ${JSON.stringify(queued)}`);
	}
}

const endpoint = resolveEndpoint({
	platform: process.platform,
	dir,
	user: "bench",
	version,
	tmpDir: tmpdir(),
});

let enqueueFailures = 0;
const started = startRuntime(
	{
		gate: () => {
			if (!uplink.enqueue(decision).ok) enqueueFailures++;
			return {
				verdict: "allow",
				reason: "bench",
				decisionIds: [],
				degraded: false,
			};
		},
	},
	{ endpoint, version, idleTtlMs: 60_000 },
);
if (!started.ok)
	bail(`runtime did not start: ${JSON.stringify(started.error)}`);
const loop = startLoop(uplink.tick);

const client = createHookClient({
	endpoint,
	version,
	spawn: () => ({
		ok: false,
		error: { kind: "spawn_failed", message: "bench runs in process" },
	}),
	fallback: () => ({
		verdict: "deny",
		reason: "fallback",
		decisionIds: [],
		degraded: false,
	}),
});
const event = { kind: "shell", input: { command: "ls" } };

let degraded = 0;
const samples: number[] = [];
for (let i = 0; i < WARMUP + iterations; i++) {
	const t0 = performance.now();
	const result = await client.evaluate(event, { timeoutMs: 1000 });
	const elapsed = performance.now() - t0;
	if (result.degraded) degraded++;
	if (i >= WARMUP) samples.push(elapsed);
}

loop.stop();
started.value.stop();
const delivered = cloud.state.received.length;
const envelopes = cloud.state.envelopes.length;
rmSync(dir, { recursive: true, force: true });

samples.sort((a, b) => a - b);
const at = (q: number): number =>
	samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
const p95 = at(0.95);
process.stdout.write(
	`gate round trip with a busy uplink over ${iterations} requests: ` +
		`p50 ${at(0.5).toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, ` +
		`p99 ${at(0.99).toFixed(3)} ms, max ${at(1).toFixed(3)} ms, ` +
		`degraded ${degraded}; uplink delivered ${delivered} events in ` +
		`${envelopes} envelopes, enqueue failures ${enqueueFailures}\n`,
);
process.exit(
	p95 < BUDGET_P95_MS &&
		degraded === 0 &&
		delivered > 0 &&
		enqueueFailures === 0
		? 0
		: 1,
);
