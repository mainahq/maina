/**
 * Gate evaluator bench (FR-GATE-6 budget: p95 <= 50 ms per event with the
 * deterministic backends, no model).
 *
 * Replays the labelled command corpus (`src/gate/__fixtures__/commands.jsonl`)
 * through `evaluateGate` twice: once with `action.risk` on the rules backend
 * (the default), once with it routed to the heuristic backend. The heuristic
 * backend has no `action.risk` heuristic, so that pass times the fail-closed
 * path (every event is `degraded` and asks). Each pass warms up, then times
 * every event. Prints p50/p95/p99/max per pass and exits 1 when either p95
 * is over budget. `evaluate.test.ts` holds the same budget in CI.
 *
 *   bun packages/core/bench/gate.bench.ts [rounds]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REGISTRY, withBackend } from "../src/decide/registry";
import { evaluateGate, type GatePorts } from "../src/gate/evaluate";
import type { GateEvent } from "../src/gate/events";
import { loadShellParser } from "../src/gate/parsers/shell";
import { DEFAULT_POLICY } from "../src/policy/defaults";
import type { Policy } from "../src/policy/schema";

const BUDGET_P95_MS = 50;
const WARMUP_ROUNDS = 2;
const rounds = Number(process.argv[2] ?? 5);
const ROOT = "/work/repo";

/** A corpus line: one event's kind and action (other fields are labels). */
type Fixture = Pick<GateEvent, "kind" | "action">;

const events: readonly GateEvent[] = readFileSync(
	join(import.meta.dir, "../src/gate/__fixtures__/commands.jsonl"),
	"utf8",
)
	.split("\n")
	.filter((line) => line.trim() !== "")
	.map((line) => {
		const fixture = JSON.parse(line) as Fixture;
		return {
			host: "bench",
			sessionId: "bench",
			root: ROOT,
			permissionMode: "default",
			untrusted: [],
			kind: fixture.kind,
			action: fixture.action,
		} as GateEvent;
	});

const shell = await loadShellParser();
if (!shell.ok) {
	process.stderr.write(`bash grammar did not load: ${shell.error.message}\n`);
	process.exit(1);
}

let n = 0;
const ports: GatePorts = {
	clock: { now: () => performance.now() },
	backends: DEFAULT_REGISTRY,
	ctx: { shell: shell.value, home: "/home/dev" },
	newId: () => `bench-${++n}`,
};

function run(label: string, policy: Policy): boolean {
	const samples: number[] = [];
	let degraded = 0;
	for (let round = 0; round < WARMUP_ROUNDS + rounds; round++) {
		for (const event of events) {
			const t0 = performance.now();
			const result = evaluateGate(ports, event, policy);
			const elapsed = performance.now() - t0;
			if (round < WARMUP_ROUNDS) continue;
			samples.push(elapsed);
			if (result.degraded) degraded++;
		}
	}
	samples.sort((a, b) => a - b);
	const at = (q: number): number =>
		samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
	const p95 = at(0.95);
	process.stdout.write(
		`evaluateGate [${label}] over ${samples.length} events: ` +
			`p50 ${at(0.5).toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, ` +
			`p99 ${at(0.99).toFixed(3)} ms, max ${at(1).toFixed(3)} ms, ` +
			`degraded ${degraded}\n`,
	);
	return p95 <= BUDGET_P95_MS;
}

const rules = run("rules backend", DEFAULT_POLICY);
const heuristic = run(
	"heuristic backend",
	withBackend(DEFAULT_POLICY, "action.risk", "heuristic"),
);
process.exit(rules && heuristic ? 0 : 1);
