import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeScript } from "../__fixtures__/fake-acp-agent";
import type { HarnessEvent } from "../events";
import {
	type PermissionPolicy,
	type Run,
	type RunOptions,
	startRun,
} from "../orchestrator";
import { type SpawnAgent, spawnAgent } from "../worker";

const FIXTURE = join(
	import.meta.dir,
	"..",
	"__fixtures__",
	"fake-acp-agent.ts",
);
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maina-harness-")));

const allowAll: PermissionPolicy = () => "allow";

function options(
	script: FakeScript,
	extra: Partial<RunOptions> = {},
): RunOptions {
	return {
		agent: {
			name: "fake",
			command: process.execPath,
			args: [FIXTURE, JSON.stringify(script)],
		},
		task: "fix the bug",
		root: ROOT,
		policy: allowAll,
		...extra,
	};
}

async function collect(run: Run): Promise<readonly HarnessEvent[]> {
	const events: HarnessEvent[] = [];
	for await (const event of run.events) events.push(event);
	return events;
}

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

describe("startRun: session lifecycle", () => {
	test("initialize, new session, prompt, end: the run streams a session event then ends completed", async () => {
		const { spawn, pids } = trackingSpawn();
		const run = startRun(
			options({
				steps: [
					{
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "on it" },
						},
					},
				],
			}),
			{ spawn },
		);
		const events = await collect(run);
		expect(events).toEqual([
			{
				type: "session",
				sessionId: "fake-session",
				agent: "fake",
				protocolVersion: 1,
			},
			{ type: "message", role: "agent", text: "on it" },
			{ type: "end", state: "completed", stopReason: "end_turn" },
		]);
		expect(await run.done).toEqual({
			type: "end",
			state: "completed",
			stopReason: "end_turn",
		});
		// The agent serves one run: it is gone once the run ends.
		expect(pids).toHaveLength(1);
		expect(isAlive(pids[0] as number)).toBe(false);
	});

	test("a stop other than end_turn ends the run stopped with the agent's reason", async () => {
		const events = await collect(
			startRun(options({ stopReason: "max_tokens" })),
		);
		expect(events.at(-1)).toEqual({
			type: "end",
			state: "stopped",
			stopReason: "max_tokens",
		});
	});

	test("an agent that cannot be spawned ends the run failed", async () => {
		const events = await collect(
			startRun({
				...options({}),
				agent: { name: "ghost", command: "/nonexistent/maina-acp-agent" },
			}),
		);
		expect(events).toEqual([
			{
				type: "end",
				state: "failed",
				error: expect.objectContaining({ code: "spawn_failed" }),
			},
		]);
	});

	test("an agent that dies mid-turn ends the run failed, not hung", async () => {
		const events = await collect(startRun(options({ steps: [{ exit: 3 }] })));
		expect(events.at(-1)).toMatchObject({
			type: "end",
			state: "failed",
			error: { code: "agent_exited" },
		});
	});
});

describe("startRun: tool calls", () => {
	test("every ACP tool-call update reaches Run.events as a normalised event", async () => {
		const events = await collect(
			startRun(
				options({
					steps: [
						{
							update: {
								sessionUpdate: "tool_call",
								toolCallId: "t1",
								title: "Run the tests",
								kind: "execute",
								status: "pending",
								rawInput: { command: "bun test" },
							},
						},
						{
							update: {
								sessionUpdate: "tool_call_update",
								toolCallId: "t1",
								status: "in_progress",
							},
						},
						{
							update: {
								sessionUpdate: "tool_call",
								toolCallId: "t2",
								title: "Edit a.ts",
								kind: "edit",
								status: "pending",
								content: [
									{
										type: "diff",
										path: join(ROOT, "a.ts"),
										oldText: "a",
										newText: "b",
									},
								],
							},
						},
						{
							update: {
								sessionUpdate: "tool_call_update",
								toolCallId: "t1",
								status: "completed",
							},
						},
					],
				}),
			),
		);
		const tools = events.filter((e) => e.type === "tool");
		expect(
			tools.map((e) => [e.call.toolCallId, e.update, e.call.status]),
		).toEqual([
			["t1", "call", "pending"],
			["t1", "update", "in_progress"],
			["t2", "call", "pending"],
			["t1", "update", "completed"],
		]);
		expect(tools[0]).toMatchObject({
			gate: [
				{
					host: "acp:fake",
					sessionId: "fake-session",
					root: ROOT,
					kind: "shell",
					action: { command: "bun test" },
				},
			],
		});
		expect(events).toContainEqual({
			type: "diff",
			toolCallId: "t2",
			path: join(ROOT, "a.ts"),
			oldText: "a",
			newText: "b",
		});
	});

	test("a permission request goes to the policy and its verdict answers the agent", async () => {
		const seen: string[] = [];
		const policy: PermissionPolicy = (request) => {
			seen.push(request.gate[0]?.kind ?? "none");
			return "deny";
		};
		const events = await collect(
			startRun(
				options(
					{
						steps: [
							{
								permission: {
									toolCall: {
										toolCallId: "t9",
										kind: "execute",
										title: "Push",
										rawInput: { command: "git push --force" },
									},
									options: [
										{ optionId: "yes", name: "Allow", kind: "allow_once" },
										{ optionId: "no", name: "Reject", kind: "reject_once" },
									],
								},
							},
						],
					},
					{ policy },
				),
			),
		);
		expect(seen).toEqual(["shell"]);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "permission",
				verdict: "deny",
				optionId: "no",
				request: expect.objectContaining({ toolCallId: "t9" }),
			}),
		);
		// The fake agent echoes the option it was given.
		expect(events).toContainEqual({
			type: "message",
			role: "agent",
			text: "permission:no",
		});
	});

	test("a policy that fails denies: the gate fails closed", async () => {
		const events = await collect(
			startRun(
				options(
					{
						steps: [
							{
								permission: {
									toolCall: { toolCallId: "t1", kind: "edit" },
									options: [
										{ optionId: "yes", name: "Allow", kind: "allow_once" },
										{ optionId: "no", name: "Reject", kind: "reject_once" },
									],
								},
							},
						],
					},
					{ policy: () => Promise.reject(new Error("policy down")) },
				),
			),
		);
		expect(events).toContainEqual({
			type: "message",
			role: "agent",
			text: "permission:no",
		});
	});
});

describe("startRun: cancellation", () => {
	test("cancel() tells the agent, ends the run cancelled and cleans up the child", async () => {
		const { spawn, pids } = trackingSpawn();
		const run = startRun(options({ steps: [{ hang: true }] }), { spawn });
		const events: HarnessEvent[] = [];
		for await (const event of run.events) {
			events.push(event);
			if (event.type === "session") await run.cancel();
		}
		expect(events.at(-1)).toEqual({
			type: "end",
			state: "cancelled",
			stopReason: "cancelled",
		});
		expect(isAlive(pids[0] as number)).toBe(false);
	});

	test("an agent that ignores session/cancel is killed", async () => {
		const { spawn, pids } = trackingSpawn();
		const run = startRun(
			options({ steps: [{ hang: true }], ignoreCancel: true }),
			{ spawn, cancelGraceMs: 50, killGraceMs: 50 },
		);
		for await (const event of run.events) {
			if (event.type === "session") break;
		}
		await run.cancel();
		expect(await run.done).toMatchObject({ type: "end", state: "cancelled" });
		expect(isAlive(pids[0] as number)).toBe(false);
	});

	test("a cancel that lands while a finished turn is being torn down does not relabel it", async () => {
		let entered: () => void = () => undefined;
		const stopping = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const spawn: SpawnAgent = (agent, root) => {
			const child = spawnAgent(agent, root);
			if (!child.ok) return child;
			const real = child.value;
			return {
				ok: true,
				value: {
					...real,
					stop: async (graceMs) => {
						entered();
						await gate;
						await real.stop(graceMs);
					},
				},
			};
		};
		const run = startRun(options({}), { spawn });
		await stopping;
		const cancelling = run.cancel();
		release();
		await cancelling;
		expect(await run.done).toEqual({
			type: "end",
			state: "completed",
			stopReason: "end_turn",
		});
	});

	test("cancel() after the run ended is a no-op", async () => {
		const run = startRun(options({}));
		await collect(run);
		await run.cancel();
		expect((await run.done).state).toBe("completed");
	});
});

describe("startRun: budgets", () => {
	test("exceeding the tool-call budget cancels the run", async () => {
		const call = (id: string) => ({
			update: {
				sessionUpdate: "tool_call" as const,
				toolCallId: id,
				title: id,
				kind: "read" as const,
			},
		});
		const events = await collect(
			startRun(
				options(
					{
						steps: [call("a"), call("b"), call("c"), { hang: true }],
					},
					{ budgets: { maxToolCalls: 2 } },
				),
			),
		);
		expect(events.at(-1)).toMatchObject({
			type: "end",
			state: "budget_exceeded",
			budget: "tool_calls",
		});
	});

	test("a permission request for a call past the tool-call budget is never allowed", async () => {
		const events = await collect(
			startRun(
				options(
					{
						steps: [
							{
								update: {
									sessionUpdate: "tool_call",
									toolCallId: "a",
									title: "a",
									kind: "read",
								},
							},
							{
								// A second call the agent asks about before reporting it.
								permission: {
									toolCall: {
										toolCallId: "b",
										kind: "execute",
										rawInput: { command: "rm -rf build" },
									},
									options: [
										{ optionId: "yes", name: "Allow", kind: "allow_once" },
										{ optionId: "no", name: "Reject", kind: "reject_once" },
									],
								},
							},
							{ hang: true },
						],
					},
					{ budgets: { maxToolCalls: 1 } },
				),
			),
		);
		expect(events).toContainEqual({
			type: "message",
			role: "agent",
			text: "permission:cancelled",
		});
		expect(events.at(-1)).toMatchObject({
			type: "end",
			state: "budget_exceeded",
			budget: "tool_calls",
		});
	});

	test("exceeding the wall-clock budget cancels the run", async () => {
		const events = await collect(
			startRun(
				options({ steps: [{ hang: true }] }, { budgets: { wallClockMs: 100 } }),
			),
		);
		expect(events.at(-1)).toMatchObject({
			type: "end",
			state: "budget_exceeded",
			budget: "wall_clock",
		});
	});
});

describe("startRun: protocol version", () => {
	test("an agent on another ACP version ends the run with a clear error", async () => {
		const { spawn, pids } = trackingSpawn();
		const events = await collect(
			startRun(options({ protocolVersion: 99 }), { spawn }),
		);
		expect(events).toEqual([
			{
				type: "end",
				state: "failed",
				error: {
					code: "protocol_mismatch",
					message:
						'agent "fake" speaks ACP protocol v99; the maina harness supports v1',
				},
			},
		]);
		expect(isAlive(pids[0] as number)).toBe(false);
	});
});
