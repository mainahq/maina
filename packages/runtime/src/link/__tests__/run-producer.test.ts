/**
 * Run events (#594, cloud plan Task 8.4, FR-RUN-1, FR-RUN-4): a run's
 * `run.started`, `run.step` and `run.finished` go to the Link uplink as
 * metadata, under one run id, from plugin sessions and `maina run` workers.
 */

import { describe, expect, test } from "bun:test";
import type { GateEvent } from "../../gate";
import { createPluginRuns } from "../../run-events";
import { SESSION_START, SESSION_STOP } from "../../stop-verify";
import {
	asWireEvent,
	capturingSink,
	HASH_A,
	HASH_B,
} from "../producers/__tests__/helpers";
import {
	emitRun,
	parseRunFact,
	type RunFact,
	runEvent,
} from "../producers/run";

const RUN_ID = "run-m1abc-1f2e3d4c";

describe("runEvent", () => {
	test("a run lifecycle emits schema-valid events under one run id", () => {
		const facts: readonly RunFact[] = [
			{
				type: "run.started",
				runId: RUN_ID,
				source: "maina-run",
				agent: "claude",
				host: "maina-run",
				repoHash: HASH_A,
				branchHash: HASH_B,
			},
			{
				type: "run.step",
				runId: RUN_ID,
				step: 1,
				toolClass: "shell",
				verdict: "allow",
			},
			{
				type: "run.step",
				runId: RUN_ID,
				step: 2,
				toolClass: "file.write",
				verdict: "deny",
			},
			{
				type: "run.finished",
				runId: RUN_ID,
				outcome: "succeeded",
				durationMs: 1234.4,
				steps: 2,
			},
		];
		const events = facts.map((fact, i) => {
			const input = runEvent(fact);
			if (input === null) throw new Error(`${fact.type} had no event`);
			return asWireEvent(input, i + 1);
		});
		expect(events.map((e) => e.type)).toEqual([
			"run.started",
			"run.step",
			"run.step",
			"run.finished",
		]);
		expect(new Set(events.map((e) => e.runId))).toEqual(new Set([RUN_ID]));
		expect(events.every((e) => e.dataClass === "metadata")).toBe(true);
		expect(events[0]?.data).toEqual({
			agent: "claude",
			host: "maina-run",
			repoHash: HASH_A,
			branchHash: HASH_B,
		});
		expect(events[2]?.data).toEqual({
			step: 2,
			toolClass: "file.write",
			verdict: "deny",
		});
		expect(events[3]?.data).toEqual({
			outcome: "succeeded",
			durationMs: 1234,
			steps: 2,
		});
	});

	test("never sends a name, a path or a command: labels fall back to unknown", () => {
		const started = runEvent({
			type: "run.started",
			runId: RUN_ID,
			source: "plugin",
			agent: "Claude Code",
			host: "/usr/local/bin/claude",
			repoHash: "acme/payments",
		});
		expect(started?.data).toEqual({ agent: "unknown" });
		const step = runEvent({
			type: "run.step",
			runId: RUN_ID,
			step: 1,
			toolClass: "rm -rf /",
			verdict: "allow",
		});
		expect(step?.data).toEqual({
			step: 1,
			toolClass: "unknown",
			verdict: "allow",
		});
	});

	test("a run id that is not an id, or a verdict that is not one, has no event", () => {
		expect(
			runEvent({
				type: "run.started",
				runId: "../../etc/passwd",
				source: "plugin",
				agent: "claude-code",
			}),
		).toBeNull();
		expect(
			runEvent({
				type: "run.step",
				runId: RUN_ID,
				step: 1,
				toolClass: "shell",
				verdict: "maybe" as "allow",
			}),
		).toBeNull();
	});

	test("emitRun enqueues on the sink", () => {
		const { sink, inputs } = capturingSink();
		const emitted = emitRun(sink, {
			type: "run.finished",
			runId: RUN_ID,
			outcome: "stopped",
			durationMs: 5,
			steps: 0,
		});
		expect(emitted.ok).toBe(true);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.runId).toBe(RUN_ID);
	});
});

describe("parseRunFact", () => {
	test("reads a run fact sent over the runtime's IPC", () => {
		const fact = {
			type: "run.step",
			runId: RUN_ID,
			step: 3,
			toolClass: "mcp",
			verdict: "ask",
		};
		expect(parseRunFact(fact)).toEqual(fact as RunFact);
	});

	test("refuses anything else", () => {
		for (const bad of [
			null,
			"run.started",
			{ type: "decision", runId: RUN_ID },
			{ type: "run.started", runId: RUN_ID, agent: "claude" },
			{ type: "run.started", runId: 7, source: "plugin", agent: "claude" },
			{
				type: "run.step",
				runId: RUN_ID,
				step: -1,
				toolClass: "shell",
				verdict: "allow",
			},
			{
				type: "run.finished",
				runId: RUN_ID,
				outcome: "exploded",
				durationMs: 1,
				steps: 1,
			},
		]) {
			expect(parseRunFact(bad)).toBeNull();
		}
	});
});

const session = (
	kind: string,
	input: Record<string, unknown> = {},
): GateEvent => ({
	kind,
	input: { host: "claude-code", sessionId: "sess-1", ...input },
});

function pluginRuns(ci = false) {
	const { sink, inputs } = capturingSink();
	let t = 1_000;
	let n = 0;
	const runs = createPluginRuns({
		sink,
		ci,
		now: () => t,
		newRunId: () => `run_${++n}`,
	});
	return {
		runs,
		inputs,
		advance: (ms: number) => {
			t += ms;
		},
	};
}

describe("createPluginRuns", () => {
	test("a plugin session produces a run with source plugin: start, steps, stop", () => {
		const { runs, inputs, advance } = pluginRuns();
		runs.observe(session(SESSION_START));
		const run = runs.current("claude-code", "sess-1");
		expect(run?.source).toBe("plugin");
		expect(run?.agent).toBe("claude-code");
		runs.decided(session("shell", { command: "ls" }), "allow");
		runs.decided(session("file.write", { path: "a.ts" }), "ask");
		advance(2_500);
		runs.observe(session(SESSION_STOP));
		expect(runs.current("claude-code", "sess-1")).toBeUndefined();

		const events = inputs.map((input, i) => asWireEvent(input, i + 1));
		expect(events.map((e) => e.type)).toEqual([
			"run.started",
			"run.step",
			"run.step",
			"run.finished",
		]);
		expect(new Set(events.map((e) => e.runId))).toEqual(new Set(["run_1"]));
		expect(events[0]?.data).toEqual({
			agent: "claude-code",
			host: "claude-code",
		});
		expect(events.slice(1, 3).map((e) => e.data)).toEqual([
			{ step: 1, toolClass: "shell", verdict: "allow" },
			{ step: 2, toolClass: "file.write", verdict: "ask" },
		]);
		expect(events[3]?.data).toEqual({
			outcome: "succeeded",
			durationMs: 2_500,
			steps: 2,
		});
	});

	test("a CI job produces a run with source ci", () => {
		const { runs } = pluginRuns(true);
		runs.observe(session(SESSION_START));
		expect(runs.current("claude-code", "sess-1")?.source).toBe("ci");
	});

	test("the run id stays the same across a resumed start; a tool call with no start opens one", () => {
		const { runs, inputs } = pluginRuns();
		runs.decided(session("shell", { command: "ls" }), "deny");
		runs.observe(session(SESSION_START, { source: "resume" }));
		runs.decided(session("shell", { command: "pwd" }), "allow");
		const types = inputs.map((i) => i.type);
		expect(types).toEqual(["run.started", "run.step", "run.step"]);
		expect(new Set(inputs.map((i) => i.runId))).toEqual(new Set(["run_1"]));
	});

	test("sessions are separate runs; an event with no session is ignored", () => {
		const { runs, inputs } = pluginRuns();
		runs.observe(session(SESSION_START));
		runs.observe(session(SESSION_START, { sessionId: "sess-2" }));
		runs.observe({ kind: SESSION_START, input: { host: "claude-code" } });
		runs.decided({ kind: "shell", input: { command: "ls" } }, "allow");
		expect(inputs.map((i) => i.runId)).toEqual(["run_1", "run_2"]);
	});

	test("a stop with no open run sends nothing", () => {
		const { runs, inputs } = pluginRuns();
		runs.observe(session(SESSION_STOP));
		expect(inputs).toEqual([]);
	});

	test("a sink that throws never reaches the caller", () => {
		const runs = createPluginRuns({
			sink: {
				enqueue: () => {
					throw new Error("disk full");
				},
			},
			ci: false,
			now: () => 0,
			newRunId: () => "run_x",
		});
		expect(() => runs.observe(session(SESSION_START))).not.toThrow();
		expect(() => runs.decided(session("shell"), "allow")).not.toThrow();
	});
});
