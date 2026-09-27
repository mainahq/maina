/**
 * System 1 bench (#338, FR-S1-5; system1-artifact.md §7): p95 <= 30 ms per
 * `action.risk` inference and resident memory <= 1 GB.
 *
 * No real model artifact exists yet, so it runs the loader's whole path
 * (verify, load, parity self-check, encode, run, calibrate) on the toy
 * fixture release, signed with a dev key. The engine is this machine's:
 * the native addon where the release ships one, else WASM (the fixture
 * ships none, so WASM today). Prints load time, p50/p95/p99 and RSS, and
 * exits 1 when a budget is broken.
 *
 *   bun packages/runtime/bench/model.bench.ts [iterations]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, withBackend } from "@mainahq/core";
import { hostTarget } from "../build/standalone";
import {
	checkerFor,
	devKey,
	pinOn,
} from "../src/model/__tests__/fixtures/model-release";
import {
	buildSystem1Release,
	S1_VERSION,
	writeRelease,
} from "../src/model/__tests__/fixtures/system1-release";
import { createSystem1Port } from "../src/model/infer";
import { loadModel } from "../src/model/load";

const BUDGET_P95_MS = 30;
const BUDGET_RSS_BYTES = 1024 ** 3;
const WARMUP = 50;
const iterations = Number(process.argv[2] ?? 1000);

const key = devKey();
const release = buildSystem1Release(key.privatePem);
const root = mkdtempSync(join(tmpdir(), "maina-model-bench-"));
writeRelease(join(root, "maina-system1", S1_VERSION), release.files);
const target =
	hostTarget(process.platform, process.arch, false) ?? "linux-x64-musl";

const t0 = performance.now();
const port = createSystem1Port(
	loadModel({
		pin: pinOn(release.manifestBytes, S1_VERSION),
		root,
		target,
		verifySignature: checkerFor(key.publicPem),
	}),
);
await port.ready;
const loadMs = performance.now() - t0;
const off = port.disabled?.();
if (off !== undefined) {
	process.stderr.write(`model bench: ${off}\n`);
	rmSync(root, { recursive: true, force: true });
	process.exit(1);
}

const policy = withBackend(DEFAULT_POLICY, "action.risk", "system1");
const samples: number[] = [];
for (let i = 0; i < WARMUP + iterations; i++) {
	// A distinct command each time, so the output cache never answers.
	const input = {
		type: "action.risk",
		state: {
			trusted: {
				eventKind: "shell",
				rule: "no_rule",
				classes: ["shell.opaque"],
			},
			untrusted: { action: { command: `git status --short dir-${i}` } },
		},
		questions: [{ kind: "choice", id: "r", options: ["allow", "ask", "deny"] }],
		policy,
	} as const;
	const started = performance.now();
	const out = await port.infer([input]);
	const elapsed = performance.now() - started;
	if (!out.ok) {
		process.stderr.write(`model bench: ${out.error.message}\n`);
		process.exit(1);
	}
	if (i >= WARMUP) samples.push(elapsed);
}
samples.sort((a, b) => a - b);
const at = (q: number) =>
	samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
const p95 = at(0.95);
const rss = process.memoryUsage().rss;
rmSync(root, { recursive: true, force: true });

process.stdout.write(
	`system1 (${port.engine} on ${target}) load ${loadMs.toFixed(1)} ms; ` +
		`action.risk over ${iterations} runs: p50 ${at(0.5).toFixed(3)} ms, ` +
		`p95 ${p95.toFixed(3)} ms, p99 ${at(0.99).toFixed(3)} ms; ` +
		`rss ${(rss / 1024 ** 2).toFixed(0)} MB\n`,
);
process.exit(p95 <= BUDGET_P95_MS && rss <= BUDGET_RSS_BYTES ? 0 : 1);
