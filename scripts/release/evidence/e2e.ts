#!/usr/bin/env bun
/**
 * The e2e evidence for spec §9.1 (v1 task 12.1, #558), from what the
 * release-evidence workflow's real-config cells left behind:
 *
 *   e2e-matrix.json    every `real-config matrix` case in every JUnit report
 *                      is one run; skipped cases are not runs
 *   first-result.json  per marketplace host, the slowest successful first
 *                      result across OSes and repetitions
 *   uninstall.json     per marketplace host, every trace any run left
 *
 *   bun scripts/release/evidence/e2e.ts --in <dir> --out <dir> [--link <url>]
 *
 * `--in` is searched recursively for `*.xml` (JUnit) and `*.jsonl`
 * (`ci/e2e/real-config/measurements.ts`) files.
 */

import type {
	FirstResultMeasurement,
	Marketplace,
	Measurement,
	UninstallMeasurement,
} from "../../../ci/e2e/real-config/measurements";
import { MARKETPLACE_HOSTS } from "../../../ci/e2e/real-config/measurements";
import { parseJunit } from "./junit";
import type { Result } from "./shell";

/** The describe block the matrix cases live in (`matrix.test.ts`). */
export const MATRIX_SUITE = "real-config matrix";

export type E2eMatrixEvidence = Readonly<{
	link: string;
	runs: number;
	passed: number;
	/** JUnit reports read: cells × repetitions. */
	reports: number;
	failures: readonly Readonly<{ name: string; count: number }>[];
}>;

export function e2eMatrixEvidence(
	reports: readonly string[],
	link: string,
): Result<E2eMatrixEvidence, string> {
	if (reports.length === 0) return { ok: false, error: "no JUnit report" };
	let runs = 0;
	let passed = 0;
	const failed = new Map<string, number>();
	for (const [i, xml] of reports.entries()) {
		const parsed = parseJunit(xml);
		if (!parsed.ok) {
			return { ok: false, error: `report ${i + 1}: ${parsed.error}` };
		}
		for (const c of parsed.value) {
			if (c.suite !== MATRIX_SUITE || c.status === "skipped") continue;
			runs++;
			if (c.status === "passed") passed++;
			else failed.set(c.name, (failed.get(c.name) ?? 0) + 1);
		}
	}
	if (runs === 0) {
		return {
			ok: false,
			error: `no "${MATRIX_SUITE}" case ran in ${reports.length} report(s)`,
		};
	}
	const failures = [...failed]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return {
		ok: true,
		value: { link, runs, passed, reports: reports.length, failures },
	};
}

// ── Measurements ──────────────────────────────────────────────────────────

const OSES: ReadonlySet<string> = new Set(["darwin", "linux"]);
const HOSTS: ReadonlySet<string> = new Set(MARKETPLACE_HOSTS);

function asMeasurement(v: unknown): Measurement | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const o = v as Record<string, unknown>;
	if (typeof o.host !== "string" || !HOSTS.has(o.host)) return undefined;
	if (typeof o.os !== "string" || !OSES.has(o.os)) return undefined;
	if (
		o.kind === "first-result" &&
		typeof o.seconds === "number" &&
		Number.isFinite(o.seconds) &&
		o.seconds >= 0 &&
		typeof o.ok === "boolean"
	) {
		return o as FirstResultMeasurement;
	}
	if (
		o.kind === "uninstall" &&
		Array.isArray(o.traces) &&
		o.traces.every((t) => typeof t === "string")
	) {
		return o as UninstallMeasurement;
	}
	return undefined;
}

export function parseMeasurements(
	text: string,
): Readonly<{ records: readonly Measurement[]; invalid: number }> {
	const records: Measurement[] = [];
	let invalid = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			invalid++;
			continue;
		}
		const m = asMeasurement(parsed);
		if (m === undefined) invalid++;
		else records.push(m);
	}
	return { records, invalid };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** `records` grouped by host, in marketplace order. */
function byHost<M extends Measurement>(
	records: readonly M[],
): readonly (readonly [Marketplace, readonly M[]])[] {
	return MARKETPLACE_HOSTS.map(
		(host) => [host, records.filter((r) => r.host === host)] as const,
	).filter(([, rs]) => rs.length > 0);
}

export type FirstResultEntry = Readonly<{
	/** Absent when any run failed: a failed first result has no time. */
	seconds?: number;
	runs: number;
	failed: number;
	byOs: Readonly<Record<string, number>>;
	error?: string;
}>;

export function firstResultEvidence(
	records: readonly Measurement[],
	link: string,
): Result<
	Readonly<{ link: string; marketplaces: Record<string, FirstResultEntry> }>,
	string
> {
	const firsts = records.filter(
		(r): r is FirstResultMeasurement => r.kind === "first-result",
	);
	if (firsts.length === 0) {
		return { ok: false, error: "no first-result measurement" };
	}
	const marketplaces: Record<string, FirstResultEntry> = {};
	for (const [host, rs] of byHost(firsts)) {
		const byOs: Record<string, number> = {};
		for (const r of rs) {
			byOs[r.os] = round1(Math.max(byOs[r.os] ?? 0, r.seconds));
		}
		const failed = rs.filter((r) => !r.ok).length;
		marketplaces[host] =
			failed === 0
				? {
						seconds: round1(Math.max(...rs.map((r) => r.seconds))),
						runs: rs.length,
						failed,
						byOs,
					}
				: {
						runs: rs.length,
						failed,
						byOs,
						error: `the first verify failed in ${failed} of ${rs.length} runs`,
					};
	}
	return { ok: true, value: { link, marketplaces } };
}

export function uninstallEvidence(
	records: readonly Measurement[],
	link: string,
): Result<
	Readonly<{
		link: string;
		marketplaces: Record<
			string,
			Readonly<{ traces: readonly string[]; runs: number }>
		>;
	}>,
	string
> {
	const uninstalls = records.filter(
		(r): r is UninstallMeasurement => r.kind === "uninstall",
	);
	if (uninstalls.length === 0) {
		return { ok: false, error: "no uninstall measurement" };
	}
	const marketplaces: Record<
		string,
		Readonly<{ traces: readonly string[]; runs: number }>
	> = {};
	for (const [host, rs] of byHost(uninstalls)) {
		const traces = [
			...new Set(rs.flatMap((r) => r.traces.map((t) => `${r.os}: ${t}`))),
		].sort();
		marketplaces[host] = { traces, runs: rs.length };
	}
	return { ok: true, value: { link, marketplaces } };
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { join } = await import("node:path");
	const { emit, filesUnder, flag, readText, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	const input = flag(argv, "--in") ?? "raw/e2e";
	const out = flag(argv, "--out");
	const link = flag(argv, "--link") ?? runLink(process.env);
	const xml = filesUnder(input, ".xml").map((f) => readText(f) ?? "");
	const text = filesUnder(input, ".jsonl")
		.map((f) => readText(f) ?? "")
		.join("\n");
	const { records, invalid } = parseMeasurements(text);
	if (invalid > 0) {
		process.stderr.write(`e2e: ignored ${invalid} malformed measurement(s)\n`);
	}
	const dir = out ?? ".";
	emit(
		"e2e-matrix",
		join(dir, "e2e-matrix.json"),
		e2eMatrixEvidence(xml, link),
	);
	emit(
		"first-result",
		join(dir, "first-result.json"),
		firstResultEvidence(records, link),
	);
	emit(
		"uninstall",
		join(dir, "uninstall.json"),
		uninstallEvidence(records, link),
	);
}
