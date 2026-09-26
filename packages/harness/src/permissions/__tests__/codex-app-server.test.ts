/**
 * Codex app-server approvals (FR-HAR-2): `codex app-server` asks its client
 * before it runs a command or applies a patch. Every such request is
 * answered from the gate and logged; a standing approval is never given.
 *
 * The app-server here is scripted over in-memory streams, speaking the same
 * newline-delimited JSON-RPC (without the `jsonrpc` field) Codex does.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
	attachCodexApprovals,
	type CodexRpc,
	connectCodexAppServer,
} from "../codex-app-server";
import { DENY_PUBLISH, type TestBridge, testBridge } from "./gate-fixture";

const ROOT = "/work/repo";

type Message = Readonly<Record<string, unknown>>;

/** A scripted app-server: send it lines, read back the client's answers. */
function fakeServer(): Readonly<{
	rpc: CodexRpc;
	send: (message: Message) => Promise<void>;
	next: () => Promise<Message>;
	end: () => Promise<void>;
}> {
	const toClient = new TransformStream<Uint8Array, Uint8Array>();
	const toServer = new TransformStream<Uint8Array, Uint8Array>();
	const rpc = connectCodexAppServer({
		input: toServer.writable,
		output: toClient.readable,
	});
	const writer = toClient.writable.getWriter();
	const reader = toServer.readable.getReader();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let buffered = "";
	const next = async (): Promise<Message> => {
		for (;;) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				return JSON.parse(line);
			}
			const chunk = await reader.read();
			if (chunk.done) throw new Error("client closed");
			buffered += decoder.decode(chunk.value, { stream: true });
		}
	};
	return {
		rpc,
		send: (message) =>
			writer.write(encoder.encode(`${JSON.stringify(message)}\n`)),
		next,
		end: () => writer.close(),
	};
}

let bridge: TestBridge;
beforeAll(async () => {
	bridge = await testBridge();
});

async function ask(
	server: ReturnType<typeof fakeServer>,
	id: number,
	method: string,
	params: Message,
): Promise<Message> {
	await server.send({ id, method, params });
	return server.next();
}

describe("attachCodexApprovals", () => {
	test("command approvals are answered from the gate: accept, never acceptForSession", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		const base = { threadId: "th-1", turnId: "tu-1", cwd: ROOT };

		expect(
			await ask(server, 1, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c1",
				command: "ls -la",
			}),
		).toEqual({ id: 1, result: { decision: "accept" } });
		expect(
			await ask(server, 2, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c2",
				command: "npm publish",
			}),
		).toEqual({ id: 2, result: { decision: "decline" } });
		// No readable command: opaque, so declined.
		expect(
			await ask(server, 3, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c3",
			}),
		).toEqual({ id: 3, result: { decision: "decline" } });

		expect(
			bridge.records.map((r) => [r.toolCallId, r.verdict, r.answer]),
		).toEqual([
			["c1", "allow", "accept"],
			["c2", "deny", "decline"],
			["c3", "ask", "decline"],
		]);
		expect(bridge.records[1]).toMatchObject({
			source: "codex-app-server",
			host: "codex",
			sessionId: "th-1",
			gate: [
				expect.objectContaining({
					kind: "shell",
					action: { command: "npm publish", cwd: ROOT },
				}),
			],
		});
		await server.end();
	});

	test("file-change approvals are judged against the changes the item announced", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		await server.send({
			method: "item/started",
			params: {
				threadId: "th-1",
				turnId: "tu-1",
				item: {
					type: "fileChange",
					id: "f1",
					status: "inProgress",
					changes: [
						{ path: `${ROOT}/src/a.ts`, kind: { type: "add" }, diff: "x" },
					],
				},
			},
		});
		await server.send({
			method: "item/started",
			params: {
				threadId: "th-1",
				turnId: "tu-1",
				item: {
					type: "fileChange",
					id: "f2",
					status: "inProgress",
					changes: [
						{
							path: `${ROOT}/src/b.ts`,
							kind: { type: "update", move_path: "/etc/profile" },
							diff: "@@",
						},
					],
				},
			},
		});
		const base = { threadId: "th-1", turnId: "tu-1" };
		expect(
			await ask(server, 10, "item/fileChange/requestApproval", {
				...base,
				itemId: "f1",
			}),
		).toEqual({ id: 10, result: { decision: "accept" } });
		// A move out of the workspace writes /etc/profile: irreversible, asks,
		// so it is declined.
		expect(
			await ask(server, 11, "item/fileChange/requestApproval", {
				...base,
				itemId: "f2",
			}),
		).toEqual({ id: 11, result: { decision: "decline" } });
		// An item the server never announced: nothing to judge, so declined.
		expect(
			await ask(server, 12, "item/fileChange/requestApproval", {
				...base,
				itemId: "ghost",
			}),
		).toEqual({ id: 12, result: { decision: "decline" } });
		expect(bridge.records[1]?.gate.map((g) => g.action)).toEqual([
			{ path: `${ROOT}/src/b.ts`, content: "@@" },
			{ path: "/etc/profile" },
		]);
		expect(bridge.records.map((r) => r.answer)).toEqual([
			"accept",
			"decline",
			"decline",
		]);
		await server.end();
	});

	test("legacy execCommandApproval and applyPatchApproval get approved or denied", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		expect(
			await ask(server, 20, "execCommandApproval", {
				conversationId: "conv-1",
				callId: "e1",
				command: ["npm", "publish"],
				cwd: ROOT,
				parsedCmd: [],
			}),
		).toEqual({ id: 20, result: { decision: "denied" } });
		expect(
			await ask(server, 21, "execCommandApproval", {
				conversationId: "conv-1",
				callId: "e2",
				command: ["git", "status"],
				cwd: ROOT,
				parsedCmd: [],
			}),
		).toEqual({ id: 21, result: { decision: "approved" } });
		expect(
			await ask(server, 22, "applyPatchApproval", {
				conversationId: "conv-1",
				callId: "p1",
				fileChanges: {
					[`${ROOT}/README.md`]: { type: "add", content: "hello" },
				},
			}),
		).toEqual({ id: 22, result: { decision: "approved" } });
		expect(
			await ask(server, 23, "applyPatchApproval", {
				conversationId: "conv-1",
				callId: "p2",
				fileChanges: { "/home/dev/.zshrc": { type: "delete", content: "" } },
			}),
		).toEqual({ id: 23, result: { decision: "denied" } });
		expect(bridge.records.map((r) => [r.toolCallId, r.answer])).toEqual([
			["e1", "denied"],
			["e2", "approved"],
			["p1", "approved"],
			["p2", "denied"],
		]);
		expect(bridge.records[0]?.sessionId).toBe("conv-1");
		await server.end();
	});

	test("a patch updated after it was announced is judged as updated, not as first announced", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		const base = { threadId: "th-1", turnId: "tu-1" };
		await server.send({
			method: "item/started",
			params: {
				...base,
				item: {
					type: "fileChange",
					id: "f3",
					status: "inProgress",
					changes: [
						{ path: `${ROOT}/src/a.ts`, kind: { type: "add" }, diff: "x" },
					],
				},
			},
		});
		await server.send({
			method: "item/fileChange/patchUpdated",
			params: {
				...base,
				itemId: "f3",
				changes: [
					{ path: `${ROOT}/src/a.ts`, kind: { type: "add" }, diff: "x" },
					{
						path: "/home/dev/.zshrc",
						kind: { type: "update", move_path: null },
						diff: "@@",
					},
				],
			},
		});
		expect(
			await ask(server, 13, "item/fileChange/requestApproval", {
				...base,
				itemId: "f3",
			}),
		).toEqual({ id: 13, result: { decision: "decline" } });
		expect(bridge.records[0]?.gate.map((g) => g.action)).toEqual([
			{ path: `${ROOT}/src/a.ts`, content: "x" },
			{ path: "/home/dev/.zshrc", content: "@@" },
		]);
		await server.end();
	});

	test("a request for a standing write grant (grantRoot) is declined, however safe the change", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		const base = { threadId: "th-1", turnId: "tu-1" };
		await server.send({
			method: "item/started",
			params: {
				...base,
				item: {
					type: "fileChange",
					id: "f4",
					status: "inProgress",
					changes: [
						{ path: `${ROOT}/src/a.ts`, kind: { type: "add" }, diff: "x" },
					],
				},
			},
		});
		expect(
			await ask(server, 14, "item/fileChange/requestApproval", {
				...base,
				itemId: "f4",
				grantRoot: "/",
			}),
		).toEqual({ id: 14, result: { decision: "decline" } });
		expect(
			await ask(server, 24, "applyPatchApproval", {
				conversationId: "conv-1",
				callId: "p3",
				fileChanges: { [`${ROOT}/README.md`]: { type: "add", content: "hi" } },
				grantRoot: ROOT,
			}),
		).toEqual({ id: 24, result: { decision: "denied" } });
		expect(bridge.records.map((r) => [r.verdict, r.answer])).toEqual([
			["deny", "decline"],
			["deny", "denied"],
		]);
		expect(bridge.records[0]?.reason).toContain("standing");
		await server.end();
	});

	test("a command approval asking for network access is judged on the host too", async () => {
		const strict = await testBridge({
			...DENY_PUBLISH,
			rules: {
				allow: [],
				deny: [{ match: "npm publish" }, { match: "evil.example" }],
			},
		});
		const server = fakeServer();
		attachCodexApprovals(server.rpc, strict, { root: ROOT });
		const base = { threadId: "th-1", turnId: "tu-1", cwd: ROOT };
		expect(
			await ask(server, 15, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c4",
				command: "ls",
				networkApprovalContext: { host: "evil.example", protocol: "https" },
			}),
		).toEqual({ id: 15, result: { decision: "decline" } });
		expect(strict.records[0]?.gate).toEqual([
			expect.objectContaining({ kind: "shell" }),
			expect.objectContaining({
				kind: "network",
				action: { url: "https://evil.example" },
			}),
		]);
		expect(
			await ask(server, 16, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c5",
				command: "ls",
				networkApprovalContext: { host: "ok.example", protocol: "https" },
			}),
		).toEqual({ id: 16, result: { decision: "accept" } });
		await server.end();
	});

	test("a command approval the gate cannot judge whole is declined: extra permissions, stdin", async () => {
		bridge.records.length = 0;
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		const base = { threadId: "th-1", turnId: "tu-1", cwd: ROOT };
		expect(
			await ask(server, 17, "item/commandExecution/requestApproval", {
				...base,
				itemId: "c6",
				command: "ls",
				additionalPermissions: { fileSystem: { write: ["/"] } },
			}),
		).toEqual({ id: 17, result: { decision: "decline" } });
		expect(
			await ask(server, 18, "item/commandExecution/requestApproval", {
				...base,
				kind: "writeStdin",
				itemId: "c7",
				command: "ls",
			}),
		).toEqual({ id: 18, result: { decision: "decline" } });
		// An explicit `command` kind is an ordinary command approval.
		expect(
			await ask(server, 19, "item/commandExecution/requestApproval", {
				...base,
				kind: "command",
				itemId: "c8",
				command: "ls",
			}),
		).toEqual({ id: 19, result: { decision: "accept" } });
		expect(bridge.records.map((r) => r.verdict)).toEqual([
			"deny",
			"deny",
			"allow",
		]);
		await server.end();
	});

	test("a request maina does not serve gets a JSON-RPC error, not an approval", async () => {
		const server = fakeServer();
		attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		const reply = await ask(server, 30, "item/tool/requestUserInput", {});
		expect(reply).toMatchObject({ id: 30, error: { code: -32601 } });
		await server.end();
	});

	test("once detached, approval requests are no longer answered allow", async () => {
		const server = fakeServer();
		const detach = attachCodexApprovals(server.rpc, bridge, { root: ROOT });
		detach();
		const reply = await ask(
			server,
			40,
			"item/commandExecution/requestApproval",
			{
				threadId: "th-1",
				turnId: "tu-1",
				itemId: "c9",
				command: "ls",
			},
		);
		expect(reply).toMatchObject({ id: 40, error: { code: -32601 } });
		await server.end();
	});

	test("the connection closes when the server's output ends", async () => {
		const server = fakeServer();
		await server.end();
		await server.rpc.closed;
	});
});
