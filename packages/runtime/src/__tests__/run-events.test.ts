/**
 * Run events through the resident runtime (#594): a host's session start
 * reaches the runtime as `session.start` (never the gate), the gate's
 * verdicts become the session's steps, and a `maina run` worker's run
 * events arrive over the `run.event` request for the Link uplink.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { GateEvent } from "../gate";
import { createRequest, sendRequest } from "../ipc";
import {
	asWireEvent,
	capturingSink,
} from "../link/producers/__tests__/helpers";
import {
	createPluginRuns,
	createRunEventClient,
	withRunEvents,
} from "../run-events";
import { type Runtime, type RuntimePorts, startRuntime } from "../server";
import { SESSION_START, SESSION_STOP } from "../stop-verify";
import { fixedGate, tempEndpoint } from "./support";

const VERSION = "1.0.0";
const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function start(ports: RuntimePorts): Runtime {
	const ep = tempEndpoint(VERSION);
	cleanups.push(ep.cleanup);
	const started = startRuntime(ports, {
		endpoint: ep.endpoint,
		version: VERSION,
		idleTtlMs: 60_000,
	});
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	cleanups.push(started.value.stop);
	return started.value;
}

async function send(
	runtime: Runtime,
	method: "hook.evaluate" | "run.event",
	params: unknown,
) {
	const sent = await sendRequest(
		runtime.address,
		createRequest(method, params, VERSION),
		5_000,
	);
	if (!sent.ok) throw new Error(JSON.stringify(sent.error));
	return sent.value;
}

const event = (
	kind: string,
	input: Record<string, unknown> = {},
): GateEvent => ({
	kind,
	input: { host: "claude-code", sessionId: "sess-1", ...input },
	cwd: "/repo",
});

/** Waits for the background work a gate answer schedules. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function withRuns() {
	const { sink, inputs } = capturingSink();
	let n = 0;
	const runs = createPluginRuns({
		sink,
		ci: false,
		now: () => 0,
		newRunId: () => `run_${++n}`,
	});
	const gated: GateEvent[] = [];
	const ports = withRunEvents(
		{
			gate: (e) => {
				gated.push(e);
				return fixedGate("deny")(e);
			},
			observe: () => null,
		},
		{ runs, sink },
	);
	return { runtime: start(ports), inputs, gated };
}

describe("plugin sessions through the runtime", () => {
	test("session start, a gated call and the stop become one run's events", async () => {
		const { runtime, inputs, gated } = withRuns();
		const started = await send(runtime, "hook.evaluate", event(SESSION_START));
		// A session start is answered quietly; the gate never sees it.
		expect(started.ok && started.result).toEqual({
			verdict: "allow",
			reason: "",
			decisionIds: [],
			degraded: false,
		});
		await send(runtime, "hook.evaluate", event("shell", { command: "ls" }));
		await send(runtime, "hook.evaluate", event(SESSION_STOP));
		await settle();
		expect(gated.map((e) => e.kind)).toEqual(["shell"]);
		const events = inputs.map((input, i) => asWireEvent(input, i + 1));
		expect(events.map((e) => e.type)).toEqual([
			"run.started",
			"run.step",
			"run.finished",
		]);
		expect(events[1]?.data).toEqual({
			step: 1,
			toolClass: "shell",
			verdict: "deny",
		});
		expect(new Set(events.map((e) => e.runId))).toEqual(new Set(["run_1"]));
	});
});

describe("run.event", () => {
	test("a maina run worker's event is queued for the uplink", async () => {
		const { runtime, inputs } = withRuns();
		const answer = await send(runtime, "run.event", {
			type: "run.started",
			runId: "run-m1abc-1f2e3d4c",
			source: "maina-run",
			agent: "claude",
		});
		expect(answer.ok && answer.result).toEqual({ queued: true });
		expect(inputs).toHaveLength(1);
		expect(asWireEvent(inputs[0] as (typeof inputs)[0]).data).toEqual({
			agent: "claude",
		});
	});

	test("the run event client delivers a worker's events in order", async () => {
		const { sink, inputs } = capturingSink();
		const runs = createPluginRuns({
			sink,
			ci: false,
			now: () => 0,
			newRunId: () => "run_x",
		});
		const ep = tempEndpoint(VERSION);
		cleanups.push(ep.cleanup);
		const started = startRuntime(
			withRunEvents({ gate: fixedGate("allow") }, { runs, sink }),
			{ endpoint: ep.endpoint, version: VERSION, idleTtlMs: 60_000 },
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		cleanups.push(started.value.stop);
		let spawned = 0;
		const client = createRunEventClient({
			endpoint: ep.endpoint,
			version: VERSION,
			spawn: () => {
				spawned++;
				return { ok: false, error: { kind: "spawn_failed", message: "no" } };
			},
		});
		const runId = "run-m1abc-1f2e3d4c";
		client.send({ type: "run.started", runId, source: "ci", agent: "claude" });
		client.send({
			type: "run.finished",
			runId,
			outcome: "stopped",
			durationMs: 10,
			steps: 0,
		});
		await client.flush(5_000);
		expect(inputs.map((i) => i.type)).toEqual(["run.started", "run.finished"]);
		expect(spawned).toBe(0);
	});

	test("with no runtime to take them, the client drops events without throwing", async () => {
		const ep = tempEndpoint(VERSION);
		cleanups.push(ep.cleanup);
		const client = createRunEventClient({
			endpoint: ep.endpoint,
			version: VERSION,
			spawn: () => ({
				ok: false,
				error: { kind: "spawn_failed", message: "no runtime" },
			}),
			timeoutMs: 200,
		});
		client.send({ type: "run.started" });
		await client.flush(2_000);
	});

	test("anything that is not a run event is refused and queues nothing", async () => {
		const { runtime, inputs } = withRuns();
		const answer = await send(runtime, "run.event", { type: "decision" });
		expect(answer.ok && answer.result).toEqual({
			queued: false,
			reason: "invalid",
		});
		expect(inputs).toEqual([]);
	});
});
