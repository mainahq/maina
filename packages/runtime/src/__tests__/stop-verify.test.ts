/**
 * Verify on session stop (v1 task 6.4, FR-VER-7).
 *
 * The runtime remembers which files each session edited (from its
 * `action.post` file edits) and, on the session's `session.stop` event, runs
 * verify on those files. The answer is a stop decision each host adapter
 * renders through its own stop contract: a failed verify blocks the stop
 * (Claude Code and Codex `decision: "block"`, Cursor `followup_message`), any
 * other result is a one-line summary. A session that changed nothing runs
 * nothing, and its stop prints `{}` on every host.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { renderStop, type StopHost } from "../adapters/stop";
import type { GateDecision, GateEvent } from "../gate";
import { createRequest, sendRequest } from "../ipc";
import { type Runtime, type RuntimePorts, startRuntime } from "../server";
import {
	createStopVerify,
	type StopVerifyPorts,
	type StopVerifyReport,
} from "../stop-verify";
import { systemStopVerifyPorts } from "../stop-verify-system";
import { fixedGate, type TempEndpoint, tempEndpoint } from "./support";

const VERSION = "1.0.0";
const FIXTURES = join(import.meta.dir, "..", "adapters", "__fixtures__");
const HOSTS: readonly StopHost[] = ["claude-code", "codex", "cursor"];

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const edit = (sessionId: string, path: string, cwd = "/repo"): GateEvent => ({
	kind: "action.post",
	input: { sessionId, action: { kind: "file.write", path } },
	cwd,
});

const stopEvent = (sessionId: string, cwd = "/repo"): GateEvent => ({
	kind: "session.stop",
	input: { sessionId },
	cwd,
});

type VerifyCall = Readonly<{ root: string; files: readonly string[] }>;

/** Fake ports: `/repo` is the root of everything under it. */
function fakePorts(report: StopVerifyReport | null): {
	ports: StopVerifyPorts;
	calls: VerifyCall[];
} {
	const calls: VerifyCall[] = [];
	return {
		calls,
		ports: {
			rootOf: async (dir) => (dir.startsWith("/repo") ? "/repo" : null),
			verify: async (root, files) => {
				calls.push({ root, files });
				return report;
			},
		},
	};
}

const PASSED: StopVerifyReport = { status: "passed", findings: 0, files: 2 };
const FAILED: StopVerifyReport = { status: "failed", findings: 3, files: 2 };

// ── Host stop contracts ─────────────────────────────────────────────────────

const ajv = new Ajv({ strict: false });

function stopSchema(host: StopHost) {
	const path = join(FIXTURES, host, "schemas", "stop.output.schema.json");
	return ajv.compile(JSON.parse(readFileSync(path, "utf8")));
}

const SCHEMAS = new Map(HOSTS.map((host) => [host, stopSchema(host)]));

/** Renders `decision` for `host` and checks it against the host's schema. */
function throughContract(host: StopHost, decision: GateDecision): unknown {
	const output = renderStop(host, decision);
	const validate = SCHEMAS.get(host);
	expect(validate?.(output)).toBe(true);
	return output;
}

// ── createStopVerify ────────────────────────────────────────────────────────

describe("createStopVerify", () => {
	test("a session that changed files runs verify on them at stop", async () => {
		const { ports, calls } = fakePorts(PASSED);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "src/a.ts"));
		stops.observe(edit("s1", "/repo/src/b.ts"));
		const decision = await stops.stop(stopEvent("s1"));
		expect(calls).toEqual([{ root: "/repo", files: ["src/a.ts", "src/b.ts"] }]);
		expect(decision.verdict).toBe("allow");
		expect(decision.reason).toContain("maina verify: passed");
		expect(decision.reason).toContain("2 changed files");
	});

	test("a session with no changes runs nothing and says nothing", async () => {
		const { ports, calls } = fakePorts(PASSED);
		const stops = createStopVerify(ports);
		// Another session's edit is not this session's change.
		stops.observe(edit("other", "src/a.ts"));
		const decision = await stops.stop(stopEvent("s1"));
		expect(calls).toEqual([]);
		expect(decision).toEqual({ verdict: "allow", reason: "" });
	});

	test("a failed verify blocks the stop with the reason to fix it", async () => {
		const { ports } = fakePorts(FAILED);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "src/a.ts"));
		const decision = await stops.stop(stopEvent("s1"));
		expect(decision.verdict).toBe("deny");
		expect(decision.reason).toStartWith("maina verify failed on changed lines");
		expect(decision.reason).toEndWith("fix before finishing.");
	});

	test("after a block, only new edits run verify again, over every file still failing", async () => {
		const { ports, calls } = fakePorts(FAILED);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "src/a.ts"));
		expect((await stops.stop(stopEvent("s1"))).verdict).toBe("deny");
		// The agent stops again without touching anything: no loop.
		expect(await stops.stop(stopEvent("s1"))).toEqual({
			verdict: "allow",
			reason: "",
		});
		stops.observe(edit("s1", "src/b.ts"));
		await stops.stop(stopEvent("s1"));
		expect(calls.map((c) => c.files)).toEqual([
			["src/a.ts"],
			["src/a.ts", "src/b.ts"],
		]);
	});

	test("a passed session is forgotten, so its next stop runs nothing", async () => {
		const { ports, calls } = fakePorts(PASSED);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "src/a.ts"));
		await stops.stop(stopEvent("s1"));
		await stops.stop(stopEvent("s1"));
		expect(calls).toHaveLength(1);
	});

	test("edits outside the stop's repository, or with no session id, run nothing", async () => {
		const { ports, calls } = fakePorts(PASSED);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "/elsewhere/x.ts", "/elsewhere"));
		stops.observe({
			kind: "action.post",
			input: { action: { kind: "file.write", path: "a.ts" } },
			cwd: "/repo",
		});
		expect(await stops.stop(stopEvent("s1"))).toEqual({
			verdict: "allow",
			reason: "",
		});
		expect(calls).toEqual([]);
	});

	test("a verify that throws never blocks the stop", async () => {
		const stops = createStopVerify({
			rootOf: async () => "/repo",
			verify: async () => {
				throw new Error("boom");
			},
		});
		stops.observe(edit("s1", "src/a.ts"));
		const decision = await stops.stop(stopEvent("s1"));
		expect(decision.verdict).toBe("allow");
		expect(decision.reason).toContain("could not run");
		expect(decision.reason).toContain("boom");
	});

	test("a repository verify does not apply to runs nothing", async () => {
		const { ports, calls } = fakePorts(null);
		const stops = createStopVerify(ports);
		stops.observe(edit("s1", "src/a.ts"));
		expect(await stops.stop(stopEvent("s1"))).toEqual({
			verdict: "allow",
			reason: "",
		});
		expect(calls).toHaveLength(1);
	});
});

// ── Through the runtime and each host's stop contract ──────────────────────

describe("session.stop through the runtime", () => {
	function start(ports: RuntimePorts): { runtime: Runtime; ep: TempEndpoint } {
		const ep = tempEndpoint(VERSION);
		cleanups.push(ep.cleanup);
		const started = startRuntime(ports, {
			endpoint: ep.endpoint,
			version: VERSION,
			idleTtlMs: 60_000,
		});
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		cleanups.push(started.value.stop);
		return { runtime: started.value, ep };
	}

	async function send(runtime: Runtime, event: GateEvent): Promise<unknown> {
		const sent = await sendRequest(
			runtime.address,
			createRequest("hook.evaluate", event, VERSION),
			5_000,
		);
		if (!sent.ok) throw new Error(JSON.stringify(sent.error));
		if (!sent.value.ok) throw new Error(JSON.stringify(sent.value.error));
		return sent.value.result;
	}

	function withStops(report: StopVerifyReport | null) {
		const fake = fakePorts(report);
		const stops = createStopVerify(fake.ports);
		const { runtime } = start({
			// The gate would ask; a stop never reaches it.
			gate: fixedGate("ask"),
			observe: (event) => {
				stops.observe(event);
				return null;
			},
			stop: stops.stop,
		});
		return { runtime, calls: fake.calls };
	}

	test("a session that changed files triggers verify and every host shows the summary", async () => {
		const { runtime, calls } = withStops(PASSED);
		await send(runtime, edit("s1", "src/a.ts"));
		const decision = (await send(runtime, stopEvent("s1"))) as GateDecision;
		expect(calls).toEqual([{ root: "/repo", files: ["src/a.ts"] }]);
		expect(decision.verdict).toBe("allow");
		const summary = decision.reason;
		expect(summary).toContain("maina verify: passed");
		expect(throughContract("claude-code", decision)).toEqual({
			systemMessage: summary,
		});
		expect(throughContract("codex", decision)).toEqual({
			systemMessage: summary,
		});
		// Cursor's stop output has no field for a message to the user.
		expect(throughContract("cursor", decision)).toEqual({});
	});

	test("a failed verify blocks the stop through every host's contract", async () => {
		const { runtime } = withStops(FAILED);
		await send(runtime, edit("s1", "src/a.ts"));
		const decision = (await send(runtime, stopEvent("s1"))) as GateDecision;
		expect(decision.verdict).toBe("deny");
		const reason = decision.reason;
		expect(throughContract("claude-code", decision)).toEqual({
			decision: "block",
			reason,
		});
		expect(throughContract("codex", decision)).toEqual({
			decision: "block",
			reason,
		});
		expect(throughContract("cursor", decision)).toEqual({
			followup_message: reason,
		});
	});

	test("a session with no changes runs nothing and every host prints {}", async () => {
		const { runtime, calls } = withStops(FAILED);
		const decision = (await send(runtime, stopEvent("s1"))) as GateDecision;
		expect(calls).toEqual([]);
		for (const host of HOSTS) {
			expect(throughContract(host, decision)).toEqual({});
		}
	});

	test("a runtime without a stop port lets the stop through, silently", async () => {
		const { runtime } = start({ gate: fixedGate("deny") });
		expect(await send(runtime, stopEvent("s1"))).toEqual({
			verdict: "allow",
			reason: "",
		});
	});
});

describe("renderStop", () => {
	test("a degraded ask on stop never blocks and prints {}", () => {
		const ask: GateDecision = { verdict: "ask", reason: "runtime down" };
		for (const host of HOSTS) expect(throughContract(host, ask)).toEqual({});
	});
});

describe("systemStopVerifyPorts", () => {
	function tempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "maina-stop-"));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
		return dir;
	}

	test("a directory outside any repository has no root", async () => {
		expect(await systemStopVerifyPorts().rootOf(tempDir())).toBeNull();
	});

	test("a repository maina was never set up in runs nothing", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
		expect(await systemStopVerifyPorts().verify(dir, ["a.ts"])).toBeNull();
	});
});
