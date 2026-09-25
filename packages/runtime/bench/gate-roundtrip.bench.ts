/**
 * Gate round-trip bench (FR-GATE-1 budget: < 10 ms p95 on a warm runtime).
 *
 * Starts a runtime in process on a temporary endpoint, warms it up, then
 * times `hookClient.evaluate` end to end: a fresh connection, one request,
 * one response, as a hook process does it. Prints p50/p95/p99 and exits 1
 * when p95 is over budget.
 *
 *   bun packages/runtime/bench/gate-roundtrip.bench.ts [iterations]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookClient } from "../src/client/hook-client";
import { resolveEndpoint } from "../src/registry";
import { startRuntime } from "../src/server";

const BUDGET_P95_MS = 10;
const WARMUP = 50;
const iterations = Number(process.argv[2] ?? 2000);
const version = "bench";

const dir = mkdtempSync(join(tmpdir(), "maina-bench-"));
const endpoint = resolveEndpoint({
	platform: process.platform,
	dir,
	user: "bench",
	version,
	tmpDir: tmpdir(),
});

const started = startRuntime(
	{ gate: () => ({ verdict: "allow", reason: "bench" }) },
	{ endpoint, version, idleTtlMs: 60_000 },
);
if (!started.ok) {
	process.stderr.write(
		`runtime did not start: ${JSON.stringify(started.error)}\n`,
	);
	process.exit(1);
}

const client = createHookClient({
	endpoint,
	version,
	spawn: () => ({
		ok: false,
		error: { kind: "spawn_failed", message: "bench runs in process" },
	}),
	fallback: () => ({ verdict: "deny", reason: "fallback" }),
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

started.value.stop();
rmSync(dir, { recursive: true, force: true });

samples.sort((a, b) => a - b);
const at = (q: number): number =>
	samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
const p95 = at(0.95);
process.stdout.write(
	`gate round trip over ${iterations} requests: ` +
		`p50 ${at(0.5).toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, ` +
		`p99 ${at(0.99).toFixed(3)} ms, max ${at(1).toFixed(3)} ms, ` +
		`degraded ${degraded}\n`,
);
process.exit(p95 < BUDGET_P95_MS && degraded === 0 ? 0 : 1);
