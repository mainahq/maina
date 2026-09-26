/**
 * The remote connector service (FR-REM-1, FR-REM-5): the maina MCP tools
 * over Streamable HTTP, behind OAuth 2.1.
 *
 * `createRemoteService` returns a web-standard `fetch` handler (Bun.serve,
 * Workers, Deno) serving:
 *
 * - the OAuth surface from `auth.ts` (metadata, `/register`, `/authorize`,
 *   `/token`), which needs no token;
 * - `/mcp`, the MCP endpoint: every request carries a bearer token that is
 *   verified (unexpired, bound to this resource) and must hold the tools
 *   scope, else 401 / 403 with a `WWW-Authenticate` challenge that points
 *   at the protected resource metadata, as the MCP authorization spec asks;
 * - `/healthz`.
 *
 * Tools are the `packages/mcp` definitions (`createMcpServer`), limited to
 * the remote tools and run over `remoteRuntime`, which pins every call to
 * the service's workspace and refuses the action gate.
 */

import { VERSION } from "@mainahq/core";
import { createMcpServer, type McpRuntime, type ToolName } from "@mainahq/mcp";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
	type Authenticate,
	type AuthServer,
	createAuthServer,
	type Grant,
	MCP_PATH,
	TOOLS_SCOPE,
} from "./auth";
import { createSessions } from "./session";
import { REMOTE_TOOLS, remoteRuntime, remoteTools } from "./tools";

type RemoteServiceOptions = Readonly<{
	/** The service's public origin, e.g. `https://maina.example.com`. */
	issuer: string;
	/** The workspace every tool call acts on. */
	root: string;
	runtime: McpRuntime;
	/** Authenticates the resource owner when a client asks for access. */
	authenticate: Authenticate;
	/** Allow-list of tool names (`default` = the remote default set). */
	tools?: readonly string[];
	scopes?: readonly string[];
	/** Milliseconds since the epoch. */
	now?: () => number;
	accessTokenTtlSeconds?: number;
	refreshTokenTtlSeconds?: number;
	/** Idle time after which a session ends; 30 minutes by default. */
	sessionIdleSeconds?: number;
	maxSessions?: number;
}>;

export type RemoteService = Readonly<{
	/** The tools every session registers, in catalog order. */
	tools: readonly ToolName[];
	fetch: (req: Request) => Promise<Response>;
	sessionCount: () => number;
	close: () => Promise<void>;
}>;

const quote = (value: string): string => `"${value.replace(/["\\]/g, "")}"`;

function challenge(
	auth: AuthServer,
	status: 401 | 403,
	params: Readonly<Record<string, string>>,
): Response {
	const fields = Object.entries({
		...params,
		scope: TOOLS_SCOPE,
		resource_metadata: auth.resourceMetadataUrl,
	}).map(([k, v]) => `${k}=${quote(v)}`);
	return new Response(
		JSON.stringify({
			error: params.error ?? "unauthorized",
			error_description:
				params.error_description ?? "a bearer token is required",
		}),
		{
			status,
			headers: {
				"content-type": "application/json",
				"www-authenticate": `Bearer ${fields.join(", ")}`,
			},
		},
	);
}

type Bearer =
	| Readonly<{ ok: true; grant: Grant; token: string }>
	| Readonly<{ ok: false; response: Response }>;

function checkBearer(auth: AuthServer, req: Request): Bearer {
	const match = /^Bearer\s+(\S+)$/i.exec(
		req.headers.get("authorization") ?? "",
	);
	const token = match?.[1];
	if (token === undefined) {
		return { ok: false, response: challenge(auth, 401, {}) };
	}
	const verified = auth.verify(token);
	if (!verified.ok || verified.value.resource !== auth.resource) {
		return {
			ok: false,
			response: challenge(auth, 401, {
				error: "invalid_token",
				error_description: "the access token is invalid or expired",
			}),
		};
	}
	if (!verified.value.scopes.includes(TOOLS_SCOPE)) {
		return {
			ok: false,
			response: challenge(auth, 403, {
				error: "insufficient_scope",
				error_description: `the token lacks the ${TOOLS_SCOPE} scope`,
			}),
		};
	}
	return { ok: true, grant: verified.value, token };
}

const authInfoOf = (grant: Grant, token: string): AuthInfo => ({
	token,
	clientId: grant.clientId,
	scopes: [...grant.scopes],
	expiresAt: Math.floor(grant.expiresAt / 1000),
	resource: new URL(grant.resource),
	extra: { subject: grant.subject },
});

export function createRemoteService(
	options: RemoteServiceOptions,
): RemoteService {
	const now = options.now ?? Date.now;
	const auth = createAuthServer({
		issuer: options.issuer,
		authenticate: options.authenticate,
		now,
		...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
		...(options.accessTokenTtlSeconds !== undefined
			? { accessTokenTtlSeconds: options.accessTokenTtlSeconds }
			: {}),
		...(options.refreshTokenTtlSeconds !== undefined
			? { refreshTokenTtlSeconds: options.refreshTokenTtlSeconds }
			: {}),
	});
	const tools =
		options.tools === undefined
			? [...REMOTE_TOOLS]
			: remoteTools(options.tools);
	const runtime = remoteRuntime(options.runtime, options.root);
	const sessions = createSessions({
		open: () => createMcpServer(runtime, { tools }),
		now,
		idleMs: (options.sessionIdleSeconds ?? 1800) * 1000,
		maxSessions: options.maxSessions ?? 256,
	});

	async function route(req: Request): Promise<Response> {
		const path = new URL(req.url).pathname;
		if (path === "/healthz") {
			return Response.json({ status: "ok", version: VERSION });
		}
		const handled = await auth.handle(req);
		if (handled !== null) return handled;
		if (path !== MCP_PATH) return new Response("Not found", { status: 404 });
		const bearer = checkBearer(auth, req);
		if (!bearer.ok) return bearer.response;
		return sessions.handle(
			req,
			{ clientId: bearer.grant.clientId, subject: bearer.grant.subject },
			authInfoOf(bearer.grant, bearer.token),
		);
	}

	return {
		tools,
		fetch: async (req) => {
			// Whatever a dependency throws answers 500; the service keeps serving.
			try {
				return await route(req);
			} catch {
				return Response.json({ error: "server_error" }, { status: 500 });
			}
		},
		sessionCount: sessions.count,
		close: sessions.closeAll,
	};
}

type RemoteConfig = Readonly<{
	issuer: string;
	port: number;
	root: string;
	owner: Readonly<{ username: string; password: string }>;
	tools: readonly string[] | undefined;
}>;

type ConfigError = Readonly<{
	kind: "invalid_config";
	variable: string;
	message: string;
}>;

const MIN_PASSWORD = 12;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const configError = (
	variable: string,
	message: string,
): { ok: false; error: ConfigError } => ({
	ok: false,
	error: { kind: "invalid_config", variable, message },
});

function parseIssuer(raw: string): URL | null {
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}

/**
 * The service configuration from the environment: `PORT` (8787),
 * `MAINA_REMOTE_ISSUER` (the public origin; https unless loopback, no
 * path), `MAINA_REMOTE_WORKSPACE` (`cwd`), `MAINA_REMOTE_OWNER` (`owner`)
 * and `MAINA_REMOTE_PASSWORD` (required), `MAINA_MCP_TOOLS` (allow-list).
 */
export function readRemoteConfig(
	env: Readonly<Record<string, string | undefined>>,
	cwd: string,
): { ok: true; value: RemoteConfig } | { ok: false; error: ConfigError } {
	const rawPort = env.PORT?.trim() || "8787";
	const port = Number(rawPort);
	if (!/^\d+$/.test(rawPort) || port < 1 || port > 65_535) {
		return configError("PORT", "must be a port number (1-65535)");
	}
	const rawIssuer = (
		env.MAINA_REMOTE_ISSUER?.trim() || `http://localhost:${port}`
	).replace(/\/+$/, "");
	const issuer = parseIssuer(rawIssuer);
	if (
		issuer === null ||
		issuer.pathname !== "/" ||
		issuer.search !== "" ||
		issuer.hash !== ""
	) {
		return configError(
			"MAINA_REMOTE_ISSUER",
			"must be an origin with no path, e.g. https://maina.example.com",
		);
	}
	if (
		issuer.protocol !== "https:" &&
		!(issuer.protocol === "http:" && LOOPBACK.has(issuer.hostname))
	) {
		return configError(
			"MAINA_REMOTE_ISSUER",
			"must use https (http only on loopback)",
		);
	}
	const password = env.MAINA_REMOTE_PASSWORD ?? "";
	if (password.length < MIN_PASSWORD) {
		return configError(
			"MAINA_REMOTE_PASSWORD",
			`the owner password is required, at least ${MIN_PASSWORD} characters`,
		);
	}
	const tools = env.MAINA_MCP_TOOLS?.trim();
	return {
		ok: true,
		value: {
			issuer: issuer.origin,
			port,
			root: env.MAINA_REMOTE_WORKSPACE?.trim() || cwd,
			owner: { username: env.MAINA_REMOTE_OWNER?.trim() || "owner", password },
			tools: tools
				? tools
						.split(",")
						.map((t) => t.trim())
						.filter((t) => t.length > 0)
				: undefined,
		},
	};
}
