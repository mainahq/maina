/**
 * Status line bench (FR-RET-1 budget: render <= 50 ms p95).
 *
 * Times `renderStatusline` on its own, then the line a host gets from a warm
 * runtime: the `status` probe over a fresh connection plus the render.
 * Prints p50/p95/p99 for both and exits 1 when either p95 is over budget.
 *
 *   bun packages/runtime/bench/statusline.bench.ts [iterations]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEndpoint } from "../src/registry";
import { startRuntime } from "../src/server";
import { renderStatusline } from "../src/statusline/render";
import {
	probeRuntime,
	readStatuslineState,
	type StatuslineState,
} from "../src/statusline/state";

const BUDGET_P95_MS = 50;
const WARMUP = 50;
const iterations = Number(process.argv[2] ?? 2000);
const version = "bench";

const summary = {
	blocked: 1,
	asked: 2,
	allowed: 14,
	routed: 5,
	estimatedSavedUsd: 0.42,
	addedLatencyP95: 38,
};

async function time(run: () => unknown): Promise<readonly number[]> {
	const samples: number[] = [];
	for (let i = 0; i < WARMUP + iterations; i++) {
		const t0 = performance.now();
		await run();
		const elapsed = performance.now() - t0;
		if (i >= WARMUP) samples.push(elapsed);
	}
	return samples.sort((a, b) => a - b);
}

const at = (samples: readonly number[], q: number): number =>
	samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;

function report(label: string, samples: readonly number[]): boolean {
	const p95 = at(samples, 0.95);
	process.stdout.write(
		`${label} over ${iterations} runs: p50 ${at(samples, 0.5).toFixed(3)} ms, ` +
			`p95 ${p95.toFixed(3)} ms, p99 ${at(samples, 0.99).toFixed(3)} ms\n`,
	);
	return p95 <= BUDGET_P95_MS;
}

const state: StatuslineState = { runtime: "on", degraded: ["gate"], summary };
const renderOk = report(
	"statusline render",
	await time(() => renderStatusline(state, { color: true })),
);

const dir = mkdtempSync(join(tmpdir(), "maina-bench-"));
const endpoint = resolveEndpoint({
	platform: process.platform,
	dir,
	user: "bench",
	version,
	tmpDir: tmpdir(),
});
const started = startRuntime(
	{
		gate: () => ({
			verdict: "allow",
			reason: "bench",
			decisionIds: [],
			degraded: false,
		}),
	},
	{ endpoint, version, idleTtlMs: 60_000 },
);
if (!started.ok) {
	process.stderr.write(
		`runtime did not start: ${JSON.stringify(started.error)}\n`,
	);
	process.exit(1);
}

let off = 0;
const lineSamples = await time(async () => {
	const read = await readStatuslineState(
		{ sessionId: "bench" },
		{
			probe: (sessionId) =>
				probeRuntime({
					address: endpoint.address,
					version,
					timeoutMs: 1000,
					...(sessionId === undefined ? {} : { sessionId }),
				}),
			summary: async () => summary,
		},
	);
	if (read.runtime === "off") off++;
	return renderStatusline(read);
});

started.value.stop();
rmSync(dir, { recursive: true, force: true });

const lineOk = report("statusline probe + render", lineSamples);
process.stdout.write(`off ${off}\n`);
process.exit(renderOk && lineOk && off === 0 ? 0 : 1);
