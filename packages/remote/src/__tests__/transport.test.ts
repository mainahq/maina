/**
 * The remote MCP service (FR-REM-1, FR-REM-5): the MCP handshake over
 * Streamable HTTP behind OAuth 2.1, driven by the official SDK client
 * (discovery, dynamic registration, PKCE, then the session), bearer checks
 * on every request, per-client sessions with idle expiry, and a tool list
 * with no action-gate capability.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ALL_TOOLS, DEFAULT_TOOLS, type McpRuntime } from "@mainahq/mcp";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { basicAuthenticator, TOOLS_SCOPE } from "../auth";
import {
	createRemoteService,
	type RemoteService,
	readRemoteConfig,
} from "../server";
import { GATE_DECISION_TYPES, REMOTE_TOOLS, remoteTools } from "../tools";
import {
	approve,
	type Clock,
	clock,
	type Handle,
	ISSUER,
	issueToken,
	OWNER,
	REDIRECT,
	RESOURCE,
} from "./helpers";

const WORKSPACE = "/srv/maina/workspace";

type Call = Readonly<{ method: string; args: unknown }>;

function fakeRuntime(): { runtime: McpRuntime; calls: Call[] } {
	const calls: Call[] = [];
	const unused = () =>
		Promise.resolve({
			ok: false as const,
			error: { kind: "failed" as const, message: "not used in this test" },
		});
	const runtime: McpRuntime = {
		resolveRoot: (explicit) => {
			calls.push({ method: "resolveRoot", args: explicit });
			return Promise.resolve({
				ok: true,
				value: explicit ?? "/cwd/of/process",
			});
		},
		status: (call) => {
			calls.push({ method: "status", args: call });
			return Promise.resolve({
				ok: true,
				value: { graphIndexed: true, wikiInitialized: false, policyErrors: [] },
			});
		},
		decide: (call) => {
			calls.push({ method: "decide", args: call });
			return Promise.resolve({
				ok: true,
				value: [
					{
						id: "q1",
						type: call.request.type,
						answer: true,
						distribution: [
							{ answer: true, p: 0.9 },
							{ answer: false, p: 0.1 },
						],
						confidence: 0.9,
						backend: { id: "rules", version: "1" },
						latencyMs: 0,
					},
				],
			});
		},
		verify: unused,
		impact: unused,
		context: unused,
		review: unused,
		specCheck: unused,
		receipts: unused,
		wiki: { ask: unused, structure: unused, contents: unused },
	};
	return { runtime, calls };
}

let open: RemoteService[] = [];
afterEach(async () => {
	await Promise.all(open.map((s) => s.close()));
	open = [];
});

function setup(
	options: Readonly<{
		tools?: readonly string[];
		idleSeconds?: number;
		maxSessions?: number;
		registrationLimit?: Readonly<{ max: number; windowSeconds: number }>;
		trustedProxies?: number;
	}> = {},
): {
	service: RemoteService;
	handle: Handle;
	fetchFn: typeof fetch;
	calls: Call[];
	time: Clock;
} {
	const time = clock();
	const { runtime, calls } = fakeRuntime();
	const service = createRemoteService({
		issuer: ISSUER,
		root: WORKSPACE,
		runtime,
		authenticate: basicAuthenticator(OWNER),
		scopes: [TOOLS_SCOPE, "jobs:read"],
		now: time.now,
		accessTokenTtlSeconds: 600,
		...(options.tools !== undefined ? { tools: options.tools } : {}),
		...(options.idleSeconds !== undefined
			? { sessionIdleSeconds: options.idleSeconds }
			: {}),
		...(options.maxSessions !== undefined
			? { maxSessions: options.maxSessions }
			: {}),
		...(options.registrationLimit !== undefined
			? { registrationLimit: options.registrationLimit }
			: {}),
		...(options.trustedProxies !== undefined
			? { trustedProxies: options.trustedProxies }
			: {}),
	});
	open.push(service);
	const handle: Handle = (req) => service.fetch(req);
	const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
		service.fetch(new Request(input, init))) as typeof fetch;
	return { service, handle, fetchFn, calls, time };
}

/** An MCP client connected with a fixed bearer token. */
async function connect(
	fetchFn: typeof fetch,
	token: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
	const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
		fetch: fetchFn,
		requestInit: { headers: { authorization: `Bearer ${token}` } },
	});
	const client = new Client({ name: "remote-test", version: "1.0.0" });
	await client.connect(transport);
	return { client, transport };
}

const INIT = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "raw", version: "1" },
	},
};

function mcpPost(
	handle: Handle,
	body: unknown,
	headers: Record<string, string>,
): Promise<Response> {
	return handle(
		new Request(RESOURCE, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		}),
	);
}

describe("bearer protection on /mcp", () => {
	test("a request without a token is 401 and points at the resource metadata", async () => {
		const { handle } = setup();
		const res = await mcpPost(handle, INIT, {});
		expect(res.status).toBe(401);
		const challenge = res.headers.get("www-authenticate") ?? "";
		expect(challenge).toStartWith("Bearer ");
		expect(challenge).toContain(
			`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
		);
		expect(challenge).toContain(`scope="${TOOLS_SCOPE}"`);
	});

	test("an unknown token is 401 invalid_token", async () => {
		const { handle } = setup();
		const res = await mcpPost(handle, INIT, { authorization: "Bearer forged" });
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain(
			'error="invalid_token"',
		);
	});

	test("a token without the tools scope is 403 insufficient_scope", async () => {
		const { handle } = setup();
		const token = await issueToken(handle, "jobs:read");
		const res = await mcpPost(handle, INIT, {
			authorization: `Bearer ${token.access_token}`,
		});
		expect(res.status).toBe(403);
		const challenge = res.headers.get("www-authenticate") ?? "";
		expect(challenge).toContain('error="insufficient_scope"');
		expect(challenge).toContain(`scope="${TOOLS_SCOPE}"`);
	});

	test("an expired token is refused mid-session", async () => {
		const { handle, fetchFn, time } = setup();
		const token = await issueToken(handle);
		const { client } = await connect(fetchFn, token.access_token);
		expect((await client.listTools()).tools.length).toBeGreaterThan(0);
		time.advance(601_000);
		await expect(client.listTools()).rejects.toThrow();
		const res = await mcpPost(handle, INIT, {
			authorization: `Bearer ${token.access_token}`,
		});
		expect(res.status).toBe(401);
	});

	test("the health check and metadata need no token; unknown paths are 404", async () => {
		const { handle } = setup();
		expect((await handle(new Request(`${ISSUER}/healthz`))).status).toBe(200);
		expect(
			(
				await handle(
					new Request(`${ISSUER}/.well-known/oauth-protected-resource/mcp`),
				)
			).status,
		).toBe(200);
		expect((await handle(new Request(`${ISSUER}/nope`))).status).toBe(404);
	});
});

describe("CORS on /mcp for browser-based MCP clients", () => {
	test("a preflight is 204 without a token and allows the MCP headers", async () => {
		const { handle } = setup();
		const res = await handle(
			new Request(RESOURCE, {
				method: "OPTIONS",
				headers: {
					origin: "https://app.example",
					"access-control-request-method": "POST",
					"access-control-request-headers":
						"authorization, content-type, mcp-session-id, mcp-protocol-version",
				},
			}),
		);
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		const methods = res.headers.get("access-control-allow-methods") ?? "";
		for (const m of ["GET", "POST", "DELETE"]) expect(methods).toContain(m);
		const allowed = res.headers.get("access-control-allow-headers") ?? "";
		for (const h of [
			"authorization",
			"content-type",
			"mcp-session-id",
			"mcp-protocol-version",
			"last-event-id",
		]) {
			expect(allowed).toContain(h);
		}
	});

	test("the 401 challenge is readable cross-origin, so a browser client can discover the metadata", async () => {
		const { handle } = setup();
		const res = await mcpPost(handle, INIT, { origin: "https://app.example" });
		expect(res.status).toBe(401);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-expose-headers")).toContain(
			"www-authenticate",
		);
	});

	test("an initialize response exposes the session id", async () => {
		const { handle } = setup();
		const token = await issueToken(handle);
		const res = await mcpPost(handle, INIT, {
			origin: "https://app.example",
			authorization: `Bearer ${token.access_token}`,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("mcp-session-id")).toBeTruthy();
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-expose-headers")).toContain(
			"mcp-session-id",
		);
		await res.body?.cancel();
	});

	test("the peer address reaches the registration rate limit", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
		});
		const registerAs = (address: string) =>
			service.fetch(
				new Request(`${ISSUER}/register`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						redirect_uris: [REDIRECT],
						token_endpoint_auth_method: "none",
					}),
				}),
				{ address },
			);
		expect((await registerAs("203.0.113.7")).status).toBe(201);
		expect((await registerAs("203.0.113.7")).status).toBe(429);
		expect((await registerAs("198.51.100.2")).status).toBe(201);
	});

	/** A registration arriving from the proxy at 10.0.0.2 with `forwardedFor`. */
	const viaProxy = (service: RemoteService, forwardedFor: string | undefined) =>
		service.fetch(
			new Request(`${ISSUER}/register`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(forwardedFor !== undefined
						? { "x-forwarded-for": forwardedFor }
						: {}),
				},
				body: JSON.stringify({
					redirect_uris: [REDIRECT],
					token_endpoint_auth_method: "none",
				}),
			}),
			{ address: "10.0.0.2" },
		);

	test("behind a trusted proxy each forwarded client has its own registration budget", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
			trustedProxies: 1,
		});
		expect((await viaProxy(service, "203.0.113.7")).status).toBe(201);
		expect((await viaProxy(service, "203.0.113.7")).status).toBe(429);
		// Another caller behind the same proxy is not locked out.
		expect((await viaProxy(service, "198.51.100.2")).status).toBe(201);
	});

	test("behind a trusted proxy only the address it appended counts, not what the caller claims", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
			trustedProxies: 1,
		});
		expect((await viaProxy(service, "1.1.1.1, 203.0.113.7")).status).toBe(201);
		expect((await viaProxy(service, "2.2.2.2, 203.0.113.7")).status).toBe(429);
	});

	test("behind two trusted proxies the address the outer one appended counts", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
			trustedProxies: 2,
		});
		// caller-claimed, then the TLS terminator's view, then the ingress's.
		expect(
			(await viaProxy(service, "1.1.1.1, 203.0.113.7, 10.0.0.9")).status,
		).toBe(201);
		expect(
			(await viaProxy(service, "2.2.2.2, 203.0.113.7, 10.0.0.9")).status,
		).toBe(429);
		expect((await viaProxy(service, "203.0.113.8, 10.0.0.9")).status).toBe(201);
	});

	test("without trusted proxies X-Forwarded-For is ignored", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
		});
		expect((await viaProxy(service, "203.0.113.7")).status).toBe(201);
		expect((await viaProxy(service, "198.51.100.2")).status).toBe(429);
	});

	test("a trusted proxy that sent no X-Forwarded-For falls back to the connection's address", async () => {
		const { service } = setup({
			registrationLimit: { max: 1, windowSeconds: 60 },
			trustedProxies: 1,
		});
		expect((await viaProxy(service, undefined)).status).toBe(201);
		expect((await viaProxy(service, undefined)).status).toBe(429);
	});
});

/** An in-memory OAuth client, as a host (Claude, Cursor) would keep one. */
function memoryProvider(): OAuthClientProvider & {
	pending: URL | undefined;
} {
	let info: OAuthClientInformationMixed | undefined;
	let tokens: OAuthTokens | undefined;
	let verifier = "";
	const provider = {
		pending: undefined as URL | undefined,
		get redirectUrl() {
			return REDIRECT;
		},
		get clientMetadata() {
			return {
				client_name: "sdk host",
				redirect_uris: [REDIRECT],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			};
		},
		clientInformation: () => info,
		saveClientInformation: (i: OAuthClientInformationMixed) => {
			info = i;
		},
		tokens: () => tokens,
		saveTokens: (t: OAuthTokens) => {
			tokens = t;
		},
		redirectToAuthorization: (url: URL) => {
			provider.pending = url;
		},
		saveCodeVerifier: (v: string) => {
			verifier = v;
		},
		codeVerifier: () => verifier,
	};
	return provider;
}

describe("the MCP handshake over Streamable HTTP with OAuth", () => {
	test("the SDK client discovers, registers, authorizes and lists the remote tools", async () => {
		const { fetchFn, handle } = setup();
		const provider = memoryProvider();
		const first = new StreamableHTTPClientTransport(new URL(RESOURCE), {
			authProvider: provider,
			fetch: fetchFn,
		});
		await expect(
			new Client({ name: "host", version: "1" }).connect(first),
		).rejects.toThrow();
		// Discovery and dynamic registration happened before the redirect.
		expect(provider.clientInformation()).toBeDefined();
		const pending = provider.pending;
		expect(pending?.origin).toBe(ISSUER);
		expect(pending?.searchParams.get("code_challenge_method")).toBe("S256");
		expect(pending?.searchParams.get("resource")).toBe(RESOURCE);

		// The resource owner signs in and approves on the consent page; the
		// host receives the code.
		const approved = await approve(handle, pending?.toString() ?? "");
		const code = new URL(
			approved.headers.get("location") ?? "",
		).searchParams.get("code");
		await first.finishAuth(code ?? "");

		const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
			authProvider: provider,
			fetch: fetchFn,
		});
		const client = new Client({ name: "host", version: "1" });
		await client.connect(transport);
		expect(client.getServerVersion()?.name).toBe("maina");
		expect(transport.sessionId).toBeTruthy();
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name)).toEqual([...REMOTE_TOOLS]);
		await client.close();
	});

	test("a tool call runs against the service's workspace, never a caller-supplied root", async () => {
		const { handle, fetchFn, calls } = setup();
		const token = await issueToken(handle);
		const { client } = await connect(fetchFn, token.access_token);
		const ok = await client.callTool({ name: "status", arguments: {} });
		expect(ok.isError).toBeFalsy();
		expect(calls.find((c) => c.method === "status")?.args).toEqual({
			root: WORKSPACE,
		});
		const escaped = await client.callTool({
			name: "status",
			arguments: { root: "/etc" },
		});
		expect(escaped.isError).toBe(true);
		expect(
			(escaped.structuredContent as { error: { kind: string } }).error.kind,
		).toBe("invalid_input");
		expect(calls.filter((c) => c.method === "status")).toHaveLength(1);
		expect(calls.some((c) => c.method === "resolveRoot")).toBe(false);
	});
});

describe("no action-gate capability remotely (FR-REM-5)", () => {
	test("the remote tool list is the MCP default set minus local-only tools, and names no gate", async () => {
		const { handle, fetchFn } = setup();
		const token = await issueToken(handle);
		const { client } = await connect(fetchFn, token.access_token);
		const { tools } = await client.listTools();
		for (const tool of tools) {
			expect(tool.name).not.toMatch(/gate/i);
			expect(tool.description ?? "").not.toMatch(/action\.risk|gate/i);
			expect(tool.annotations?.readOnlyHint).toBe(true);
		}
		expect(
			REMOTE_TOOLS.every((t) =>
				(DEFAULT_TOOLS as readonly string[]).includes(t),
			),
		).toBe(true);
		expect(remoteTools(ALL_TOOLS).every((t) => ALL_TOOLS.includes(t))).toBe(
			true,
		);
	});

	test("decide refuses the gate's decision types and passes the others through", async () => {
		expect(GATE_DECISION_TYPES).toContain("action.risk");
		const { handle, fetchFn, calls } = setup();
		const token = await issueToken(handle);
		const { client } = await connect(fetchFn, token.access_token);
		const gate = await client.callTool({
			name: "decide",
			arguments: {
				type: "action.risk",
				questions: [{ kind: "choice", id: "v", options: ["allow", "deny"] }],
			},
		});
		expect(gate.isError).toBe(true);
		expect(
			(gate.structuredContent as { error: { kind: string } }).error.kind,
		).toBe("invalid_input");
		expect(calls.some((c) => c.method === "decide")).toBe(false);

		const real = await client.callTool({
			name: "decide",
			arguments: {
				type: "finding.real",
				questions: [{ kind: "bool", id: "q1" }],
			},
		});
		expect(real.isError).toBeFalsy();
		expect(calls.filter((c) => c.method === "decide")).toHaveLength(1);
	});

	test("an allow-list can add DeepWiki tools but never unknown or local-only ones", () => {
		expect(remoteTools(["default", "ask_question", "gate", "nope"])).toEqual([
			...REMOTE_TOOLS,
			"ask_question",
		]);
		const { service } = setup({ tools: ["status", "decide", "gate"] });
		expect(service.tools).toEqual(["decide", "status"]);
	});
});

describe("sessions", () => {
	test("a session belongs to the client that opened it", async () => {
		const { handle, fetchFn } = setup();
		const a = await issueToken(handle);
		const b = await issueToken(handle);
		const { transport } = await connect(fetchFn, a.access_token);
		const res = await mcpPost(
			handle,
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			{
				authorization: `Bearer ${b.access_token}`,
				"mcp-session-id": transport.sessionId ?? "",
				"mcp-protocol-version": "2025-06-18",
			},
		);
		expect(res.status).toBe(404);
	});

	test("an unknown session id is 404 and a non-initialize request without one is 400", async () => {
		const { handle } = setup();
		const token = await issueToken(handle);
		const auth = { authorization: `Bearer ${token.access_token}` };
		const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
		expect(
			(await mcpPost(handle, list, { ...auth, "mcp-session-id": "missing" }))
				.status,
		).toBe(404);
		expect((await mcpPost(handle, list, auth)).status).toBe(400);
	});

	test("an idle session expires", async () => {
		const { handle, fetchFn, time, service } = setup({ idleSeconds: 60 });
		const token = await issueToken(handle);
		const { client, transport } = await connect(fetchFn, token.access_token);
		expect(service.sessionCount()).toBe(1);
		time.advance(30_000);
		await client.listTools();
		time.advance(59_000);
		await client.listTools();
		time.advance(61_000);
		const res = await mcpPost(
			handle,
			{ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
			{
				authorization: `Bearer ${token.access_token}`,
				"mcp-session-id": transport.sessionId ?? "",
				"mcp-protocol-version": "2025-06-18",
			},
		);
		expect(res.status).toBe(404);
		expect(service.sessionCount()).toBe(0);
	});

	test("the number of open sessions is capped", async () => {
		const { handle, service } = setup({ maxSessions: 1 });
		const token = await issueToken(handle);
		const auth = { authorization: `Bearer ${token.access_token}` };
		expect((await mcpPost(handle, INIT, auth)).status).toBe(200);
		const over = await mcpPost(handle, INIT, auth);
		expect(over.status).toBe(503);
		expect(service.sessionCount()).toBe(1);
	});

	test("concurrent initializes cannot open more sessions than the cap", async () => {
		const { handle, service } = setup({ maxSessions: 2 });
		const token = await issueToken(handle);
		const auth = { authorization: `Bearer ${token.access_token}` };
		const results = await Promise.all(
			Array.from({ length: 6 }, () => mcpPost(handle, INIT, auth)),
		);
		const statuses = results.map((r) => r.status);
		expect(statuses.filter((s) => s === 200)).toHaveLength(2);
		expect(statuses.filter((s) => s === 503)).toHaveLength(4);
		expect(service.sessionCount()).toBe(2);
	});

	test("DELETE ends the session", async () => {
		const { handle, fetchFn, service } = setup();
		const token = await issueToken(handle);
		const { transport } = await connect(fetchFn, token.access_token);
		expect(service.sessionCount()).toBe(1);
		await transport.terminateSession();
		expect(service.sessionCount()).toBe(0);
	});
});

describe("readRemoteConfig", () => {
	const env = {
		MAINA_REMOTE_ISSUER: "https://maina.example.com/",
		MAINA_REMOTE_OWNER: "ops",
		MAINA_REMOTE_PASSWORD: "a-long-password-123",
	};

	test("reads the issuer, port, workspace and owner from the environment", () => {
		const config = readRemoteConfig(
			{ ...env, PORT: "9000", MAINA_REMOTE_WORKSPACE: "/repo" },
			"/cwd",
		);
		expect(config).toEqual({
			ok: true,
			value: {
				issuer: "https://maina.example.com",
				port: 9000,
				root: "/repo",
				owner: { username: "ops", password: "a-long-password-123" },
				users: [],
				tools: undefined,
				maxClients: 1000,
				registrationLimit: { max: 20, windowSeconds: 60 },
				trustedProxies: 0,
			},
		});
	});

	test("reads extra users, the client cap and the registration rate", () => {
		const config = readRemoteConfig(
			{
				...env,
				MAINA_REMOTE_USERS: JSON.stringify({
					alice: "alice-password-1",
					bob: "bob-password-22",
				}),
				MAINA_REMOTE_MAX_CLIENTS: "50",
				MAINA_REMOTE_REGISTRATIONS_PER_MINUTE: "5",
				MAINA_REMOTE_TRUSTED_PROXIES: "1",
			},
			"/cwd",
		);
		expect(config.ok && config.value).toMatchObject({
			trustedProxies: 1,
			users: [
				{ username: "alice", password: "alice-password-1" },
				{ username: "bob", password: "bob-password-22" },
			],
			maxClients: 50,
			registrationLimit: { max: 5, windowSeconds: 60 },
		});
	});

	test.each([
		["users that are not JSON", { MAINA_REMOTE_USERS: "alice:pw" }],
		["users that are a JSON array", { MAINA_REMOTE_USERS: '["alice"]' }],
		[
			"a user password that is not a string",
			{ MAINA_REMOTE_USERS: '{"alice": 12345678901234}' },
		],
		["a short user password", { MAINA_REMOTE_USERS: '{"alice": "short"}' }],
		[
			"a user name with a colon",
			{ MAINA_REMOTE_USERS: '{"al:ice": "a-long-password-1"}' },
		],
		[
			"a user who is the owner again",
			{ MAINA_REMOTE_USERS: '{"ops": "a-long-password-1"}' },
		],
		["a zero client cap", { MAINA_REMOTE_MAX_CLIENTS: "0" }],
		["a non-numeric client cap", { MAINA_REMOTE_MAX_CLIENTS: "many" }],
		[
			"a zero registration rate",
			{ MAINA_REMOTE_REGISTRATIONS_PER_MINUTE: "0" },
		],
		["a negative trusted proxy count", { MAINA_REMOTE_TRUSTED_PROXIES: "-1" }],
		[
			"a non-numeric trusted proxy count",
			{ MAINA_REMOTE_TRUSTED_PROXIES: "yes" },
		],
	])("refuses %s, naming the variable", (_label, extra) => {
		const config = readRemoteConfig({ ...env, ...extra }, "/cwd");
		expect(config.ok).toBe(false);
		if (config.ok) return;
		expect(config.error.variable).toBe(Object.keys(extra)[0] ?? "");
	});

	test("defaults the port, workspace and issuer to local ones", () => {
		const config = readRemoteConfig(
			{
				MAINA_REMOTE_OWNER: "ops",
				MAINA_REMOTE_PASSWORD: "a-long-password-123",
			},
			"/cwd",
		);
		expect(config.ok && config.value).toMatchObject({
			issuer: "http://localhost:8787",
			port: 8787,
			root: "/cwd",
		});
	});

	test("resolves a relative workspace against the working directory", () => {
		const config = readRemoteConfig(
			{ ...env, MAINA_REMOTE_WORKSPACE: "repos/app/" },
			"/cwd",
		);
		expect(config.ok && config.value.root).toBe("/cwd/repos/app");
	});

	test.each([
		// HTTP Basic splits at the first colon: this owner could never sign in.
		["an owner name with a colon", { ...env, MAINA_REMOTE_OWNER: "ops:admin" }],
		["no owner password", { ...env, MAINA_REMOTE_PASSWORD: "" }],
		["a short owner password", { ...env, MAINA_REMOTE_PASSWORD: "short" }],
		["a non-numeric port", { ...env, PORT: "http" }],
		[
			"a plain-http public issuer",
			{ ...env, MAINA_REMOTE_ISSUER: "http://maina.example.com" },
		],
		[
			"an issuer with a path",
			{ ...env, MAINA_REMOTE_ISSUER: "https://x.example/sub" },
		],
	])("refuses %s", (_label, input) => {
		expect(readRemoteConfig(input, "/cwd").ok).toBe(false);
	});
});
