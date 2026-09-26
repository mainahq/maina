/**
 * The benchmark page (#361, FR-DOC-5).
 *
 * `/benchmarks/` is generated from the public gate benchmark's report and
 * from nothing else: every number on it is read from the report. Until the
 * report exists (#339) the page is a clearly labelled "publishes with v1"
 * methodology page with no results. The v1 release gate (#362) is what
 * requires the report: `requireBenchmarkReport` fails without it, so the
 * docs build does not have to.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	BENCHMARK_REPORT,
	type BenchmarkReport,
	parseBenchmarkReport,
	readBenchmarkReport,
	renderBenchmarksPage,
	requireBenchmarkReport,
} from "../benchmark-report";
import { GENERATED_DOCS, generateDocs } from "../docs-manifest";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PAGE = "packages/docs/src/content/docs/benchmarks.mdx";

const MAINA = {
	id: "maina",
	name: "maina",
	version: "1.0.0",
	falseAllowRate: 0.0049,
	falseBlockRate: 0.0312,
	p95LatencyMs: 38.4,
	calibrationError: 0.041,
} as const;

const REPORT: BenchmarkReport = {
	schemaVersion: 1,
	ranOn: "2026-11-02",
	harness: {
		url: "https://github.com/mainahq/gate-bench",
		commit: "0a1b2c3d4e5f",
	},
	dataset: {
		name: "gate-bench frozen set",
		version: "1.0.0",
		sha256: "a".repeat(64),
		destructive: 412,
		benign: 1588,
	},
	seed: 20261102,
	systems: [
		MAINA,
		{
			id: "claude-code-auto-mode",
			name: "Claude Code auto mode",
			version: "2.3.1",
			falseAllowRate: 0.0218,
			falseBlockRate: 0.0105,
			p95LatencyMs: 1830,
			calibrationError: null,
		},
	],
	reproduce: [
		"git clone https://github.com/mainahq/gate-bench",
		"cd gate-bench && bun install",
		"bun run bench --seed 20261102",
	],
};

const json = (value: unknown): string => JSON.stringify(value, null, 2);

describe("parseBenchmarkReport", () => {
	test("accepts a well-formed report", () => {
		const parsed = parseBenchmarkReport(json(REPORT));
		expect(parsed).toEqual({ ok: true, value: REPORT });
	});

	test.each([
		["not JSON", "{"],
		["a newer schema", json({ ...REPORT, schemaVersion: 2 })],
		["no systems", json({ ...REPORT, systems: [] })],
		["no maina row", json({ ...REPORT, systems: REPORT.systems.slice(1) })],
		[
			"a rate above 1",
			json({
				...REPORT,
				systems: [{ ...MAINA, falseAllowRate: 1.2 }],
			}),
		],
		[
			"a negative latency",
			json({
				...REPORT,
				systems: [{ ...MAINA, p95LatencyMs: -1 }],
			}),
		],
		[
			"a duplicate system id",
			json({
				...REPORT,
				systems: [MAINA, MAINA],
			}),
		],
		[
			"markup in a name",
			json({
				...REPORT,
				systems: [{ ...MAINA, name: "<script>" }],
			}),
		],
		[
			"a timestamp for the run date",
			json({ ...REPORT, ranOn: "2026-11-02T10:00:00Z" }),
		],
		[
			"a short dataset hash",
			json({ ...REPORT, dataset: { ...REPORT.dataset, sha256: "abc" } }),
		],
		[
			"a fractional case count",
			json({ ...REPORT, dataset: { ...REPORT.dataset, benign: 1.5 } }),
		],
		["no reproduce steps", json({ ...REPORT, reproduce: [] })],
		[
			"a code fence in a reproduce step",
			json({ ...REPORT, reproduce: ["```"] }),
		],
		[
			"an underscore-emphasis name",
			json({ ...REPORT, systems: [{ ...MAINA, name: "_maina_" }] }),
		],
		[
			"an HTML entity in a name",
			json({ ...REPORT, systems: [{ ...MAINA, name: "a &lt; b" }] }),
		],
		[
			"a dataset name that renders as a heading",
			json({ ...REPORT, dataset: { ...REPORT.dataset, name: "# Big" } }),
		],
		[
			"a dataset name that renders as a list item",
			json({ ...REPORT, dataset: { ...REPORT.dataset, name: "- item" } }),
		],
		[
			"no destructive cases",
			json({ ...REPORT, dataset: { ...REPORT.dataset, destructive: 0 } }),
		],
		[
			"no benign cases",
			json({ ...REPORT, dataset: { ...REPORT.dataset, benign: 0 } }),
		],
		[
			"a harness that is not https",
			json({ ...REPORT, harness: { ...REPORT.harness, url: "http://x.y" } }),
		],
	])("rejects %s", (_label, text) => {
		const parsed = parseBenchmarkReport(text);
		expect(parsed.ok).toBe(false);
	});
});

describe("renderBenchmarksPage without a report", () => {
	const page = renderBenchmarksPage(null);

	test("is labelled as publishing with v1, and shows no results", () => {
		expect(page).toContain(":::caution[Publishes with v1]");
		expect(page).not.toMatch(/^\|/m);
		expect(page).not.toMatch(/\d+(\.\d+)?\s?%/);
		expect(page).toContain("https://github.com/mainahq/maina/issues/339");
	});

	test("still documents the methodology and how to reproduce", () => {
		expect(page).toContain("## Methodology");
		expect(page).toContain("## Reproduce");
		expect(page).toContain("False allows");
		expect(page).toContain("False blocks");
		expect(page).toContain(BENCHMARK_REPORT);
		expect(page).toContain("bun run docs:generate");
	});
});

describe("renderBenchmarksPage with a report", () => {
	const page = renderBenchmarksPage(REPORT);

	test("is not labelled as a placeholder", () => {
		expect(page).not.toContain("Publishes with v1");
	});

	test("renders one results row per system, numbers from the report", () => {
		expect(page).toContain(
			"| maina | `1.0.0` | 0.49% | 3.12% | 38.4 ms | 0.041 |",
		);
		expect(page).toContain(
			"| Claude Code auto mode | `2.3.1` | 2.18% | 1.05% | 1830 ms | not exposed |",
		);
	});

	test("records the dataset, seed, harness and run date", () => {
		expect(page).toContain(REPORT.dataset.sha256);
		expect(page).toContain("20261102");
		expect(page).toContain("412 destructive");
		expect(page).toContain("1588 benign");
		expect(page).toContain(
			"https://github.com/mainahq/gate-bench/tree/0a1b2c3d4e5f",
		);
		expect(page).toContain("2026-11-02");
	});

	test("shows the harness link text as code, so URL characters stay literal", () => {
		const underscored = renderBenchmarksPage({
			...REPORT,
			harness: { ...REPORT.harness, url: "https://github.com/a_b/_gate_" },
		});
		expect(underscored).toContain(
			"[`github.com/a_b/_gate_ @ 0a1b2c3`](https://github.com/a_b/_gate_/tree/0a1b2c3d4e5f)",
		);
	});

	test("lists the report's reproduce steps in a shell block", () => {
		const block = page.slice(page.indexOf("## Reproduce"));
		expect(block).toContain(["```bash", ...REPORT.reproduce, "```"].join("\n"));
	});

	test("changes when the report changes: nothing is hand-written", () => {
		const other = renderBenchmarksPage({
			...REPORT,
			systems: [{ ...MAINA, falseAllowRate: 0.001 }],
		});
		expect(other).toContain("| maina | `1.0.0` | 0.10% |");
		expect(other).not.toContain("0.49%");
	});
});

describe("reading the report", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-bench-361-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const write = (text: string): void => {
		const path = join(root, BENCHMARK_REPORT);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	};

	test("no report is not an error for the docs", () => {
		expect(readBenchmarkReport(root)).toEqual({ ok: true, value: null });
	});

	test("a valid report is read", () => {
		write(json(REPORT));
		expect(readBenchmarkReport(root)).toEqual({ ok: true, value: REPORT });
	});

	test("an invalid report is an error, never a silent placeholder", () => {
		write(json({ ...REPORT, seed: "x" }));
		const read = readBenchmarkReport(root);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error).toContain(BENCHMARK_REPORT);
	});

	test("the release gate requires the report", () => {
		const missing = requireBenchmarkReport(root);
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.error).toContain(BENCHMARK_REPORT);
			expect(missing.error).toContain("#339");
		}
		write(json(REPORT));
		expect(requireBenchmarkReport(root)).toEqual({ ok: true, value: REPORT });
	});
});

describe("the generated page", () => {
	test("is one of the docs generator's files", () => {
		expect(GENERATED_DOCS).toContain(PAGE);
	});

	test("is rendered from the committed report, or its absence", () => {
		const read = readBenchmarkReport(REPO_ROOT);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const page = generateDocs(REPO_ROOT).get(PAGE) ?? "";
		expect(page).toStartWith('---\ntitle: "Benchmarks"');
		expect(page).toEndWith(renderBenchmarksPage(read.value));
	});
});

describe("the release-gate entrypoint", () => {
	const SCRIPT = join(REPO_ROOT, "scripts", "benchmark-report.ts");
	const run = (...args: string[]) =>
		Bun.spawnSync(["bun", SCRIPT, ...args], { cwd: REPO_ROOT });

	test("--require-report exits 0 only when the committed report is valid", () => {
		const expected = requireBenchmarkReport(REPO_ROOT).ok ? 0 : 1;
		const result = run("--require-report");
		expect(result.exitCode).toBe(expected);
		if (expected === 1) {
			expect(result.stderr.toString()).toContain("benchmark report: FAIL");
		}
	});

	test("without the flag it prints usage and exits 2", () => {
		const result = run();
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain("--require-report");
	});
});
