/**
 * Runtime IPC protocol (FR-GATE-1, FR-MCP-5).
 *
 * The protocol is newline-delimited JSON over a Unix socket (named pipe on
 * Windows), versioned by `PROTOCOL_VERSION`. These tests pin the codec, the
 * five request methods, and the warm round-trip budget the hook path relies
 * on: under 10 ms at p95.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createHookClient } from "../client/hook-client";
import type { GateEvaluator } from "../gate";
import {
	createLineSplitter,
	createRequest,
	decodeRequest,
	decodeResponse,
	encodeMessage,
	METHODS,
	PROTOCOL_VERSION,
	type Request,
	sendRequest,
} from "../ipc";
import { type Runtime, type RuntimePorts, startRuntime } from "../server";
import {
	fixedGate,
	noSpawn,
	shellEvent,
	type TempEndpoint,
	tempEndpoint,
} from "./support";

const VERSION = "1.0.0";

let temp: TempEndpoint | null = null;
let runtime: Runtime | null = null;

afterEach(() => {
	runtime?.stop();
	runtime = null;
	temp?.cleanup();
	temp = null;
});

function start(ports: RuntimePorts): Runtime {
	temp = tempEndpoint(VERSION);
	const started = startRuntime(ports, {
		endpoint: temp.endpoint,
		version: VERSION,
		idleTtlMs: 60_000,
	});
	if (!started.ok) {
		throw new Error(`runtime did not start: ${JSON.stringify(started.error)}`);
	}
	runtime = started.value;
	return runtime;
}

describe("protocol codec", () => {
	test("the protocol carries exactly the five runtime requests", () => {
		expect([...METHODS].sort() as string[]).toEqual(
			["decide", "graph.query", "hook.evaluate", "status", "verify.run"].sort(),
		);
		expect(PROTOCOL_VERSION).toBe(1);
	});

	test("a request round-trips through encode and decode", () => {
		const req = createRequest("hook.evaluate", shellEvent, VERSION);
		const line = encodeMessage(req);
		expect(line.endsWith("\n")).toBe(true);
		expect(line.slice(0, -1)).not.toContain("\n");
		expect(decodeRequest(line.trim())).toEqual({ ok: true, value: req });
	});

	test("malformed JSON is a bad request", () => {
		const decoded = decodeRequest("{not json");
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.error.code).toBe("bad_request");
	});

	test("an unknown method is rejected with the request id", () => {
		const decoded = decodeRequest(
			JSON.stringify({
				v: PROTOCOL_VERSION,
				id: "r1",
				method: "fs.delete",
				clientVersion: VERSION,
			}),
		);
		expect(decoded).toEqual({
			ok: false,
			error: {
				code: "unknown_method",
				message: expect.any(String),
				id: "r1",
			},
		});
	});

	test.each([
		["no protocol version", {}],
		["a non-numeric protocol version", { v: "1" }],
	] as const)("a request with %s is a bad request, not a mismatch", (_name, extra) => {
		const decoded = decodeRequest(
			JSON.stringify({
				id: "r9",
				method: "status",
				clientVersion: VERSION,
				...extra,
			}),
		);
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.error.code).toBe("bad_request");
	});

	test("a malformed request never stops the runtime", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const reply = await new Promise<string>((resolve) => {
			void Bun.connect({
				unix: rt.address,
				socket: {
					open: (s) => void s.write("{}\n"),
					data: (s, chunk) => {
						s.end();
						resolve(new TextDecoder().decode(chunk));
					},
				},
			});
		});
		expect(JSON.parse(reply).error.code).toBe("bad_request");
		const sent = await sendRequest(
			rt.address,
			createRequest("status", undefined, VERSION),
			1000,
		);
		expect(sent.ok && sent.value.ok).toBe(true);
	});

	test("another protocol version is a version mismatch", () => {
		const decoded = decodeRequest(
			JSON.stringify({
				v: PROTOCOL_VERSION + 1,
				id: "r2",
				method: "status",
				clientVersion: VERSION,
			}),
		);
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.error.code).toBe("version_mismatch");
	});

	test("a line longer than the cap is refused even when it ends in the same chunk", () => {
		const split = createLineSplitter(1000);
		const bytes = (text: string) => new TextEncoder().encode(text);
		expect(split(bytes("a".repeat(900))).ok).toBe(true);
		const tail = split(bytes(`${"a".repeat(200)}\n`));
		expect(tail.ok).toBe(false);
		const fresh = createLineSplitter(1000);
		expect(fresh(bytes(`${"b".repeat(1500)}\n`)).ok).toBe(false);
		const fine = createLineSplitter(1000);
		expect(fine(bytes(`${"c".repeat(1000)}\nd`))).toEqual({
			ok: true,
			value: ["c".repeat(1000)],
		});
	});

	test("a response without a runtime version is rejected", () => {
		const decoded = decodeResponse(
			JSON.stringify({ v: PROTOCOL_VERSION, id: "r3", ok: true, result: {} }),
		);
		expect(decoded.ok).toBe(false);
	});
});

describe("runtime requests over the socket", () => {
	test("status reports version, protocol and pid", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const sent = await sendRequest(
			rt.address,
			createRequest("status", undefined, VERSION),
			1000,
		);
		expect(sent.ok).toBe(true);
		if (!sent.ok) return;
		expect(sent.value.runtimeVersion).toBe(VERSION);
		expect(sent.value.ok).toBe(true);
		if (!sent.value.ok) return;
		expect(sent.value.result).toMatchObject({
			version: VERSION,
			protocol: PROTOCOL_VERSION,
			pid: process.pid,
		});
	});

	test("status reports no gate decision yet as a null degraded flag", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const sent = await sendRequest(
			rt.address,
			createRequest("status", { sessionId: "s1" }, VERSION),
			1000,
		);
		expect(sent.ok && sent.value.ok && sent.value.result).toMatchObject({
			lastGateDegraded: null,
		});
	});

	test("an unknown method gets an unknown_method error", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const bogus = {
			...createRequest("status", undefined, VERSION),
			method: "fs.delete",
		} as unknown as Request;
		const sent = await sendRequest(rt.address, bogus, 1000);
		expect(sent.ok).toBe(true);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("unknown_method");
	});

	test.each([
		"decide",
		"graph.query",
		"verify.run",
	] as const)("%s answers not_implemented until a port is plugged in", async (method) => {
		const rt = start({ gate: fixedGate("allow") });
		const sent = await sendRequest(
			rt.address,
			createRequest(method, {}, VERSION),
			1000,
		);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("not_implemented");
	});

	test("a handler result that cannot be serialised answers handler_failed", async () => {
		const rt = start({
			gate: fixedGate("allow"),
			handlers: { "graph.query": () => ({ big: 1n }) },
		});
		const sent = await sendRequest(
			rt.address,
			createRequest("graph.query", {}, VERSION),
			1000,
		);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("handler_failed");
	});

	test("a plugged-in handler port serves its request", async () => {
		const rt = start({
			gate: fixedGate("allow"),
			handlers: { "graph.query": (params) => ({ echo: params }) },
		});
		const sent = await sendRequest(
			rt.address,
			createRequest("graph.query", { symbol: "startRuntime" }, VERSION),
			1000,
		);
		if (!sent.ok || !sent.value.ok) throw new Error("expected a result");
		expect(sent.value.result).toEqual({ echo: { symbol: "startRuntime" } });
	});

	test("hook.evaluate with a malformed event is a bad request", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const sent = await sendRequest(
			rt.address,
			createRequest("hook.evaluate", "rm -rf /", VERSION),
			1000,
		);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("bad_request");
	});

	test.each([
		"allow",
		"ask",
		"deny",
	] as const)("the hook client passes a runtime %s through, not degraded", async (verdict) => {
		const rt = start({ gate: fixedGate(verdict) });
		const client = createHookClient({
			endpoint: rt.endpoint,
			version: VERSION,
			spawn: noSpawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 1000 });
		expect(result).toEqual({
			verdict,
			reason: `fixed ${verdict}`,
			decisionIds: [],
			degraded: false,
			source: "runtime",
		});
	});

	// #454: the daemon must not report `degraded: false` when core's
	// `evaluateGate` fell back (no model answer, no shell grammar).
	test("a degraded runtime decision reaches the wire with its decision ids", async () => {
		const degradedGate: GateEvaluator = () => ({
			verdict: "ask",
			reason: "no model answer; asking",
			decisionIds: ["d-1", "d-2"],
			degraded: true,
		});
		const rt = start({ gate: degradedGate });
		const sent = await sendRequest(
			rt.address,
			createRequest("hook.evaluate", shellEvent, VERSION),
			1000,
		);
		if (!sent.ok || !sent.value.ok) throw new Error("expected a result");
		expect(sent.value.result).toEqual({
			verdict: "ask",
			reason: "no model answer; asking",
			decisionIds: ["d-1", "d-2"],
			degraded: true,
		});
	});

	test("the hook client reports a degraded runtime decision as degraded", async () => {
		const rt = start({
			gate: () => ({
				verdict: "ask",
				reason: "no model answer; asking",
				decisionIds: ["d-1"],
				degraded: true,
			}),
		});
		const client = createHookClient({
			endpoint: rt.endpoint,
			version: VERSION,
			spawn: noSpawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 1000 });
		expect(result).toEqual({
			verdict: "ask",
			reason: "no model answer; asking",
			decisionIds: ["d-1"],
			degraded: true,
			source: "runtime",
		});
	});

	// Spec §6.1 rule 2: a degraded gate never allows, whoever evaluated it.
	test("the hook client tightens a degraded runtime allow to ask", async () => {
		const rt = start({
			gate: () => ({
				verdict: "allow",
				reason: "no model answer",
				decisionIds: ["d-1"],
				degraded: true,
			}),
		});
		const client = createHookClient({
			endpoint: rt.endpoint,
			version: VERSION,
			spawn: noSpawn,
			fallback: fixedGate("deny"),
		});
		const result = await client.evaluate(shellEvent, { timeoutMs: 1000 });
		expect(result).toEqual({
			verdict: "ask",
			reason: "no model answer",
			decisionIds: ["d-1"],
			degraded: true,
			source: "runtime",
		});
	});

	test("a gate answer without the degraded flag is a handler failure", async () => {
		const rt = start({
			gate: (() => ({
				verdict: "allow",
				reason: "legacy",
			})) as unknown as GateEvaluator,
		});
		const sent = await sendRequest(
			rt.address,
			createRequest("hook.evaluate", shellEvent, VERSION),
			1000,
		);
		if (!sent.ok || sent.value.ok) throw new Error("expected an rpc error");
		expect(sent.value.error.code).toBe("handler_failed");
	});
});

describe("warm round trip", () => {
	test("hook.evaluate round-trips under 10 ms at p95", async () => {
		const rt = start({ gate: fixedGate("allow") });
		const client = createHookClient({
			endpoint: rt.endpoint,
			version: VERSION,
			spawn: noSpawn,
			fallback: fixedGate("deny"),
		});
		for (let i = 0; i < 20; i++) {
			await client.evaluate(shellEvent, { timeoutMs: 1000 });
		}
		const samples: number[] = [];
		for (let i = 0; i < 200; i++) {
			const t0 = performance.now();
			const result = await client.evaluate(shellEvent, { timeoutMs: 1000 });
			samples.push(performance.now() - t0);
			expect(result.degraded).toBe(false);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.floor(samples.length * 0.95)] ?? Infinity;
		expect(p95).toBeLessThan(10);
	});
});
