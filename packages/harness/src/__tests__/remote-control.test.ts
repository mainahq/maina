/**
 * Run events and remote control in `maina run` (#594, cloud plan Task 8.4,
 * FR-RUN-1, FR-RUN-3, FR-RUN-4): a run emits `run.started`, one `run.step`
 * per gated tool call and `run.finished` under one run id; a stop from the
 * run board halts the worker and ends the run stopped with a report; the
 * board's revision grant enters the one bounded revision (FR-HAR-5), once.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { FakeScript } from "../__fixtures__/fake-acp-agent";
import type { EndEvent, HarnessEvent, RunLifecycleEvent } from "../events";
import { runStepOf } from "../events";
import { type RunOptions, startRun } from "../orchestrator";
import { runSource } from "../run/context";
import {
	type Attempt,
	createRunControl,
	orchestratedAttempt,
	type Review,
	type RevisionPorts,
	runOutcome,
	runWithRevision,
} from "../run/revision";
import { type SpawnAgent, spawnAgent } from "../worker";
import { testTmpDir } from "./test-tmp";

const FIXTURE = join(
	import.meta.dir,
	"..",
	"__fixtures__",
	"fake-acp-agent.ts",
);
const ROOT = testTmpDir("maina-harness-remote-");
const RUN_ID = "run-m1abc-1f2e3d4c";

const completed: EndEvent = {
	type: "end",
	state: "completed",
	stopReason: "end_turn",
};
const fail = (...findings: string[]): Review => ({ passed: false, findings });
const pass: Review = { passed: true, findings: [] };

const GATE_BASE = {
	host: "acp:fake",
	sessionId: "s",
	root: ROOT,
	permissionMode: "unknown",
	untrusted: [],
} as const;

const permission = (
	toolCallId: string,
	kind: "shell" | "file.write",
	verdict: "allow" | "deny",
): HarnessEvent => ({
	type: "permission",
	request: {
		toolCallId,
		call: {
			toolCallId,
			title: toolCallId,
			kind: kind === "shell" ? "execute" : "edit",
			status: "pending",
			locations: [],
			diffs: [],
		},
		gate: [
			kind === "shell"
				? { ...GATE_BASE, kind, action: { command: "ls" } }
				: { ...GATE_BASE, kind, action: { path: "a.ts" } },
		],
		opaque: false,
		options: [],
	},
	verdict,
});

function control(revisionWaitMs = 0) {
	const events: RunLifecycleEvent[] = [];
	const created = createRunControl({
		runId: RUN_ID,
		source: "maina-run",
		agent: "fake",
		emit: (event) => {
			events.push(event);
		},
		revisionWaitMs,
	});
	return { ...created, events };
}

/** Scripted ports: each attempt reports `steps` and ends `completed`. */
function scripted(
	reviews: readonly Review[],
	steps: readonly HarnessEvent[] = [],
	onAttempt?: (n: number) => void,
) {
	let attempts = 0;
	let reviewed = 0;
	let t = 0;
	const ports: RevisionPorts = {
		attempt: async ({ onEvent }): Promise<Attempt> => {
			attempts++;
			onAttempt?.(attempts);
			for (const event of steps) onEvent?.(event);
			t += 1_000;
			return { end: completed, toolCalls: steps.length };
		},
		review: async () => reviews[reviewed++] ?? fail("still failing"),
		now: () => t,
	};
	return { ports, attempts: () => attempts };
}

const input = {
	task: "fix the bug",
	context: "unattended",
	budgets: {},
} as const;

describe("run events", () => {
	test("a run lifecycle emits run.started, a step per gated call and run.finished under one run id", async () => {
		const c = control();
		const { ports } = scripted(
			[pass],
			[
				permission("t1", "shell", "allow"),
				{ type: "message", role: "agent", text: "working" },
				permission("t2", "file.write", "deny"),
			],
		);
		const receipt = await runWithRevision(input, {
			...ports,
			control: c.control,
		});
		expect(receipt.status).toBe("passed");
		expect(c.events).toEqual([
			{
				type: "run.started",
				runId: RUN_ID,
				source: "maina-run",
				agent: "fake",
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
				durationMs: 1_000,
				steps: 2,
			},
		]);
	});

	test("an emit port that throws never ends the run", async () => {
		const { control: c } = createRunControl({
			runId: RUN_ID,
			source: "maina-run",
			agent: "fake",
			emit: () => {
				throw new Error("runtime gone");
			},
		});
		const { ports } = scripted([pass], [permission("t1", "shell", "allow")]);
		const receipt = await runWithRevision(input, { ...ports, control: c });
		expect(receipt.status).toBe("passed");
	});

	test("runStepOf reads only permission events", () => {
		expect(runStepOf(permission("t1", "shell", "allow"))).toEqual({
			toolClass: "shell",
			verdict: "allow",
		});
		expect(
			runStepOf({ type: "message", role: "agent", text: "hi" }),
		).toBeNull();
	});

	test("the run's outcome follows its receipt", async () => {
		const passed = await runWithRevision(input, scripted([pass]).ports);
		expect(runOutcome(passed)).toBe("succeeded");
		const failed = await runWithRevision(input, scripted([]).ports);
		expect(runOutcome(failed)).toBe("failed");
	});
});

describe("run source", () => {
	test("a maina run worker in CI runs with source ci", () => {
		expect(runSource({ ci: false }, "maina-run")).toBe("maina-run");
		expect(runSource({ ci: true }, "maina-run")).toBe("ci");
		expect(runSource({ ci: false }, "plugin")).toBe("plugin");
		expect(runSource({ ci: true }, "plugin")).toBe("ci");
	});
});

/** Wraps the real spawn so a test can see the child's pid. */
function trackingSpawn(): { spawn: SpawnAgent; pids: number[] } {
	const pids: number[] = [];
	const spawn: SpawnAgent = (agent, root) => {
		const child = spawnAgent(agent, root);
		if (child.ok) pids.push(child.value.pid);
		return child;
	};
	return { spawn, pids };
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const agent = (script: FakeScript): RunOptions["agent"] => ({
	name: "fake",
	command: process.execPath,
	args: [FIXTURE, JSON.stringify(script)],
});

describe("remote stop", () => {
	test("a stop halts the fake ACP worker and emits run.finished with status stopped", async () => {
		const c = control();
		const { spawn, pids } = trackingSpawn();
		const attempt = orchestratedAttempt(
			{
				agent: agent({ steps: [{ hang: true }] }),
				root: ROOT,
				policy: () => "allow",
			},
			{ spawn, cancelGraceMs: 200, killGraceMs: 200 },
		);
		const ports: RevisionPorts = {
			attempt: (a) => {
				// The board's stop arrives while the agent is mid-turn.
				setTimeout(() => c.handle.stop("stopped_from_board"), 300);
				return attempt(a);
			},
			review: async () => pass,
			now: () => Date.now(),
		};
		const receipt = await runWithRevision(input, {
			...ports,
			control: c.control,
		});
		expect(receipt.status).toBe("stopped");
		if (receipt.status !== "stopped") return;
		expect(receipt.reason).toBe("remote_stop");
		expect(receipt.report).toContain("stopped from the run board");
		expect(receipt.reviews).toEqual([]);
		expect(pids).toHaveLength(1);
		expect(isAlive(pids[0] as number)).toBe(false);
		const finished = c.events.at(-1);
		expect(finished).toMatchObject({
			type: "run.finished",
			runId: RUN_ID,
			outcome: "stopped",
		});
	});

	test("a stop before the run starts an attempt starts none", async () => {
		const c = control();
		c.handle.stop();
		const s = scripted([pass]);
		const receipt = await runWithRevision(input, {
			...s.ports,
			control: c.control,
		});
		expect(s.attempts()).toBe(0);
		expect(receipt.status).toBe("stopped");
		expect(runOutcome(receipt)).toBe("stopped");
	});

	test("startRun's signal stops the worker like a cancel", async () => {
		const { spawn, pids } = trackingSpawn();
		const controller = new AbortController();
		const run = startRun(
			{
				agent: agent({ steps: [{ hang: true }] }),
				task: "t",
				root: ROOT,
				policy: () => "allow",
				signal: controller.signal,
			},
			{ spawn, cancelGraceMs: 200, killGraceMs: 200 },
		);
		for await (const event of run.events) {
			if (event.type === "session") controller.abort();
		}
		expect((await run.done).state).toBe("cancelled");
		expect(isAlive(pids[0] as number)).toBe(false);
	});
});

describe("remote revision grant", () => {
	test("a revision grant is applied exactly once", async () => {
		const c = control(60_000);
		const s = scripted([fail("lint"), fail("lint again")]);
		const answers: boolean[] = [];
		let reviews = 0;
		const ports: RevisionPorts = {
			...s.ports,
			review: async () => {
				const review = await s.ports.review();
				// The board answers the first failed review with the one revision.
				if (++reviews === 1) {
					setTimeout(() => {
						answers.push(c.handle.grantRevision("grant_1"));
					}, 10);
				}
				return review;
			},
		};
		const receipt = await runWithRevision(input, {
			...ports,
			control: c.control,
		});
		expect(s.attempts()).toBe(2);
		expect(answers).toEqual([true]);
		expect(receipt.status).toBe("stopped");
		if (receipt.status !== "stopped") return;
		// The second failed review stops the run: no second revision.
		expect(receipt.reason).toBe("review_failed");
		expect(c.handle.grantRevision("grant_1")).toBe(false);
		expect(c.handle.grantRevision("grant_2")).toBe(false);
	});

	test("a grant that arrives before the review fails is kept for it", async () => {
		const c = control(60_000);
		expect(c.handle.grantRevision("grant_1")).toBe(true);
		const s = scripted([fail("lint"), pass]);
		const receipt = await runWithRevision(input, {
			...s.ports,
			control: c.control,
		});
		expect(s.attempts()).toBe(2);
		expect(receipt.status).toBe("passed");
	});

	test("a stop with report answers the revision question: no revision, stopped", async () => {
		const c = control(60_000);
		const s = scripted([fail("lint")]);
		const ports: RevisionPorts = {
			...s.ports,
			review: async () => {
				const review = await s.ports.review();
				setTimeout(() => c.handle.stop("stopped_with_report"), 10);
				return review;
			},
		};
		const receipt = await runWithRevision(input, {
			...ports,
			control: c.control,
		});
		expect(s.attempts()).toBe(1);
		expect(receipt.status).toBe("stopped");
		if (receipt.status !== "stopped") return;
		expect(receipt.reason).toBe("remote_stop");
		expect(receipt.report).toContain("stopped with report");
		expect(receipt.report).toContain("lint");
		expect(c.events.at(-1)).toMatchObject({ outcome: "stopped" });
		// A stopped run takes no grant.
		expect(c.handle.grantRevision("grant_late")).toBe(false);
	});

	test("with no answer from the board in time, the local rule gives the revision", async () => {
		const c = control(20);
		const s = scripted([fail("lint"), pass]);
		const receipt = await runWithRevision(input, {
			...s.ports,
			control: c.control,
		});
		expect(s.attempts()).toBe(2);
		expect(receipt.status).toBe("passed");
	});

	test("waiting for the board never spends the wall clock the local-rule revision needs", async () => {
		// A board that never answers: the wait takes at most half of what is
		// left, so the revision still runs (it used to wait it all away and
		// end the run over budget).
		const c = control(60_000);
		let attempts = 0;
		let reviewed = 0;
		const reviews = [fail("lint"), pass];
		const receipt = await runWithRevision(
			{ ...input, budgets: { wallClockMs: 400 } },
			{
				attempt: async () => {
					attempts++;
					return { end: completed, toolCalls: 0 };
				},
				review: async () => reviews[reviewed++] ?? fail("still failing"),
				now: () => Date.now(),
				control: c.control,
			},
		);
		expect(attempts).toBe(2);
		expect(receipt.status).toBe("passed");
	});
});
