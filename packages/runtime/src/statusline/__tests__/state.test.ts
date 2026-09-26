/**
 * Status line state (FR-RET-1, #347): what the line shows, read from the
 * resident runtime's `status` answer (with the gate's wire `degraded` flag,
 * #456) and the session's decision-log summary. Reading it never throws: a
 * runtime that is down, or any failure, is the "off" state.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { SessionSummary } from "@mainahq/core";
import {
	fixedGate,
	type TempEndpoint,
	tempEndpoint,
} from "../../__tests__/support";
import type { GateEvaluator } from "../../gate";
import { createRequest, sendRequest } from "../../ipc";
import { type Runtime, startRuntime } from "../../server";
import {
	parseHostInput,
	parseRuntimeStatus,
	probeRuntime,
	type RuntimeProbe,
	readStatuslineState,
	type StatuslineStatePorts,
} from "../state";

const VERSION = "1.0.0";

const SUMMARY: SessionSummary = {
	blocked: 1,
	asked: 0,
	allowed: 3,
	routed: 0,
	estimatedSavedUsd: 0,
	addedLatencyP95: 4,
};

let temp: TempEndpoint | null = null;
let runtime: Runtime | null = null;

afterEach(() => {
	runtime?.stop();
	runtime = null;
	temp?.cleanup();
	temp = null;
});

function start(gate: GateEvaluator): Runtime {
	temp = tempEndpoint(VERSION);
	const started = startRuntime(
		{ gate },
		{ endpoint: temp.endpoint, version: VERSION, idleTtlMs: 60_000 },
	);
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	runtime = started.value;
	return runtime;
}

async function gateEvent(rt: Runtime, sessionId: string): Promise<void> {
	await sendRequest(
		rt.address,
		createRequest(
			"hook.evaluate",
			{ kind: "shell", input: { command: "ls", sessionId } },
			VERSION,
		),
		1000,
	);
}

const ports = (
	probe: RuntimeProbe | (() => Promise<RuntimeProbe>),
	summary: SessionSummary | null | (() => SessionSummary | null) = SUMMARY,
): StatuslineStatePorts & { summaryCalls: number } => {
	const counted = {
		summaryCalls: 0,
		probe: typeof probe === "function" ? probe : async () => probe,
		summary: async () => {
			counted.summaryCalls++;
			return typeof summary === "function" ? summary() : summary;
		},
	};
	return counted;
};

describe("parseHostInput", () => {
	test("reads the session id and working directory Claude Code sends", () => {
		expect(
			parseHostInput(
				JSON.stringify({
					session_id: "abc-123",
					cwd: "/repo/sub",
					workspace: { current_dir: "/repo/other" },
				}),
			),
		).toEqual({ sessionId: "abc-123", cwd: "/repo/sub" });
		expect(
			parseHostInput(JSON.stringify({ workspace: { current_dir: "/repo" } })),
		).toEqual({ cwd: "/repo" });
	});

	test("anything else is an empty session, never an error", () => {
		for (const text of ["", "nope", "[]", "null", '{"session_id":7}']) {
			expect(parseHostInput(text)).toEqual({});
		}
	});
});

describe("parseRuntimeStatus", () => {
	test("reads the gate's last degraded flag", () => {
		const base = { version: VERSION, protocol: 1, pid: 1 };
		expect(parseRuntimeStatus({ ...base, lastGateDegraded: true })).toEqual({
			gateDegraded: true,
		});
		expect(parseRuntimeStatus({ ...base, lastGateDegraded: null })).toEqual({
			gateDegraded: false,
		});
	});

	test("rejects a status of the wrong shape", () => {
		expect(parseRuntimeStatus(null)).toBeNull();
		expect(parseRuntimeStatus({ protocol: 1 })).toBeNull();
		expect(
			parseRuntimeStatus({
				version: VERSION,
				protocol: 1,
				lastGateDegraded: 1,
			}),
		).toBeNull();
	});
});

describe("probeRuntime", () => {
	test("no runtime listening is down", async () => {
		temp = tempEndpoint(VERSION);
		const probe = await probeRuntime({
			address: temp.endpoint.address,
			version: VERSION,
			timeoutMs: 200,
		});
		expect(probe).toEqual({ kind: "down" });
	});

	test("a healthy runtime is up and not degraded", async () => {
		const rt = start(fixedGate("allow"));
		await gateEvent(rt, "s1");
		const probe = await probeRuntime({
			address: rt.address,
			version: VERSION,
			sessionId: "s1",
			timeoutMs: 1000,
		});
		expect(probe).toEqual({ kind: "up", gateDegraded: false });
	});

	test("a degraded gate decision on the wire shows up for its session", async () => {
		const rt = start((event) => ({
			verdict: "ask",
			reason: "no model answer",
			decisionIds: [],
			degraded: event.input.sessionId === "s1",
		}));
		await gateEvent(rt, "s1");
		await gateEvent(rt, "s2");
		const probe = (sessionId?: string) =>
			probeRuntime({
				address: rt.address,
				version: VERSION,
				timeoutMs: 1000,
				...(sessionId === undefined ? {} : { sessionId }),
			});
		expect(await probe("s1")).toEqual({ kind: "up", gateDegraded: true });
		expect(await probe("s2")).toEqual({ kind: "up", gateDegraded: false });
		expect(await probe("s3")).toEqual({ kind: "up", gateDegraded: false });
		// Without a session: the last decision the runtime served (s2's).
		expect(await probe()).toEqual({ kind: "up", gateDegraded: false });
	});

	test("a gate that fails counts as degraded", async () => {
		const rt = start(() => {
			throw new Error("model down");
		});
		await gateEvent(rt, "s1");
		expect(
			await probeRuntime({
				address: rt.address,
				version: VERSION,
				sessionId: "s1",
				timeoutMs: 1000,
			}),
		).toEqual({ kind: "up", gateDegraded: true });
	});

	test("a runtime of another version is unusable", async () => {
		const rt = start(fixedGate("allow"));
		const probe = await probeRuntime({
			address: rt.address,
			version: "9.9.9",
			timeoutMs: 1000,
		});
		expect(probe).toEqual({ kind: "unusable" });
	});
});

describe("readStatuslineState", () => {
	test("a runtime that is down is off, and the log is never read", async () => {
		const p = ports({ kind: "down" });
		expect(await readStatuslineState({ sessionId: "s1" }, p)).toEqual({
			runtime: "off",
		});
		expect(p.summaryCalls).toBe(0);
	});

	test("a healthy runtime shows the session summary", async () => {
		expect(
			await readStatuslineState(
				{ sessionId: "s1", cwd: "/repo" },
				ports({ kind: "up", gateDegraded: false }),
			),
		).toEqual({ runtime: "on", degraded: [], summary: SUMMARY });
	});

	test("the wire degraded flag marks the gate degraded", async () => {
		expect(
			await readStatuslineState(
				{ sessionId: "s1" },
				ports({ kind: "up", gateDegraded: true }),
			),
		).toEqual({ runtime: "on", degraded: ["gate"], summary: SUMMARY });
	});

	test("a runtime that answers but cannot serve is degraded", async () => {
		expect(
			await readStatuslineState({}, ports({ kind: "unusable" }, null)),
		).toEqual({ runtime: "on", degraded: ["runtime"], summary: null });
	});

	test("a probe that throws is off, never an error", async () => {
		const p = ports(async () => {
			throw new Error("socket exploded");
		});
		expect(await readStatuslineState({}, p)).toEqual({ runtime: "off" });
	});

	test("a summary that throws leaves the numbers out", async () => {
		const p = ports({ kind: "up", gateDegraded: false }, () => {
			throw new Error("db locked");
		});
		expect(await readStatuslineState({ sessionId: "s1" }, p)).toEqual({
			runtime: "on",
			degraded: [],
			summary: null,
		});
	});
});
