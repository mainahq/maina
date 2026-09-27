/**
 * Fail-closed hook client (FR-GATE-1, spec §6.1 rule 2).
 *
 * When the runtime cannot answer (not running and cannot be spawned, crashed
 * mid-request, timed out, or answered garbage) the hook client evaluates the
 * rules-only fallback in process and flags the result `degraded`. A degraded
 * result is never `allow`: an `allow` from the fallback is tightened to `ask`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createHookClient } from "../client/hook-client";
import type { GateEvaluator } from "../gate";
import { createRequest, sendRequest } from "../ipc";
import { daemonSpawner, type SpawnRuntime } from "../lifecycle";
import type { Endpoint } from "../registry";
import { type Runtime, type RuntimePorts, startRuntime } from "../server";
import {
	fixedGate,
	isAlive,
	killQuietly,
	noSpawn,
	shellEvent,
	type TempEndpoint,
	tempEndpoint,
	waitFor,
} from "./support";

const VERSION = "1.0.0";

const temps: TempEndpoint[] = [];
const runtimes: Runtime[] = [];
const pids: number[] = [];
const listeners: { stop: (closeActive?: boolean) => void }[] = [];

afterEach(() => {
	for (const rt of runtimes.splice(0)) rt.stop();
	for (const l of listeners.splice(0)) l.stop(true);
	for (const pid of pids.splice(0)) killQuietly(pid);
	for (const t of temps.splice(0)) t.cleanup();
});

function temp(): TempEndpoint {
	const t = tempEndpoint(VERSION);
	temps.push(t);
	return t;
}

function client(
	endpoint: Endpoint,
	fallback: GateEvaluator,
	spawn: SpawnRuntime = noSpawn,
) {
	return createHookClient({ endpoint, version: VERSION, spawn, fallback });
}

function start(endpoint: Endpoint, ports: RuntimePorts): Runtime {
	const started = startRuntime(ports, {
		endpoint,
		version: VERSION,
		idleTtlMs: 60_000,
	});
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	runtimes.push(started.value);
	return started.value;
}

async function ready(address: string): Promise<boolean> {
	return waitFor(async () => {
		const sent = await sendRequest(
			address,
			createRequest("status", undefined, VERSION),
			500,
		);
		return sent.ok && sent.value.ok;
	}, 5000);
}

describe("no runtime and none can be spawned", () => {
	test("an allow from the rules-only fallback is tightened to ask", async () => {
		const t = temp();
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 500 },
		);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			source: "fallback",
			degradedCause: "spawn_failed",
		});
	});

	test("a deny from the rules-only fallback stays deny", async () => {
		const t = temp();
		const result = await client(t.endpoint, fixedGate("deny")).evaluate(
			shellEvent,
			{ timeoutMs: 500 },
		);
		expect(result).toMatchObject({ verdict: "deny", degraded: true });
	});

	test("a fallback that throws still yields ask, never allow", async () => {
		const t = temp();
		const throwing: GateEvaluator = () => {
			throw new Error("rules file unreadable");
		};
		const result = await client(t.endpoint, throwing).evaluate(shellEvent, {
			timeoutMs: 500,
		});
		expect(result).toMatchObject({ verdict: "ask", degraded: true });
	});

	test("a fallback returning an invalid verdict still yields ask", async () => {
		const t = temp();
		const bogus = (() => ({
			verdict: "yes",
			reason: "",
		})) as unknown as GateEvaluator;
		const result = await client(t.endpoint, bogus).evaluate(shellEvent, {
			timeoutMs: 500,
		});
		expect(result).toMatchObject({ verdict: "ask", degraded: true });
	});

	test("a spawn port that throws still yields a degraded ask, never a rejection", async () => {
		const t = temp();
		const throwing: SpawnRuntime = () => {
			throw new Error("spawn port blew up");
		};
		const result = await client(
			t.endpoint,
			fixedGate("allow"),
			throwing,
		).evaluate(shellEvent, { timeoutMs: 500 });
		expect(result.degraded).toBe(true);
		expect(result.verdict).toBe("ask");
		if (result.source === "fallback")
			expect(result.degradedCause).toBe("client_error");
	});

	test("a spawn that never comes up degrades within the time budget", async () => {
		const t = temp();
		const silent: SpawnRuntime = () => ({ ok: true, value: { pid: 0 } });
		const t0 = performance.now();
		const result = await client(
			t.endpoint,
			fixedGate("allow"),
			silent,
		).evaluate(shellEvent, { timeoutMs: 200 });
		expect(performance.now() - t0).toBeLessThan(500);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			degradedCause: "timeout",
		});
	});
});

describe("runtime failures", () => {
	test("a hung evaluator times out into a degraded result within budget", async () => {
		const t = temp();
		start(t.endpoint, { gate: () => new Promise(() => {}) });
		const t0 = performance.now();
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 150 },
		);
		expect(performance.now() - t0).toBeLessThan(450);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			degradedCause: "timeout",
		});
	});

	test("an evaluator that throws gives a degraded result", async () => {
		const t = temp();
		start(t.endpoint, {
			gate: () => {
				throw new Error("boom");
			},
		});
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 1000 },
		);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			degradedCause: "handler_failed",
		});
	});

	test("an evaluator returning an invalid verdict gives a degraded result", async () => {
		const t = temp();
		start(t.endpoint, {
			gate: (() => ({
				verdict: "maybe",
				reason: "?",
			})) as unknown as GateEvaluator,
		});
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 1000 },
		);
		expect(result).toMatchObject({ verdict: "ask", degraded: true });
	});

	test("a garbage response gives a degraded result", async () => {
		const t = temp();
		listeners.push(
			Bun.listen({
				unix: t.endpoint.address,
				socket: {
					data: (socket) => {
						socket.write("definitely not json\n");
					},
				},
			}),
		);
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 1000 },
		);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			degradedCause: "bad_response",
		});
	});

	test.each([
		["another runtime version", { runtimeVersion: "0.9.0", id: "same" }],
		["a null id", { runtimeVersion: VERSION, id: null }],
	] as const)("an allow answer carrying %s is never trusted", async (_name, shape) => {
		const t = temp();
		listeners.push(
			Bun.listen({
				unix: t.endpoint.address,
				socket: {
					data: (socket, chunk) => {
						const req = JSON.parse(new TextDecoder().decode(chunk));
						const id = shape.id === null ? null : req.id;
						socket.write(
							`${JSON.stringify({
								v: 1,
								id,
								runtimeVersion: shape.runtimeVersion,
								ok: true,
								result: { verdict: "allow", reason: "impostor" },
							})}\n`,
						);
					},
				},
			}),
		);
		const result = await client(t.endpoint, fixedGate("deny")).evaluate(
			shellEvent,
			{ timeoutMs: 1000 },
		);
		expect(result).toMatchObject({ verdict: "deny", degraded: true });
	});

	test("a socket dir that is not private is never trusted", async () => {
		if (process.platform === "win32") return;
		const t = temp();
		const real = join(t.dir, "real");
		mkdirSync(real, { mode: 0o700 });
		const link = join(t.dir, "link");
		symlinkSync(real, link);
		const endpoint = { ...t.endpoint, address: join(link, "rt.sock") };
		listeners.push(
			Bun.listen({
				unix: endpoint.address,
				socket: {
					data: (socket, chunk) => {
						const req = JSON.parse(new TextDecoder().decode(chunk));
						socket.write(
							`${JSON.stringify({
								v: 1,
								id: req.id,
								runtimeVersion: VERSION,
								ok: true,
								result: { verdict: "allow", reason: "impostor" },
							})}\n`,
						);
					},
				},
			}),
		);
		const result = await client(endpoint, fixedGate("deny")).evaluate(
			shellEvent,
			{ timeoutMs: 1000 },
		);
		expect(result).toMatchObject({
			verdict: "deny",
			degraded: true,
			degradedCause: "insecure_endpoint",
		});
	});

	test("a runtime that crashes mid-request gives a degraded result", async () => {
		const t = temp();
		const { address, pidFile, spawnLock } = t.endpoint;
		const proc = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "fixtures", "crashing-runtime.ts"),
				address,
				pidFile,
				spawnLock,
				VERSION,
			],
			{ stdio: ["ignore", "ignore", "ignore"] },
		);
		pids.push(proc.pid);
		expect(await ready(address)).toBe(true);
		const result = await client(t.endpoint, fixedGate("allow")).evaluate(
			shellEvent,
			{ timeoutMs: 2000 },
		);
		expect(await proc.exited).toBe(1);
		expect(result).toMatchObject({
			verdict: "ask",
			degraded: true,
			degradedCause: "closed",
		});
	}, 10_000);

	test("after a runtime is killed, the next call respawns it", async () => {
		const t = temp();
		const spawn = daemonSpawner({
			endpoint: t.endpoint,
			version: VERSION,
			idleTtlMs: 10_000,
		});
		const tracking: SpawnRuntime = () => {
			const spawned = spawn();
			if (spawned.ok) pids.push(spawned.value.pid);
			return spawned;
		};
		const first = tracking();
		if (!first.ok) throw new Error(first.error.message);
		expect(await ready(t.endpoint.address)).toBe(true);
		killQuietly(first.value.pid);
		// Gone means nothing accepts a connection any more: on Windows the
		// pipe outlives the pid for a moment, and a connection it takes then
		// just closes, a crash rather than a missing runtime.
		const gone = async () => {
			if (isAlive(first.value.pid)) return false;
			const sent = await sendRequest(
				t.endpoint.address,
				createRequest("status", undefined, VERSION),
				500,
			);
			return !sent.ok && sent.error.kind === "connect_failed";
		};
		expect(await waitFor(gone, 3000)).toBe(true);

		const result = await client(
			t.endpoint,
			fixedGate("deny"),
			tracking,
		).evaluate(shellEvent, { timeoutMs: 8000 });
		expect(result).toMatchObject({ source: "runtime" });
		expect(pids).toHaveLength(2);
	}, 15_000);
});

/**
 * A runtime that never answers must still leave the rules-only fallback
 * enough time to decide (#564): on a cold start the fallback loads the bash
 * grammar first, which takes far longer than a last-moment grace.
 */
describe("the fallback gets a real budget (#564)", () => {
	const silent: SpawnRuntime = () => ({ ok: true, value: { pid: 0 } });

	/** A deny that takes `loadMs` to load its rules the first time. */
	function coldFallback(loadMs: number): {
		fallback: GateEvaluator;
		warm: () => void;
		warmed: () => number;
	} {
		let loading: Promise<void> | null = null;
		let warms = 0;
		const load = () => {
			loading ??= Bun.sleep(loadMs);
			return loading;
		};
		return {
			fallback: async (event) => {
				await load();
				return fixedGate("deny")(event);
			},
			warm: () => {
				warms++;
				void load();
			},
			warmed: () => warms,
		};
	}

	function warmedClient(
		endpoint: Endpoint,
		spawn: SpawnRuntime,
		fallback: GateEvaluator,
		warmFallback: () => void,
	) {
		return createHookClient({
			endpoint,
			version: VERSION,
			spawn,
			fallback,
			warmFallback,
		});
	}

	test("a runtime that never comes up leaves the fallback time to decide", async () => {
		const t = temp();
		const cold = coldFallback(300);
		const t0 = performance.now();
		const result = await client(t.endpoint, cold.fallback, silent).evaluate(
			shellEvent,
			{ timeoutMs: 1500 },
		);
		expect(performance.now() - t0).toBeLessThan(1500 + 200);
		expect(result).toMatchObject({
			verdict: "deny",
			degraded: true,
			degradedCause: "timeout",
		});
	});

	test("a runtime that has to be started warms the fallback while it waits", async () => {
		const t = temp();
		const cold = coldFallback(800);
		const result = await warmedClient(
			t.endpoint,
			silent,
			cold.fallback,
			cold.warm,
		).evaluate(shellEvent, { timeoutMs: 1500 });
		expect(cold.warmed()).toBe(1);
		expect(result).toMatchObject({
			verdict: "deny",
			degraded: true,
			degradedCause: "timeout",
		});
	});

	test("a runtime that is slow to answer warms the fallback too", async () => {
		const t = temp();
		start(t.endpoint, { gate: () => new Promise(() => {}) });
		const cold = coldFallback(800);
		const result = await warmedClient(
			t.endpoint,
			noSpawn,
			cold.fallback,
			cold.warm,
		).evaluate(shellEvent, { timeoutMs: 2000 });
		expect(cold.warmed()).toBe(1);
		expect(result).toMatchObject({ verdict: "deny", degradedCause: "timeout" });
	});

	test("a runtime that answers at once never warms the fallback", async () => {
		const t = temp();
		start(t.endpoint, { gate: fixedGate("deny") });
		const cold = coldFallback(800);
		const result = await warmedClient(
			t.endpoint,
			noSpawn,
			cold.fallback,
			cold.warm,
		).evaluate(shellEvent, { timeoutMs: 2000 });
		expect(result).toMatchObject({ source: "runtime" });
		expect(cold.warmed()).toBe(0);
	});

	test("a warm-up that throws never breaks the gate", async () => {
		const t = temp();
		const result = await warmedClient(
			t.endpoint,
			silent,
			fixedGate("deny"),
			() => {
				throw new Error("grammar missing");
			},
		).evaluate(shellEvent, { timeoutMs: 300 });
		expect(result).toMatchObject({ verdict: "deny", degraded: true });
	});
});
