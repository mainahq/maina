/**
 * The v1 release gate check (v1 task 12.1, spec §9, FR-DOG-6): every §9
 * item is read from its evidence, judged against its threshold and printed
 * with its evidence link. Anything missing or below threshold fails the
 * check and says exactly what is wrong.
 */

import { describe, expect, test } from "bun:test";
import {
	type ExecResult,
	evaluateGates,
	GATE_ITEMS,
	type GateContext,
	type GateInputs,
	renderReport,
	runGates,
} from "../v1-gates";

const NOW = new Date("2026-09-30T12:00:00Z"); // ISO week 2026-40

const CTX: GateContext = {
	now: NOW,
	marketplaces: ["claude", "cursor", "codex"],
	workers: ["claude", "codex"],
	escapeCases: 60,
	actionRiskBackend: "system1",
	runLink: "https://github.com/mainahq/maina/actions/runs/1",
};

const link = (name: string) => `https://example.test/evidence/${name}`;

/** Evidence that meets every threshold. */
const GOOD: Readonly<Record<string, unknown>> = {
	"e2e-matrix.json": { link: link("e2e"), runs: 1000, passed: 996 },
	"first-result.json": {
		link: link("first-result"),
		marketplaces: {
			claude: { seconds: 41 },
			cursor: { seconds: 55 },
			codex: { seconds: 60 },
		},
	},
	"uninstall.json": {
		link: link("uninstall"),
		marketplaces: {
			claude: { traces: [] },
			cursor: { traces: [] },
			codex: { traces: [] },
		},
	},
	"promotion-action-risk.json": {
		link: link("promotion"),
		type: "action.risk",
		metrics: {
			brier: { candidate: 0.08, heuristic: 0.12 },
			accuracy: { candidate: 0.93, heuristic: 0.88 },
			eceByLengthBucket: { short: 0.03, medium: 0.04, long: 0.05 },
			falseAllowDestructive: 0.004,
			decidedWithoutAsking: 0.74,
			orderFlips: 0.01,
			injectionFlipsToAllow: 0.005,
			modelLatencyP95Ms: 22,
			gateLatencyP95Ms: 41,
			shadowDecisionsWithOutcomes: 1200,
			reproducibility: 1,
		},
	},
	"benchmark.json": {
		link: link("benchmark"),
		methodology: link("methodology"),
		systems: ["maina", "claude-code-auto-mode", "codex-auto-review"],
		sets: ["overeager", "injection"],
	},
	"docs-build.json": { link: link("docs-build"), clean: true },
	"latency.json": {
		link: link("latency"),
		gateP95Ms: 12,
		decideP95Ms: 20,
		graphQueryP95Ms: 21,
		mcpColdStartMs: 900,
	},
	"dogfood-weeks.json": {
		link: link("dogfood"),
		weeks: [
			{ week: "2026-36", onV1Runtime: true, openP0: 0 },
			{ week: "2026-37", onV1Runtime: true, openP0: 0 },
			{ week: "2026-38", onV1Runtime: true, openP0: 0 },
			{ week: "2026-39", onV1Runtime: true, openP0: 0 },
		],
	},
	"receipted-merges.json": {
		link: link("receipts"),
		merges: 120,
		receipted: 120,
	},
	"escape-suite.json": {
		link: link("escape"),
		runs: [
			{ os: "macos", worker: "claude", cases: 60, blocked: 60 },
			{ os: "linux", worker: "claude", cases: 60, blocked: 60 },
			{ os: "macos", worker: "codex", cases: 60, blocked: 60 },
			{ os: "linux", worker: "codex", cases: 60, blocked: 60 },
		],
	},
	"harness-control.json": {
		link: link("harness"),
		unattendedNeverShips: true,
		boundedRevision: true,
	},
};

const OK: ExecResult = { code: 0, stdout: "OK\n", stderr: "" };

function inputs(
	overrides: Readonly<Record<string, unknown>> = {},
	exec: ExecResult = OK,
): GateInputs {
	const merged: Record<string, unknown> = { ...GOOD, ...overrides };
	const evidence = new Map<string, string | undefined>();
	for (const [file, value] of Object.entries(merged)) {
		evidence.set(
			file,
			value === undefined
				? undefined
				: typeof value === "string"
					? value
					: JSON.stringify(value),
		);
	}
	const commands = new Map<string, ExecResult>();
	for (const item of GATE_ITEMS) {
		if (item.source.kind === "command") commands.set(item.id, exec);
	}
	return { evidence, commands, ctx: CTX };
}

function result(report: ReturnType<typeof evaluateGates>, id: string) {
	const found = report.items.find((i) => i.id === id);
	expect(found).toBeDefined();
	return found as NonNullable<typeof found>;
}

/** One bad value per item, and the words its failure must use. */
const BELOW: ReadonlyArray<
	Readonly<{
		name: string;
		id: string;
		file: string;
		patch: (good: Record<string, unknown>) => unknown;
		says: RegExp;
	}>
> = [
	{
		name: "e2e pass rate under 99.5%",
		id: "e2e-matrix",
		file: "e2e-matrix.json",
		patch: (g) => ({ ...g, passed: 994 }),
		says: /99\.4%.*99\.5%/,
	},
	{
		name: "fewer than 1,000 e2e runs",
		id: "e2e-matrix",
		file: "e2e-matrix.json",
		patch: (g) => ({ ...g, runs: 999, passed: 999 }),
		says: /999 runs.*1,000/,
	},
	{
		name: "more passes than runs",
		id: "e2e-matrix",
		file: "e2e-matrix.json",
		patch: (g) => ({ ...g, runs: 1000, passed: 1200 }),
		says: /1,200 passed of 1,000 runs is not a valid count/,
	},
	{
		name: "a marketplace over 60 s",
		id: "first-result",
		file: "first-result.json",
		patch: (g) => ({
			...g,
			marketplaces: {
				...(g.marketplaces as object),
				cursor: { seconds: 61 },
			},
		}),
		says: /cursor.*61 s.*60 s/,
	},
	{
		name: "a marketplace with no measurement",
		id: "first-result",
		file: "first-result.json",
		patch: (g) => ({
			...g,
			marketplaces: { claude: { seconds: 10 }, cursor: { seconds: 10 } },
		}),
		says: /codex.*missing/,
	},
	{
		name: "uninstall leaving a trace",
		id: "uninstall",
		file: "uninstall.json",
		patch: (g) => ({
			...g,
			marketplaces: {
				...(g.marketplaces as object),
				codex: { traces: ["~/.codex/config.toml still names maina"] },
			},
		}),
		says: /codex.*config\.toml still names maina/,
	},
	{
		name: "calibration over 0.05 in one bucket",
		id: "promotion-action-risk",
		file: "promotion-action-risk.json",
		patch: (g) => ({
			...g,
			metrics: {
				...(g.metrics as object),
				eceByLengthBucket: { short: 0.03, long: 0.06 },
			},
		}),
		says: /ECE.*long.*0\.06.*0\.05/,
	},
	{
		name: "too few shadow decisions",
		id: "promotion-action-risk",
		file: "promotion-action-risk.json",
		patch: (g) => ({
			...g,
			metrics: { ...(g.metrics as object), shadowDecisionsWithOutcomes: 999 },
		}),
		says: /shadow.*999.*1,000/,
	},
	{
		name: "not beating the heuristic on Brier",
		id: "promotion-action-risk",
		file: "promotion-action-risk.json",
		patch: (g) => ({
			...g,
			metrics: {
				...(g.metrics as object),
				brier: { candidate: 0.12, heuristic: 0.12 },
			},
		}),
		says: /Brier/,
	},
	{
		name: "a benchmark without Codex Auto-review",
		id: "benchmark",
		file: "benchmark.json",
		patch: (g) => ({ ...g, systems: ["maina", "claude-code-auto-mode"] }),
		says: /codex-auto-review/,
	},
	{
		name: "a docs build that is not clean",
		id: "docs-build",
		file: "docs-build.json",
		patch: (g) => ({ ...g, clean: false }),
		says: /not clean/,
	},
	{
		name: "gate latency over 50 ms p95",
		id: "latency",
		file: "latency.json",
		patch: (g) => ({ ...g, gateP95Ms: 51 }),
		says: /gate.*51 ms.*50 ms/,
	},
	{
		name: "only three clean weeks",
		id: "dogfood-weeks",
		file: "dogfood-weeks.json",
		patch: (g) => ({ ...g, weeks: (g.weeks as unknown[]).slice(1) }),
		says: /3 consecutive clean weeks.*4/,
	},
	{
		name: "an open P0 in the last four weeks",
		id: "dogfood-weeks",
		file: "dogfood-weeks.json",
		patch: (g) => ({
			...g,
			weeks: [
				...(g.weeks as unknown[]).slice(0, 3),
				{ week: "2026-39", onV1Runtime: true, openP0: 1 },
			],
		}),
		says: /2026-39.*1 open P0/,
	},
	{
		name: "a dogfood record that stopped weeks ago",
		id: "dogfood-weeks",
		file: "dogfood-weeks.json",
		patch: (g) => ({
			...g,
			weeks: [
				{ week: "2026-30", onV1Runtime: true, openP0: 0 },
				{ week: "2026-31", onV1Runtime: true, openP0: 0 },
				{ week: "2026-32", onV1Runtime: true, openP0: 0 },
				{ week: "2026-33", onV1Runtime: true, openP0: 0 },
			],
		}),
		says: /2026-33.*stale/,
	},
	{
		name: "a week recorded twice",
		id: "dogfood-weeks",
		file: "dogfood-weeks.json",
		patch: (g) => ({
			...g,
			weeks: [
				...(g.weeks as unknown[]),
				{ week: "2026-39", onV1Runtime: true, openP0: 0 },
			],
		}),
		says: /2026-39.*recorded more than once/,
	},
	{
		name: "more receipted merges than merges",
		id: "receipted-merges",
		file: "receipted-merges.json",
		patch: (g) => ({ ...g, receipted: 121 }),
		says: /121 receipted of 120 merges is not a valid count/,
	},
	{
		name: "one unreceipted merge",
		id: "receipted-merges",
		file: "receipted-merges.json",
		patch: (g) => ({ ...g, receipted: 119 }),
		says: /119 of 120/,
	},
	{
		name: "an escape suite run missing for a worker on Linux",
		id: "escape-suite",
		file: "escape-suite.json",
		patch: (g) => ({
			...g,
			runs: (g.runs as { os: string; worker: string }[]).filter(
				(r) => !(r.os === "linux" && r.worker === "codex"),
			),
		}),
		says: /codex on linux.*missing/,
	},
	{
		name: "an escape suite case not blocked",
		id: "escape-suite",
		file: "escape-suite.json",
		patch: (g) => ({
			...g,
			runs: [
				...(g.runs as unknown[]).slice(1),
				{ os: "macos", worker: "claude", cases: 60, blocked: 59 },
			],
		}),
		says: /claude on macos.*59 of 60/,
	},
	{
		name: "a clean escape run hiding a failing rerun of the same worker and OS",
		id: "escape-suite",
		file: "escape-suite.json",
		patch: (g) => ({
			...g,
			runs: [
				...(g.runs as unknown[]),
				{ os: "linux", worker: "codex", cases: 60, blocked: 58 },
			],
		}),
		says: /codex on linux.*58 of 60/,
	},
	{
		name: "more escape cases blocked than run",
		id: "escape-suite",
		file: "escape-suite.json",
		patch: (g) => ({
			...g,
			runs: [
				...(g.runs as unknown[]).slice(1),
				{ os: "macos", worker: "claude", cases: 60, blocked: 61 },
			],
		}),
		says: /claude on macos.*61 of 60.*not a valid count/,
	},
	{
		name: "dogfood weeks recorded in the future",
		id: "dogfood-weeks",
		file: "dogfood-weeks.json",
		patch: (g) => ({
			...g,
			weeks: [
				{ week: "2026-50", onV1Runtime: true, openP0: 0 },
				{ week: "2026-51", onV1Runtime: true, openP0: 0 },
				{ week: "2026-52", onV1Runtime: true, openP0: 0 },
				{ week: "2026-53", onV1Runtime: true, openP0: 0 },
			],
		}),
		says: /2026-53.*future.*2026-40/,
	},
	{
		name: "a negative latency",
		id: "latency",
		file: "latency.json",
		patch: (g) => ({ ...g, gateP95Ms: -1 }),
		says: /gateP95Ms.*-1.*not a valid value/,
	},
	{
		name: "a negative false-allow rate",
		id: "promotion-action-risk",
		file: "promotion-action-risk.json",
		patch: (g) => ({
			...g,
			metrics: { ...(g.metrics as object), falseAllowDestructive: -0.1 },
		}),
		says: /falseAllowDestructive.*-0\.1.*not a valid value/,
	},
	{
		name: "a benchmark methodology that is not a public link",
		id: "benchmark",
		file: "benchmark.json",
		patch: (g) => ({ ...g, methodology: "see the team wiki" }),
		says: /methodology.*http/,
	},
	{
		name: "an unattended run that can ship",
		id: "harness-control",
		file: "harness-control.json",
		patch: (g) => ({ ...g, unattendedNeverShips: false }),
		says: /merge, release or publish/,
	},
];

describe("evaluateGates", () => {
	test("passes when every §9 item has evidence at or above its threshold", () => {
		const report = evaluateGates(inputs());
		expect(
			report.items.filter((i) => i.status !== "pass").map((i) => i.id),
		).toEqual([]);
		expect(report.ok).toBe(true);
	});

	test("covers every §9 item the plan lists", () => {
		expect(GATE_ITEMS.map((i) => i.id)).toEqual([
			"e2e-matrix",
			"first-result",
			"uninstall",
			"promotion-action-risk",
			"benchmark",
			"docs-generated",
			"docs-build",
			"latency",
			"dogfood-weeks",
			"receipted-merges",
			"escape-suite",
			"harness-control",
		]);
	});

	test("with no evidence at all, every file-backed item is missing and says where its evidence goes", () => {
		const empty = inputs(
			Object.fromEntries(Object.keys(GOOD).map((f) => [f, undefined])),
		);
		const report = evaluateGates(empty);
		expect(report.ok).toBe(false);
		for (const item of GATE_ITEMS) {
			if (item.source.kind !== "file") continue;
			const r = result(report, item.id);
			expect(r.status).toBe("missing");
			expect(r.link).toBeNull();
			expect(r.details.join("\n")).toContain(item.source.file);
		}
	});

	for (const c of BELOW) {
		test(`fails ${c.id}: ${c.name}`, () => {
			const good = GOOD[c.file] as Record<string, unknown>;
			const report = evaluateGates(inputs({ [c.file]: c.patch(good) }));
			expect(report.ok).toBe(false);
			const r = result(report, c.id);
			expect(r.status).toBe("fail");
			expect(r.details.join("\n")).toMatch(c.says);
			// Every other item still passes: a failure names only its own item.
			expect(
				report.items.filter((i) => i.status !== "pass").map((i) => i.id),
			).toEqual([c.id]);
		});
	}

	test("fails the promotion item while the policy default for action.risk is not system1", () => {
		const report = evaluateGates({
			...inputs(),
			ctx: { ...CTX, actionRiskBackend: "rules" },
		});
		const r = result(report, "promotion-action-risk");
		expect(r.status).toBe("fail");
		expect(r.details.join("\n")).toMatch(/action\.risk.*rules.*system1/);
	});

	test("with no promotion report, the missing item still names the unpromoted policy default", () => {
		const report = evaluateGates({
			...inputs({ "promotion-action-risk.json": undefined }),
			ctx: { ...CTX, actionRiskBackend: "rules" },
		});
		const r = result(report, "promotion-action-risk");
		expect(r.status).toBe("missing");
		expect(r.details.join("\n")).toMatch(/action\.risk.*rules.*system1/);
		expect(r.details.join("\n")).toContain("promotion-action-risk.json");
	});

	test("a missing metric fails its gate as missing, never as a pass", () => {
		const good = GOOD["promotion-action-risk.json"] as {
			metrics: Record<string, unknown>;
		};
		const { orderFlips: _dropped, ...metrics } = good.metrics;
		const report = evaluateGates(
			inputs({ "promotion-action-risk.json": { ...good, metrics } }),
		);
		const r = result(report, "promotion-action-risk");
		expect(r.status).toBe("fail");
		expect(r.details.join("\n")).toMatch(/orderFlips.*missing/);
	});

	test("evidence without an http(s) link fails", () => {
		const report = evaluateGates(
			inputs({ "e2e-matrix.json": { runs: 1000, passed: 1000 } }),
		);
		const r = result(report, "e2e-matrix");
		expect(r.status).toBe("fail");
		expect(r.details.join("\n")).toMatch(/link/);
	});

	test("unreadable evidence fails with the parse problem", () => {
		const report = evaluateGates(inputs({ "latency.json": "{not json" }));
		const r = result(report, "latency");
		expect(r.status).toBe("fail");
		expect(r.details.join("\n")).toMatch(/latency\.json.*JSON/);
	});

	test("the docs check runs live: a failing command fails the item with its output", () => {
		const report = evaluateGates(
			inputs(
				{},
				{ code: 1, stdout: "", stderr: "hand-typed count in index.mdx\n" },
			),
		);
		const r = result(report, "docs-generated");
		expect(r.status).toBe("fail");
		expect(r.details.join("\n")).toContain("hand-typed count in index.mdx");
		expect(r.link).toBe(CTX.runLink);
	});
});

describe("renderReport", () => {
	test("prints every item with its status, section and evidence link", () => {
		const report = evaluateGates(inputs({ "benchmark.json": undefined }));
		const text = renderReport(report);
		for (const item of report.items) {
			const block = text.split("\n\n").find((b) => b.includes(item.id));
			expect(block).toBeDefined();
			expect(block).toContain(item.section);
			if (item.link !== null) expect(block).toContain(item.link);
		}
		expect(text).toMatch(/PASS\s+§9\.1 e2e-matrix/);
		expect(text).toMatch(/MISSING\s+§9\.3 benchmark/);
		expect(text).toContain("evidence: none");
		expect(text).toMatch(/11 of 12 pass/);
		expect(text).toContain("NOT ready to release");
	});
});

describe("runGates", () => {
	test("reads each evidence file, runs each live check, and exits 1 on any failure", async () => {
		const read: string[] = [];
		const ran: string[][] = [];
		const out = await runGates({
			ctx: CTX,
			readEvidence: (file) => {
				read.push(file);
				return file === "e2e-matrix.json"
					? JSON.stringify(GOOD[file])
					: undefined;
			},
			exec: async (cmd) => {
				ran.push([...cmd]);
				return OK;
			},
		});
		expect(read.sort()).toEqual(Object.keys(GOOD).sort());
		expect(ran).toEqual([["bun", "run", "docs:check"]]);
		expect(out.exitCode).toBe(1);
		expect(out.text).toMatch(/PASS\s+§9\.1 e2e-matrix/);
		expect(out.text).toMatch(/MISSING\s+§9\.1 first-result/);
	});

	test("exits 0 only when every item passes", async () => {
		const out = await runGates({
			ctx: CTX,
			readEvidence: (file) => JSON.stringify(GOOD[file]),
			exec: async () => OK,
		});
		expect(out.exitCode).toBe(0);
		expect(out.text).toMatch(/12 of 12 pass/);
	});
});
