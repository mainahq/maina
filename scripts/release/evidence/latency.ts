#!/usr/bin/env bun
/**
 * The latency evidence for spec §8/§9.2 (v1 task 12.1, #558): folds the
 * bench reports into `latency.json`.
 *
 *   gate + decide p95   packages/core/bench/gate.bench.ts --json
 *   graph query p95     packages/core/bench/graph.bench.ts --json (the
 *                       slowest query kind's p95, warm)
 *   MCP cold start      scripts/release/evidence/mcp-cold-start.ts --json
 *
 *   bun scripts/release/evidence/latency.ts --gate <f> --graph <f> --mcp <f> --out <f>
 *
 * A bench that produced nothing leaves its numbers out, so the gate reports
 * them missing instead of passing on a default.
 */

import type { Result } from "./shell";

type Obj = Readonly<Record<string, unknown>>;

const isObj = (v: unknown): v is Obj =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

export type LatencyInputs = Readonly<{
	gate: unknown;
	graph: unknown;
	mcp: unknown;
}>;

export type LatencyEvidence = Readonly<{
	link: string;
	gateP95Ms?: number;
	decideP95Ms?: number;
	graphQueryP95Ms?: number;
	mcpColdStartMs?: number;
	graphRepo?: string;
	missing?: readonly string[];
}>;

function gateNumbers(v: unknown): Obj | undefined {
	if (!isObj(v)) return undefined;
	const gate = num(v.gateP95Ms);
	const decide = num(v.decideP95Ms);
	return gate === undefined || decide === undefined
		? undefined
		: { gateP95Ms: gate, decideP95Ms: decide };
}

function graphNumbers(v: unknown): Obj | undefined {
	if (!isObj(v) || !isObj(v.queries)) return undefined;
	const p95s = Object.values(v.queries).map((q) =>
		isObj(q) ? num(q.p95) : undefined,
	);
	if (p95s.length === 0 || p95s.some((p) => p === undefined)) return undefined;
	return {
		graphQueryP95Ms: Math.max(...(p95s as number[])),
		...(typeof v.repo === "string" ? { graphRepo: v.repo } : {}),
	};
}

function mcpNumbers(v: unknown): Obj | undefined {
	const p95 = isObj(v) ? num(v.p95Ms) : undefined;
	return p95 === undefined ? undefined : { mcpColdStartMs: p95 };
}

export function latencyEvidence(
	inputs: LatencyInputs,
	link: string,
): Result<LatencyEvidence, string> {
	const parts = [
		["gate bench", gateNumbers(inputs.gate)],
		["graph bench", graphNumbers(inputs.graph)],
		["MCP cold-start bench", mcpNumbers(inputs.mcp)],
	] as const;
	const missing = parts.filter(([, p]) => p === undefined).map(([l]) => l);
	if (missing.length === parts.length) {
		return { ok: false, error: "no bench produced a report" };
	}
	const merged = Object.assign({}, ...parts.map(([, p]) => p ?? {}));
	return {
		ok: true,
		value: {
			link,
			...merged,
			...(missing.length > 0 ? { missing } : {}),
		},
	};
}

/** The percentile as the benches take it (`gate.bench.ts`): index ⌊n·q⌋. */
function percentile(sorted: readonly number[], q: number): number {
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
	);
}

export type ColdStartSummary = Readonly<{
	samples: readonly number[];
	p95Ms: number;
	maxMs: number;
}>;

export function summarizeColdStarts(
	samples: readonly number[],
): Result<ColdStartSummary, string> {
	if (samples.length === 0) {
		return { ok: false, error: "the MCP server never started" };
	}
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		ok: true,
		value: {
			samples,
			p95Ms: percentile(sorted, 0.95),
			maxMs: sorted.at(-1) ?? 0,
		},
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, readJson, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	emit(
		"latency",
		flag(argv, "--out"),
		latencyEvidence(
			{
				gate: readJson(flag(argv, "--gate")),
				graph: readJson(flag(argv, "--graph")),
				mcp: readJson(flag(argv, "--mcp")),
			},
			flag(argv, "--link") ?? runLink(process.env),
		),
	);
}
