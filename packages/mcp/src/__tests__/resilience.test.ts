/**
 * Error isolation and the real version (FR-MCP-5): a tool that throws
 * answers with a structured `failed` error and the server keeps serving;
 * the server reports maina's own `VERSION`; and stdout carries nothing but
 * protocol frames, whatever a capability prints.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { VERSION } from "@mainahq/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startMcp } from "../server";
import { call, connect, expectEnvelope, fakeRuntime, text } from "./fixtures";

const boom = (): never => {
	throw new Error("capability blew up");
};

describe("a throwing tool", () => {
	test("a synchronous throw becomes a structured `failed` error", async () => {
		const { runtime } = fakeRuntime({ verify: boom });
		const client = await connect(runtime);
		const result = await call(client, "verify", { root: "/repo" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.data).toBeNull();
		expect(result.structuredContent?.error).toEqual({
			kind: "failed",
			message: "capability blew up",
		});
		expect(result.structuredContent?.meta).toMatchObject({
			tool: "verify",
			root: "/repo",
			version: VERSION,
		});
		expect(text(result)).toContain("capability blew up");
	});

	test("a rejected promise becomes a structured `failed` error", async () => {
		const { runtime } = fakeRuntime({
			status: () => Promise.reject(new Error("rejected inside status")),
		});
		const client = await connect(runtime);
		const result = await call(client, "status", { root: "/repo" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error).toEqual({
			kind: "failed",
			message: "rejected inside status",
		});
	});

	test("a non-Error throw keeps its text", async () => {
		const { runtime } = fakeRuntime({
			status: () => Promise.reject("plain string"),
		});
		const client = await connect(runtime);
		const result = await call(client, "status", { root: "/repo" });
		expect(result.structuredContent?.error).toEqual({
			kind: "failed",
			message: "plain string",
		});
	});

	test("a throwing root resolver is isolated the same way", async () => {
		const { runtime } = fakeRuntime({ resolveRoot: boom });
		const client = await connect(runtime);
		const result = await call(client, "status", {});
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.kind).toBe("failed");
		expect(result.structuredContent?.meta).toMatchObject({
			tool: "status",
			root: null,
			version: VERSION,
		});
	});

	test("the server keeps serving after a tool throws", async () => {
		const { runtime } = fakeRuntime({ verify: boom });
		const client = await connect(runtime);
		expect((await call(client, "verify", { root: "/repo" })).isError).toBe(
			true,
		);
		expectEnvelope(
			await call(client, "status", { root: "/repo" }),
			"status",
			"/repo",
		);
		expect((await call(client, "verify", { root: "/repo" })).isError).toBe(
			true,
		);
		expect((await client.listTools()).tools.length).toBeGreaterThan(0);
	});
});

describe("version", () => {
	test("serverInfo.version is maina's VERSION", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime);
		expect(client.getServerVersion()).toEqual({
			name: "maina",
			version: VERSION,
		});
	});

	test("status and meta report the same VERSION", async () => {
		const { runtime } = fakeRuntime();
		const client = await connect(runtime);
		const result = await call(client, "status", { root: "/repo" });
		const data = result.structuredContent?.data as { version: string };
		expect(data.version).toBe(VERSION);
		expect(result.structuredContent?.meta.version).toBe(VERSION);
	});
});

// ── stdout carries protocol frames only ─────────────────────────────────────

describe("stdout while serving (spy)", () => {
	// startMcp reroutes these for the whole process; put them back.
	const saved = { ...console };
	afterEach(() => {
		Object.assign(console, saved);
	});

	test("console output from a capability goes to stderr, never stdout", async () => {
		const stdout = spyOn(process.stdout, "write");
		const stderr = spyOn(process.stderr, "write").mockImplementation(
			() => true,
		);
		try {
			const { runtime } = fakeRuntime({
				status: async () => {
					// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
					console.log("noise", { from: "log" });
					// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
					console.info("noise from info");
					// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
					console.debug("noise from debug");
					return {
						ok: true,
						value: {
							graphIndexed: false,
							wikiInitialized: false,
							policyErrors: [],
						},
					};
				},
			});
			const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
			await startMcp(runtime, {}, serverSide);
			const client = new Client({ name: "resilience", version: "0" });
			await client.connect(clientSide);
			await call(client, "status", { root: "/repo" });

			expect(stdout).not.toHaveBeenCalled();
			const written = stderr.mock.calls.map((c) => String(c[0])).join("");
			expect(written).toContain("noise { from: 'log' }");
			expect(written).toContain("noise from info");
			expect(written).toContain("noise from debug");
		} finally {
			stdout.mockRestore();
			stderr.mockRestore();
		}
	});
});

const FIXTURE = join(import.meta.dir, "stdio-fixture.ts");

type Frame = Readonly<{
	jsonrpc?: string;
	id?: number;
	result?: {
		serverInfo?: { name: string; version: string };
		isError?: boolean;
		structuredContent?: { error: { kind: string; message: string } | null };
	};
}>;

function parseFrame(line: string): Frame | undefined {
	try {
		return JSON.parse(line) as Frame;
	} catch {
		return undefined;
	}
}

describe("stdout of a real stdio server", () => {
	test("every stdout line is a JSON-RPC frame; console noise lands on stderr", async () => {
		const proc = Bun.spawn(["bun", FIXTURE], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const send = (msg: Record<string, unknown>) =>
			proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
		send({
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "resilience", version: "0" },
			},
		});
		send({ method: "notifications/initialized" });
		const status = { name: "status", arguments: { root: "/repo" } };
		send({ id: 2, method: "tools/call", params: status });
		send({
			id: 3,
			method: "tools/call",
			params: { name: "verify", arguments: { root: "/repo" } },
		});
		send({ id: 4, method: "tools/call", params: status });
		await proc.stdin.flush();

		const lines: string[] = [];
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for await (const chunk of proc.stdout) {
				buffer += decoder.decode(chunk, { stream: true });
				const parts = buffer.split("\n");
				buffer = parts.pop() ?? "";
				lines.push(...parts.filter((l) => l.trim() !== ""));
				if (lines.some((l) => parseFrame(l)?.id === 4)) break;
			}
		} finally {
			proc.kill();
			await proc.exited;
		}
		const stderr = await new Response(proc.stderr).text();

		const notFrames = lines.filter((l) => parseFrame(l)?.jsonrpc !== "2.0");
		expect(notFrames).toEqual([]);
		const frames = lines.flatMap((l) => parseFrame(l) ?? []);
		const byId = new Map(frames.map((f) => [f.id, f]));
		expect(byId.get(1)?.result?.serverInfo?.version).toBe(VERSION);
		expect(byId.get(2)?.result?.isError).toBeFalsy();
		expect(byId.get(3)?.result?.isError).toBe(true);
		expect(byId.get(3)?.result?.structuredContent?.error).toEqual({
			kind: "failed",
			message: "verify blew up",
		});
		expect(byId.get(4)?.result?.isError).toBeFalsy();
		expect(stderr).toContain("noise from console.log");
		expect(stderr).toContain("noise from console.info");
		expect(stderr).toContain("noise from console.debug");
		expect(stderr).toContain("from console.table");
	}, 20_000);
});
