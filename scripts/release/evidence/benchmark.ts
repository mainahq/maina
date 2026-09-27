#!/usr/bin/env bun
/**
 * The benchmark evidence for spec §9.3 (v1 task 8.8, #581): the public gate
 * benchmark's report for each set (`scripts/benchmark-report.ts` schema,
 * validated by it) folded into `benchmark.json` with the exact system and
 * set ids the release gate checks, and the public methodology link.
 *
 *   bun scripts/release/evidence/benchmark.ts --overeager <f> --injection <f> \
 *     --out <f> [--methodology <url>] [--link <url>]
 *
 * The ids are defined here once; `v1-gates.ts` reads them. A system counts
 * only when every set's report ran it, and ids outside the lists are not
 * evidence. A set or system that is absent is listed in `missing`, so the
 * gate names it. An invalid report is an error: nothing is published from
 * a report the docs page would refuse.
 */

import { parseBenchmarkReport } from "../../benchmark-report";
import type { Result } from "./shell";

/** The systems the public benchmark compares (spec §9.3). */
export const BENCHMARK_SYSTEMS = [
	"maina",
	"claude-code-auto-mode",
	"codex-auto-review",
] as const;

/** The benchmark's sets: over-eager actions and prompt injection. */
export const BENCHMARK_SETS = ["overeager", "injection"] as const;

/** The public methodology: the generated `/benchmarks/` docs page. */
export const BENCHMARK_METHODOLOGY = "https://mainahq.com/benchmarks/";

const LINK = /^https?:\/\/\S+$/;

type SetId = (typeof BENCHMARK_SETS)[number];
type SystemId = (typeof BENCHMARK_SYSTEMS)[number];

export type BenchmarkEvidence = Readonly<{
	link: string;
	methodology: string;
	systems: readonly SystemId[];
	sets: readonly SetId[];
	missing?: readonly string[];
}>;

export function benchmarkEvidence(
	/** Each set's report text, `undefined` when there is none. */
	reports: Readonly<Partial<Record<SetId, string | undefined>>>,
	link: string,
	methodology: string = BENCHMARK_METHODOLOGY,
): Result<BenchmarkEvidence, string> {
	if (!LINK.test(methodology)) {
		return {
			ok: false,
			error: `methodology ${JSON.stringify(methodology)} is not an http(s) link`,
		};
	}
	const ran = new Map<SetId, ReadonlySet<string>>();
	for (const set of BENCHMARK_SETS) {
		const text = reports[set];
		if (text === undefined) continue;
		const parsed = parseBenchmarkReport(text);
		if (!parsed.ok) return { ok: false, error: `${set}: ${parsed.error}` };
		ran.set(set, new Set(parsed.value.systems.map((s) => s.id)));
	}
	if (ran.size === 0) {
		return { ok: false, error: "no benchmark report for any set" };
	}
	const sets = BENCHMARK_SETS.filter((s) => ran.has(s));
	const systems = BENCHMARK_SYSTEMS.filter((id) =>
		[...ran.values()].every((ids) => ids.has(id)),
	);
	const missing = [
		...BENCHMARK_SETS.filter((s) => !ran.has(s)).map((s) => `set ${s}`),
		...BENCHMARK_SYSTEMS.filter((s) => !systems.includes(s)).map(
			(s) => `system ${s}`,
		),
	];
	return {
		ok: true,
		value: {
			link,
			methodology,
			systems,
			sets,
			...(missing.length > 0 ? { missing } : {}),
		},
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, readText, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	emit(
		"benchmark",
		flag(argv, "--out"),
		benchmarkEvidence(
			Object.fromEntries(
				BENCHMARK_SETS.map((s) => [s, readText(flag(argv, `--${s}`))]),
			),
			flag(argv, "--link") ?? runLink(process.env),
			flag(argv, "--methodology"),
		),
	);
}
