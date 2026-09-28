/**
 * The Maina Link v1 wire types this runtime sends and reads (#589).
 *
 * Every shape here is the cloud's (Global Constraint 8): the TypeScript
 * types mirror the vendored JSON Schemas in `./v1/`, and `parseWire`
 * validates against those schemas, so the schemas stay the one source of
 * truth. Nothing outside `link/protocol` declares a wire type (the pin test
 * enforces it). Outbound messages are validated too: the schemas forbid
 * extra properties, so a message that would send more than the published
 * fields never leaves the machine.
 */

import type { Result } from "@mainahq/core";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import controlMessageSchema from "./v1/control-message.schema.json" with {
	type: "json",
};
import enrolCompleteSchema from "./v1/enrol-complete.schema.json" with {
	type: "json",
};
import enrolCompleteResultSchema from "./v1/enrol-complete-result.schema.json" with {
	type: "json",
};
import enrolStartSchema from "./v1/enrol-start.schema.json" with {
	type: "json",
};
import enrolStartResultSchema from "./v1/enrol-start-result.schema.json" with {
	type: "json",
};
import envelopeSchema from "./v1/envelope.schema.json" with { type: "json" };
import envelopeAckSchema from "./v1/envelope-ack.schema.json" with {
	type: "json",
};
import eventSchema from "./v1/event.schema.json" with { type: "json" };
import policyBundleSchema from "./v1/policy-bundle.schema.json" with {
	type: "json",
};
import tokenChallengeSchema from "./v1/token-challenge.schema.json" with {
	type: "json",
};
import tokenGrantSchema from "./v1/token-grant.schema.json" with {
	type: "json",
};

export type DeviceKind = "workstation" | "ci";
/** An org's data class (`privacy.json` `dataClasses`); `metadata` is the default. */
export type DataClass = "metadata" | "names" | "rich";
type DeviceOs = "darwin" | "linux" | "windows" | "other";
export type OrgKeyPurpose =
	| "policy-bundle"
	| "approval-resolution"
	| "link-control";
export const ORG_KEY_PURPOSES: readonly OrgKeyPurpose[] = [
	"policy-bundle",
	"approval-resolution",
	"link-control",
];

/** `POST /link/v1/enrol/start` body. */
type EnrolStart = Readonly<{
	v: 1;
	kind: DeviceKind;
	os: DeviceOs;
	arch: string;
	runtimeVersion: string;
	label?: string;
}>;

type EnrolStartResult = Readonly<{
	v: 1;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	expiresIn: number;
	interval: number;
}>;

/** `POST /link/v1/enrol/complete` body; `proof` signs the rest. */
type EnrolComplete = Readonly<{
	v: 1;
	deviceCode: string;
	alg: "ed25519";
	publicKey: string;
	proof: string;
}>;

export type OrgKey = Readonly<{
	keyId: string;
	purpose: OrgKeyPurpose;
	alg: "ed25519";
	publicKey: string;
	notBefore: string;
	notAfter?: string;
}>;

type LinkEndpoints = Readonly<{
	tokenExchange: string;
	events: string;
	policy: string;
	approvals: string;
	schemas: string;
}>;

export type EnrolCompleteResult = Readonly<{
	v: 1;
	deviceId: string;
	orgId: string;
	orgKeys: readonly OrgKey[];
	linkSalt: Readonly<{ id: string; value: string }>;
	schemaVersion: 1;
	endpoints: LinkEndpoints;
}>;

/** `POST /link/v1/token` body; `sig` signs the rest. */
type TokenChallenge = Readonly<{
	v: 1;
	deviceId: string;
	nonce: string;
	ts: string;
	sig: string;
}>;

type TokenGrant = Readonly<{
	v: 1;
	deviceId: string;
	accessToken: string;
	tokenType: "device-bound";
	expiresIn: number;
}>;

type KeyRotationBody = Readonly<{
	add: readonly OrgKey[];
	retire: readonly string[];
}>;

type ControlBase = Readonly<{
	v: 1;
	orgId: string;
	messageId: string;
	deviceId: string;
	issuedAt: string;
	expiresAt: string;
	keyId: string;
	sig: string;
}>;

/** A signed instruction to one device (`$defs` in the schema per kind). */
export type ControlMessage =
	| (ControlBase &
			Readonly<{
				kind: "stop";
				body: Readonly<{ runId: string; reason?: string }>;
			}>)
	| (ControlBase &
			Readonly<{
				kind: "revision_grant";
				body: Readonly<{ runId: string; grantId: string }>;
			}>)
	| (ControlBase & Readonly<{ kind: "key_rotation"; body: KeyRotationBody }>);

/** An uplinked event's type (`event.schema.json` `type`). */
export type LinkEventType =
	| "decision"
	| "approval.requested"
	| "approval.resolved"
	| "run.started"
	| "run.step"
	| "run.finished"
	| "receipt"
	| "spend"
	| "inventory"
	| "override";

/**
 * One runtime event. `data` is checked against the schema for its `type`
 * at its `dataClass`, so its fields are the schema's, not listed here.
 */
export type LinkEvent = Readonly<{
	eventId: string;
	seq: number;
	ts: string;
	type: LinkEventType;
	dataClass: DataClass;
	runId?: string;
	data: Readonly<Record<string, unknown>>;
}>;

/** `POST /link/v1/events` body: one device's signed, ordered batch. */
type LinkEnvelope = Readonly<{
	v: 1;
	deviceId: string;
	seqFrom: number;
	seqTo: number;
	sentAt: string;
	events: readonly LinkEvent[];
	sig: string;
}>;

/** The cloud's answer to an envelope (202 from `POST /link/v1/events`). */
export type EnvelopeAck = Readonly<{
	v: 1;
	accepted: number;
	duplicates: number;
	rejected: readonly Readonly<{
		seq: number;
		eventId?: string;
		reason: "invalid_event" | "data_class_violation";
		field?: string;
	}>[];
	nextExpectedSeq: number;
	/** Seqs the cloud has not seen below `nextExpectedSeq`, oldest first. */
	gaps: readonly Readonly<{ from: number; to: number }>[];
}>;

type BundleScope = Readonly<{ kind: "org" | "team" | "repo"; id: string }>;

/**
 * `GET /link/v1/policy`: the org's signed, versioned policy for this
 * device's scope. `policy` is a maina v1 policy body, which core validates
 * against its own schema. While the cloud's signer is dark a bundle is
 * marked unsigned: `keyId: "unsigned"` and an all-zero `sig` (adr/0012).
 */
export type PolicyBundle = Readonly<{
	v: 1;
	orgId: string;
	scope: BundleScope;
	version: number;
	/** `sha256:` of the canonical `{ policy, budgetDirectives, exceptions }`. */
	etag: string;
	policy: Readonly<Record<string, unknown>> & Readonly<{ version: 1 }>;
	budgetDirectives: readonly Readonly<{
		id: string;
		scopeKind: BundleScope["kind"];
		scopeId: string;
		period: "day" | "week" | "month";
		limitMicroUsd: number;
		action: "degrade" | "stop";
		degradeTo?: string;
	}>[];
	exceptions: readonly Readonly<{
		id: string;
		actionClass: string;
		scopeKind: BundleScope["kind"];
		scopeId: string;
		verdict: "allow" | "ask";
		expiresAt: string;
	}>[];
	issuedAt: string;
	notBefore: string;
	keyId: string;
	sig: string;
}>;

type WireTypes = {
	"enrol-start": EnrolStart;
	"enrol-start-result": EnrolStartResult;
	"enrol-complete": EnrolComplete;
	"enrol-complete-result": EnrolCompleteResult;
	"token-challenge": TokenChallenge;
	"token-grant": TokenGrant;
	"control-message": ControlMessage;
	event: LinkEvent;
	envelope: LinkEnvelope;
	"envelope-ack": EnvelopeAck;
	"policy-bundle": PolicyBundle;
};

type WireKind = keyof WireTypes;

const SCHEMAS: Readonly<Record<WireKind, object>> = {
	"enrol-start": enrolStartSchema,
	"enrol-start-result": enrolStartResultSchema,
	"enrol-complete": enrolCompleteSchema,
	"enrol-complete-result": enrolCompleteResultSchema,
	"token-challenge": tokenChallengeSchema,
	"token-grant": tokenGrantSchema,
	"control-message": controlMessageSchema,
	event: eventSchema,
	envelope: envelopeSchema,
	"envelope-ack": envelopeAckSchema,
	"policy-bundle": policyBundleSchema,
};

export type WireRefusal = Readonly<{
	kind: "invalid_message";
	message: WireKind;
	problems: readonly string[];
}>;

let ajv: Ajv2020 | undefined;
const compiled = new Map<WireKind, ValidateFunction>();

function validator(kind: WireKind): Result<ValidateFunction, string> {
	const cached = compiled.get(kind);
	if (cached !== undefined) return { ok: true, value: cached };
	try {
		if (ajv === undefined) {
			ajv = new Ajv2020({ allErrors: true, strict: false });
			// The envelope refers to the event schema by its `$id`.
			ajv.addSchema(eventSchema);
		}
		const fn =
			kind === "event"
				? ajv.getSchema(eventSchema.$id)
				: ajv.compile(SCHEMAS[kind]);
		if (fn === undefined) return { ok: false, error: `no schema ${kind}` };
		compiled.set(kind, fn);
		return { ok: true, value: fn };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** `value` as the wire message `kind`, when it matches the published schema. */
export function parseWire<K extends WireKind>(
	kind: K,
	value: unknown,
): Result<WireTypes[K], WireRefusal> {
	const fn = validator(kind);
	if (!fn.ok) {
		return {
			ok: false,
			error: { kind: "invalid_message", message: kind, problems: [fn.error] },
		};
	}
	if (fn.value(value) === true) {
		return { ok: true, value: value as WireTypes[K] };
	}
	const problems = (fn.value.errors ?? []).map(
		(e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
	);
	return {
		ok: false,
		error: { kind: "invalid_message", message: kind, problems },
	};
}

// ── HTTP envelope and refusal codes (cloud adr/0010) ───────────────────────

/**
 * Every Link answer is a `{ data, error, meta }` envelope; a refusal's
 * `error` is its machine code and `meta.message` a human line.
 */
export type ApiEnvelope = Readonly<{
	data: unknown;
	error: string | null;
	meta?: Readonly<{ message?: unknown }>;
}>;

/** The refusal codes the runtime acts on (adr/0010). */
export const LINK_CODES = {
	/** Enrolment: not approved yet; poll again after `interval`. */
	authorizationPending: "authorization_pending",
	/** Enrolment: poll more slowly (RFC 8628). */
	slowDown: "slow_down",
	/** Enrolment: the org keys aren't available yet; retry the same code. */
	orgKeysUnavailable: "org_keys_unavailable",
	/** The device was revoked: stop Link, ask to re-enrol. */
	deviceRevoked: "device_revoked",
	/** The token is stale or unknown: buy a new one once. */
	tokenExpired: "token_expired",
	invalidToken: "invalid_token",
	missingToken: "missing_token",
} as const;
