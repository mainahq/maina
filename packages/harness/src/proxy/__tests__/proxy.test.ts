/**
 * ACP proxy mode (FR-HAR-3): an editor (Zed, a JetBrains IDE) launches
 * `maina acp --agent <name>` as its agent; the proxy launches the real
 * agent and sits between them. A fake editor ↔ the proxy ↔ a fake agent.
 *
 * - every message the proxy has no reason to change passes through as the
 *   same bytes, both ways;
 * - every `session/request_permission` goes through the gate first: a deny
 *   is rejected and an allow answered `allow_once` without bothering the
 *   editor; only an `ask` reaches the person in the editor;
 * - when the session ends the proxy produces a receipt of what happened;
 * - when either side disconnects, the other is cleaned up.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	client,
	ndJsonStream,
	type PermissionOption,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { FakeScript } from "../../__fixtures__/fake-acp-agent";
import {
	type TestBridge,
	testBridge,
} from "../../permissions/__tests__/gate-fixture";
import {
	type AgentProcess,
	type AgentSpec,
	type SpawnAgent,
	spawnAgent,
} from "../../worker";
import { type ProxyReceipt, startProxy } from "../server";

const FIXTURE = join(
	import.meta.dir,
	"..",
	"..",
	"__fixtures__",
	"fake-acp-agent.ts",
);
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maina-acp-proxy-")));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ONCE: readonly PermissionOption[] = [
	{ optionId: "yes", name: "Allow", kind: "allow_once" },
	{ optionId: "always", name: "Always allow", kind: "allow_always" },
	{ optionId: "no", name: "Reject", kind: "reject_once" },
];

let bridge: TestBridge;
beforeAll(async () => {
	bridge = await testBridge();
});

// ── plumbing ────────────────────────────────────────────────────────────────

/** Reads a byte stream one ndjson line at a time; undefined once it ends. */
function lineReader(stream: ReadableStream<Uint8Array>): {
	next: (ms?: number) => Promise<string | undefined | "timeout">;
} {
	const reader = stream.getReader();
	let buffer = "";
	let ended = false;
	return {
		next: async (ms = 2000) => {
			const deadline = Date.now() + ms;
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline !== -1) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					return line;
				}
				if (ended) return undefined;
				const left = deadline - Date.now();
				if (left <= 0) return "timeout";
				let timer: ReturnType<typeof setTimeout> | undefined;
				const chunk = await Promise.race([
					reader.read(),
					new Promise<"timeout">((resolve) => {
						timer = setTimeout(() => resolve("timeout"), left);
					}),
				]);
				clearTimeout(timer);
				if (chunk === "timeout") return "timeout";
				if (chunk.done) ended = true;
				else buffer += decoder.decode(chunk.value, { stream: true });
			}
		},
	};
}

type Endpoint = {
	/** What this side writes. */
	send: (line: string) => Promise<void>;
	/** What this side receives, a line at a time. */
	next: (ms?: number) => Promise<string | undefined | "timeout">;
	/** Hangs up: closes what this side writes. */
	hangUp: () => Promise<void>;
};

/** The editor's stdio as the proxy sees it, and the editor's end of it. */
function editorPipes(): {
	io: {
		input: ReadableStream<Uint8Array>;
		output: WritableStream<Uint8Array>;
	};
	toProxy: WritableStream<Uint8Array>;
	fromProxy: ReadableStream<Uint8Array>;
} {
	const up = new TransformStream<Uint8Array, Uint8Array>();
	const down = new TransformStream<Uint8Array, Uint8Array>();
	return {
		io: { input: up.readable, output: down.writable },
		toProxy: up.writable,
		fromProxy: down.readable,
	};
}

function rawEditor(pipes: ReturnType<typeof editorPipes>): Endpoint {
	const writer = pipes.toProxy.getWriter();
	const reader = lineReader(pipes.fromProxy);
	return {
		send: (line) => writer.write(encoder.encode(`${line}\n`)),
		next: reader.next,
		hangUp: () => writer.close(),
	};
}

/** An agent that lives in the test: the test plays its side, line by line. */
function inProcessAgent(): {
	spawn: SpawnAgent;
	agent: Endpoint;
	stopped: () => boolean;
} {
	const toAgent = new TransformStream<Uint8Array, Uint8Array>();
	const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
	const writer = fromAgent.writable.getWriter();
	const reader = lineReader(toAgent.readable);
	let stopped = false;
	let exit: (code: number | null) => void = () => undefined;
	const exited = new Promise<number | null>((resolve) => {
		exit = resolve;
	});
	const hangUp = async (): Promise<void> => {
		await writer.close().catch(() => undefined);
		exit(0);
	};
	const child: AgentProcess = {
		pid: -1,
		input: toAgent.writable,
		output: fromAgent.readable,
		exited,
		stderrTail: () => "",
		stop: async () => {
			stopped = true;
			await hangUp();
		},
	};
	return {
		spawn: () => ({ ok: true, value: child }),
		agent: {
			send: (line) => writer.write(encoder.encode(`${line}\n`)),
			next: reader.next,
			hangUp,
		},
		stopped: () => stopped,
	};
}

const FAKE: AgentSpec = { name: "fake", command: "unused" };

function fakeAgentSpec(script: FakeScript): AgentSpec {
	return {
		name: "fake",
		command: process.execPath,
		args: [FIXTURE, JSON.stringify(script)],
	};
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

const within = <T>(promise: Promise<T>, ms = 5000): Promise<T | "timeout"> =>
	Promise.race([
		promise,
		new Promise<"timeout">((resolve) =>
			setTimeout(() => resolve("timeout"), ms),
		),
	]);

/** A permission request line, as an agent sends it. */
function permissionLine(
	id: number | string,
	toolCall: Record<string, unknown>,
	options: readonly PermissionOption[] = ONCE,
): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id,
		method: "session/request_permission",
		params: { sessionId: "s-1", toolCall, options },
	});
}

const shellCall = (toolCallId: string, command: string): ToolCallUpdate => ({
	toolCallId,
	kind: "execute",
	title: command,
	rawInput: { command },
});

/** A session/new round trip, so the proxy knows the session and its cwd. */
async function openSession(editor: Endpoint, agent: Endpoint): Promise<void> {
	await editor.send(
		JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "session/new",
			params: { cwd: ROOT, mcpServers: [] },
		}),
	);
	expect(await agent.next()).toContain('"session/new"');
	await agent.send(
		JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sessionId: "s-1" } }),
	);
	expect(await editor.next()).toContain('"s-1"');
}

// ── transparency ────────────────────────────────────────────────────────────

describe("proxy: transparent for every message it does not need to change", () => {
	test("requests, responses, notifications and extensions pass through as the same bytes, both ways", async () => {
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;

		const editorLines = [
			'{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"_meta":{"zed.dev":{"x":1}}}}',
			'{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/work","mcpServers":[]}}',
			'{ "jsonrpc": "2.0",  "method": "session/cancel", "params": { "sessionId": "s-1" } }',
			'{"jsonrpc":"2.0","method":"_zed/custom","params":{"a":[1,2,3]}}',
			"not json at all",
		];
		for (const line of editorLines) {
			await editor.send(line);
			expect(await agent.next()).toBe(line);
		}

		const agentLines = [
			'{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true},"authMethods":[]}}',
			'{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s-1"}}',
			'{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"ls","kind":"execute","rawInput":{"command":"ls"}}}}',
			'{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1","update":{"sessionUpdate":"plan","entries":[]}}}',
			'{"jsonrpc":"2.0","id":"fs-1","method":"fs/read_text_file","params":{"sessionId":"s-1","path":"/work/a.ts"}}',
		];
		for (const line of agentLines) {
			await agent.send(line);
			expect(await editor.next()).toBe(line);
		}

		// The editor's answer to the agent's own request goes back untouched.
		const answer =
			'{"jsonrpc":"2.0","id":"fs-1","result":{"content":"export {}"}}';
		await editor.send(answer);
		expect(await agent.next()).toBe(answer);

		await editor.hangUp();
		expect(await within(proxy.done)).toMatchObject({ ok: true });
	});
});

// ── the gate ────────────────────────────────────────────────────────────────

describe("proxy: permission requests go through the gate", () => {
	test("a denied call is rejected by the gate; the editor never sees it", async () => {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);

		await agent.send(permissionLine(7, shellCall("t-pub", "npm publish")));
		expect(JSON.parse((await agent.next()) as string)).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: { outcome: { outcome: "selected", optionId: "no" } },
		});
		// Nothing reached the editor: the next line it gets is the marker.
		const marker = '{"jsonrpc":"2.0","method":"_test/marker"}';
		await agent.send(marker);
		expect(await editor.next()).toBe(marker);

		expect(bridge.records).toHaveLength(1);
		expect(bridge.records[0]).toMatchObject({
			source: "acp",
			host: "acp:fake",
			sessionId: "s-1",
			toolCallId: "t-pub",
			verdict: "deny",
			answer: "reject_once",
		});

		await editor.hangUp();
		const done = await within(proxy.done);
		expect(done).toMatchObject({ ok: true });
	});

	test("an allowed call is answered allow_once by the gate, never a standing allow", async () => {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);

		await agent.send(permissionLine("p-1", shellCall("t-ls", "ls")));
		expect(JSON.parse((await agent.next()) as string)).toEqual({
			jsonrpc: "2.0",
			id: "p-1",
			result: { outcome: { outcome: "selected", optionId: "yes" } },
		});
		expect(await editor.next(200)).toBe("timeout");
		expect(bridge.records[0]).toMatchObject({
			verdict: "allow",
			answer: "allow_once",
		});

		await editor.hangUp();
		await within(proxy.done);
	});

	test("an ask goes to the person in the editor, without standing allows; their answer reaches the agent and is logged", async () => {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);

		// An execute call with no command: the gate cannot read it, so it asks.
		const opaque = { toolCallId: "t-op", kind: "execute", title: "run it" };
		await agent.send(permissionLine(9, opaque));
		const asked = JSON.parse((await editor.next()) as string) as {
			id: number;
			method: string;
			params: RequestPermissionRequest;
		};
		expect(asked.id).toBe(9);
		expect(asked.method).toBe("session/request_permission");
		expect(asked.params.toolCall.toolCallId).toBe("t-op");
		// A standing allow would let later calls skip the gate: not offered.
		expect(asked.params.options.map((o) => o.kind)).toEqual([
			"allow_once",
			"reject_once",
		]);
		expect(bridge.records).toHaveLength(0);

		const answer =
			'{"jsonrpc":"2.0","id":9,"result":{"outcome":{"outcome":"selected","optionId":"yes"}}}';
		await editor.send(answer);
		expect(await agent.next()).toBe(answer);
		expect(bridge.records).toHaveLength(1);
		expect(bridge.records[0]).toMatchObject({
			toolCallId: "t-op",
			verdict: "ask",
			opaque: true,
			answer: "allow_once",
		});

		await editor.hangUp();
		await within(proxy.done);
	});

	test("a request the gate cannot read goes to the editor (fail closed to ask), and the proxy keeps going", async () => {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);

		// `locations` is not a list: the normaliser cannot read the call.
		const junk = permissionLine(11, {
			toolCallId: "t-junk",
			kind: "edit",
			locations: 42,
		});
		await agent.send(junk);
		expect(await editor.next()).toBe(junk);
		const marker = '{"jsonrpc":"2.0","method":"_test/after"}';
		await agent.send(marker);
		expect(await editor.next()).toBe(marker);

		await editor.hangUp();
		expect(await within(proxy.done)).toMatchObject({ ok: true });
	});

	test("a request the editor never answered is logged cancelled when the session ends", async () => {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);
		await agent.send(
			permissionLine(10, { toolCallId: "t-q", kind: "execute", title: "?" }),
		);
		expect(await editor.next()).toContain('"t-q"');

		await editor.hangUp();
		const done = await within(proxy.done);
		expect(done).toMatchObject({ ok: true });
		expect(bridge.records).toEqual([
			expect.objectContaining({
				toolCallId: "t-q",
				verdict: "ask",
				answer: "cancelled",
			}),
		]);
	});
});

// ── the agent's calls on the editor ─────────────────────────────────────────

describe("proxy: what the agent asks the editor to do goes through the gate", () => {
	// An editor that offers `fs` and `terminal` does the agent's writes and
	// commands for it. An agent the editor put in a permissive mode (accept
	// edits, bypass) sends no permission request first, so these requests are
	// the only place the gate sees the action: a deny must hold there too.
	async function gated(line: string): Promise<{
		toAgent: string | undefined | "timeout";
		toEditor: string | undefined | "timeout";
	}> {
		bridge.records.length = 0;
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		const editor = rawEditor(pipes);
		const { agent } = fake;
		await openSession(editor, agent);
		await agent.send(line);
		const toEditor = await editor.next(300);
		const toAgent = await agent.next(300);
		await editor.hangUp();
		await within(proxy.done);
		return { toAgent, toEditor };
	}

	test("a denied command on the editor's terminal is refused; the editor never runs it", async () => {
		const { toAgent, toEditor } = await gated(
			JSON.stringify({
				jsonrpc: "2.0",
				id: "term-1",
				method: "terminal/create",
				params: { sessionId: "s-1", command: "npm", args: ["publish"] },
			}),
		);
		expect(toEditor).toBe("timeout");
		const answer = JSON.parse(toAgent as string);
		expect(answer).toMatchObject({ jsonrpc: "2.0", id: "term-1" });
		expect(answer.error.message).toContain("maina");
		expect(answer.result).toBeUndefined();
		expect(bridge.records).toEqual([
			expect.objectContaining({
				source: "acp",
				sessionId: "s-1",
				verdict: "deny",
				answer: "error",
			}),
		]);
	});

	test("a denied write through the editor's fs is refused; the editor never writes it", async () => {
		const { toAgent, toEditor } = await gated(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 41,
				method: "fs/write_text_file",
				params: {
					sessionId: "s-1",
					path: join(ROOT, ".maina", "policy.yml"),
					content: "rules: {}\n",
				},
			}),
		);
		expect(toEditor).toBe("timeout");
		expect(JSON.parse(toAgent as string)).toMatchObject({
			id: 41,
			error: { code: expect.any(Number) },
		});
		expect(bridge.records[0]).toMatchObject({ verdict: "deny" });
	});

	test("what the gate does not deny reaches the editor as the same bytes, unlogged", async () => {
		const line = JSON.stringify({
			jsonrpc: "2.0",
			id: "term-2",
			method: "terminal/create",
			params: { sessionId: "s-1", command: "ls", args: ["-la"] },
		});
		const { toAgent, toEditor } = await gated(line);
		expect(toEditor).toBe(line);
		expect(toAgent).toBe("timeout");
		expect(bridge.records).toEqual([]);
	});
});

// ── receipts, end to end ────────────────────────────────────────────────────

/** An editor on the ACP SDK: the real client side of the protocol. */
function sdkEditor(pipes: ReturnType<typeof editorPipes>) {
	const asked: RequestPermissionRequest[] = [];
	const connection = client({ name: "fake-editor" })
		.onRequest("session/request_permission", async ({ params }) => {
			asked.push(params);
			return { outcome: { outcome: "cancelled" } };
		})
		.connect(ndJsonStream(pipes.toProxy, pipes.fromProxy));
	return {
		asked,
		agent: connection.agent,
		hangUp: async () => {
			connection.close();
			await pipes.toProxy.close().catch(() => undefined);
		},
	};
}

describe("proxy: a receipt at the end of the session", () => {
	test("the receipt records the session, its turns, tool calls, files and every permission answer", async () => {
		bridge.records.length = 0;
		const script: FakeScript = {
			steps: [
				{
					update: {
						sessionUpdate: "tool_call",
						toolCallId: "t-edit",
						title: "Edit a.ts",
						kind: "edit",
						status: "completed",
						content: [
							{ type: "diff", path: "src/a.ts", oldText: "a", newText: "b" },
						],
					},
				},
				{
					permission: {
						toolCall: shellCall("t-pub", "npm publish"),
						options: ONCE,
					},
				},
				{ permission: { toolCall: shellCall("t-ls", "ls"), options: ONCE } },
			],
		};
		const pipes = editorPipes();
		const { spawn, pids } = trackingSpawn();
		let clock = 1000;
		const proxy = startProxy(
			{ editor: pipes.io, agent: fakeAgentSpec(script), root: ROOT, bridge },
			{ spawn, now: () => (clock += 500) },
		);
		const editor = sdkEditor(pipes);

		const init = await editor.agent.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
			},
		});
		expect(init.protocolVersion).toBe(PROTOCOL_VERSION);
		const session = await editor.agent.buildSession(ROOT).start();
		void session.prompt("fix the bug").catch(() => undefined);
		const messages: string[] = [];
		let stopReason: string | undefined;
		for (;;) {
			const message = await session.nextUpdate();
			if (message.kind === "stop") {
				stopReason = message.stopReason;
				break;
			}
			const { update } = message;
			if (
				update.sessionUpdate === "agent_message_chunk" &&
				update.content.type === "text"
			) {
				messages.push(update.content.text);
			}
		}
		expect(stopReason).toBe("end_turn");
		// The gate answered both requests; the editor was never asked.
		expect(messages).toEqual(["permission:no", "permission:yes"]);
		expect(editor.asked).toEqual([]);
		session.dispose();

		await editor.hangUp();
		const done = await within(proxy.done);
		if (done === "timeout" || !done.ok) {
			throw new Error(`proxy did not end cleanly: ${JSON.stringify(done)}`);
		}
		const receipt: ProxyReceipt = done.value;
		expect(receipt).toEqual({
			agent: "fake",
			endedBy: "editor",
			startedAt: 1500,
			endedAt: 2000,
			sessions: [
				{
					sessionId: "fake-session",
					cwd: ROOT,
					prompts: 1,
					stopReasons: ["end_turn"],
					toolCalls: 3,
					files: ["src/a.ts"],
				},
			],
			permissions: [
				expect.objectContaining({
					sessionId: "fake-session",
					toolCallId: "t-pub",
					verdict: "deny",
					answeredBy: "gate",
					answer: "reject_once",
				}),
				expect.objectContaining({
					sessionId: "fake-session",
					toolCallId: "t-ls",
					verdict: "allow",
					answeredBy: "gate",
					answer: "allow_once",
				}),
			],
		});
		expect(isAlive(pids[0] as number)).toBe(false);
	});
});

// ── disconnects ─────────────────────────────────────────────────────────────

describe("proxy: disconnecting either side cleans up the other", () => {
	test("the editor hanging up mid-turn stops the agent process", async () => {
		const pipes = editorPipes();
		const { spawn, pids } = trackingSpawn();
		const proxy = startProxy(
			{
				editor: pipes.io,
				agent: fakeAgentSpec({ steps: [{ hang: true }], ignoreCancel: true }),
				root: ROOT,
				bridge,
			},
			{ spawn, killGraceMs: 200 },
		);
		const editor = sdkEditor(pipes);
		await editor.agent.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {},
		});
		const session = await editor.agent.buildSession(ROOT).start();
		void session.prompt("hang").catch(() => undefined);
		expect(pids).toHaveLength(1);
		expect(isAlive(pids[0] as number)).toBe(true);

		await editor.hangUp();
		const done = await within(proxy.done);
		expect(done).toMatchObject({ ok: true, value: { endedBy: "editor" } });
		expect(isAlive(pids[0] as number)).toBe(false);
	});

	test("the agent dying mid-turn closes the editor's side", async () => {
		const pipes = editorPipes();
		const proxy = startProxy(
			{
				editor: pipes.io,
				agent: fakeAgentSpec({ steps: [{ exit: 3 }] }),
				root: ROOT,
				bridge,
			},
			{ killGraceMs: 200 },
		);
		const writer = pipes.toProxy.getWriter();
		const reader = lineReader(pipes.fromProxy);
		const send = (message: object) =>
			writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
		await send({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} },
		});
		expect(await reader.next()).toContain('"protocolVersion"');
		await send({
			jsonrpc: "2.0",
			id: 1,
			method: "session/new",
			params: { cwd: ROOT, mcpServers: [] },
		});
		expect(await reader.next()).toContain('"fake-session"');
		await send({
			jsonrpc: "2.0",
			id: 2,
			method: "session/prompt",
			params: {
				sessionId: "fake-session",
				prompt: [{ type: "text", text: "die" }],
			},
		});

		// The editor's view: the agent's output ends...
		expect(await reader.next(5000)).toBeUndefined();
		const done = await within(proxy.done);
		expect(done).toMatchObject({
			ok: true,
			value: { endedBy: "agent", agentExitCode: 3 },
		});
		// ...and the proxy stops reading it: nothing more is taken from it.
		const late = await writer
			.write(encoder.encode('{"jsonrpc":"2.0","method":"x"}\n'))
			.then(
				() => "accepted",
				() => "refused",
			);
		expect(late).toBe("refused");
	});

	test("an agent that cannot be started ends the proxy with the error and closes the editor's side", async () => {
		const pipes = editorPipes();
		const proxy = startProxy({
			editor: pipes.io,
			agent: { name: "ghost", command: "/nonexistent/maina-acp-agent" },
			root: ROOT,
			bridge,
		});
		const done = await within(proxy.done);
		expect(done).toMatchObject({
			ok: false,
			error: { code: "spawn_failed" },
		});
		expect(await lineReader(pipes.fromProxy).next()).toBeUndefined();
	});

	test("the in-process agent is stopped when the editor hangs up", async () => {
		const pipes = editorPipes();
		const fake = inProcessAgent();
		const proxy = startProxy(
			{ editor: pipes.io, agent: FAKE, root: ROOT, bridge },
			{ spawn: fake.spawn },
		);
		await rawEditor(pipes).hangUp();
		expect(await within(proxy.done)).toMatchObject({
			ok: true,
			value: { endedBy: "editor", sessions: [], permissions: [] },
		});
		expect(fake.stopped()).toBe(true);
	});
});
