/**
 * MCP sessions over Streamable HTTP (FR-REM-1).
 *
 * An `initialize` POST without a session id opens a session: a fresh MCP
 * server connected to a web-standard Streamable HTTP transport, which
 * answers with the new `Mcp-Session-Id`. Later requests carry that id and
 * are routed to the same transport. A session belongs to the OAuth client
 * and subject that opened it: presented by anyone else, or unknown, it is
 * 404 (the MCP spec's signal to re-initialize). Sessions end on DELETE,
 * when idle longer than `idleMs`, or when the service closes.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

type SessionOwner = Readonly<{ clientId: string; subject: string }>;

type SessionOptions = Readonly<{
	/** A new MCP server for a new session. */
	open: () => McpServer;
	now: () => number;
	idleMs: number;
	maxSessions: number;
}>;

type Sessions = Readonly<{
	handle: (
		req: Request,
		owner: SessionOwner,
		authInfo: AuthInfo,
	) => Promise<Response>;
	count: () => number;
	closeAll: () => Promise<void>;
}>;

type Session = Readonly<{
	server: McpServer;
	transport: WebStandardStreamableHTTPServerTransport;
	owner: SessionOwner;
	lastSeen: number;
}>;

const rpcError = (status: number, code: number, message: string): Response =>
	new Response(
		JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
		{ status, headers: { "content-type": "application/json" } },
	);

const sameOwner = (a: SessionOwner, b: SessionOwner): boolean =>
	a.clientId === b.clientId && a.subject === b.subject;

export function createSessions(options: SessionOptions): Sessions {
	const sessions = new Map<string, Session>();
	/** Initialize requests between the cap check and their session opening. */
	let opening = 0;

	async function end(id: string): Promise<void> {
		const session = sessions.get(id);
		if (session === undefined) return;
		sessions.delete(id);
		await session.server.close().catch(() => undefined);
	}

	async function sweep(): Promise<void> {
		const cutoff = options.now() - options.idleMs;
		const idle = [...sessions]
			.filter(([, s]) => s.lastSeen <= cutoff)
			.map(([id]) => id);
		await Promise.all(idle.map(end));
	}

	async function open(
		req: Request,
		owner: SessionOwner,
		authInfo: AuthInfo,
	): Promise<Response> {
		const body: unknown = await req.json().catch(() => undefined);
		if (body === undefined) return rpcError(400, -32700, "Parse error");
		if (!isInitializeRequest(body)) {
			return rpcError(
				400,
				-32000,
				"Bad Request: no valid session id; send initialize first",
			);
		}
		// Initializes still in flight count too, or concurrent ones would all
		// pass the check before any of them registers its session.
		if (sessions.size + opening >= options.maxSessions) {
			return rpcError(503, -32000, "Too many open sessions; retry later");
		}
		opening += 1;
		try {
			const server = options.open();
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (id) => {
					sessions.set(id, {
						server,
						transport,
						owner,
						lastSeen: options.now(),
					});
				},
				onsessionclosed: (id) => {
					sessions.delete(id);
				},
			});
			await server.connect(transport);
			return await transport.handleRequest(req, { parsedBody: body, authInfo });
		} finally {
			opening -= 1;
		}
	}

	return {
		handle: async (req, owner, authInfo) => {
			await sweep();
			const id = req.headers.get("mcp-session-id");
			if (id === null) {
				return req.method === "POST"
					? open(req, owner, authInfo)
					: rpcError(400, -32000, "Bad Request: Mcp-Session-Id is required");
			}
			const session = sessions.get(id);
			if (session === undefined || !sameOwner(session.owner, owner)) {
				return rpcError(404, -32001, "Session not found");
			}
			sessions.set(id, { ...session, lastSeen: options.now() });
			return session.transport.handleRequest(req, { authInfo });
		},
		count: () => sessions.size,
		closeAll: async () => {
			await Promise.all([...sessions.keys()].map(end));
		},
	};
}
