/**
 * The benchmark evidence (spec §9.3, task 8.8, #581): the public gate
 * benchmark's report per set, folded into `benchmark.json` with the exact
 * system and set ids `v1-gates.ts` checks and the public methodology link.
 */

import { describe, expect, test } from "bun:test";
import {
	BENCHMARK_METHODOLOGY,
	BENCHMARK_SETS,
	BENCHMARK_SYSTEMS,
	benchmarkEvidence,
} from "../benchmark";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

const system = (id: string) => ({
	id,
	name: id,
	version: "1.0.0",
	falseAllowRate: 0.01,
	falseBlockRate: 0.02,
	p95LatencyMs: 30,
	calibrationError: null,
});

/** A valid `scripts/benchmark-report.ts` report over `ids`. */
const report = (name: string, ids: readonly string[]): string =>
	JSON.stringify({
		schemaVersion: 1,
		ranOn: "2026-11-02",
		harness: {
			url: "https://github.com/mainahq/gate-bench",
			commit: "0a1b2c3d4e5f",
		},
		dataset: {
			name,
			version: "1.0.0",
			sha256: "a".repeat(64),
			destructive: 400,
			benign: 1600,
		},
		seed: 1,
		systems: ids.map(system),
		reproduce: ["bun run bench --seed 1"],
	});

const ALL = BENCHMARK_SYSTEMS;

describe("benchmarkEvidence", () => {
	test("the exact ids the release gate checks", () => {
		expect(BENCHMARK_SYSTEMS).toEqual([
			"maina",
			"claude-code-auto-mode",
			"codex-auto-review",
		]);
		expect(BENCHMARK_SETS).toEqual(["overeager", "injection"]);
		expect(BENCHMARK_METHODOLOGY).toMatch(/^https:\/\/\S+\/benchmarks\/$/);
	});

	test("every set run against every system", () => {
		expect(
			benchmarkEvidence(
				{
					overeager: report("overeager", ALL),
					injection: report("injection", ALL),
				},
				LINK,
			),
		).toEqual({
			ok: true,
			value: {
				link: LINK,
				methodology: BENCHMARK_METHODOLOGY,
				systems: [...ALL],
				sets: ["overeager", "injection"],
			},
		});
	});

	test("a system counts only when every set ran it, and unknown ids are not evidence", () => {
		const r = benchmarkEvidence(
			{
				overeager: report("overeager", [...ALL, "some-other-agent"]),
				injection: report("injection", ["maina", "claude-code-auto-mode"]),
			},
			LINK,
		);
		expect(r).toEqual({
			ok: true,
			value: {
				link: LINK,
				methodology: BENCHMARK_METHODOLOGY,
				systems: ["maina", "claude-code-auto-mode"],
				sets: ["overeager", "injection"],
				missing: ["system codex-auto-review"],
			},
		});
	});

	test("a set with no report is listed missing", () => {
		const r = benchmarkEvidence(
			{ overeager: report("overeager", ALL), injection: undefined },
			LINK,
		);
		if (!r.ok) throw new Error(r.error);
		expect(r.value.sets).toEqual(["overeager"]);
		expect(r.value.missing).toEqual(["set injection"]);
	});

	test("an invalid report is an error, not a silent gap", () => {
		const r = benchmarkEvidence(
			{ overeager: "{", injection: report("injection", ALL) },
			LINK,
		);
		expect(r).toEqual({
			ok: false,
			error: expect.stringMatching(/overeager.*not valid JSON/),
		});
	});

	test("the methodology must be a public link", () => {
		const r = benchmarkEvidence(
			{
				overeager: report("overeager", ALL),
				injection: report("injection", ALL),
			},
			LINK,
			"see the team wiki",
		);
		expect(r.ok).toBe(false);
	});

	test("with no report at all there is no evidence", () => {
		expect(benchmarkEvidence({}, LINK).ok).toBe(false);
	});
});
