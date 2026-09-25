/**
 * Graph hooks (FR-GRAPH-2): the runtime keeps each repository's code graph
 * current from host events. `session.start` brings the whole root up to date
 * (incremental by content hash) and an `action.post` file edit updates just
 * the edited paths. Syncs for one root are single flight: events that arrive
 * while one runs are coalesced into the next.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeGraph, readCodeGraph } from "@mainahq/core";
import type { GateEvent } from "../gate";
import {
	createGraphSync,
	type GraphSyncPorts,
	type GraphSyncResult,
	graphTrigger,
	systemGraphSyncPorts,
} from "../graph-hooks";
import { createRequest, sendRequest } from "../ipc";
import { type Runtime, startRuntime } from "../server";
import { fixedGate, type TempEndpoint, tempEndpoint, waitFor } from "./support";

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const session = (cwd: string): GateEvent => ({
	kind: "session.start",
	input: {},
	cwd,
});

const edit = (cwd: string, path: string): GateEvent => ({
	kind: "action.post",
	input: { action: { kind: "file.write", path } },
	cwd,
});

describe("graphTrigger", () => {
	test("session.start syncs the event's root", () => {
		expect(graphTrigger(session("/repo"))).toEqual({
			kind: "session",
			dir: "/repo",
		});
	});

	test("the event's root wins over its cwd", () => {
		expect(
			graphTrigger({
				kind: "session.start",
				input: { root: "/repo" },
				cwd: "/repo/sub",
			}),
		).toEqual({ kind: "session", dir: "/repo" });
	});

	test("an action.post file edit updates the edited paths, made absolute", () => {
		expect(graphTrigger(edit("/repo", "src/a.ts"))).toEqual({
			kind: "edit",
			dir: "/repo",
			paths: ["/repo/src/a.ts"],
		});
		expect(
			graphTrigger({
				kind: "action.post",
				input: {
					action: { kind: "file.edit", paths: ["/repo/b.ts", "c.ts"] },
				},
				cwd: "/repo",
			}),
		).toEqual({
			kind: "edit",
			dir: "/repo",
			paths: ["/repo/b.ts", "/repo/c.ts"],
		});
	});

	test("anything else moves nothing", () => {
		const none: GateEvent[] = [
			{ kind: "action.post", input: { action: { kind: "shell" } }, cwd: "/r" },
			{
				kind: "action.pre",
				input: { action: { kind: "file.write", path: "a.ts" } },
				cwd: "/r",
			},
			{ kind: "action.post", input: { action: { kind: "file.write" } } },
			{ kind: "session.start", input: {} },
			{ kind: "shell", input: { command: "ls" }, cwd: "/r" },
		];
		for (const event of none) expect(graphTrigger(event)).toBeNull();
	});
});

type Call = Readonly<{ root: string; op: "all" | readonly string[] }>;

const synced: GraphSyncResult = { ok: true, value: undefined };

/** Lets resolved root lookups reach the queue. */
const flush = () => Bun.sleep(0);

/** Ports whose syncs finish only when the test releases them. */
function gatedPorts(
	rootOf: (dir: string) => Promise<string | null> = async (d) => d,
) {
	const calls: Call[] = [];
	const releases: (() => void)[] = [];
	let running = 0;
	let maxRunning = 0;
	const run = (call: Call) => {
		calls.push(call);
		running++;
		maxRunning = Math.max(maxRunning, running);
		return new Promise<GraphSyncResult>((resolve) => {
			releases.push(() => {
				running--;
				resolve(synced);
			});
		});
	};
	const ports: GraphSyncPorts = {
		rootOf,
		syncAll: (root) => run({ root, op: "all" }),
		syncPaths: (root, paths) => run({ root, op: [...paths].sort() }),
	};
	return {
		ports,
		calls,
		maxRunning: () => maxRunning,
		/** Finishes the oldest running sync and lets queued work start. */
		releaseNext: async () => {
			releases.shift()?.();
			await flush();
		},
	};
}

describe("createGraphSync", () => {
	test("edits during a running sync are coalesced into one follow-up", async () => {
		const gated = gatedPorts();
		const sync = createGraphSync(gated.ports);

		const first = sync.observe(edit("/repo", "a.ts"));
		await flush();
		const second = sync.observe(edit("/repo", "b.ts"));
		const third = sync.observe(edit("/repo", "c.ts"));
		await flush();
		expect(gated.calls).toEqual([{ root: "/repo", op: ["/repo/a.ts"] }]);

		await gated.releaseNext();
		await first;
		expect(gated.calls).toEqual([
			{ root: "/repo", op: ["/repo/a.ts"] },
			{ root: "/repo", op: ["/repo/b.ts", "/repo/c.ts"] },
		]);
		await gated.releaseNext();
		await Promise.all([second, third]);
		expect(gated.maxRunning()).toBe(1);
	});

	test("a pending session sync subsumes pending edits", async () => {
		const gated = gatedPorts();
		const sync = createGraphSync(gated.ports);

		void sync.observe(edit("/repo", "a.ts"));
		await flush();
		const queuedEdit = sync.observe(edit("/repo", "b.ts"));
		const queuedSession = sync.observe(session("/repo"));
		await flush();
		await gated.releaseNext();
		expect(gated.calls.at(-1)).toEqual({ root: "/repo", op: "all" });
		await gated.releaseNext();
		await Promise.all([queuedEdit, queuedSession]);
		expect(gated.calls).toHaveLength(2);
	});

	test("different roots sync independently", async () => {
		const gated = gatedPorts();
		const sync = createGraphSync(gated.ports);

		void sync.observe(edit("/one", "a.ts"));
		void sync.observe(edit("/two", "a.ts"));
		await flush();
		expect(gated.calls.map((c) => c.root)).toEqual(["/one", "/two"]);
		expect(gated.maxRunning()).toBe(2);
		await gated.releaseNext();
		await gated.releaseNext();
	});

	test("the root is looked up off the caller's turn, so observe returns at once", async () => {
		const lookup = Promise.withResolvers<string | null>();
		const gated = gatedPorts(() => lookup.promise);
		const sync = createGraphSync(gated.ports);

		const work = sync.observe(edit("/repo", "a.ts"));
		expect(work).toBeInstanceOf(Promise);
		await flush();
		expect(gated.calls).toEqual([]);

		lookup.resolve("/repo");
		await flush();
		expect(gated.calls).toEqual([{ root: "/repo", op: ["/repo/a.ts"] }]);
		await gated.releaseNext();
		await work;
	});

	test("events outside a repository, or that move nothing, start nothing", async () => {
		const gated = gatedPorts(async () => null);
		const sync = createGraphSync(gated.ports);
		await sync.observe(session("/tmp/nowhere"));
		expect(
			createGraphSync(gatedPorts().ports).observe({
				kind: "shell",
				input: {},
				cwd: "/repo",
			}),
		).toBeNull();
		expect(gated.calls).toEqual([]);
	});

	test("a failed sync is reported, never rejects and does not wedge the root", async () => {
		const seen: string[] = [];
		const errors: unknown[] = [];
		const failure: GraphSyncResult = {
			ok: false,
			error: { kind: "open_failed", path: "/repo/.maina", message: "full" },
		};
		const sync = createGraphSync(
			{
				rootOf: async (d) => d,
				syncAll: async () => {
					seen.push("all");
					return failure;
				},
				syncPaths: async (_root, paths) => {
					seen.push(...paths);
					return synced;
				},
			},
			{ onError: (_root, error) => errors.push(error) },
		);
		await sync.observe(session("/repo"));
		await sync.observe(edit("/repo", "a.ts"));
		expect(seen).toEqual(["all", "/repo/a.ts"]);
		expect(errors).toEqual([failure.ok ? null : failure.error]);
	});

	test("a port that throws or rejects is reported and never rejects", async () => {
		const errors: unknown[] = [];
		const sync = createGraphSync(
			{
				rootOf: (d) => {
					if (d === "/bad-root") throw new Error("probe crashed");
					return Promise.resolve(d);
				},
				syncAll: () => Promise.reject(new Error("disk on fire")),
				syncPaths: async () => synced,
			},
			{ onError: (_root, error) => errors.push(error) },
		);
		await sync.observe(session("/bad-root"));
		await sync.observe(session("/repo"));
		await sync.observe(edit("/repo", "a.ts"));
		expect(errors).toHaveLength(2);
	});
});

describe("createGraphSync conflict retries", () => {
	const conflict: GraphSyncResult = {
		ok: false,
		error: { kind: "conflict", attempts: 3 },
	};

	/** Ports that answer each sync with the next scripted result. */
	function scriptedPorts(results: GraphSyncResult[]) {
		const calls: Call[] = [];
		const next = () => results.shift() ?? synced;
		const ports: GraphSyncPorts = {
			rootOf: async (d) => d,
			syncAll: async (root) => {
				calls.push({ root, op: "all" });
				return next();
			},
			syncPaths: async (root, paths) => {
				calls.push({ root, op: [...paths] });
				return next();
			},
		};
		return { ports, calls };
	}

	test("paths dropped by a conflict are synced again, and the event waits for the retry", async () => {
		const errors: unknown[] = [];
		const scripted = scriptedPorts([conflict]);
		const sync = createGraphSync(scripted.ports, {
			onError: (_root, error) => errors.push(error),
		});

		await sync.observe(edit("/repo", "a.ts"));

		expect(scripted.calls).toEqual([
			{ root: "/repo", op: ["/repo/a.ts"] },
			{ root: "/repo", op: ["/repo/a.ts"] },
		]);
		expect(errors).toEqual([]);
	});

	test("a conflicted session sync is retried as a full sync", async () => {
		const scripted = scriptedPorts([conflict]);
		const sync = createGraphSync(scripted.ports);
		await sync.observe(session("/repo"));
		expect(scripted.calls).toEqual([
			{ root: "/repo", op: "all" },
			{ root: "/repo", op: "all" },
		]);
	});

	test("the retry folds in edits that arrived while the conflicted sync ran", async () => {
		const gate = Promise.withResolvers<GraphSyncResult>();
		const calls: Call[] = [];
		const sync = createGraphSync({
			rootOf: async (d) => d,
			syncAll: async () => synced,
			syncPaths: (root, paths) => {
				calls.push({ root, op: [...paths] });
				return calls.length === 1 ? gate.promise : Promise.resolve(synced);
			},
		});

		const first = sync.observe(edit("/repo", "a.ts"));
		await flush();
		const second = sync.observe(edit("/repo", "b.ts"));
		await flush();
		gate.resolve(conflict);
		await Promise.all([first, second]);

		expect(calls).toEqual([
			{ root: "/repo", op: ["/repo/a.ts"] },
			{ root: "/repo", op: ["/repo/a.ts", "/repo/b.ts"] },
		]);
	});

	test("retries are bounded: a root that keeps conflicting is reported once and not wedged", async () => {
		const errors: unknown[] = [];
		const scripted = scriptedPorts([conflict, conflict, conflict, conflict]);
		const sync = createGraphSync(scripted.ports, {
			conflictRetries: 2,
			onError: (_root, error) => errors.push(error),
		});

		await sync.observe(edit("/repo", "a.ts"));
		// One attempt plus two retries, then the paths are given up on.
		expect(scripted.calls).toHaveLength(3);
		expect(errors).toEqual([conflict.ok ? null : conflict.error]);

		// The retry budget is per run of conflicts: the next event gets its own.
		await sync.observe(edit("/repo", "b.ts"));
		expect(scripted.calls.slice(3)).toEqual([
			{ root: "/repo", op: ["/repo/b.ts"] },
			{ root: "/repo", op: ["/repo/b.ts"] },
		]);
		expect(errors).toHaveLength(1);
	});

	test("an onError that throws does not wedge the root", async () => {
		const scripted = scriptedPorts([conflict]);
		const sync = createGraphSync(scripted.ports, {
			conflictRetries: 0,
			onError: () => {
				throw new Error("reporter crashed");
			},
		});
		await sync.observe(edit("/repo", "a.ts"));
		await sync.observe(edit("/repo", "b.ts"));
		expect(scripted.calls).toEqual([
			{ root: "/repo", op: ["/repo/a.ts"] },
			{ root: "/repo", op: ["/repo/b.ts"] },
		]);
	});

	test("a conflictRetries that is not a whole number >= 0 falls back to the default bound", async () => {
		for (const conflictRetries of [
			Number.POSITIVE_INFINITY,
			Number.NaN,
			-1,
			1.5,
		]) {
			const errors: unknown[] = [];
			const scripted = scriptedPorts(Array(10).fill(conflict));
			const sync = createGraphSync(scripted.ports, {
				conflictRetries,
				onError: (_root, error) => errors.push(error),
			});
			await sync.observe(edit("/repo", "a.ts"));
			// One attempt plus the default three retries, then reported.
			expect(scripted.calls).toHaveLength(4);
			expect(errors).toHaveLength(1);
		}
	});

	test("errors other than a conflict are not retried", async () => {
		const errors: unknown[] = [];
		const failure: GraphSyncResult = {
			ok: false,
			error: { kind: "db", message: "locked" },
		};
		const scripted = scriptedPorts([failure]);
		const sync = createGraphSync(scripted.ports, {
			onError: (_root, error) => errors.push(error),
		});
		await sync.observe(edit("/repo", "a.ts"));
		expect(scripted.calls).toHaveLength(1);
		expect(errors).toHaveLength(1);
	});
});

describe("runtime observe port", () => {
	test("an observer that throws, rejects or never settles leaves the gate's answer alone", async () => {
		const t = tempEndpoint();
		cleanups.push(t.cleanup);
		let calls = 0;
		const started = startRuntime(
			{
				gate: fixedGate("deny"),
				observe: () => {
					calls++;
					if (calls === 1) throw new Error("observer crashed");
					if (calls === 2) return Promise.reject(new Error("rejected"));
					return new Promise<void>(() => undefined);
				},
			},
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		cleanups.unshift(() => started.value.stop());

		for (let i = 0; i < 3; i++) {
			expect(await hook(started.value.address, session("/repo"))).toEqual({
				verdict: "deny",
				reason: "fixed deny",
				decisionIds: [],
				degraded: false,
			});
		}
		expect(calls).toBe(3);
	});

	test("pending observer work keeps the runtime from going idle until it settles", async () => {
		const t = tempEndpoint();
		cleanups.push(t.cleanup);
		const work = Promise.withResolvers<void>();
		const started = startRuntime(
			{ gate: fixedGate("allow"), observe: () => work.promise },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 100 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		cleanups.unshift(() => started.value.stop());

		await hook(started.value.address, session("/repo"));
		const early = await Promise.race([
			started.value.closed,
			Bun.sleep(300).then(() => "running" as const),
		]);
		expect(early).toBe("running");

		work.resolve();
		expect(await started.value.closed).toBe("idle");
	});
});

// ── Through the runtime, against a real repository and graph store ─────────

const fixtureGitEnv = (): Record<string, string> => {
	const env: Record<string, string> = { LC_ALL: "C" };
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !key.startsWith("GIT_") && key !== "LC_ALL") {
			env[key] = value;
		}
	}
	return env;
};

function tempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "maina-graph-hooks-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const proc = Bun.spawnSync(["git", "init", "-q"], {
		cwd: dir,
		env: fixtureGitEnv(),
	});
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
	mkdirSync(join(dir, ".maina"));
	mkdirSync(join(dir, "src"));
	writeFileSync(
		join(dir, "src", "math.ts"),
		"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n",
	);
	writeFileSync(
		join(dir, "src", "use.ts"),
		'import { add } from "./math";\n\nexport const three = add(1, 2);\n',
	);
	return dir;
}

function graphNames(root: string): readonly string[] {
	const opened = openCodeGraph(join(root, ".maina"));
	if (!opened.ok) return [];
	try {
		const graph = readCodeGraph(opened.value.ports.db);
		return graph.ok ? graph.value.nodes.map((n) => n.name) : [];
	} finally {
		opened.value.close();
	}
}

function runtimeWith(ports: GraphSyncPorts): { t: TempEndpoint; rt: Runtime } {
	const t = tempEndpoint();
	cleanups.push(t.cleanup);
	const sync = createGraphSync(ports);
	const started = startRuntime(
		{ gate: fixedGate("allow"), observe: sync.observe },
		{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
	);
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	cleanups.unshift(() => started.value.stop());
	return { t, rt: started.value };
}

async function hook(address: string, event: GateEvent) {
	const sent = await sendRequest(
		address,
		createRequest("hook.evaluate", event, "1.0.0"),
		2000,
	);
	if (!sent.ok || !sent.value.ok) throw new Error("hook.evaluate failed");
	return sent.value.result;
}

describe("runtime graph hooks", () => {
	test("session.start indexes the root and an edit event updates only that file", async () => {
		const root = tempRepo();
		const real = systemGraphSyncPorts();
		const calls: Call[] = [];
		const { rt } = runtimeWith({
			rootOf: real.rootOf,
			syncAll: (r) => {
				calls.push({ root: r, op: "all" });
				return real.syncAll(r);
			},
			syncPaths: (r, paths) => {
				calls.push({ root: r, op: [...paths] });
				return real.syncPaths(r, paths);
			},
		});

		// The gate still answers; the sync runs beside it.
		expect(await hook(rt.address, session(root))).toEqual({
			verdict: "allow",
			reason: "fixed allow",
			decisionIds: [],
			degraded: false,
		});
		expect(await waitFor(() => graphNames(root).includes("add"), 5000)).toBe(
			true,
		);

		writeFileSync(
			join(root, "src", "math.ts"),
			"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n\nexport function sub(a: number, b: number): number {\n\treturn a - b;\n}\n",
		);
		await hook(rt.address, edit(join(root, "src"), "math.ts"));
		expect(await waitFor(() => graphNames(root).includes("sub"), 5000)).toBe(
			true,
		);

		const realRoot = await real.rootOf(root);
		expect(calls).toEqual([
			{ root: realRoot ?? "", op: "all" },
			{ root: realRoot ?? "", op: [join(root, "src", "math.ts")] },
		]);
	}, 15_000);

	test("two concurrent edits to one root never run updateFiles at once, and both land", async () => {
		const root = tempRepo();
		const real = systemGraphSyncPorts();
		let running = 0;
		let maxRunning = 0;
		const syncs: (readonly string[])[] = [];
		const sync = createGraphSync({
			...real,
			syncPaths: async (r, paths) => {
				syncs.push([...paths]);
				running++;
				maxRunning = Math.max(maxRunning, running);
				try {
					return await real.syncPaths(r, paths);
				} finally {
					running--;
				}
			},
		});

		const edits = [
			sync.observe(edit(join(root, "src"), "math.ts")),
			sync.observe(edit(join(root, "src"), "use.ts")),
		];
		await Promise.all(edits);

		expect(maxRunning).toBe(1);
		expect(syncs.flat().sort()).toEqual([
			join(root, "src", "math.ts"),
			join(root, "src", "use.ts"),
		]);
		expect([...graphNames(root)].sort()).toEqual(["add", "math.ts", "use.ts"]);
	}, 15_000);

	test("a repository without .maina is never written to", async () => {
		const root = tempRepo();
		rmSync(join(root, ".maina"), { recursive: true, force: true });
		const { rt } = runtimeWith(systemGraphSyncPorts());
		await hook(rt.address, session(root));
		await Bun.sleep(100);
		expect(
			await Bun.file(join(root, ".maina", "graph", "index.db")).exists(),
		).toBe(false);
	});
});
