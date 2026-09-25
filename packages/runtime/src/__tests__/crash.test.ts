/**
 * Fail-closed hook client (FR-GATE-1, spec §6.1 rule 2).
 *
 * When the runtime cannot answer (not running and cannot be spawned, crashed
 * mid-request, timed out, or answered garbage) the hook client evaluates the
 * rules-only fallback in process and flags the result `degraded`. A degraded
 * result is never `allow`: an `allow` from the fallback is tightened to `ask`.
 */

import { afterEach, describe, expect, test } from "bun:test";
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
		if (result.degraded) expect(result.degradedCause).toBe("client_error");
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
		expect(await waitFor(() => !isAlive(first.value.pid), 3000)).toBe(true);

		const result = await client(
			t.endpoint,
			fixedGate("deny"),
			tracking,
		).evaluate(shellEvent, { timeoutMs: 8000 });
		expect(result).toMatchObject({ degraded: false, source: "runtime" });
		expect(pids).toHaveLength(2);
	}, 15_000);
});
