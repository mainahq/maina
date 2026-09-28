/**
 * The real hook ports (#480): the Stop hook asks the resident runtime to
 * verify the session's changes with a budget long enough for a verify run,
 * not the gate's few seconds, and says so when verify still does not finish.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import type { GateDecision, GateEvent } from "../gate";
import { systemClaudeHookPorts, writeTty } from "../hook-system";
import { resolveEndpoint } from "../registry";
import { startRuntime } from "../server";
import { fixedGate } from "./support";
import { testTmpDir } from "./test-tmp";

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
	const xdg = testTmpDir("maina-xdg-");
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

describe("systemClaudeHookPorts session start", () => {
	test("a session start reaches the runtime's observer, never its gate (#594)", async () => {
		const xdg = testTmpDir("maina-xdg-");
		cleanups.push(() => rmSync(xdg, { recursive: true, force: true }));
		const endpoint = resolveEndpoint({
			platform: process.platform,
			dir: join(xdg, "maina"),
			user: userInfo().username,
			version: cliPackage.version,
			tmpDir: tmpdir(),
		});
		const observed: string[] = [];
		const gated: string[] = [];
		const started = startRuntime(
			{
				gate: (event) => {
					gated.push(event.kind);
					return fixedGate("deny")(event);
				},
				observe: (event) => {
					observed.push(event.kind);
					return null;
				},
			},
			{ endpoint, version: cliPackage.version, idleTtlMs: 60_000 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		cleanups.unshift(started.value.stop);
		const ports = systemClaudeHookPorts({ env: { XDG_RUNTIME_DIR: xdg } });
		await ports.sessionStart?.({
			kind: "session.start",
			input: { host: "claude-code", sessionId: "s-594" },
		});
		expect(observed).toEqual(["session.start"]);
		expect(gated).toEqual([]);
	});
});

// #351 review: the terminal write must only ever reach an existing terminal
// device. Opened with "w" (O_CREAT | O_TRUNC), "/dev/tty" on Windows is a
// path on the current drive, and a missing one would be created as a file.
describe("writeTty", () => {
	test("never creates the file it writes to", () => {
		const dir = testTmpDir("maina-tty-");
		try {
			const path = join(dir, "tty");
			expect(() => writeTty("\u001b]9;x\u0007", path)).toThrow();
			expect(existsSync(path)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
