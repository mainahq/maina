/**
 * An in-process Maina cloud for the Link client tests: the enrol, token and
 * one authenticated route, answered from the vendored v1 schemas. It checks
 * everything the real cloud checks on these routes (adr/0010 in the cloud
 * repo): each body validates against its published schema, the enrolment
 * proof and the token challenge verify under the device key, a revoked
 * device gets `device_revoked`, and a nonce is used once. The crypto here is
 * written against `node:crypto` directly, not the client's helpers, so a
 * client that signs the wrong bytes fails.
 */

import {
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	randomBytes,
	sign,
	verify,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalizeReceipt, type HttpPort } from "@mainahq/core";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

const V1 = join(import.meta.dir, "..", "protocol", "v1");

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schemaFiles = readdirSync(V1).filter((f) => f.endsWith(".schema.json"));
// Added together first: the envelope schema refers to the event schema.
for (const file of schemaFiles) {
	ajv.addSchema(JSON.parse(readFileSync(join(V1, file), "utf-8")), file);
}

function valid(name: string, value: unknown): boolean {
	const check: ValidateFunction | undefined = ajv.getSchema(
		`${name}.schema.json`,
	);
	if (check === undefined) throw new Error(`no schema ${name}`);
	return check(value) === true;
}

type FakeRequest = Readonly<{
	method: string;
	url: string;
	headers: Readonly<Record<string, string>>;
	body?: string;
}>;

type FakeResponse = Readonly<{ status: number; body: string }>;

type OrgKeyPurpose = "policy-bundle" | "approval-resolution" | "link-control";

type OrgKeyRow = {
	keyId: string;
	purpose: OrgKeyPurpose;
	alg: "ed25519";
	publicKey: string;
	notBefore: string;
	notAfter?: string;
};

type FakeCloudOptions = {
	/** Completions answered `authorization_pending` before the approval. */
	pendingPolls?: number;
	/** The CI-enrolment API token the cloud accepts. */
	ciToken?: string;
	/** Purposes to leave out of the enrolment's org keys. */
	omitPurposes?: readonly OrgKeyPurpose[];
	/** Refuse every completion with this code (an expired code, say). */
	refuseCompleteWith?: string;
};

export type FakeCloud = Readonly<{
	baseUrl: string;
	http: HttpPort;
	/** Answers one request (also served over HTTP by the Node build test). */
	handle: (req: FakeRequest) => FakeResponse;
	requests: FakeRequest[];
	/** Counters and switches a test reads and flips. */
	state: {
		pendingPolls: number;
		completions: number;
		tokenExchanges: number;
		eventCalls: number;
		revoked: boolean;
		/** Tokens issued from now on are expired too (a refresh does not help). */
		alwaysExpire: boolean;
		deviceId: string | null;
		devicePublicKey: string | null;
		proofVerified: boolean;
		challengesVerified: number;
	};
	/** Every token issued so far is answered `token_expired` from now on. */
	expireIssuedTokens: () => void;
	/** Signs a control message with the org's link-control key. */
	signControl: (message: Record<string, unknown>, keyId?: string) => unknown;
	/** A fresh key pair, as a key_rotation's `add` entry plus its signer. */
	newOrgKey: (
		keyId: string,
		purpose: OrgKeyPurpose,
	) => Readonly<{ entry: OrgKeyRow; privateKey: KeyObject }>;
	/** Signs with a key the device does not trust. */
	signWith: (
		privateKey: KeyObject,
		message: Record<string, unknown>,
	) => unknown;
	orgId: string;
	controlKeyId: string;
}>;

const b64url = (bytes: Uint8Array): string =>
	Buffer.from(bytes).toString("base64url");

function rawPublicKey(key: KeyObject): string {
	const jwk = key.export({ format: "jwk" });
	return String(jwk.x);
}

function publicKeyFromRaw(x: string): KeyObject {
	return createPublicKey({
		key: { kty: "OKP", crv: "Ed25519", x },
		format: "jwk",
	});
}

function jcs(value: unknown): string {
	const c = canonicalizeReceipt(value);
	if (!c.ok) throw new Error(c.message);
	return c.data;
}

function withoutField(
	message: Record<string, unknown>,
	field: string,
): Record<string, unknown> {
	const { [field]: _dropped, ...rest } = message;
	return rest;
}

function deviceSigned(
	purpose: string,
	message: Record<string, unknown>,
	field: string,
	publicKey: string,
): boolean {
	const sig = message[field];
	if (typeof sig !== "string") return false;
	const data = Buffer.concat([
		Buffer.from(`maina-link/sig/v1\n${purpose}\n`, "utf-8"),
		Buffer.from(jcs(withoutField(message, field)), "utf-8"),
	]);
	try {
		return verify(
			null,
			data,
			publicKeyFromRaw(publicKey),
			Buffer.from(sig, "base64url"),
		);
	} catch {
		return false;
	}
}

const ok = (data: unknown, status = 200): FakeResponse => ({
	status,
	body: JSON.stringify({ data, error: null }),
});

const refuse = (status: number, code: string): FakeResponse => ({
	status,
	body: JSON.stringify({ data: null, error: code, meta: { message: code } }),
});

const USER_CODE = "WDJB-MJHT";

export function fakeCloud(options: FakeCloudOptions = {}): FakeCloud {
	const baseUrl = "https://cloud.test";
	const orgId = "org_acme";
	const controlKeyId = "key_control_1";
	const keys = new Map<string, KeyObject>();
	const orgKeys: OrgKeyRow[] = [];
	const purposes: readonly [string, OrgKeyPurpose][] = [
		["key_policy_1", "policy-bundle"],
		["key_approval_1", "approval-resolution"],
		[controlKeyId, "link-control"],
	];
	for (const [keyId, purpose] of purposes) {
		const pair = generateKeyPairSync("ed25519");
		keys.set(keyId, pair.privateKey);
		if (options.omitPurposes?.includes(purpose)) continue;
		orgKeys.push({
			keyId,
			purpose,
			alg: "ed25519",
			publicKey: rawPublicKey(pair.publicKey),
			notBefore: "2026-01-01T00:00:00.000Z",
		});
	}

	const deviceCodes = new Map<string, { approved: boolean }>();
	const nonces = new Set<string>();
	const tokens = new Map<string, { expired: boolean }>();
	const requests: FakeRequest[] = [];
	const state: FakeCloud["state"] = {
		pendingPolls: options.pendingPolls ?? 0,
		completions: 0,
		tokenExchanges: 0,
		eventCalls: 0,
		revoked: false,
		alwaysExpire: false,
		deviceId: null,
		devicePublicKey: null,
		proofVerified: false,
		challengesVerified: 0,
	};

	function parse(body: string | undefined): unknown {
		try {
			return JSON.parse(body ?? "");
		} catch {
			return undefined;
		}
	}

	function start(req: FakeRequest): FakeResponse {
		const body = parse(req.body);
		if (!valid("enrol-start", body)) return refuse(400, "invalid_request");
		const kind = (body as { kind: string }).kind;
		const bearer = req.headers.Authorization ?? req.headers.authorization;
		let approved = false;
		if (kind === "ci") {
			if (bearer === undefined) return refuse(401, "ci_token_required");
			if (bearer !== `Bearer ${options.ciToken}`) {
				return refuse(403, "ci_scope_required");
			}
			approved = true;
		}
		const deviceCode = `dc_${b64url(randomBytes(32))}`;
		deviceCodes.set(deviceCode, { approved });
		return ok({
			v: 1,
			deviceCode,
			userCode: USER_CODE,
			verificationUri: "https://app.cloud.test/enrol",
			expiresIn: 600,
			interval: 5,
		});
	}

	function complete(req: FakeRequest): FakeResponse {
		state.completions++;
		const body = parse(req.body);
		if (!valid("enrol-complete", body)) return refuse(400, "invalid_request");
		const message = body as Record<string, unknown> & {
			deviceCode: string;
			publicKey: string;
		};
		if (options.refuseCompleteWith !== undefined) {
			return refuse(400, options.refuseCompleteWith);
		}
		const pending = deviceCodes.get(message.deviceCode);
		if (pending === undefined) return refuse(400, "invalid_grant");
		if (!deviceSigned("enrol-proof", message, "proof", message.publicKey)) {
			return refuse(400, "invalid_proof");
		}
		if (!pending.approved && state.pendingPolls > 0) {
			state.pendingPolls--;
			return refuse(400, "authorization_pending");
		}
		deviceCodes.delete(message.deviceCode);
		state.proofVerified = true;
		state.deviceId = "dev_01J9Z3K4T8QX";
		state.devicePublicKey = message.publicKey;
		return ok({
			v: 1,
			deviceId: state.deviceId,
			orgId,
			orgKeys,
			linkSalt: {
				id: "lsalt_1",
				value: b64url(randomBytes(32)),
			},
			schemaVersion: 1,
			endpoints: {
				tokenExchange: "/link/v1/token",
				events: "/link/v1/events",
				policy: "/link/v1/policy",
				approvals: "/link/v1/approvals",
				schemas: "/link/v1/schemas",
			},
		});
	}

	function token(req: FakeRequest): FakeResponse {
		state.tokenExchanges++;
		const body = parse(req.body);
		if (!valid("token-challenge", body)) return refuse(400, "invalid_request");
		const challenge = body as Record<string, unknown> & {
			deviceId: string;
			nonce: string;
		};
		if (
			state.deviceId === null ||
			state.devicePublicKey === null ||
			challenge.deviceId !== state.deviceId
		) {
			return refuse(401, "unknown_device");
		}
		if (
			!deviceSigned("token-challenge", challenge, "sig", state.devicePublicKey)
		) {
			return refuse(401, "invalid_signature");
		}
		state.challengesVerified++;
		if (state.revoked) return refuse(401, "device_revoked");
		if (nonces.has(challenge.nonce)) return refuse(401, "challenge_replayed");
		nonces.add(challenge.nonce);
		const accessToken = `lat_${b64url(randomBytes(32))}`;
		tokens.set(accessToken, { expired: state.alwaysExpire });
		return ok({
			v: 1,
			deviceId: state.deviceId,
			accessToken,
			tokenType: "device-bound",
			expiresIn: 900,
		});
	}

	function events(req: FakeRequest): FakeResponse {
		state.eventCalls++;
		const bearer = req.headers.Authorization ?? req.headers.authorization;
		if (bearer === undefined) return refuse(401, "missing_token");
		const t = tokens.get(bearer.replace(/^Bearer /, ""));
		if (t === undefined) return refuse(401, "invalid_token");
		if (state.revoked) return refuse(401, "device_revoked");
		if (t.expired) return refuse(401, "token_expired");
		return ok({ accepted: true });
	}

	function handle(req: FakeRequest): FakeResponse {
		requests.push(req);
		const path = new URL(req.url).pathname;
		if (req.method !== "POST") return refuse(404, "not_found");
		switch (path) {
			case "/link/v1/enrol/start":
				return start(req);
			case "/link/v1/enrol/complete":
				return complete(req);
			case "/link/v1/token":
				return token(req);
			case "/link/v1/events":
				return events(req);
			default:
				return refuse(404, "not_found");
		}
	}

	function signWith(
		privateKey: KeyObject,
		message: Record<string, unknown>,
	): unknown {
		const data = Buffer.concat([
			Buffer.from(`maina-cloud/sig/v1\nlink-control\n${orgId}\n`, "utf-8"),
			Buffer.from(jcs(message), "utf-8"),
		]);
		return { ...message, sig: b64url(sign(null, data, privateKey)) };
	}

	return {
		baseUrl,
		orgId,
		controlKeyId,
		requests,
		state,
		handle,
		http: { request: async (req) => ({ ok: true, value: handle(req) }) },
		expireIssuedTokens: () => {
			for (const t of tokens.values()) t.expired = true;
		},
		signControl: (message, keyId = controlKeyId) => {
			const key = keys.get(keyId);
			if (key === undefined) throw new Error(`no key ${keyId}`);
			return signWith(key, { ...message, keyId });
		},
		newOrgKey: (keyId, purpose) => {
			const pair = generateKeyPairSync("ed25519");
			keys.set(keyId, pair.privateKey);
			return {
				entry: {
					keyId,
					purpose,
					alg: "ed25519",
					publicKey: rawPublicKey(pair.publicKey),
					notBefore: "2026-01-01T00:00:00.000Z",
				},
				privateKey: pair.privateKey,
			};
		},
		signWith,
	};
}
