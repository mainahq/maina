/**
 * Runtime lifecycle (FR-GATE-1, FR-S1-5).
 *
 * One runtime per user per version: the endpoint (socket, pid file, spawn
 * lock) is keyed by both. The hook client spawns the runtime on demand behind
 * a single-flight lock, a client of another version restarts it, and an idle
 * runtime exits after a configurable TTL. Spawn tests run the real daemon
 * entry in a child process.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHookClient } from "../client/hook-client";
import { createRequest, sendRequest } from "../ipc";
import { daemonCommand, daemonSpawner, type SpawnRuntime } from "../lifecycle";
import {
	defaultRuntimeDir,
	ensureEndpointDirs,
	resolveEndpoint,
} from "../registry";
import { type Runtime, startRuntime } from "../server";
import {
	deadPid,
	fixedGate,
	isAlive,
	killQuietly,
	shellEvent,
	type TempEndpoint,
	tempEndpoint,
	waitFor,
} from "./support";

const temps: TempEndpoint[] = [];
const runtimes: Runtime[] = [];
const daemons: number[] = [];

afterEach(() => {
	for (const rt of runtimes.splice(0)) rt.stop();
	for (const pid of daemons.splice(0)) killQuietly(pid);
	for (const t of temps.splice(0)) t.cleanup();
});

function temp(version = "1.0.0"): TempEndpoint {
	const t = tempEndpoint(version);
	temps.push(t);
	return t;
}

/** Wraps a spawner to count calls and remember the daemons it started. */
function tracked(spawn: SpawnRuntime): {
	spawn: SpawnRuntime;
	calls: () => number;
} {
	let calls = 0;
	return {
		spawn: () => {
			calls++;
			const spawned = spawn();
			if (spawned.ok) daemons.push(spawned.value.pid);
			return spawned;
		},
		calls: () => calls,
	};
}

async function statusOf(
	address: string,
	version: string,
): Promise<Record<string, unknown> | null> {
	const sent = await sendRequest(
		address,
		createRequest("status", undefined, version),
		1000,
	);
	if (!sent.ok || !sent.value.ok) return null;
	return sent.value.result as Record<string, unknown>;
}

describe("endpoint registry", () => {
	const base = {
		platform: "darwin" as const,
		dir: "/home/u/.maina/run",
		user: "u",
		tmpDir: "/tmp",
	};

	test("each version gets its own socket, pid file and spawn lock", () => {
		const a = resolveEndpoint({ ...base, version: "1.0.0" });
		const b = resolveEndpoint({ ...base, version: "1.1.0" });
		expect(a.address).toBe("/home/u/.maina/run/rt-1.0.0.sock");
		expect(a.pidFile).toBe("/home/u/.maina/run/rt-1.0.0.pid");
		expect(a.spawnLock).toBe("/home/u/.maina/run/rt-1.0.0.lock");
		expect(b.address).not.toBe(a.address);
		expect(b.pidFile).not.toBe(a.pidFile);
	});

	test("Windows uses a per-user, per-version named pipe", () => {
		const e = resolveEndpoint({
			...base,
			platform: "win32",
			dir: "C:\\Users\\u\\.maina\\run",
			version: "1.0.0",
		});
		expect(e.address).toBe("\\\\.\\pipe\\maina-u-1.0.0");
	});

	test("unsafe characters in a version never reach the path", () => {
		const e = resolveEndpoint({ ...base, version: "1.0.0/../../x" });
		expect(e.address.startsWith(`${base.dir}/`)).toBe(true);
		expect(e.address.slice(base.dir.length + 1)).not.toContain("/");
	});

	test("an over-long socket path falls back to a short one under tmp", () => {
		const dir = `/home/${"u".repeat(120)}/.maina/run`;
		const e = resolveEndpoint({ ...base, dir, version: "1.0.0" });
		expect(e.address.startsWith("/tmp/")).toBe(true);
		expect(Buffer.byteLength(e.address)).toBeLessThan(104);
		expect(e.pidFile.startsWith(dir)).toBe(true);
		// Inside a per-user subdirectory, never directly in the shared tmp dir.
		expect(dirname(e.address)).not.toBe("/tmp");
		expect(dirname(dirname(e.address))).toBe("/tmp");
	});

	test("the socket dir is created private and a loose one is tightened", () => {
		if (process.platform === "win32") return;
		const t = temp();
		const socketDir = join(t.dir, "sockets");
		mkdirSync(socketDir, { mode: 0o755 });
		chmodSync(socketDir, 0o755);
		const endpoint = { ...t.endpoint, address: join(socketDir, "rt.sock") };
		expect(ensureEndpointDirs(endpoint, process.platform).ok).toBe(true);
		expect(statSync(socketDir).mode & 0o777).toBe(0o700);
	});

	test("a socket dir reached through a symlink is refused", () => {
		if (process.platform === "win32") return;
		const t = temp();
		const real = join(t.dir, "real");
		mkdirSync(real, { mode: 0o700 });
		const link = join(t.dir, "link");
		symlinkSync(real, link);
		const endpoint = { ...t.endpoint, address: join(link, "rt.sock") };
		const dirs = ensureEndpointDirs(endpoint, process.platform);
		expect(dirs.ok).toBe(false);
		if (!dirs.ok) expect(dirs.error.kind).toBe("io_error");
	});

	test("the runtime dir is per user: XDG_RUNTIME_DIR, else ~/.maina/run", () => {
		expect(
			defaultRuntimeDir({ XDG_RUNTIME_DIR: "/run/user/501" }, "/home/u"),
		).toBe("/run/user/501/maina");
		expect(defaultRuntimeDir({}, "/home/u")).toBe("/home/u/.maina/run");
		expect(defaultRuntimeDir({ XDG_RUNTIME_DIR: "" }, "/home/u")).toBe(
			"/home/u/.maina/run",
		);
	});
});

describe("runtime exclusivity", () => {
	test("a second runtime on a live endpoint is refused", () => {
		const t = temp();
		const config = {
			endpoint: t.endpoint,
			version: "1.0.0",
			idleTtlMs: 60_000,
		};
		const first = startRuntime({ gate: fixedGate("allow") }, config);
		expect(first.ok).toBe(true);
		if (first.ok) runtimes.push(first.value);
		const second = startRuntime({ gate: fixedGate("allow") }, config);
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.error.kind).toBe("already_running");
	});

	test("a pid file left by a dead process is taken over", async () => {
		const t = temp();
		writeFileSync(
			t.endpoint.pidFile,
			JSON.stringify({ pid: await deadPid(), at: Date.now() }),
		);
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		runtimes.push(started.value);
		expect(JSON.parse(readFileSync(t.endpoint.pidFile, "utf8")).pid).toBe(
			process.pid,
		);
	});

	// On Linux, Bun unlinks a Unix socket's path when its listener stops, so
	// only the atomic takeover guards against displacement there.
	test.skipIf(process.platform === "linux")(
		"a runtime displaced from its pid file leaves the successor's socket alone",
		() => {
			const t = temp();
			const started = startRuntime(
				{ gate: fixedGate("allow") },
				{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
			);
			if (!started.ok) throw new Error(JSON.stringify(started.error));
			// Another live process took the claim over (the stale-claim race in
			// ADR 0044); the socket path now belongs to it.
			writeFileSync(
				t.endpoint.pidFile,
				JSON.stringify({ pid: process.ppid, at: Date.now() }),
			);
			started.value.stop();
			expect(existsSync(t.endpoint.address)).toBe(true);
			expect(JSON.parse(readFileSync(t.endpoint.pidFile, "utf8")).pid).toBe(
				process.ppid,
			);
		},
	);

	test("a stale claim that another claimant is taking over is not taken twice", async () => {
		const t = temp();
		writeFileSync(
			t.endpoint.pidFile,
			JSON.stringify({ pid: await deadPid(), at: Date.now() }),
		);
		mkdirSync(`${t.endpoint.pidFile}.takeover`);
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		if (started.ok) runtimes.push(started.value);
		expect(started.ok).toBe(false);
		if (!started.ok) expect(started.error.kind).toBe("already_running");
	});

	test("a takeover marker abandoned by a crashed claimant is cleared", async () => {
		const t = temp();
		writeFileSync(
			t.endpoint.pidFile,
			JSON.stringify({ pid: await deadPid(), at: Date.now() }),
		);
		const marker = `${t.endpoint.pidFile}.takeover`;
		mkdirSync(marker);
		const old = new Date(Date.now() - 60_000);
		utimesSync(marker, old, old);
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		expect(started.ok).toBe(true);
		if (started.ok) runtimes.push(started.value);
		expect(existsSync(marker)).toBe(false);
	});

	test("a pid file from before the last boot is stale even if the pid is reused", () => {
		const t = temp();
		writeFileSync(
			t.endpoint.pidFile,
			JSON.stringify({ pid: process.pid, at: 0 }),
		);
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		expect(started.ok).toBe(true);
		if (started.ok) runtimes.push(started.value);
	});
});

describe("spawn on demand", () => {
	test("the client spawns the runtime when none is running", async () => {
		const t = temp();
		const spawner = tracked(
			daemonSpawner({
				endpoint: t.endpoint,
				version: "1.0.0",
				idleTtlMs: 10_000,
			}),
		);
		const client = createHookClient({
			endpoint: t.endpoint,
			version: "1.0.0",
			spawn: spawner.spawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 8000 });
		expect(result.source).toBe("runtime");
		expect(spawner.calls()).toBe(1);
		const status = await statusOf(t.endpoint.address, "1.0.0");
		expect(status?.pid).toBe(daemons[0]);
	}, 15_000);

	test("the client spawns the runtime on a fresh machine with no runtime dir yet", async () => {
		const t = temp();
		const endpoint = resolveEndpoint({
			platform: process.platform,
			dir: join(t.dir, "not", "created", "yet"),
			user: "test",
			version: "1.0.0",
			tmpDir: tmpdir(),
		});
		const spawner = tracked(
			daemonSpawner({ endpoint, version: "1.0.0", idleTtlMs: 10_000 }),
		);
		const client = createHookClient({
			endpoint,
			version: "1.0.0",
			spawn: spawner.spawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 8000 });
		expect(result.source).toBe("runtime");
		expect(spawner.calls()).toBe(1);
	}, 15_000);

	test("concurrent clients spawn exactly one daemon", async () => {
		const t = temp();
		const spawner = tracked(
			daemonSpawner({
				endpoint: t.endpoint,
				version: "1.0.0",
				idleTtlMs: 10_000,
			}),
		);
		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				createHookClient({
					endpoint: t.endpoint,
					version: "1.0.0",
					spawn: spawner.spawn,
					fallback: fixedGate("deny"),
				}).evaluate(shellEvent, { timeoutMs: 8000 }),
			),
		);
		expect(results.every((r) => r.source === "runtime")).toBe(true);
		expect(spawner.calls()).toBe(1);
		expect(daemons.filter(isAlive)).toHaveLength(1);
	}, 20_000);
});

describe("version mismatch", () => {
	test("a runtime answering another version's client stops and frees its endpoint", async () => {
		const t = temp();
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 60_000 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		runtimes.push(started.value);
		const sent = await sendRequest(
			t.endpoint.address,
			createRequest("status", undefined, "2.0.0"),
			1000,
		);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("version_mismatch");
		expect(sent.value.runtimeVersion).toBe("1.0.0");
		expect(await started.value.closed).toBe("version_mismatch");
		expect(existsSync(t.endpoint.pidFile)).toBe(false);
	});

	test("the client restarts a runtime of another version and gets its answer", async () => {
		const t = temp();
		const old = tracked(
			daemonSpawner({
				endpoint: t.endpoint,
				version: "1.0.0",
				idleTtlMs: 10_000,
			}),
		);
		const oldSpawn = old.spawn();
		if (!oldSpawn.ok) throw new Error(oldSpawn.error.message);
		expect(
			await waitFor(
				async () => (await statusOf(t.endpoint.address, "1.0.0")) !== null,
				5000,
			),
		).toBe(true);

		const next = tracked(
			daemonSpawner({
				endpoint: t.endpoint,
				version: "2.0.0",
				idleTtlMs: 10_000,
			}),
		);
		const client = createHookClient({
			endpoint: t.endpoint,
			version: "2.0.0",
			spawn: next.spawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 8000 });
		expect(result.source).toBe("runtime");
		expect(next.calls()).toBe(1);
		expect(await waitFor(() => !isAlive(oldSpawn.value.pid), 3000)).toBe(true);
		const status = await statusOf(t.endpoint.address, "2.0.0");
		expect(status?.version).toBe("2.0.0");
	}, 20_000);
});

describe("idle TTL", () => {
	test("an idle runtime exits after the configured TTL", async () => {
		const t = temp();
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 150 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		runtimes.push(started.value);
		const t0 = Date.now();
		expect(await started.value.closed).toBe("idle");
		expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
		expect(existsSync(t.endpoint.pidFile)).toBe(false);
		expect(existsSync(t.endpoint.address)).toBe(false);
	});

	test("requests reset the idle clock", async () => {
		const t = temp();
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 200 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		runtimes.push(started.value);
		let closed = false;
		void started.value.closed.then(() => {
			closed = true;
		});
		for (let i = 0; i < 5; i++) {
			await Bun.sleep(100);
			expect(await statusOf(t.endpoint.address, "1.0.0")).not.toBeNull();
		}
		expect(closed).toBe(false);
	});

	test("a spawned daemon process exits once idle", async () => {
		const t = temp();
		const spawner = tracked(
			daemonSpawner({ endpoint: t.endpoint, version: "1.0.0", idleTtlMs: 300 }),
		);
		const spawned = spawner.spawn();
		if (!spawned.ok) throw new Error(spawned.error.message);
		expect(
			await waitFor(
				async () => (await statusOf(t.endpoint.address, "1.0.0")) !== null,
				5000,
			),
		).toBe(true);
		expect(await waitFor(() => !isAlive(spawned.value.pid), 5000)).toBe(true);
		expect(existsSync(t.endpoint.pidFile)).toBe(false);
	}, 15_000);
});

describe("standalone runtime daemon (ADR 0045)", () => {
	test("from source, the daemon is daemon.ts run by bun", () => {
		expect(
			daemonCommand(
				"file:///repo/packages/runtime/src/lifecycle.ts",
				"/usr/local/bin/bun",
			),
		).toEqual(["/usr/local/bin/bun", "/repo/packages/runtime/src/daemon.ts"]);
	});

	test("in a compiled runtime, the daemon is the executable itself", () => {
		expect(daemonCommand("file:///$bunfs/root/maina", "/data/maina")).toEqual([
			"/data/maina",
			"runtime-daemon",
		]);
		expect(
			daemonCommand("file:///B:/~BUN/root/maina.exe", "C:\\data\\maina.exe"),
		).toEqual(["C:\\data\\maina.exe", "runtime-daemon"]);
	});

	test("the standalone entry's runtime-daemon mode serves the runtime", async () => {
		const t = temp();
		const ok = ensureEndpointDirs(t.endpoint, process.platform);
		expect(ok.ok).toBe(true);
		const main = join(import.meta.dir, "..", "standalone", "main.ts");
		const proc = Bun.spawn(
			[
				process.execPath,
				main,
				"runtime-daemon",
				"--address",
				t.endpoint.address,
				"--pid-file",
				t.endpoint.pidFile,
				"--spawn-lock",
				t.endpoint.spawnLock,
				"--version",
				"1.0.0",
				"--idle-ttl-ms",
				"10000",
			],
			{ stdio: ["ignore", "ignore", "ignore"] },
		);
		daemons.push(proc.pid);
		expect(
			await waitFor(
				async () => (await statusOf(t.endpoint.address, "1.0.0")) !== null,
				5000,
			),
		).toBe(true);
		expect((await statusOf(t.endpoint.address, "1.0.0"))?.pid).toBe(proc.pid);
	}, 15_000);
});
