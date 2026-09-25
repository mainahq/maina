/**
 * Shared helpers for the runtime tests: throwaway endpoints under a temp dir,
 * fixed gate evaluators, process liveness and polling.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateEvaluator, GateEvent } from "../gate";
import type { SpawnRuntime } from "../lifecycle";
import { type Endpoint, resolveEndpoint } from "../registry";

export type TempEndpoint = Readonly<{
	dir: string;
	endpoint: Endpoint;
	cleanup: () => void;
}>;

/** A fresh runtime dir with the endpoint for `version` inside it. */
export function tempEndpoint(version = "1.0.0"): TempEndpoint {
	const dir = mkdtempSync(join(tmpdir(), "maina-rt-"));
	const endpoint = resolveEndpoint({
		platform: process.platform,
		dir,
		user: "test",
		version,
		tmpDir: tmpdir(),
	});
	return {
		dir,
		endpoint,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

export const shellEvent: GateEvent = {
	kind: "shell",
	input: { command: "rm -rf build" },
};

export const fixedGate =
	(verdict: "allow" | "ask" | "deny"): GateEvaluator =>
	() => ({
		verdict,
		reason: `fixed ${verdict}`,
		decisionIds: [],
		degraded: false,
	});

/** A spawner that never starts anything, so the client must degrade. */
export const noSpawn: SpawnRuntime = () => ({
	ok: false,
	error: { kind: "spawn_failed", message: "spawning disabled in this test" },
});

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function killQuietly(pid: number): void {
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone.
	}
}

/** Polls `cond` every 10 ms until it holds or `timeoutMs` passes. */
export async function waitFor(
	cond: () => boolean | Promise<boolean>,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await cond()) return true;
		await Bun.sleep(10);
	}
	return cond();
}

/** The pid of a process that has already exited. */
export async function deadPid(): Promise<number> {
	const proc = Bun.spawn(["true"], { stdio: ["ignore", "ignore", "ignore"] });
	await proc.exited;
	return proc.pid;
}
