#!/usr/bin/env bun
/**
 * Code-graph latency bench (v1 task 5.5, FR-GRAPH-2, FR-GRAPH-4).
 *
 * Indexes the pinned ~100k-LOC repository (`scripts/fixtures/fetch-100k-repo.ts`)
 * into a fresh store, then measures, against that warm store:
 *
 * - initial index time: recorded, not budgeted;
 * - single-file update: an edit that adds an exported symbol to one file,
 *   then the edit undone, each brought up to date with `updateFiles`. The
 *   edited files are the ones most of the tree depends on (the worst case:
 *   every dependent is re-resolved) plus files spread across the tree.
 *   Budget: <= 500 ms at p95;
 * - warm queries: `search`, `impact` and `minimalContext`, each timed on its
 *   own after a warm-up. Budget: <= 200 ms p95 per query kind.
 *
 * Edits are made through an in-memory overlay on the filesystem port, so the
 * cached checkout is never modified. Prints a report and exits 1 when a
 * budget is breached (or the run fails), 0 otherwise.
 *
 *     bun packages/core/bench/graph.bench.ts [--repo <dir>] [--json <file>]
 *
 * Without `--repo`, the pinned repository is fetched into the bench cache
 * (see the fetch script for where).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { parseArgs } from "node:util";
import {
	defaultCacheRoot,
	ensurePinnedRepo,
	PINNED_REPO,
} from "../../../scripts/fixtures/fetch-100k-repo";
import { impact, minimalContext, search } from "../src/graph/query/index";
import {
	type GraphSnapshot,
	type GraphStorePorts,
	indexRepo,
	readGraph,
	updateFiles,
} from "../src/graph/store/index";
import { openCodeGraph, systemFs } from "../src/graph/system";
import type { FsPort } from "../src/ports/index";
import {
	type BenchReport,
	checkBudgets,
	GRAPH_BUDGETS,
	type QueryKind,
	type Summary,
	summarize,
} from "./graph-budget";

const HUB_FILES = 4;
const SPREAD_FILES = 8;
const WARMUP = 3;
const QUERY_ITERATIONS = 40;
const CONTEXT_BUDGET_TOKENS = 8000;

const SEARCH_QUERIES = [
	"safeParse",
	"ZodType",
	"parse",
	"string min",
	"error map",
	"toJSONSchema",
];

function fail(message: string): never {
	process.stderr.write(`graph bench: ${message}\n`);
	process.exit(1);
}

const { values: args } = parseArgs({
	options: {
		repo: { type: "string" },
		json: { type: "string" },
	},
});

function resolveRepo(): string {
	if (args.repo !== undefined) return args.repo;
	const fetched = ensurePinnedRepo(defaultCacheRoot());
	if (!fetched.ok) fail(fetched.message);
	return fetched.dir;
}

const time = async (run: () => unknown): Promise<number> => {
	const t0 = performance.now();
	await run();
	return performance.now() - t0;
};

const root = resolveRepo();
const mainaDir = mkdtempSync(join(tmpdir(), "maina-graph-bench-"));
const opened = openCodeGraph(mainaDir);
if (!opened.ok) fail(`cannot open the store: ${opened.error.message}`);
const { ports: basePorts, close } = opened.value;

/** Absolute path -> edited content; everything else reads from disk. */
const overlay = new Map<string, string>();
const fs: FsPort = {
	...systemFs,
	readFile: async (path) => {
		const edited = overlay.get(path);
		return edited === undefined
			? systemFs.readFile(path)
			: { ok: true, value: edited };
	},
	exists: async (path) => overlay.has(path) || systemFs.exists(path),
};
const ports: GraphStorePorts = { ...basePorts, fs };

const indexStart = performance.now();
const indexed = await indexRepo(ports, root);
const initialIndexMs = performance.now() - indexStart;
if (!indexed.ok) fail(`index failed: ${JSON.stringify(indexed.error)}`);

const read = readGraph(ports.db);
if (!read.ok) fail(`read failed: ${JSON.stringify(read.error)}`);
const graph = read.value;
const files = graph.files.map((f) => f.path);

let loc = 0;
for (const path of files) {
	const content = await systemFs.readFile(posix.join(root, path));
	if (content.ok) loc += content.value.split("\n").length;
}

/** Files other files point edges at, most-depended-on first. */
function hubFiles(snapshot: GraphSnapshot): readonly string[] {
	const pathOf = new Map(snapshot.nodes.map((n) => [n.id, n.path]));
	const dependents = new Map<string, Set<string>>();
	for (const edge of snapshot.edges) {
		const target = pathOf.get(edge.dst);
		if (target === undefined || target === edge.path) continue;
		const set = dependents.get(target) ?? new Set<string>();
		set.add(edge.path);
		dependents.set(target, set);
	}
	return [...dependents.entries()]
		.sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))
		.map(([path]) => path);
}

const hubs = hubFiles(graph).slice(0, HUB_FILES);
const spread = Array.from(
	{ length: SPREAD_FILES },
	(_, i) => files[Math.floor(((i + 0.5) * files.length) / SPREAD_FILES)],
).filter((p): p is string => p !== undefined && !hubs.includes(p));
const edited = [...hubs, ...spread];

const updateSamples: number[] = [];
for (const [i, path] of edited.entries()) {
	const absolute = posix.join(root, path);
	const original = await systemFs.readFile(absolute);
	if (!original.ok) fail(`cannot read ${path}`);
	overlay.set(
		absolute,
		`${original.value}\nexport function mainaBenchEdit${i}(): number {\n\treturn ${i};\n}\n`,
	);
	let result: Awaited<ReturnType<typeof updateFiles>> | undefined;
	updateSamples.push(
		await time(async () => {
			result = await updateFiles(ports, root, [path]);
		}),
	);
	if (!result?.ok || result.value.parsed.length !== 1) {
		fail(`edit of ${path} was not applied: ${JSON.stringify(result)}`);
	}
	overlay.delete(absolute);
	updateSamples.push(await time(() => updateFiles(ports, root, [path])));
}

const readPorts = { db: ports.db };
const contextPorts = { db: ports.db, fs: ports.fs };
const hubOr = (i: number): string => hubs[i % hubs.length] ?? files[0] ?? "";

const QUERIES: Readonly<Record<QueryKind, (i: number) => unknown>> = {
	search: (i) => {
		const r = search(
			readPorts,
			SEARCH_QUERIES[i % SEARCH_QUERIES.length] ?? "",
		);
		if (!r.ok) fail(`search failed: ${JSON.stringify(r.error)}`);
	},
	impact: (i) => {
		const r = impact(readPorts, { files: [hubOr(i)] });
		if (!r.ok) fail(`impact failed: ${JSON.stringify(r.error)}`);
	},
	minimalContext: async (i) => {
		const request =
			i % 2 === 0
				? { query: SEARCH_QUERIES[i % SEARCH_QUERIES.length] ?? "" }
				: { files: [hubOr(i)] };
		const r = await minimalContext(contextPorts, root, {
			...request,
			budgetTokens: CONTEXT_BUDGET_TOKENS,
		});
		if (!r.ok) fail(`minimalContext failed: ${JSON.stringify(r.error)}`);
	},
};

const queries = {} as Record<QueryKind, Summary>;
for (const kind of Object.keys(QUERIES) as QueryKind[]) {
	const run = QUERIES[kind];
	for (let i = 0; i < WARMUP; i++) await run(i);
	const samples: number[] = [];
	for (let i = 0; i < QUERY_ITERATIONS; i++) {
		samples.push(await time(() => run(i)));
	}
	queries[kind] = summarize(samples);
}

close();
rmSync(mainaDir, { recursive: true, force: true });

const report: BenchReport = {
	repo: `${PINNED_REPO.name}@${PINNED_REPO.commit.slice(0, 7)}`,
	files: files.length,
	loc,
	nodes: graph.nodes.length,
	edges: graph.edges.length,
	initialIndexMs,
	update: summarize(updateSamples),
	queries,
};

const ms = (n: number): string => `${n.toFixed(1)} ms`;
const line = (label: string, s: Summary, budget: number): string =>
	`  ${label.padEnd(22)} p50 ${ms(s.p50).padStart(10)}  p95 ${ms(s.p95).padStart(10)}  max ${ms(s.max).padStart(10)}  (budget p95 ${budget} ms, n=${s.count})\n`;

process.stdout.write(
	`graph bench on ${report.repo}: ${report.files} files, ${report.loc} lines, ${report.nodes} nodes, ${report.edges} edges\n` +
		`  initial index          ${ms(report.initialIndexMs)} (recorded, no budget)\n` +
		line("single-file update", report.update, GRAPH_BUDGETS.updateMs) +
		(Object.keys(queries) as QueryKind[])
			.map((k) => line(`query ${k}`, queries[k], GRAPH_BUDGETS.queryP95Ms))
			.join("") +
		`  edited: ${edited.join(", ")}\n`,
);

if (args.json !== undefined) {
	writeFileSync(args.json, `${JSON.stringify(report, null, "\t")}\n`);
}

const breaches = checkBudgets(report);
for (const b of breaches) {
	process.stdout.write(
		`BUDGET BREACH: ${b.metric} ${ms(b.actualMs)} > ${b.budgetMs} ms\n`,
	);
}
process.exit(breaches.length === 0 ? 0 : 1);
