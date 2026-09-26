/**
 * Test helpers for the remote service: a settable clock, PKCE pairs, form
 * posts and a raw OAuth walk (register, authorize, token) that hands back
 * a bearer token without going through an MCP client.
 */

import { createHash, randomBytes } from "node:crypto";

export const ISSUER = "https://remote.test";
export const RESOURCE = `${ISSUER}/mcp`;
export const REDIRECT = "http://127.0.0.1:33418/callback";
export const OWNER = { username: "owner", password: "s3cret-pass" };

export type Clock = { now: () => number; advance: (ms: number) => void };

export function clock(start = 1_750_000_000_000): Clock {
	let t = start;
	return {
		now: () => t,
		advance: (ms) => {
			t += ms;
		},
	};
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

type Pkce = Readonly<{ verifier: string; challenge: string }>;

export function pkce(): Pkce {
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

export const basic = (user: string, pass: string): string =>
	`Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

export const ownerAuth = basic(OWNER.username, OWNER.password);

export type Handle = (req: Request) => Promise<Response>;

export function postJson(
	handle: Handle,
	path: string,
	body: unknown,
): Promise<Response> {
	return handle(
		new Request(`${ISSUER}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

export function postForm(
	handle: Handle,
	path: string,
	fields: Record<string, string>,
	headers: Record<string, string> = {},
): Promise<Response> {
	return handle(
		new Request(`${ISSUER}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				...headers,
			},
			body: new URLSearchParams(fields).toString(),
		}),
	);
}

type Registered = Readonly<{
	client_id: string;
	client_secret?: string;
	redirect_uris: string[];
	token_endpoint_auth_method: string;
}>;

export async function register(
	handle: Handle,
	metadata: Record<string, unknown> = {},
): Promise<Registered> {
	const res = await postJson(handle, "/register", {
		redirect_uris: [REDIRECT],
		client_name: "test client",
		token_endpoint_auth_method: "none",
		...metadata,
	});
	if (res.status !== 201) {
		throw new Error(`register failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as Registered;
}

type AuthorizeParams = Readonly<{
	clientId: string;
	challenge: string;
	scope?: string;
	redirect?: string;
	state?: string;
	resource?: string;
	method?: string;
}>;

function authorizeUrl(p: AuthorizeParams): string {
	const q = new URLSearchParams({
		response_type: "code",
		client_id: p.clientId,
		redirect_uri: p.redirect ?? REDIRECT,
		code_challenge: p.challenge,
		code_challenge_method: p.method ?? "S256",
		state: p.state ?? "st-1",
	});
	if (p.scope !== undefined) q.set("scope", p.scope);
	if (p.resource !== undefined) q.set("resource", p.resource);
	return `${ISSUER}/authorize?${q.toString()}`;
}

export function authorize(
	handle: Handle,
	p: AuthorizeParams,
	auth: string | null = ownerAuth,
): Promise<Response> {
	return handle(
		new Request(authorizeUrl(p), {
			headers: auth === null ? {} : { authorization: auth },
		}),
	);
}

/** The `code` from an authorization redirect; throws when it is not one. */
export function codeFrom(res: Response): string {
	const location = res.headers.get("location");
	if (res.status !== 302 || location === null) {
		throw new Error(`expected a redirect, got ${res.status}`);
	}
	const code = new URL(location).searchParams.get("code");
	if (code === null) throw new Error(`no code in ${location}`);
	return code;
}

type TokenBody = Readonly<{
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
}>;

/** Register a public client and walk the code flow to a token response. */
export async function issueToken(
	handle: Handle,
	scope?: string,
): Promise<TokenBody & { client_id: string }> {
	const client = await register(handle);
	const pair = pkce();
	const code = codeFrom(
		await authorize(handle, {
			clientId: client.client_id,
			challenge: pair.challenge,
			...(scope !== undefined ? { scope } : {}),
		}),
	);
	const res = await postForm(handle, "/token", {
		grant_type: "authorization_code",
		code,
		redirect_uri: REDIRECT,
		client_id: client.client_id,
		code_verifier: pair.verifier,
	});
	if (res.status !== 200) {
		throw new Error(`token failed: ${res.status} ${await res.text()}`);
	}
	return { ...((await res.json()) as TokenBody), client_id: client.client_id };
}
