/**
 * OAuth 2.1 for the remote connector (FR-REM-1).
 *
 * The service is its own authorization server and its MCP endpoint the one
 * protected resource. It serves what an MCP host needs to connect with no
 * manual setup:
 *
 * - discovery: authorization server metadata (RFC 8414) and protected
 *   resource metadata (RFC 9728, at both the bare and the `/mcp` path);
 * - dynamic client registration (RFC 7591), for public clients (PKCE only)
 *   and confidential ones (`client_secret_post` / `client_secret_basic`);
 * - the authorization code grant with mandatory S256 PKCE, exact redirect
 *   matching (a loopback redirect may change port, RFC 8252), `iss` on the
 *   response (RFC 9207) and resource indicators (RFC 8707);
 * - bearer tokens bound to the resource, scoped, expiring, with rotating
 *   refresh tokens. A replayed code or refresh token revokes every token
 *   issued from the same authorization.
 *
 * Who the resource owner is comes from the injected `authenticate` port
 * (`basicAuthenticator` for a self-hosted single owner). State is kept in
 * memory and only token hashes are stored. Nothing here throws: every
 * failure is an OAuth error response.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Result } from "@mainahq/core";

/** The scope an access token needs to call the MCP tools. */
export const TOOLS_SCOPE = "mcp:tools";

/** Path of the MCP endpoint under the issuer: the protected resource. */
export const MCP_PATH = "/mcp";

/**
 * Authenticates the resource owner on the authorization endpoint: the
 * owner's subject, or the response to send instead (a login challenge).
 */
export type Authenticate = (req: Request) => Promise<Result<string, Response>>;

type AuthOptions = Readonly<{
	/** The service's public origin, e.g. `https://maina.example.com`. */
	issuer: string;
	authenticate: Authenticate;
	/** Scopes this server grants; defaults to the tools scope alone. */
	scopes?: readonly string[];
	/** Milliseconds since the epoch. */
	now?: () => number;
	accessTokenTtlSeconds?: number;
	refreshTokenTtlSeconds?: number;
	codeTtlSeconds?: number;
}>;

/** What a valid access token stands for. */
export type Grant = Readonly<{
	subject: string;
	clientId: string;
	scopes: readonly string[];
	/** The resource the token is bound to. */
	resource: string;
	/** Milliseconds since the epoch. */
	expiresAt: number;
}>;

export type AuthServer = Readonly<{
	issuer: string;
	resource: string;
	/** Where the protected resource metadata for `resource` is served. */
	resourceMetadataUrl: string;
	/** Answers an auth route; `null` when `req` is not one. */
	handle: (req: Request) => Promise<Response | null>;
	verify: (token: string) => Result<Grant, "invalid_token">;
}>;

type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

type Client = Readonly<{
	id: string;
	secretHash: string | undefined;
	authMethod: AuthMethod;
	redirectUris: readonly string[];
	/** The scopes it registered for; any supported scope when unset. */
	scopes: readonly string[] | undefined;
}>;

type Code = Readonly<{
	clientId: string;
	redirectUri: string;
	challenge: string;
	scopes: readonly string[];
	subject: string;
	family: string;
	expiresAt: number;
	used: boolean;
}>;

type Access = Readonly<{ grant: Grant; family: string }>;

type Refresh = Readonly<{
	clientId: string;
	subject: string;
	scopes: readonly string[];
	family: string;
	expiresAt: number;
}>;

const AUTH_METHODS: readonly AuthMethod[] = [
	"none",
	"client_secret_post",
	"client_secret_basic",
];
const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const BLOCKED_SCHEMES = new Set([
	"javascript",
	"data",
	"file",
	"vbscript",
	"blob",
	"about",
	"ftp",
	"ws",
	"wss",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

const newToken = (): string => randomBytes(32).toString("base64url");
const digest = (value: string): Buffer =>
	createHash("sha256").update(value).digest();
const hashOf = (value: string): string => digest(value).toString("hex");

/** Constant-time string comparison (over digests, so lengths never leak). */
function sameSecret(a: string, b: string): boolean {
	return timingSafeEqual(digest(a), digest(b));
}

const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const oauthError = (
	error: string,
	description: string,
	status = 400,
): Response =>
	json({ error, error_description: description }, status, NO_STORE);

const splitScope = (scope: string | null | undefined): string[] => [
	...new Set((scope ?? "").split(" ").filter((s) => s.length > 0)),
];

function parseUrl(raw: string): URL | null {
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}

/** https, loopback http, or a private-use scheme; never a fragment. */
function redirectAllowed(raw: string): boolean {
	const url = parseUrl(raw);
	if (url === null || raw.includes("#")) return false;
	const scheme = url.protocol.slice(0, -1);
	if (scheme === "https") return true;
	if (scheme === "http") return LOOPBACK_HOSTS.has(url.hostname);
	return !BLOCKED_SCHEMES.has(scheme);
}

/** Exact match; a loopback http redirect may differ in port only. */
function redirectMatches(registered: string, requested: string): boolean {
	if (registered === requested) return true;
	const a = parseUrl(registered);
	const b = parseUrl(requested);
	if (a === null || b === null) return false;
	return (
		a.protocol === "http:" &&
		b.protocol === "http:" &&
		LOOPBACK_HOSTS.has(a.hostname) &&
		a.hostname === b.hostname &&
		a.pathname === b.pathname &&
		a.search === b.search
	);
}

/** `decodeURIComponent` that answers `null` instead of throwing. */
function decodeSafe(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function readBasic(
	header: string | null,
): Readonly<{ user: string; pass: string }> | null {
	if (header === null || !/^basic /i.test(header)) return null;
	const decoded = Buffer.from(header.slice(6).trim(), "base64").toString(
		"utf8",
	);
	const colon = decoded.indexOf(":");
	if (colon < 0) return null;
	return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

/** A single self-hosted owner, authenticated with HTTP Basic credentials. */
export function basicAuthenticator(
	owner: Readonly<{ username: string; password: string }>,
): Authenticate {
	const challenge = () =>
		new Response(
			"Sign in as the maina remote owner to authorize this client.",
			{
				status: 401,
				headers: {
					"www-authenticate": 'Basic realm="maina remote", charset="UTF-8"',
					...NO_STORE,
				},
			},
		);
	return async (req) => {
		const creds = readBasic(req.headers.get("authorization"));
		const valid =
			creds !== null &&
			// Both compared, so a wrong user costs the same as a wrong password.
			[
				sameSecret(creds.user, owner.username),
				sameSecret(creds.pass, owner.password),
			].every(Boolean);
		return valid
			? { ok: true, value: owner.username }
			: { ok: false, error: challenge() };
	};
}

type Registration = Result<
	Readonly<{ client: Client; secret: string | undefined; name?: string }>,
	Response
>;

function registrationError(error: string, description: string): Registration {
	return { ok: false, error: oauthError(error, description) };
}

function readRegistration(
	body: unknown,
	supported: readonly string[],
): Registration {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return registrationError(
			"invalid_client_metadata",
			"the body must be a JSON object",
		);
	}
	const meta = body as Record<string, unknown>;
	const uris = meta.redirect_uris;
	if (
		!Array.isArray(uris) ||
		uris.length === 0 ||
		!uris.every((u): u is string => typeof u === "string" && redirectAllowed(u))
	) {
		return registrationError(
			"invalid_redirect_uri",
			"redirect_uris must be https, loopback http or private-use scheme URIs without a fragment",
		);
	}
	const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
	if (!AUTH_METHODS.includes(method as AuthMethod)) {
		return registrationError(
			"invalid_client_metadata",
			`token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}`,
		);
	}
	const grants = meta.grant_types ?? [...GRANT_TYPES];
	if (
		!Array.isArray(grants) ||
		!grants.includes("authorization_code") ||
		!grants.every((g) => (GRANT_TYPES as readonly unknown[]).includes(g))
	) {
		return registrationError(
			"invalid_client_metadata",
			"grant_types must include authorization_code and may add refresh_token",
		);
	}
	const responses = meta.response_types ?? ["code"];
	if (!Array.isArray(responses) || responses.some((r) => r !== "code")) {
		return registrationError(
			"invalid_client_metadata",
			'response_types must be ["code"]',
		);
	}
	const scopes =
		typeof meta.scope === "string" ? splitScope(meta.scope) : undefined;
	if (scopes?.some((s) => !supported.includes(s))) {
		return registrationError(
			"invalid_client_metadata",
			`scope must be drawn from: ${supported.join(" ")}`,
		);
	}
	const secret = method === "none" ? undefined : newToken();
	return {
		ok: true,
		value: {
			client: {
				id: randomBytes(16).toString("hex"),
				secretHash: secret === undefined ? undefined : hashOf(secret),
				authMethod: method as AuthMethod,
				redirectUris: uris,
				scopes,
			},
			secret,
			...(typeof meta.client_name === "string"
				? { name: meta.client_name }
				: {}),
		},
	};
}

export function createAuthServer(options: AuthOptions): AuthServer {
	const issuer = options.issuer.replace(/\/+$/, "");
	const resource = `${issuer}${MCP_PATH}`;
	const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource${MCP_PATH}`;
	const supported = options.scopes ?? [TOOLS_SCOPE];
	const defaultScopes = supported.includes(TOOLS_SCOPE)
		? [TOOLS_SCOPE]
		: [...supported];
	const now = options.now ?? Date.now;
	const accessTtlMs = (options.accessTokenTtlSeconds ?? 3600) * 1000;
	const refreshTtlMs = (options.refreshTokenTtlSeconds ?? 30 * 86_400) * 1000;
	const codeTtlMs = (options.codeTtlSeconds ?? 60) * 1000;

	const clients = new Map<string, Client>();
	const codes = new Map<string, Code>();
	const access = new Map<string, Access>();
	const refresh = new Map<string, Refresh>();
	/** Rotated-out refresh tokens, kept to detect replay: hash → family. */
	const retired = new Map<
		string,
		Readonly<{ family: string; expiresAt: number }>
	>();

	/** Drop everything that has expired. */
	function sweep(): void {
		const t = now();
		for (const [k, v] of codes) if (v.expiresAt <= t) codes.delete(k);
		for (const [k, v] of access) if (v.grant.expiresAt <= t) access.delete(k);
		for (const [k, v] of refresh) if (v.expiresAt <= t) refresh.delete(k);
		for (const [k, v] of retired) if (v.expiresAt <= t) retired.delete(k);
	}

	function revokeFamily(family: string): void {
		for (const [k, v] of access) if (v.family === family) access.delete(k);
		for (const [k, v] of refresh) if (v.family === family) refresh.delete(k);
	}

	/** Scopes in the server's canonical order. */
	const ordered = (scopes: readonly string[]): string[] =>
		supported.filter((s) => scopes.includes(s));

	const asMetadata = () => ({
		issuer,
		authorization_endpoint: `${issuer}/authorize`,
		token_endpoint: `${issuer}/token`,
		registration_endpoint: `${issuer}/register`,
		response_types_supported: ["code"],
		grant_types_supported: [...GRANT_TYPES],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: [...AUTH_METHODS],
		scopes_supported: [...supported],
		authorization_response_iss_parameter_supported: true,
	});

	const resourceMetadata = () => ({
		resource,
		authorization_servers: [issuer],
		scopes_supported: [...supported],
		bearer_methods_supported: ["header"],
		resource_name: "maina",
	});

	async function registerClient(req: Request): Promise<Response> {
		const body: unknown = await req.json().catch(() => undefined);
		const parsed = readRegistration(body, supported);
		if (!parsed.ok) return parsed.error;
		const { client, secret, name } = parsed.value;
		clients.set(client.id, client);
		return json(
			{
				client_id: client.id,
				client_id_issued_at: Math.floor(now() / 1000),
				...(secret !== undefined
					? { client_secret: secret, client_secret_expires_at: 0 }
					: {}),
				redirect_uris: client.redirectUris,
				token_endpoint_auth_method: client.authMethod,
				grant_types: [...GRANT_TYPES],
				response_types: ["code"],
				...(name !== undefined ? { client_name: name } : {}),
				...(client.scopes !== undefined
					? { scope: client.scopes.join(" ") }
					: {}),
			},
			201,
			NO_STORE,
		);
	}

	function redirectWith(
		redirectUri: string,
		params: Record<string, string | null>,
	): Response {
		const url = new URL(redirectUri);
		for (const [k, v] of Object.entries(params)) {
			if (v !== null) url.searchParams.set(k, v);
		}
		url.searchParams.set("iss", issuer);
		return new Response(null, {
			status: 302,
			headers: { location: url.toString(), ...NO_STORE },
		});
	}

	async function authorizeRequest(req: Request): Promise<Response> {
		sweep();
		const q = new URL(req.url).searchParams;
		const client = clients.get(q.get("client_id") ?? "");
		if (client === undefined) {
			return oauthError("invalid_request", "unknown client_id");
		}
		const requested = q.get("redirect_uri");
		const redirectUri =
			requested ??
			(client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
		if (
			redirectUri === undefined ||
			!client.redirectUris.some((r) => redirectMatches(r, redirectUri))
		) {
			return oauthError(
				"invalid_request",
				"redirect_uri is not registered for this client",
			);
		}
		const state = q.get("state");
		const fail = (error: string, description: string) =>
			redirectWith(redirectUri, {
				error,
				error_description: description,
				state,
			});
		if (q.get("response_type") !== "code") {
			return fail("unsupported_response_type", "response_type must be code");
		}
		const challenge = q.get("code_challenge") ?? "";
		if (!PKCE_CHALLENGE.test(challenge)) {
			return fail("invalid_request", "a code_challenge is required (PKCE)");
		}
		if (q.get("code_challenge_method") !== "S256") {
			return fail("invalid_request", "code_challenge_method must be S256");
		}
		const allowed = client.scopes ?? supported;
		const asked = splitScope(q.get("scope"));
		const scopes = asked.length > 0 ? asked : (client.scopes ?? defaultScopes);
		if (scopes.some((s) => !allowed.includes(s))) {
			return fail(
				"invalid_scope",
				`scope must be drawn from: ${allowed.join(" ")}`,
			);
		}
		const target = q.get("resource");
		if (target !== null && target !== resource) {
			return fail("invalid_target", `the only resource here is ${resource}`);
		}
		const owner = await options.authenticate(req);
		if (!owner.ok) return owner.error;
		const code = newToken();
		codes.set(hashOf(code), {
			clientId: client.id,
			redirectUri,
			challenge,
			scopes: ordered(scopes),
			subject: owner.value,
			family: newToken(),
			expiresAt: now() + codeTtlMs,
			used: false,
		});
		return redirectWith(redirectUri, { code, state });
	}

	function authenticateClient(
		params: URLSearchParams,
		header: string | null,
	): Result<Client, Response> {
		const basic = readBasic(header);
		const id =
			basic !== null ? decodeSafe(basic.user) : params.get("client_id");
		const client = clients.get(id ?? "");
		const denied = {
			ok: false as const,
			error: oauthError("invalid_client", "client authentication failed", 401),
		};
		if (client === undefined) return denied;
		if (client.secretHash === undefined) return { ok: true, value: client };
		const secret =
			basic !== null ? decodeSafe(basic.pass) : params.get("client_secret");
		return secret !== null && sameSecret(hashOf(secret), client.secretHash)
			? { ok: true, value: client }
			: denied;
	}

	function issueTokens(
		client: Client,
		subject: string,
		scopes: readonly string[],
		refreshScopes: readonly string[],
		family: string,
	): Response {
		const t = now();
		const accessToken = newToken();
		const refreshToken = newToken();
		access.set(hashOf(accessToken), {
			family,
			grant: {
				subject,
				clientId: client.id,
				scopes,
				resource,
				expiresAt: t + accessTtlMs,
			},
		});
		refresh.set(hashOf(refreshToken), {
			clientId: client.id,
			subject,
			scopes: refreshScopes,
			family,
			expiresAt: t + refreshTtlMs,
		});
		return json(
			{
				access_token: accessToken,
				token_type: "Bearer",
				expires_in: Math.floor(accessTtlMs / 1000),
				refresh_token: refreshToken,
				scope: scopes.join(" "),
			},
			200,
			NO_STORE,
		);
	}

	function exchangeCode(client: Client, params: URLSearchParams): Response {
		const key = hashOf(params.get("code") ?? "");
		const code = codes.get(key);
		if (code === undefined || code.expiresAt <= now()) {
			return oauthError("invalid_grant", "the code is invalid or expired");
		}
		if (code.used) {
			codes.delete(key);
			revokeFamily(code.family);
			return oauthError("invalid_grant", "the code was already used");
		}
		const redirect = params.get("redirect_uri");
		if (
			code.clientId !== client.id ||
			(redirect !== null && redirect !== code.redirectUri)
		) {
			return oauthError(
				"invalid_grant",
				"the code was issued to another client or redirect",
			);
		}
		const verifier = params.get("code_verifier");
		if (verifier === null) {
			return oauthError("invalid_request", "code_verifier is required");
		}
		if (digest(verifier).toString("base64url") !== code.challenge) {
			return oauthError("invalid_grant", "the code_verifier does not match");
		}
		const target = params.get("resource");
		if (target !== null && target !== resource) {
			return oauthError(
				"invalid_target",
				`the only resource here is ${resource}`,
			);
		}
		codes.set(key, { ...code, used: true });
		return issueTokens(
			client,
			code.subject,
			code.scopes,
			code.scopes,
			code.family,
		);
	}

	function refreshGrant(client: Client, params: URLSearchParams): Response {
		const key = hashOf(params.get("refresh_token") ?? "");
		const replayed = retired.get(key);
		if (replayed !== undefined) {
			retired.delete(key);
			revokeFamily(replayed.family);
			return oauthError("invalid_grant", "the refresh token was already used");
		}
		const token = refresh.get(key);
		if (
			token === undefined ||
			token.expiresAt <= now() ||
			token.clientId !== client.id
		) {
			return oauthError(
				"invalid_grant",
				"the refresh token is invalid or expired",
			);
		}
		const asked = splitScope(params.get("scope"));
		if (asked.some((s) => !token.scopes.includes(s))) {
			return oauthError(
				"invalid_scope",
				"a refresh can only narrow the granted scope",
			);
		}
		refresh.delete(key);
		retired.set(key, { family: token.family, expiresAt: token.expiresAt });
		const scopes = asked.length > 0 ? ordered(asked) : token.scopes;
		return issueTokens(
			client,
			token.subject,
			scopes,
			token.scopes,
			token.family,
		);
	}

	async function tokenRequest(req: Request): Promise<Response> {
		sweep();
		const params = new URLSearchParams(await req.text().catch(() => ""));
		const grantType = params.get("grant_type");
		if (grantType !== "authorization_code" && grantType !== "refresh_token") {
			return oauthError(
				"unsupported_grant_type",
				"grant_type must be authorization_code or refresh_token",
			);
		}
		const client = authenticateClient(params, req.headers.get("authorization"));
		if (!client.ok) return client.error;
		return grantType === "authorization_code"
			? exchangeCode(client.value, params)
			: refreshGrant(client.value, params);
	}

	const routes: Readonly<
		Record<
			string,
			Readonly<{
				method: string;
				run: (req: Request) => Promise<Response> | Response;
			}>
		>
	> = {
		"/.well-known/oauth-authorization-server": {
			method: "GET",
			run: () => json(asMetadata()),
		},
		"/.well-known/oauth-protected-resource": {
			method: "GET",
			run: () => json(resourceMetadata()),
		},
		[`/.well-known/oauth-protected-resource${MCP_PATH}`]: {
			method: "GET",
			run: () => json(resourceMetadata()),
		},
		"/register": { method: "POST", run: registerClient },
		"/authorize": { method: "GET", run: authorizeRequest },
		"/token": { method: "POST", run: tokenRequest },
	};

	return {
		issuer,
		resource,
		resourceMetadataUrl,
		handle: async (req) => {
			const route = routes[new URL(req.url).pathname];
			if (route === undefined) return null;
			if (req.method !== route.method) {
				return new Response(null, {
					status: 405,
					headers: { allow: route.method },
				});
			}
			return route.run(req);
		},
		verify: (token) => {
			const key = hashOf(token);
			const entry = access.get(key);
			if (entry === undefined) return { ok: false, error: "invalid_token" };
			if (entry.grant.expiresAt <= now()) {
				access.delete(key);
				return { ok: false, error: "invalid_token" };
			}
			return { ok: true, value: entry.grant };
		},
	};
}
