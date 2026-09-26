/**
 * OAuth 2.1 for the remote connector (FR-REM-1): metadata discovery,
 * dynamic client registration (RFC 7591), the authorization code flow with
 * mandatory S256 PKCE, token scoping, resource binding (RFC 8707), expiry
 * and refresh-token rotation.
 */

import { describe, expect, test } from "bun:test";
import {
	type AuthServer,
	basicAuthenticator,
	createAuthServer,
	TOOLS_SCOPE,
} from "../auth";
import {
	authorize,
	basic,
	type Clock,
	clock,
	codeFrom,
	type Handle,
	ISSUER,
	issueToken,
	OWNER,
	pkce,
	postForm,
	postJson,
	REDIRECT,
	RESOURCE,
	register,
} from "./helpers";

const JOBS_SCOPE = "jobs:read";

function setup(
	options: Readonly<{
		accessTokenTtlSeconds?: number;
		refreshTokenTtlSeconds?: number;
		codeTtlSeconds?: number;
	}> = {},
): { auth: AuthServer; handle: Handle; time: Clock } {
	const time = clock();
	const auth = createAuthServer({
		issuer: ISSUER,
		scopes: [TOOLS_SCOPE, JOBS_SCOPE],
		now: time.now,
		authenticate: basicAuthenticator(OWNER),
		...options,
	});
	const handle: Handle = async (req) =>
		(await auth.handle(req)) ??
		new Response("not an auth route", { status: 404 });
	return { auth, handle, time };
}

async function exchange(
	handle: Handle,
	fields: Record<string, string>,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; res: Response }> {
	const res = await postForm(handle, "/token", fields, headers);
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
		res,
	};
}

/** Register a public client and get an authorization code for it. */
async function codeFor(
	handle: Handle,
	scope?: string,
): Promise<{ clientId: string; code: string; verifier: string }> {
	const client = await register(handle);
	const pair = pkce();
	const res = await authorize(handle, {
		clientId: client.client_id,
		challenge: pair.challenge,
		...(scope !== undefined ? { scope } : {}),
	});
	return {
		clientId: client.client_id,
		code: codeFrom(res),
		verifier: pair.verifier,
	};
}

describe("discovery metadata", () => {
	test("authorization server metadata advertises DCR, the code flow and S256 only", async () => {
		const { handle } = setup();
		const res = await handle(
			new Request(`${ISSUER}/.well-known/oauth-authorization-server`),
		);
		expect(res.status).toBe(200);
		const meta = (await res.json()) as Record<string, unknown>;
		expect(meta.issuer).toBe(ISSUER);
		expect(meta.authorization_endpoint).toBe(`${ISSUER}/authorize`);
		expect(meta.token_endpoint).toBe(`${ISSUER}/token`);
		expect(meta.registration_endpoint).toBe(`${ISSUER}/register`);
		expect(meta.response_types_supported).toEqual(["code"]);
		expect(meta.grant_types_supported).toEqual([
			"authorization_code",
			"refresh_token",
		]);
		expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
		expect(meta.scopes_supported).toEqual([TOOLS_SCOPE, JOBS_SCOPE]);
	});

	test("protected resource metadata names the MCP endpoint and its issuer, at both well-known paths", async () => {
		const { handle } = setup();
		for (const path of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-protected-resource/mcp",
		]) {
			const res = await handle(new Request(`${ISSUER}${path}`));
			expect(res.status).toBe(200);
			const meta = (await res.json()) as Record<string, unknown>;
			expect(meta.resource).toBe(RESOURCE);
			expect(meta.authorization_servers).toEqual([ISSUER]);
			expect(meta.bearer_methods_supported).toEqual(["header"]);
		}
	});

	test("routes outside the auth surface are not handled", async () => {
		const { auth } = setup();
		expect(await auth.handle(new Request(`${ISSUER}/mcp`))).toBeNull();
	});
});

describe("dynamic client registration", () => {
	test("a public client gets a client_id and no secret", async () => {
		const { handle } = setup();
		const res = await postJson(handle, "/register", {
			redirect_uris: [REDIRECT],
			client_name: "Claude",
			token_endpoint_auth_method: "none",
		});
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as Record<string, unknown>;
		expect(typeof body.client_id).toBe("string");
		expect(body.client_secret).toBeUndefined();
		expect(body.redirect_uris).toEqual([REDIRECT]);
		expect(body.token_endpoint_auth_method).toBe("none");
		expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
		expect(typeof body.client_id_issued_at).toBe("number");
	});

	test("a confidential client gets a secret", async () => {
		const { handle } = setup();
		const client = await register(handle, {
			token_endpoint_auth_method: "client_secret_post",
		});
		expect(typeof client.client_secret).toBe("string");
		expect(client.client_secret?.length ?? 0).toBeGreaterThanOrEqual(32);
	});

	test.each([
		["missing", undefined],
		["empty", []],
		["http on a public host", ["http://evil.example/cb"]],
		["javascript", ["javascript:alert(1)"]],
		["with a fragment", ["https://app.example/cb#frag"]],
		["relative", ["/cb"]],
	])("redirect_uris %s are rejected", async (_label, redirect_uris) => {
		const { handle } = setup();
		const res = await postJson(handle, "/register", { redirect_uris });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe(
			"invalid_redirect_uri",
		);
	});

	test.each([
		["an unsupported grant type", { grant_types: ["client_credentials"] }],
		[
			"an unsupported auth method",
			{ token_endpoint_auth_method: "private_key_jwt" },
		],
		["an unsupported scope", { scope: `${TOOLS_SCOPE} admin` }],
	])("metadata with %s is rejected", async (_label, extra) => {
		const { handle } = setup();
		const res = await postJson(handle, "/register", {
			redirect_uris: [REDIRECT],
			...extra,
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe(
			"invalid_client_metadata",
		);
	});

	test("a body that is not JSON is rejected", async () => {
		const { handle } = setup();
		const res = await handle(
			new Request(`${ISSUER}/register`, { method: "POST", body: "nope" }),
		);
		expect(res.status).toBe(400);
	});

	test("https, loopback http and private-use scheme redirects are accepted", async () => {
		const { handle } = setup();
		const client = await register(handle, {
			redirect_uris: [
				"https://claude.ai/api/mcp/auth_callback",
				"http://localhost:6274/oauth/callback",
				"cursor://anysphere.cursor-retrieval/oauth/callback",
			],
		});
		expect(client.redirect_uris).toHaveLength(3);
	});
});

describe("authorization endpoint", () => {
	test("an approved request redirects back with a code and the state", async () => {
		const { handle } = setup();
		const client = await register(handle);
		const res = await authorize(handle, {
			clientId: client.client_id,
			challenge: pkce().challenge,
			state: "xyz",
		});
		expect(res.status).toBe(302);
		const location = new URL(res.headers.get("location") ?? "");
		expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
		expect(location.searchParams.get("code")).toBeTruthy();
		expect(location.searchParams.get("state")).toBe("xyz");
		expect(location.searchParams.get("iss")).toBe(ISSUER);
	});

	test("an unauthenticated resource owner is challenged, not redirected", async () => {
		const { handle } = setup();
		const client = await register(handle);
		const res = await authorize(
			handle,
			{ clientId: client.client_id, challenge: pkce().challenge },
			null,
		);
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain("Basic");
		expect(res.headers.get("location")).toBeNull();
	});

	test("wrong owner credentials are challenged", async () => {
		const { handle } = setup();
		const client = await register(handle);
		const res = await authorize(
			handle,
			{ clientId: client.client_id, challenge: pkce().challenge },
			basic(OWNER.username, "wrong"),
		);
		expect(res.status).toBe(401);
	});

	test("an unknown client or unregistered redirect is refused without redirecting", async () => {
		const { handle } = setup();
		const client = await register(handle);
		const unknown = await authorize(handle, {
			clientId: "nope",
			challenge: pkce().challenge,
		});
		expect(unknown.status).toBe(400);
		expect(unknown.headers.get("location")).toBeNull();
		const foreign = await authorize(handle, {
			clientId: client.client_id,
			challenge: pkce().challenge,
			redirect: "https://evil.example/cb",
		});
		expect(foreign.status).toBe(400);
		expect(foreign.headers.get("location")).toBeNull();
	});

	test("a loopback redirect may use another port (RFC 8252)", async () => {
		const { handle } = setup();
		const client = await register(handle);
		const res = await authorize(handle, {
			clientId: client.client_id,
			challenge: pkce().challenge,
			redirect: "http://127.0.0.1:50123/callback",
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toStartWith(
			"http://127.0.0.1:50123/callback?",
		);
	});

	test.each([
		["no code_challenge", { challenge: "" }, "invalid_request"],
		["the plain method", { method: "plain" }, "invalid_request"],
		["an unsupported scope", { scope: "admin" }, "invalid_scope"],
		[
			"another resource",
			{ resource: "https://other.example/mcp" },
			"invalid_target",
		],
	])("a request with %s redirects with an error", async (_label, extra, error) => {
		const { handle } = setup();
		const client = await register(handle);
		const res = await authorize(handle, {
			clientId: client.client_id,
			challenge: pkce().challenge,
			state: "s9",
			...extra,
		});
		expect(res.status).toBe(302);
		const location = new URL(res.headers.get("location") ?? "");
		expect(location.searchParams.get("error")).toBe(error);
		expect(location.searchParams.get("state")).toBe("s9");
		expect(location.searchParams.get("code")).toBeNull();
	});
});

describe("token endpoint: authorization code", () => {
	test("the right verifier gets a bearer token bound to the resource", async () => {
		const { auth, handle } = setup();
		const { clientId, code, verifier } = await codeFor(handle);
		const { status, body, res } = await exchange(handle, {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: clientId,
			code_verifier: verifier,
			resource: RESOURCE,
		});
		expect(status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(body.token_type).toBe("Bearer");
		expect(body.expires_in).toBe(3600);
		expect(typeof body.refresh_token).toBe("string");
		expect(body.scope).toBe(TOOLS_SCOPE);
		const grant = auth.verify(body.access_token as string);
		expect(grant.ok).toBe(true);
		if (!grant.ok) return;
		expect(grant.value.clientId).toBe(clientId);
		expect(grant.value.subject).toBe(OWNER.username);
		expect(grant.value.scopes).toEqual([TOOLS_SCOPE]);
		expect(grant.value.resource).toBe(RESOURCE);
	});

	test("a wrong verifier is invalid_grant", async () => {
		const { handle } = setup();
		const { clientId, code } = await codeFor(handle);
		const { status, body } = await exchange(handle, {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: clientId,
			code_verifier: pkce().verifier,
		});
		expect(status).toBe(400);
		expect(body.error).toBe("invalid_grant");
	});

	test("a code is single-use, and replaying it revokes the tokens it issued", async () => {
		const { auth, handle } = setup();
		const { clientId, code, verifier } = await codeFor(handle);
		const fields = {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: clientId,
			code_verifier: verifier,
		};
		const first = await exchange(handle, fields);
		expect(first.status).toBe(200);
		const replay = await exchange(handle, fields);
		expect(replay.status).toBe(400);
		expect(replay.body.error).toBe("invalid_grant");
		expect(auth.verify(first.body.access_token as string).ok).toBe(false);
		const refresh = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: first.body.refresh_token as string,
			client_id: clientId,
		});
		expect(refresh.body.error).toBe("invalid_grant");
	});

	test("an expired code is invalid_grant", async () => {
		const { handle, time } = setup({ codeTtlSeconds: 60 });
		const { clientId, code, verifier } = await codeFor(handle);
		time.advance(61_000);
		const { body } = await exchange(handle, {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: clientId,
			code_verifier: verifier,
		});
		expect(body.error).toBe("invalid_grant");
	});

	test("a code is bound to its client and redirect", async () => {
		const { handle } = setup();
		const { clientId, code, verifier } = await codeFor(handle);
		const other = await register(handle);
		const wrongClient = await exchange(handle, {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: other.client_id,
			code_verifier: verifier,
		});
		expect(wrongClient.body.error).toBe("invalid_grant");
		const { code: code2, verifier: v2, clientId: c2 } = await codeFor(handle);
		const wrongRedirect = await exchange(handle, {
			grant_type: "authorization_code",
			code: code2,
			redirect_uri: "http://127.0.0.1:1/other",
			client_id: c2,
			code_verifier: v2,
		});
		expect(wrongRedirect.body.error).toBe("invalid_grant");
		expect(clientId).not.toBe(c2);
	});

	test("a confidential client must present its secret", async () => {
		const { handle } = setup();
		const client = await register(handle, {
			token_endpoint_auth_method: "client_secret_post",
		});
		const pair = pkce();
		const code = codeFrom(
			await authorize(handle, {
				clientId: client.client_id,
				challenge: pair.challenge,
			}),
		);
		const base = {
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT,
			client_id: client.client_id,
			code_verifier: pair.verifier,
		};
		const wrong = await exchange(handle, { ...base, client_secret: "nope" });
		expect(wrong.status).toBe(401);
		expect(wrong.body.error).toBe("invalid_client");
		const right = await exchange(handle, {
			...base,
			client_secret: client.client_secret ?? "",
		});
		expect(right.status).toBe(200);
	});

	test("client_secret_basic is read from the Authorization header", async () => {
		const { handle } = setup();
		const client = await register(handle, {
			token_endpoint_auth_method: "client_secret_basic",
		});
		const pair = pkce();
		const code = codeFrom(
			await authorize(handle, {
				clientId: client.client_id,
				challenge: pair.challenge,
			}),
		);
		const { status } = await exchange(
			handle,
			{
				grant_type: "authorization_code",
				code,
				redirect_uri: REDIRECT,
				code_verifier: pair.verifier,
			},
			{ authorization: basic(client.client_id, client.client_secret ?? "") },
		);
		expect(status).toBe(200);
	});

	test("an unknown grant type is unsupported_grant_type", async () => {
		const { handle } = setup();
		const { body } = await exchange(handle, { grant_type: "password" });
		expect(body.error).toBe("unsupported_grant_type");
	});
});

describe("token scoping", () => {
	test("a token carries only the scopes requested", async () => {
		const { auth, handle } = setup();
		const token = await issueToken(handle, JOBS_SCOPE);
		expect(token.scope).toBe(JOBS_SCOPE);
		const grant = auth.verify(token.access_token);
		expect(grant.ok && grant.value.scopes).toEqual([JOBS_SCOPE]);
	});

	test("a request without scope gets the tools scope, not every scope", async () => {
		const { handle } = setup();
		const token = await issueToken(handle);
		expect(token.scope).toBe(TOOLS_SCOPE);
	});

	test("a client registered for some scopes cannot ask for others", async () => {
		const { handle } = setup();
		const client = await register(handle, { scope: JOBS_SCOPE });
		const res = await authorize(handle, {
			clientId: client.client_id,
			challenge: pkce().challenge,
			scope: TOOLS_SCOPE,
		});
		expect(
			new URL(res.headers.get("location") ?? "").searchParams.get("error"),
		).toBe("invalid_scope");
	});

	test("a refresh may narrow the scope but never widen it", async () => {
		const { auth, handle } = setup();
		const token = await issueToken(handle, `${TOOLS_SCOPE} ${JOBS_SCOPE}`);
		const narrowed = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: token.client_id,
			scope: TOOLS_SCOPE,
		});
		expect(narrowed.status).toBe(200);
		expect(narrowed.body.scope).toBe(TOOLS_SCOPE);
		const grant = auth.verify(narrowed.body.access_token as string);
		expect(grant.ok && grant.value.scopes).toEqual([TOOLS_SCOPE]);

		const other = await issueToken(handle, JOBS_SCOPE);
		const widened = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: other.refresh_token,
			client_id: other.client_id,
			scope: `${JOBS_SCOPE} ${TOOLS_SCOPE}`,
		});
		expect(widened.status).toBe(400);
		expect(widened.body.error).toBe("invalid_scope");
	});
});

describe("token expiry and refresh", () => {
	test("an access token stops verifying at its expiry", async () => {
		const { auth, handle, time } = setup({ accessTokenTtlSeconds: 600 });
		const token = await issueToken(handle);
		expect(token.expires_in).toBe(600);
		time.advance(599_000);
		expect(auth.verify(token.access_token).ok).toBe(true);
		time.advance(1_000);
		const expired = auth.verify(token.access_token);
		expect(expired.ok).toBe(false);
		if (!expired.ok) expect(expired.error).toBe("invalid_token");
	});

	test("an unknown token does not verify", () => {
		const { auth } = setup();
		expect(auth.verify("not-a-token").ok).toBe(false);
	});

	test("a refresh rotates the refresh token and the old one stops working", async () => {
		const { auth, handle, time } = setup({ accessTokenTtlSeconds: 600 });
		const token = await issueToken(handle);
		time.advance(700_000);
		const refreshed = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: token.client_id,
		});
		expect(refreshed.status).toBe(200);
		expect(refreshed.body.refresh_token).not.toBe(token.refresh_token);
		expect(auth.verify(refreshed.body.access_token as string).ok).toBe(true);
		const replay = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: token.client_id,
		});
		expect(replay.body.error).toBe("invalid_grant");
	});

	test("a refresh token is bound to its client and expires", async () => {
		const { handle, time } = setup({ refreshTokenTtlSeconds: 3600 });
		const token = await issueToken(handle);
		const other = await register(handle);
		const stolen = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: other.client_id,
		});
		expect(stolen.body.error).toBe("invalid_grant");
		time.advance(3_600_000);
		const late = await exchange(handle, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: token.client_id,
		});
		expect(late.body.error).toBe("invalid_grant");
	});
});

describe("basicAuthenticator", () => {
	const check = basicAuthenticator(OWNER);

	test("the configured owner authenticates as themselves", async () => {
		const result = await check(
			new Request(ISSUER, {
				headers: { authorization: basic(OWNER.username, OWNER.password) },
			}),
		);
		expect(result).toEqual({ ok: true, value: OWNER.username });
	});

	test.each([
		["no header", undefined],
		["a wrong password", basic(OWNER.username, "x")],
		["another user", basic("mallory", OWNER.password)],
		["a bearer header", "Bearer abc"],
	])("%s is refused with a Basic challenge", async (_label, header) => {
		const result = await check(
			new Request(ISSUER, {
				headers: header === undefined ? {} : { authorization: header },
			}),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.status).toBe(401);
		expect(result.error.headers.get("www-authenticate")).toBe(
			'Basic realm="maina remote", charset="UTF-8"',
		);
	});
});
