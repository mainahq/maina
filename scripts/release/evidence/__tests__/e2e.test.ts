/**
 * The e2e evidence (spec §9.1): the real-config matrix pass rate over every
 * recorded run, and the per-marketplace first result and uninstall traces
 * the plugin cells measured.
 */

import { describe, expect, test } from "bun:test";
import {
	e2eMatrixEvidence,
	firstResultEvidence,
	parseMeasurements,
	uninstallEvidence,
} from "../e2e";
import { junit } from "./fixtures";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

describe("e2eMatrixEvidence", () => {
	test("every matrix case in every report is one run", () => {
		const rep1 = junit([
			["real-config matrix", "claude-code × plugin × gui", "passed"],
			["real-config matrix", "claude-code × plugin × full", "passed"],
			["minimalEnv", "darwin reproduces the launchd PATH", "passed"],
		]);
		const rep2 = junit([
			["real-config matrix", "claude-code × plugin × gui", "failed"],
			["real-config matrix", "claude-code × plugin × full", "passed"],
			["Claude Code plugin (#341)", "uninstall leaves no trace", "failed"],
		]);
		expect(e2eMatrixEvidence([rep1, rep2], LINK)).toEqual({
			ok: true,
			value: {
				link: LINK,
				runs: 4,
				passed: 3,
				reports: 2,
				failures: [{ name: "claude-code × plugin × gui", count: 1 }],
			},
		});
	});

	test("skipped cases are not runs", () => {
		const rep = junit([
			["real-config matrix", "a", "passed"],
			["real-config matrix", "b", "skipped"],
		]);
		const r = e2eMatrixEvidence([rep], LINK);
		expect(r.ok && [r.value.runs, r.value.passed]).toEqual([1, 1]);
	});

	test("failures are listed most frequent first", () => {
		const reps = [
			junit([
				["real-config matrix", "a", "failed"],
				["real-config matrix", "b", "failed"],
			]),
			junit([
				["real-config matrix", "a", "passed"],
				["real-config matrix", "b", "failed"],
			]),
		];
		const r = e2eMatrixEvidence(reps, LINK);
		expect(r.ok && r.value.failures).toEqual([
			{ name: "b", count: 2 },
			{ name: "a", count: 1 },
		]);
	});

	test("no report, or no matrix case at all, is no evidence", () => {
		expect(e2eMatrixEvidence([], LINK).ok).toBe(false);
		expect(
			e2eMatrixEvidence([junit([["minimalEnv", "x", "passed"]])], LINK).ok,
		).toBe(false);
	});

	test("an unreadable report is an error, not a silent drop", () => {
		const r = e2eMatrixEvidence(["not xml"], LINK);
		expect(r.ok).toBe(false);
	});
});

const jsonl = (...records: readonly unknown[]) =>
	records.map((r) => JSON.stringify(r)).join("\n");

describe("parseMeasurements", () => {
	test("keeps well-formed records and counts the rest", () => {
		const text = [
			jsonl(
				{
					kind: "first-result",
					host: "claude",
					os: "linux",
					seconds: 12.5,
					ok: true,
				},
				{ kind: "uninstall", host: "cursor", os: "darwin", traces: [] },
			),
			"{not json",
			jsonl({ kind: "first-result", host: "claude", os: "linux" }),
			jsonl({ kind: "uninstall", host: "vim", os: "linux", traces: [] }),
			"",
		].join("\n");
		const { records, invalid } = parseMeasurements(text);
		expect(records).toHaveLength(2);
		expect(invalid).toBe(3);
	});
});

describe("firstResultEvidence", () => {
	test("the slowest successful run per host, with the per-OS worst", () => {
		const { records } = parseMeasurements(
			jsonl(
				{
					kind: "first-result",
					host: "claude",
					os: "linux",
					seconds: 20.04,
					ok: true,
				},
				{
					kind: "first-result",
					host: "claude",
					os: "darwin",
					seconds: 31.26,
					ok: true,
				},
				{
					kind: "first-result",
					host: "claude",
					os: "linux",
					seconds: 25,
					ok: true,
				},
				{
					kind: "first-result",
					host: "codex",
					os: "linux",
					seconds: 9,
					ok: true,
				},
			),
		);
		expect(firstResultEvidence(records, LINK)).toEqual({
			ok: true,
			value: {
				link: LINK,
				marketplaces: {
					claude: {
						seconds: 31.3,
						runs: 3,
						failed: 0,
						byOs: { darwin: 31.3, linux: 25 },
					},
					codex: { seconds: 9, runs: 1, failed: 0, byOs: { linux: 9 } },
				},
			},
		});
	});

	test("a host whose first result failed in any run has no seconds", () => {
		const { records } = parseMeasurements(
			jsonl(
				{
					kind: "first-result",
					host: "cursor",
					os: "linux",
					seconds: 10,
					ok: true,
				},
				{
					kind: "first-result",
					host: "cursor",
					os: "darwin",
					seconds: 70,
					ok: false,
				},
			),
		);
		const r = firstResultEvidence(records, LINK);
		expect(r.ok && r.value.marketplaces.cursor).toEqual({
			runs: 2,
			failed: 1,
			byOs: { linux: 10, darwin: 70 },
			error: "the first verify failed in 1 of 2 runs",
		});
	});

	test("no first-result measurement is no evidence", () => {
		const { records } = parseMeasurements(
			jsonl({ kind: "uninstall", host: "claude", os: "linux", traces: [] }),
		);
		expect(firstResultEvidence(records, LINK).ok).toBe(false);
	});
});

describe("uninstallEvidence", () => {
	test("every trace any run left, tagged with its OS, once", () => {
		const { records } = parseMeasurements(
			jsonl(
				{ kind: "uninstall", host: "claude", os: "linux", traces: [] },
				{ kind: "uninstall", host: "claude", os: "darwin", traces: [] },
				{
					kind: "uninstall",
					host: "codex",
					os: "linux",
					traces: ["added home/.codex/maina.toml"],
				},
				{
					kind: "uninstall",
					host: "codex",
					os: "linux",
					traces: ["added home/.codex/maina.toml"],
				},
			),
		);
		expect(uninstallEvidence(records, LINK)).toEqual({
			ok: true,
			value: {
				link: LINK,
				marketplaces: {
					claude: { traces: [], runs: 2 },
					codex: {
						traces: ["linux: added home/.codex/maina.toml"],
						runs: 2,
					},
				},
			},
		});
	});

	test("no uninstall measurement is no evidence", () => {
		expect(uninstallEvidence([], LINK).ok).toBe(false);
	});
});
