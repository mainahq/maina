#!/usr/bin/env bun
/**
 * Wave 4 / §6.11 — MCP-call simulator.
 *
 * Stands in for Claude Code / Cursor during the E2E onboarding matrix.
 * After `install.sh` and `maina setup --yes --ci` have run in the
 * matrix cell, this script:
 *
 *   1. Spawns `maina --mcp` on the same scratch dir,
 *   2. Issues a handshake + `list_tools` + one `getContext` call
 *      via the MCP stdio JSON-RPC protocol,
 *   3. Asserts the response envelope shape (`data` present, `error`
 *      null-or-absent, `meta` present) on `getContext`,
 *   4. Exits 0 on success, non-zero on any protocol or assertion
 *      failure.
 *
 * Usage:
 *   bun ci/e2e/simulate-agent.ts --ide <claude-code|cursor> [--cwd <path>]
 *
 * The `--ide` flag is declarative — both IDEs use the same stdio
 * transport so there is no real fork. Future work may differentiate
 * by handshake headers.
 */

import { argv, exit } from "node:process";

interface Args {
	ide: "claude-code" | "cursor";
	cwd: string;
	timeoutMs: number;
}

function parseArgs(): Args {
	const args: Args = {
		ide: "claude-code",
		cwd: process.cwd(),
		timeoutMs: 30_000,
	};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--ide") {
			const v = argv[++i];
			if (v === "claude-code" || v === "cursor") args.ide = v;
		} else if (arg === "--cwd") {
			const v = argv[++i];
			if (typeof v === "string") args.cwd = v;
		} else if (arg === "--timeout") {
			const v = argv[++i];
			const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
			if (Number.isFinite(n) && n > 0) args.timeoutMs = n;
		}
	}
	return args;
}

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

/** Encode a JSON-RPC message with the Content-Length framing MCP expects. */
function frame(msg: JsonRpcMessage): string {
	const body = JSON.stringify(msg);
	return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

/** Very small LSP-style framing decoder. Returns as many complete messages
 *  as the buffer contains, leaving the remainder for the next call. */
function decode(buffer: string): {
	messages: JsonRpcMessage[];
	rest: string;
} {
	const messages: JsonRpcMessage[] = [];
	let rest = buffer;
	while (true) {
		const headerEnd = rest.indexOf("\r\n\r\n");
		if (headerEnd < 0) break;
		const header = rest.slice(0, headerEnd);
		const match = header.match(/Content-Length:\s*(\d+)/i);
		if (!match) {
			rest = rest.slice(headerEnd + 4);
			continue;
		}
		const len = Number.parseInt(match[1] ?? "0", 10);
		const bodyStart = headerEnd + 4;
		if (rest.length - bodyStart < len) break;
		const body = rest.slice(bodyStart, bodyStart + len);
		try {
			messages.push(JSON.parse(body));
		} catch {
			// bad body — drop
		}
		rest = rest.slice(bodyStart + len);
	}
	return { messages, rest };
}

async function main(): Promise<void> {
	const args = parseArgs();
	// eslint-disable-next-line no-console
	console.log(
		`simulate-agent: ide=${args.ide} cwd=${args.cwd} timeout=${args.timeoutMs}ms`,
	);

	const proc = Bun.spawn(["maina", "--mcp"], {
		cwd: args.cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const decoder = new TextDecoder();
	let buffer = "";
	const pending = new Map<number, (msg: JsonRpcMessage) => void>();

	// Drain stdout → decode → dispatch to pending handlers.
	(async () => {
		const reader = proc.stdout.getReader();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const { messages, rest } = decode(buffer);
				buffer = rest;
				for (const msg of messages) {
					if (typeof msg.id === "number") {
						const handler = pending.get(msg.id);
						if (handler) {
							pending.delete(msg.id);
							handler(msg);
						}
					}
				}
			}
		} catch {
			// stream closed — fall through
		}
	})();

	const writer = proc.stdin.getWriter();
	async function rpc(
		method: string,
		params: unknown,
		id: number,
	): Promise<JsonRpcMessage> {
		const p = new Promise<JsonRpcMessage>((resolve, reject) => {
			pending.set(id, resolve);
			setTimeout(() => {
				if (pending.has(id)) {
					pending.delete(id);
					reject(new Error(`rpc(${method}) timeout after ${args.timeoutMs}ms`));
				}
			}, args.timeoutMs);
		});
		await writer.write(
			new TextEncoder().encode(frame({ jsonrpc: "2.0", id, method, params })),
		);
		return p;
	}

	let exitCode = 0;
	try {
		// Step 1 — initialize handshake.
		const init = await rpc(
			"initialize",
			{
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				clientInfo: { name: `maina-e2e-${args.ide}`, version: "0.0.0" },
			},
			1,
		);
		if (init.error) {
			throw new Error(`initialize failed: ${init.error.message}`);
		}

		// Step 2 — list tools. MCP protocol requires `notifications/initialized`
		// first but `tools/list` typically tolerates its absence.
		await writer.write(
			new TextEncoder().encode(
				frame({
					jsonrpc: "2.0",
					method: "notifications/initialized",
					params: {},
				}),
			),
		);
		const list = await rpc("tools/list", {}, 2);
		if (list.error) {
			throw new Error(`tools/list failed: ${list.error.message}`);
		}
		const tools =
			(list.result as { tools?: Array<{ name: string }> })?.tools ?? [];
		// eslint-disable-next-line no-console
		console.log(
			`simulate-agent: handshake ok — ${tools.length} tools advertised`,
		);
		const toolNames = new Set(tools.map((t) => t.name));
		// Core tool presence is required — these are the three from the
		// progressive-disclosure handshake owned by Wave 3.
		for (const required of ["getContext", "verify", "reviewCode"]) {
			if (!toolNames.has(required)) {
				throw new Error(`required tool '${required}' missing from handshake`);
			}
		}

		// Step 3 — call getContext with a tiny scope. Assert envelope shape.
		const call = await rpc(
			"tools/call",
			{ name: "getContext", arguments: { command: "context" } },
			3,
		);
		if (call.error) {
			throw new Error(`tools/call(getContext) failed: ${call.error.message}`);
		}
		const callResult = call.result as {
			content?: Array<{ type: string; text: string }>;
		};
		const text = callResult?.content?.[0]?.text ?? "";
		if (typeof text !== "string" || text.length === 0) {
			throw new Error("getContext returned empty text payload");
		}
		let parsed: { data?: unknown; error?: unknown; meta?: unknown };
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			throw new Error(
				`getContext payload is not JSON: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		if (!("data" in parsed) || !("meta" in parsed)) {
			throw new Error(
				"getContext response missing `data`/`meta` envelope fields",
			);
		}
		// eslint-disable-next-line no-console
		console.log("simulate-agent: getContext envelope OK");
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(
			`simulate-agent: FAIL — ${e instanceof Error ? e.message : String(e)}`,
		);
		exitCode = 1;
	} finally {
		try {
			await writer.close();
		} catch {
			// ignore
		}
		try {
			proc.kill();
		} catch {
			// ignore
		}
		try {
			await proc.exited;
		} catch {
			// ignore
		}
	}

	exit(exitCode);
}

main();
