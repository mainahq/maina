/**
 * The real hook ports (#480): the Stop hook asks the resident runtime to
 * verify the session's changes with a budget long enough for a verify run,
 * not the gate's few seconds, and says so when verify still does not finish.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import type { GateDecision, GateEvent } from "../gate";
import { systemClaudeHookPorts } from "../hook-system";
import { resolveEndpoint } from "../registry";
import { startRuntime } from "../server";
import { fixedGate } from "./support";

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const BLOCK: GateDecision = {
	verdict: "deny",
	reason: "maina verify failed on changed lines; fix before finishing.",
	decisionIds: [],
	degraded: false,
};

const stopEvent: GateEvent = {
	kind: "session.stop",
	input: { host: "claude-code", sessionId: "s-480" },
	cwd: "/repo",
};

/**
 * A runtime at the endpoint the system ports resolve under `XDG_RUNTIME_DIR`,
 * whose stop takes `stopMs` to answer `BLOCK`. Returns that env.
 */
function slowStopRuntime(stopMs: number): Readonly<Record<string, string>> {
	const xdg = mkdtempSync(join(tmpdir(), "maina-xdg-"));
	cleanups.push(() => rmSync(xdg, { recursive: true, force: true }));
	const endpoint = resolveEndpoint({
		platform: process.platform,
		dir: join(xdg, "maina"),
		user: userInfo().username,
		version: cliPackage.version,
		tmpDir: tmpdir(),
	});
	const started = startRuntime(
		{
			gate: fixedGate("allow"),
			stop: async () => {
				await Bun.sleep(stopMs);
				return BLOCK;
			},
		},
		{ endpoint, version: cliPackage.version, idleTtlMs: 60_000 },
	);
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	cleanups.unshift(started.value.stop);
	return { XDG_RUNTIME_DIR: xdg };
}

describe("systemClaudeHookPorts stop verify", () => {
	test("a verify slower than the gate's budget still blocks the stop", async () => {
		const env = slowStopRuntime(300);
		const ports = systemClaudeHookPorts({ env, timeoutMs: 100 });
		expect(await ports.stopVerify?.(stopEvent)).toEqual(BLOCK);
	});

	test("a verify that outlives the stop budget is a notice, not a silent {}", async () => {
		const env = slowStopRuntime(1_000);
		const ports = systemClaudeHookPorts({ env, stopTimeoutMs: 100 });
		expect(await ports.stopVerify?.(stopEvent)).toEqual({
			verdict: "allow",
			reason:
				"maina verify did not finish within 0.1 s, so this session's changes were not verified; run maina verify yourself.",
			decisionIds: [],
			degraded: true,
		});
	});
});
