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

/** Ports whose syncs finish only when the test releases them. */
function gatedPorts(rootOf: (dir: string) => string | null = (d) => d) {
	const calls: Call[] = [];
	const releases: (() => void)[] = [];
	let running = 0;
	let maxRunning = 0;
	const run = (call: Call) => {
		calls.push(call);
		running++;
		maxRunning = Math.max(maxRunning, running);
		return new Promise<void>((resolve) => {
			releases.push(() => {
				running--;
				resolve();
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
			await Bun.sleep(0);
		},
	};
}

describe("createGraphSync", () => {
	test("edits during a running sync are coalesced into one follow-up", async () => {
		const gated = gatedPorts();
		const sync = createGraphSync(gated.ports);

		const first = sync.observe(edit("/repo", "a.ts"));
		const second = sync.observe(edit("/repo", "b.ts"));
		const third = sync.observe(edit("/repo", "c.ts"));
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
		const queuedEdit = sync.observe(edit("/repo", "b.ts"));
		const queuedSession = sync.observe(session("/repo"));
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
		expect(gated.calls.map((c) => c.root)).toEqual(["/one", "/two"]);
		expect(gated.maxRunning()).toBe(2);
		await gated.releaseNext();
		await gated.releaseNext();
	});

	test("events outside a repository, or that move nothing, start nothing", () => {
		const gated = gatedPorts(() => null);
		const sync = createGraphSync(gated.ports);
		expect(sync.observe(session("/tmp/nowhere"))).toBeNull();
		expect(
			createGraphSync(gatedPorts().ports).observe({
				kind: "shell",
				input: {},
				cwd: "/repo",
			}),
		).toBeNull();
		expect(gated.calls).toEqual([]);
	});

	test("a failing sync never rejects and does not wedge the root", async () => {
		const seen: string[] = [];
		const errors: unknown[] = [];
		const sync = createGraphSync(
			{
				rootOf: (d) => d,
				syncAll: async () => {
					seen.push("all");
					throw new Error("disk on fire");
				},
				syncPaths: async (_root, paths) => {
					seen.push(...paths);
				},
			},
			{ onError: (_root, error) => errors.push(error) },
		);
		await sync.observe(session("/repo"));
		await sync.observe(edit("/repo", "a.ts"));
		expect(seen).toEqual(["all", "/repo/a.ts"]);
		expect(errors).toHaveLength(1);
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

		const realRoot = real.rootOf(root);
		expect(calls).toEqual([
			{ root: realRoot ?? "", op: "all" },
			{ root: realRoot ?? "", op: [join(root, "src", "math.ts")] },
		]);
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
