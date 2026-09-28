/**
 * An in-process Maina cloud for the Link client tests: the enrol, token and
 * event routes, answered from the vendored v1 schemas. It checks
 * everything the real cloud checks on these routes (adr/0010 in the cloud
 * repo): each body validates against its published schema, the enrolment
 * proof and the token challenge verify under the device key, a revoked
 * device gets `device_revoked`, and a nonce is used once. With `ingest`,
 * `POST /link/v1/events` is the cloud's ingest (cloud Task 4.3): it verifies
 * the envelope signature and schema, dedupes by `eventId`, tracks the
 * device's `seq` and answers an `EnvelopeAck` with `nextExpectedSeq` and the
 * open gaps. `GET /link/v1/policy` serves `state.policy` the way cloud Task
 * 6.2 does (adr/0012): an HTTP `ETag` of `"<version>.<content hex>"`, 304 on
 * a matching `If-None-Match`, 404 `no_policy` when nothing is published and
 * `meta.signature: "dark"` on a bundle marked unsigned. The approvals
 * channel is cloud Task 7.2's (adr/0014): `POST /link/v1/approvals` takes an
 * `ApprovalAsk` signed by the device key and answers `{ askId, requestId,
 * created, status, expiresAt, resolution? }`, and `GET
 * /link/v1/approvals/<askId>/wait` answers `pending` or the resolution a
 * test set with `resolveApproval`, signed with the org's approval-resolution
 * key or marked unsigned the way the dark signer marks it. The crypto here is
 * written against `node:crypto` directly, not the client's helpers, so a
 * client that signs the wrong bytes fails.
 */

import {
	createHash,
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
	/** Serve the real ingest on the events route (else a bare `accepted`). */
	ingest?: boolean;
	/**
	 * The org's data class, sent in the enrolment result only to a device
	 * that lists `dataClass` in `accepts` (cloud #265); null is a cloud from
	 * before the field, which never sends it. Defaults to `metadata`. Any
	 * other string is a cloud answering outside the protocol.
	 */
	orgDataClass?: string | null;
};

type Resolution = "approved" | "denied" | "timeout";

type ResolveOptions = Readonly<{
	/** false: marked unsigned, as while the cloud's signer is dark. */
	signed?: boolean;
	/** The org key that signs it (default the approval-resolution key). */
	keyId?: string;
	fallback?: "deny" | "ask-local";
	resolvedBy?: Readonly<{ kind: "member" | "policy" | "system"; id: string }>;
	/** Changes a signed field after signing. */
	tamper?: boolean;
}>;

type StoredAsk = {
	ask: Record<string, unknown>;
	requestId: string;
	resolution: Record<string, unknown> | null;
};

type IngestedEvent = Readonly<{
	eventId: string;
	seq: number;
	ts: string;
	type: string;
	dataClass: string;
	data: Record<string, unknown>;
}>;

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
		/** The HTTP port fails every request, as with no network. */
		offline: boolean;
		/** Envelopes still to ingest whose answer is then lost (a crash). */
		loseAcks: number;
		/** The next ingest forgets these seqs (a lost write); they reopen a gap. */
		forget: Set<number>;
		/** Events of these types are rejected as `invalid_event`. */
		rejectTypes: Set<string>;
		/** The cloud already holds seqs up to here from an earlier life. */
		seqFloor: number;
		/** Every event ingested, once each, in arrival order. */
		received: IngestedEvent[];
		/** The size of each envelope that verified. */
		envelopes: number[];
		duplicates: number;
		/** The last ack's open gaps. */
		gaps: readonly Readonly<{ from: number; to: number }>[];
		/** The bundle `GET /link/v1/policy` serves; null answers `no_policy`. */
		policy: Record<string, unknown> | null;
		/** The `If-None-Match` of each policy pull, in order. */
		policyPulls: (string | undefined)[];
		/** Every ask taken, by ask id. */
		asks: Map<string, StoredAsk>;
		/** `POST /link/v1/approvals` calls. */
		askCalls: number;
		/** The `waitMs` of each long poll, in order. */
		waits: (string | null)[];
		/** Answers every approvals call with this refusal (a hub outage). */
		approvalsRefuse: string | null;
		/**
		 * The control messages `GET /link/v1/control/wait` serves, in order;
		 * a message's cursor is its 1-based index.
		 */
		controls: unknown[];
		/** The `after` of each control wait, in order (null when absent). */
		controlWaits: (string | null)[];
	};
	/** Resolves a taken ask; the next wait (or re-ask) answers it. */
	resolveApproval: (
		askId: string,
		resolution: Resolution,
		options?: ResolveOptions,
	) => Record<string, unknown>;
	/**
	 * A bundle as the cloud builds it: its content ETag computed, then signed
	 * with the org's policy-bundle key (or `keyId`), or marked unsigned the way
	 * the dark production signer marks it (`signed: false`).
	 */
	policyBundle: (
		version: number,
		policy: Record<string, unknown>,
		options?: Readonly<{
			keyId?: string;
			signed?: boolean;
			budgetDirectives?: readonly Record<string, unknown>[];
			notBefore?: string;
			orgId?: string;
		}>,
	) => Record<string, unknown>;
	/** Signs a bundle (without `sig`) with the org's policy-bundle key `keyId`. */
	signPolicy: (
		bundle: Record<string, unknown>,
		keyId?: string,
	) => Record<string, unknown>;
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

	const orgDataClass =
		options.orgDataClass === undefined ? "metadata" : options.orgDataClass;
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
		offline: false,
		loseAcks: 0,
		forget: new Set(),
		rejectTypes: new Set(),
		seqFloor: 0,
		received: [],
		envelopes: [],
		duplicates: 0,
		gaps: [],
		policy: null,
		policyPulls: [],
		asks: new Map(),
		askCalls: 0,
		waits: [],
		approvalsRefuse: null,
		controls: [],
		controlWaits: [],
	};
	const seenEvents = new Set<string>();
	const seenSeqs = new Set<number>();

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
			accepts?: readonly string[];
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
			...(orgDataClass !== null && message.accepts?.includes("dataClass")
				? { dataClass: orgDataClass }
				: {}),
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
		if (!options.ingest) return ok({ accepted: true });
		return ingest(req);
	}

	function policy(req: FakeRequest): FakeResponse {
		const bearer = req.headers.Authorization ?? req.headers.authorization;
		if (bearer === undefined) return refuse(401, "missing_token");
		const t = tokens.get(bearer.replace(/^Bearer /, ""));
		if (t === undefined) return refuse(401, "invalid_token");
		if (state.revoked) return refuse(401, "device_revoked");
		if (t.expired) return refuse(401, "token_expired");
		const held = req.headers["If-None-Match"] ?? req.headers["if-none-match"];
		state.policyPulls.push(held);
		const bundle = state.policy;
		if (bundle === null) return refuse(404, "no_policy");
		const hex = String(bundle.etag).replace(/^sha256:/, "");
		const etag = `"${String(bundle.version)}.${hex}"`;
		if (held === etag) return { status: 304, body: "" };
		return {
			status: 200,
			body: JSON.stringify({
				data: bundle,
				error: null,
				meta: { signature: bundle.keyId === "unsigned" ? "dark" : "signed" },
			}),
		};
	}

	/** The bearer check every device route makes; null when it passes. */
	function authorize(req: FakeRequest): FakeResponse | null {
		const bearer = req.headers.Authorization ?? req.headers.authorization;
		if (bearer === undefined) return refuse(401, "missing_token");
		const t = tokens.get(bearer.replace(/^Bearer /, ""));
		if (t === undefined) return refuse(401, "invalid_token");
		if (state.revoked) return refuse(401, "device_revoked");
		if (t.expired) return refuse(401, "token_expired");
		return null;
	}

	function askReply(stored: StoredAsk, created: boolean): unknown {
		const data = stored.ask.data as { expiresAt: string };
		return {
			askId: stored.ask.askId,
			requestId: stored.requestId,
			created,
			status:
				stored.resolution === null
					? "pending"
					: String(stored.resolution.resolution),
			expiresAt: data.expiresAt,
			...(stored.resolution === null ? {} : { resolution: stored.resolution }),
		};
	}

	function approvals(req: FakeRequest): FakeResponse {
		state.askCalls++;
		const denied = authorize(req);
		if (denied !== null) return denied;
		if (state.approvalsRefuse !== null) {
			return refuse(500, state.approvalsRefuse);
		}
		const body = parse(req.body);
		if (!valid("approval-ask", body)) return refuse(400, "invalid_request");
		const ask = body as Record<string, unknown> & {
			askId: string;
			deviceId: string;
		};
		if (
			ask.deviceId !== state.deviceId ||
			state.devicePublicKey === null ||
			!deviceSigned("approval-ask", ask, "sig", state.devicePublicKey)
		) {
			return refuse(401, "invalid_signature");
		}
		const known = state.asks.get(ask.askId);
		if (known !== undefined) return ok(askReply(known, false));
		const stored: StoredAsk = {
			ask,
			requestId: `apr_${state.asks.size + 1}`,
			resolution: null,
		};
		state.asks.set(ask.askId, stored);
		return ok(askReply(stored, true), 201);
	}

	function wait(req: FakeRequest, askId: string): FakeResponse {
		const denied = authorize(req);
		if (denied !== null) return denied;
		state.waits.push(new URL(req.url).searchParams.get("waitMs"));
		if (state.approvalsRefuse !== null) {
			return refuse(500, state.approvalsRefuse);
		}
		const stored = state.asks.get(askId);
		if (stored === undefined) return refuse(404, "not_found");
		return ok(
			stored.resolution === null
				? { status: "pending" }
				: { status: "resolved", resolution: stored.resolution },
		);
	}

	/** `GET /link/v1/control/wait`: the messages after the cursor, at once. */
	function controlWait(req: FakeRequest): FakeResponse {
		const denied = authorize(req);
		if (denied !== null) return denied;
		const after = new URL(req.url).searchParams.get("after");
		state.controlWaits.push(after);
		const from = after === null ? 0 : Number(after);
		const messages = state.controls.slice(from);
		const cursor =
			state.controls.length > from ? String(state.controls.length) : after;
		return ok({ messages, cursor });
	}

	function signResolution(
		unsigned: Record<string, unknown>,
		keyId: string,
	): Record<string, unknown> {
		const key = keys.get(keyId);
		if (key === undefined) throw new Error(`no key ${keyId}`);
		const message = { ...unsigned, keyId };
		const data = Buffer.concat([
			Buffer.from(
				`maina-cloud/sig/v1\napproval-resolution\n${String(unsigned.orgId)}\n`,
				"utf-8",
			),
			Buffer.from(jcs(message), "utf-8"),
		]);
		return { ...message, sig: b64url(sign(null, data, key)) };
	}

	function resolveApproval(
		askId: string,
		resolution: Resolution,
		opts: ResolveOptions = {},
	): Record<string, unknown> {
		const stored = state.asks.get(askId);
		if (stored === undefined) throw new Error(`no ask ${askId}`);
		const unsigned: Record<string, unknown> = {
			v: 1,
			orgId,
			askId,
			deviceId: stored.ask.deviceId,
			resolution,
			...(resolution === "timeout"
				? { fallback: opts.fallback ?? stored.ask.fallback }
				: {}),
			...(resolution === "timeout"
				? {}
				: {
						resolvedBy: opts.resolvedBy ?? { kind: "member", id: "mem_7c1d" },
					}),
			resolvedAt: "2026-09-28T09:16:11.402Z",
		};
		let signed =
			opts.signed === false
				? { ...unsigned, keyId: "unsigned", sig: "A".repeat(86) }
				: signResolution(unsigned, opts.keyId ?? "key_approval_1");
		if (opts.tamper === true) {
			signed = {
				...signed,
				resolution: resolution === "approved" ? "denied" : "approved",
			};
			if (signed.resolution === "approved") delete signed.fallback;
		}
		if (!valid("approval-resolution", signed)) {
			throw new Error("fake resolution is invalid");
		}
		stored.resolution = signed;
		return signed;
	}

	/** The open gaps below the highest seq seen, oldest first. */
	function openGaps(max: number): { from: number; to: number }[] {
		const gaps: { from: number; to: number }[] = [];
		let from: number | null = null;
		for (let s = state.seqFloor + 1; s <= max; s++) {
			if (!seenSeqs.has(s)) {
				from ??= s;
			} else if (from !== null) {
				gaps.push({ from, to: s - 1 });
				from = null;
			}
		}
		if (from !== null) gaps.push({ from, to: max });
		return gaps.slice(0, 100);
	}

	function ingest(req: FakeRequest): FakeResponse {
		const body = parse(req.body);
		if (!valid("envelope", body)) return refuse(400, "invalid_envelope");
		const envelope = body as Record<string, unknown> & {
			deviceId: string;
			seqFrom: number;
			seqTo: number;
			events: IngestedEvent[];
		};
		if (
			envelope.deviceId !== state.deviceId ||
			state.devicePublicKey === null ||
			!deviceSigned("envelope", envelope, "sig", state.devicePublicKey)
		) {
			return refuse(401, "invalid_signature");
		}
		const seqs = envelope.events.map((e) => e.seq);
		const ordered = seqs.every((s, i) => i === 0 || s > (seqs[i - 1] ?? 0));
		if (
			!ordered ||
			seqs[0] !== envelope.seqFrom ||
			seqs.at(-1) !== envelope.seqTo
		) {
			return refuse(400, "invalid_envelope");
		}
		state.envelopes.push(envelope.events.length);
		let accepted = 0;
		let duplicates = 0;
		const rejected: { seq: number; eventId: string; reason: string }[] = [];
		for (const event of envelope.events) {
			if (state.forget.delete(event.seq)) continue;
			if (seenEvents.has(event.eventId)) {
				duplicates++;
				continue;
			}
			seenEvents.add(event.eventId);
			seenSeqs.add(event.seq);
			if (state.rejectTypes.has(event.type)) {
				rejected.push({
					seq: event.seq,
					eventId: event.eventId,
					reason: "invalid_event",
				});
				continue;
			}
			state.received.push(event);
			accepted++;
		}
		state.duplicates += duplicates;
		let max = state.seqFloor;
		for (const s of seenSeqs) max = Math.max(max, s);
		state.gaps = openGaps(max);
		const ack = {
			v: 1,
			accepted,
			duplicates,
			rejected,
			nextExpectedSeq: max + 1,
			gaps: state.gaps,
		};
		if (!valid("envelope-ack", ack)) throw new Error("fake ack is invalid");
		return ok(ack, 202);
	}

	function handle(req: FakeRequest): FakeResponse {
		requests.push(req);
		const path = new URL(req.url).pathname;
		if (req.method === "GET" && path === "/link/v1/policy") return policy(req);
		if (req.method === "GET" && path === "/link/v1/control/wait") {
			return controlWait(req);
		}
		const waiting = /^\/link\/v1\/approvals\/([^/]+)\/wait$/.exec(path);
		if (req.method === "GET" && waiting?.[1] !== undefined) {
			return wait(req, decodeURIComponent(waiting[1]));
		}
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
			case "/link/v1/approvals":
				return approvals(req);
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

	function signPolicy(
		bundle: Record<string, unknown>,
		keyId = "key_policy_1",
	): Record<string, unknown> {
		const key = keys.get(keyId);
		if (key === undefined) throw new Error(`no key ${keyId}`);
		const unsigned: Record<string, unknown> = {
			...withoutField(bundle, "sig"),
			keyId,
		};
		const data = Buffer.concat([
			Buffer.from(
				`maina-cloud/sig/v1\npolicy-bundle\n${String(unsigned.orgId)}\n`,
				"utf-8",
			),
			Buffer.from(jcs(unsigned), "utf-8"),
		]);
		return { ...unsigned, sig: b64url(sign(null, data, key)) };
	}

	function policyBundle(
		version: number,
		body: Record<string, unknown>,
		opts: Parameters<FakeCloud["policyBundle"]>[2] = {},
	): Record<string, unknown> {
		const budgetDirectives = opts.budgetDirectives ?? [];
		const content = { policy: body, budgetDirectives, exceptions: [] };
		const etag = `sha256:${createHash("sha256").update(jcs(content)).digest("hex")}`;
		const bundle = {
			v: 1,
			orgId: opts.orgId ?? orgId,
			scope: { kind: "org", id: opts.orgId ?? orgId },
			version,
			etag,
			...content,
			issuedAt: "2026-09-28T08:00:00.000Z",
			notBefore: opts.notBefore ?? "2026-09-28T08:00:00.000Z",
		};
		if (opts.signed === false) {
			// The dark signer (cloud adr/0012 §6): keyId "unsigned", all-zero sig.
			return { ...bundle, keyId: "unsigned", sig: "A".repeat(86) };
		}
		return signPolicy(bundle, opts.keyId);
	}

	return {
		baseUrl,
		orgId,
		controlKeyId,
		policyBundle,
		signPolicy,
		resolveApproval,
		requests,
		state,
		handle,
		http: {
			request: async (req) => {
				if (state.offline) {
					return {
						ok: false,
						error: { kind: "network", url: req.url, message: "offline" },
					};
				}
				const res = handle(req);
				if (
					state.loseAcks > 0 &&
					new URL(req.url).pathname === "/link/v1/events" &&
					res.status === 202
				) {
					state.loseAcks--;
					return {
						ok: false,
						error: { kind: "network", url: req.url, message: "reset" },
					};
				}
				return { ok: true, value: res };
			},
		},
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
