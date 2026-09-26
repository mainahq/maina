#!/usr/bin/env bun
/**
 * The public gate benchmark page (#361, FR-DOC-5).
 *
 * `/benchmarks/` is rendered from the benchmark report, a JSON file the
 * public gate benchmark (#339) produces from its raw results, and from
 * nothing else: every number, version and step on the page is read from
 * the report. `scripts/docs-manifest.ts` writes the page with the other
 * generated docs, so `docs:check` fails when it is stale.
 *
 * Until the report exists the page is a clearly labelled "publishes with
 * v1" methodology page, with no results. The docs build does not fail
 * without the report; the v1 release gate (#362) does, through
 * `requireBenchmarkReport`:
 *
 *   bun scripts/benchmark-report.ts --require-report   exit 1 without a
 *                                                      valid report
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Result<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: string }>;

/** Where the report is committed, repo-relative. */
export const BENCHMARK_REPORT = "packages/docs/src/data/benchmark-report.json";

const ISSUE_339 = "https://github.com/mainahq/maina/issues/339";

// ── Report ──────────────────────────────────────────────────────────────────

type SystemResult = Readonly<{
	/** Stable id; one row must be `maina`. */
	id: string;
	name: string;
	/** The pinned version the run used. */
	version: string;
	/** Destructive actions allowed without asking, over all destructive. */
	falseAllowRate: number;
	/** Benign actions blocked or escalated, over all benign. */
	falseBlockRate: number;
	/** Wall-clock decision latency at the 95th percentile. */
	p95LatencyMs: number;
	/** Expected calibration error; `null` when the system exposes no confidence. */
	calibrationError: number | null;
}>;

export type BenchmarkReport = Readonly<{
	schemaVersion: 1;
	/** The day the run finished, `YYYY-MM-DD`. */
	ranOn: string;
	harness: Readonly<{ url: string; commit: string }>;
	dataset: Readonly<{
		name: string;
		version: string;
		sha256: string;
		destructive: number;
		benign: number;
	}>;
	seed: number;
	systems: readonly SystemResult[];
	/** Shell lines that rerun the benchmark and regenerate the report. */
	reproduce: readonly string[];
}>;

type Json = Readonly<Record<string, unknown>>;

/** Text that renders as itself in MDX: no markup, braces, pipes or newlines. */
const PLAIN = /^[A-Za-z0-9 .,:;+_\-()/@#'&]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~\-/]*)?$/;

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** A validator: the problem with `v`, or null when it is fine. */
type Check = (v: unknown) => string | null;

const matches =
	(re: RegExp, what: string): Check =>
	(v) =>
		typeof v === "string" && re.test(v) ? null : `must be ${what}`;

const plain = matches(PLAIN, "plain text (no markup, braces or pipes)");
const rate: Check = (v) =>
	typeof v === "number" && v >= 0 && v <= 1
		? null
		: "must be a rate between 0 and 1";
const count: Check = (v) =>
	Number.isInteger(v) && (v as number) >= 0 ? null : "must be a whole number";
const latency: Check = (v) =>
	typeof v === "number" && Number.isFinite(v) && v >= 0
		? null
		: "must be a non-negative number of milliseconds";

/** The first problem among `fields` of `obj`, prefixed with its path. */
function firstProblem(
	obj: Json,
	path: string,
	fields: Readonly<Record<string, Check>>,
): string | null {
	for (const [key, check] of Object.entries(fields)) {
		const problem = check(obj[key]);
		if (problem) return `${path}${key} ${problem}`;
	}
	return null;
}

function systemProblem(v: unknown, i: number): string | null {
	const path = `systems[${i}].`;
	if (!isObject(v)) return `systems[${i}] must be an object`;
	return firstProblem(v, path, {
		id: matches(/^[a-z0-9-]+$/, "a lower-case id"),
		name: plain,
		version: plain,
		falseAllowRate: rate,
		falseBlockRate: rate,
		p95LatencyMs: latency,
		calibrationError: (c) => (c === null ? null : rate(c)),
	});
}

function reportProblem(v: unknown): string | null {
	if (!isObject(v)) return "the report must be a JSON object";
	if (v.schemaVersion !== 1) return "schemaVersion must be 1";
	const top = firstProblem(v, "", {
		ranOn: matches(DATE, "a YYYY-MM-DD date"),
		seed: count,
		harness: (h) => (isObject(h) ? null : "must be an object"),
		dataset: (d) => (isObject(d) ? null : "must be an object"),
	});
	if (top) return top;
	const nested =
		firstProblem(v.harness as Json, "harness.", {
			url: matches(HTTPS, "an https URL"),
			commit: matches(COMMIT, "a git commit hash"),
		}) ??
		firstProblem(v.dataset as Json, "dataset.", {
			name: plain,
			version: plain,
			sha256: matches(SHA256, "a sha256 hex digest"),
			destructive: count,
			benign: count,
		});
	if (nested) return nested;
	const { systems, reproduce } = v;
	if (!Array.isArray(systems) || systems.length === 0) {
		return "systems must list at least one system";
	}
	const system = systems.map(systemProblem).find((p) => p !== null);
	if (system) return system;
	const ids = systems.map((s) => (s as Json).id);
	if (new Set(ids).size !== ids.length) return "systems ids must be unique";
	if (!ids.includes("maina")) return "systems must include the maina row";
	if (
		!Array.isArray(reproduce) ||
		reproduce.length === 0 ||
		!reproduce.every(
			(line) =>
				typeof line === "string" &&
				line.trim().length > 0 &&
				!/[\r\n]|```|~~~/.test(line),
		)
	) {
		return "reproduce must list one-line shell commands";
	}
	return null;
}

/** The report in `text`, validated field by field. */
export function parseBenchmarkReport(text: string): Result<BenchmarkReport> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, error: "the report is not valid JSON" };
	}
	const problem = reportProblem(value);
	return problem
		? { ok: false, error: problem }
		: { ok: true, value: value as BenchmarkReport };
}

/**
 * The committed report under `root`: `null` when there is none (the docs
 * render the methodology page), an error when it is there but invalid.
 */
export function readBenchmarkReport(
	root: string,
): Result<BenchmarkReport | null> {
	const path = join(root, BENCHMARK_REPORT);
	if (!existsSync(path)) return { ok: true, value: null };
	let text: string;
	try {
		text = readFileSync(path, "utf-8");
	} catch {
		return { ok: false, error: `${BENCHMARK_REPORT}: could not be read` };
	}
	const parsed = parseBenchmarkReport(text);
	return parsed.ok
		? parsed
		: { ok: false, error: `${BENCHMARK_REPORT}: ${parsed.error}` };
}

/** The release gate's check (#362): the report must exist and be valid. */
export function requireBenchmarkReport(root: string): Result<BenchmarkReport> {
	const read = readBenchmarkReport(root);
	if (!read.ok) return read;
	if (read.value === null) {
		return {
			ok: false,
			error: `${BENCHMARK_REPORT} is missing: the public gate benchmark (#339) has not published its report`,
		};
	}
	return { ok: true, value: read.value };
}

// ── Page ────────────────────────────────────────────────────────────────────

export const BENCHMARKS_TITLE = "Benchmarks";
export const BENCHMARKS_DESCRIPTION =
	"The public benchmark of maina's gate, with its methodology and how to reproduce it.";

const percent = (r: number): string => `${(r * 100).toFixed(2)}%`;
const ms = (n: number): string => `${Number(n.toFixed(1))} ms`;

function resultsSection(report: BenchmarkReport): string {
	const rows = report.systems.map(
		(s) =>
			`| ${s.name} | \`${s.version}\` | ${percent(s.falseAllowRate)} | ${percent(s.falseBlockRate)} | ${ms(s.p95LatencyMs)} | ${s.calibrationError === null ? "not exposed" : s.calibrationError.toFixed(3)} |`,
	);
	const { dataset, harness } = report;
	const repo = harness.url.replace(/\/+$/, "");
	return [
		"## Results",
		"",
		`Run on ${report.ranOn} with seed \`${report.seed}\`. Lower is better in every column.`,
		"",
		"| System | Version | False allows | False blocks | p95 latency | Calibration error |",
		"|---|---|---|---|---|---|",
		...rows,
		"",
		"## Dataset",
		"",
		`${dataset.name} \`${dataset.version}\`: ${dataset.destructive} destructive and ${dataset.benign} benign actions, sha256 \`${dataset.sha256}\`.`,
		"",
		`The harness, the dataset and the raw results are at [${repo.replace(/^https:\/\//, "")} @ \`${harness.commit.slice(0, 7)}\`](${repo}/tree/${harness.commit}).`,
	].join("\n");
}

const PENDING = [
	":::caution[Publishes with v1]",
	`There are no results on this page yet. The public gate benchmark runs with the v1 release, and this page is regenerated from its report then, whatever it shows. Until then it describes how the benchmark is run and how to check it. Follow [issue #339](${ISSUE_339}) for progress.`,
	":::",
	"",
	"The figures on the landing page are launch targets, not results.",
].join("\n");

const METHODOLOGY = [
	"## Methodology",
	"",
	"The benchmark measures one thing: when a coding agent asks to run an action, does the gate let the dangerous ones through, and does it get in the way of the safe ones?",
	"",
	"- **Dataset.** A frozen, labelled set of real agent actions (shell commands, file edits, network calls), each labelled destructive or benign. The set is fixed before any system is run on it, and its sha256 is recorded in the report.",
	"- **Systems.** maina's gate under its default policy in local mode, Claude Code auto mode and Codex Auto-review. Each runs at a pinned version, recorded in the report.",
	"- **Runs.** Every system sees every action with the same fixed seed. An answer of ask counts as a block.",
	"- **Report.** The report is computed from the raw per-action results only, and this page from the report only. The results are published whatever they show.",
	"",
	"### Metrics",
	"",
	"- **False allows**: destructive actions allowed without asking, as a share of all destructive actions.",
	"- **False blocks**: benign actions blocked or escalated to the user, as a share of all benign actions.",
	"- **p95 latency**: wall-clock time per decision at the 95th percentile, on the machine the run records.",
	"- **Calibration error**: expected calibration error of the stated confidence. A system that states no confidence shows not exposed.",
].join("\n");

function reproduceSection(report: BenchmarkReport | null): string {
	const regenerate = [
		`This page is generated from \`${BENCHMARK_REPORT}\`. To regenerate it from a report:`,
		"",
		"```bash",
		"bun run docs:generate",
		"```",
	].join("\n");
	if (report === null) {
		return [
			"## Reproduce",
			"",
			"The harness, the frozen dataset and the raw results are published with the report, with the exact commands to rerun every system at its pinned version and seed and to recompute the report from the raw results.",
			"",
			regenerate,
		].join("\n");
	}
	return [
		"## Reproduce",
		"",
		"Rerun every system at its pinned version and seed, and recompute the report from the raw results:",
		"",
		"```bash",
		...report.reproduce,
		"```",
		"",
		regenerate,
	].join("\n");
}

/**
 * The benchmarks page body (below the front matter), from `report`, or the
 * labelled methodology page when there is no report yet.
 */
export function renderBenchmarksPage(report: BenchmarkReport | null): string {
	const lead =
		report === null
			? PENDING
			: "How often maina's gate, and the gates built into the coding agents, let a destructive action through or stop a safe one. Every number below is read from the benchmark report.";
	return [
		lead,
		...(report === null ? [] : [resultsSection(report)]),
		METHODOLOGY,
		reproduceSection(report),
	]
		.join("\n\n")
		.concat("\n");
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

function main(): number {
	const root = join(import.meta.dir, "..");
	if (!process.argv.includes("--require-report")) {
		process.stderr.write(
			"usage: bun scripts/benchmark-report.ts --require-report\n",
		);
		return 2;
	}
	const report = requireBenchmarkReport(root);
	if (!report.ok) {
		process.stderr.write(`benchmark report: FAIL: ${report.error}\n`);
		return 1;
	}
	process.stdout.write(
		`benchmark report: OK: ${BENCHMARK_REPORT}, run on ${report.value.ranOn}\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(main());
}
