#!/usr/bin/env bun
/**
 * The escape-suite evidence for spec §9.6 (v1 task 12.1, #558): one run per
 * sandboxed `ci/escape/runner.ts --json` report, per OS and worker.
 *
 *   bun scripts/release/evidence/escape.ts --in <dir> --out <file> [--link <url>]
 */

import type { Result } from "./shell";

export type EscapeRun = Readonly<{
	os: string;
	worker: string;
	cases: number;
	blocked: number;
	escaped?: readonly string[];
}>;

function asSandboxedRun(v: unknown): EscapeRun | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const o = v as Record<string, unknown>;
	const count = (n: unknown) =>
		typeof n === "number" && Number.isInteger(n) && n >= 0;
	if (
		o.mode !== "sandboxed" ||
		typeof o.os !== "string" ||
		typeof o.worker !== "string" ||
		!count(o.cases) ||
		!count(o.blocked)
	) {
		return undefined;
	}
	const escaped =
		Array.isArray(o.escaped) && o.escaped.length > 0
			? o.escaped.filter((e): e is string => typeof e === "string")
			: undefined;
	return {
		os: o.os,
		worker: o.worker,
		cases: o.cases as number,
		blocked: o.blocked as number,
		...(escaped ? { escaped } : {}),
	};
}

export function escapeEvidence(
	reports: readonly unknown[],
	link: string,
): Result<Readonly<{ link: string; runs: readonly EscapeRun[] }>, string> {
	const runs = reports
		.map(asSandboxedRun)
		.filter((r): r is EscapeRun => r !== undefined);
	if (runs.length === 0) {
		return {
			ok: false,
			error: `no sandboxed escape-suite report among ${reports.length}`,
		};
	}
	return { ok: true, value: { link, runs } };
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, filesUnder, flag, readJson, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	const reports = filesUnder(flag(argv, "--in") ?? "raw/escape", ".json").map(
		(f) => readJson(f),
	);
	emit(
		"escape-suite",
		flag(argv, "--out"),
		escapeEvidence(reports, flag(argv, "--link") ?? runLink(process.env)),
	);
}
