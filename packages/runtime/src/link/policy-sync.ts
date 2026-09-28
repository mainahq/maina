/**
 * Policy pull (#592, spec §6.3 "Policy pull", cloud plan Task 6.3, cloud
 * adr/0012): the org's policy bundle becomes this machine's managed policy
 * layer.
 *
 * - `tick` polls `GET /link/v1/policy` every `POLICY_POLL_MS` (inside the
 *   5-minute propagation goal, G1), always sending the held bundle's HTTP
 *   ETag (`"<version>.<content hex>"`) in `If-None-Match`; a 304 keeps it.
 * - `verifyBundle` accepts a bundle only when it matches the published
 *   schema, names this device's org, is signed by a pinned policy-bundle key
 *   (`trust.ts`), is valid now, is not older than the held one (no
 *   downgrade) and its policy body validates as a managed layer (core
 *   `parseManagedLayer`). An unsigned bundle is refused, except the one the
 *   cloud serves while its production signer is dark (`keyId: "unsigned"`,
 *   an all-zero `sig`): that is kept as a clearly labelled *unsigned*
 *   managed policy, which core only lets tighten, and never replaces a
 *   signed bundle already held.
 * - The last good bundle is kept owner-only in `<link dir>/policy/
 *   bundle.json` with the last refusal, if any. A refused bundle changes
 *   nothing else: the last good one stays in force, and applies offline.
 * - `readManagedLayer` is what the gate reads per event: the held file only,
 *   never the network, so a cloud outage adds no gate latency. It
 *   re-verifies the file against the pinned keys, so a held bundle edited on
 *   disk is an error (the gate then asks), never a silent policy.
 *
 * The bundle's exceptions (cloud Task 6.7) are not applied yet.
 */

import {
	activeBudgetDirectives,
	type ManagedLayer,
	type ManagedSignature,
	type PolicyError,
	parseManagedLayer,
	type Result,
} from "@mainahq/core";
import { createLinkClient } from "./client";
import { type LinkFailure, NOT_MODIFIED } from "./http";
import {
	type CryptoFailure,
	type LinkCrypto,
	policyBundleSigningInput,
} from "./keys";
import {
	type OrgKey,
	type PolicyBundle,
	parseWire,
	type WireRefusal,
} from "./protocol/wire";
import type { DeviceState, LinkStore, StoreError } from "./store";
import type { LinkPorts } from "./token";
import { trustedOrgKeys } from "./trust";

/** How often the device asks for a newer bundle. */
export const POLICY_POLL_MS = 60_000;

/** Clock skew tolerated on `notBefore`. */
const MAX_SKEW_MS = 5 * 60_000;

/** How the dark production signer marks a bundle (cloud adr/0012 §6). */
const DARK_KEY_ID = "unsigned";
const DARK_SIG = "A".repeat(86);

type BundleRefusal =
	| Readonly<{ kind: "unsigned" }>
	| WireRefusal
	| Readonly<{ kind: "wrong_org"; orgId: string }>
	| Readonly<{ kind: "untrusted_key"; keyId: string }>
	| Readonly<{ kind: "bad_signature" }>
	| Readonly<{ kind: "not_yet_valid"; notBefore: string }>
	| Readonly<{ kind: "downgrade"; version: number; held: number }>
	| Readonly<{ kind: "invalid_policy"; errors: readonly PolicyError[] }>
	| CryptoFailure;

/** The org and the policy-bundle keys a bundle must verify under. */
type BundleTrust = Readonly<{ orgId: string; keys: readonly OrgKey[] }>;

/** What `verifyBundle` needs of the bundle already held. */
type HeldSummary = Readonly<{
	version: number;
	etag: string;
	signature: ManagedSignature;
}>;

type VerifiedBundle = Readonly<{
	bundle: PolicyBundle;
	signature: ManagedSignature;
	layer: ManagedLayer;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isDark = (bundle: PolicyBundle): boolean =>
	bundle.keyId === DARK_KEY_ID && bundle.sig === DARK_SIG;

/** The HTTP ETag the cloud serves for `bundle` (adr/0012 §5). */
const httpEtag = (bundle: PolicyBundle): string =>
	`"${bundle.version}.${bundle.etag.replace(/^sha256:/, "")}"`;

function checkSignature(
	bundle: PolicyBundle,
	trust: BundleTrust,
	crypto: LinkCrypto,
): Result<void, BundleRefusal> {
	const key = trust.keys.find(
		(k) => k.purpose === "policy-bundle" && k.keyId === bundle.keyId,
	);
	if (key === undefined) {
		return { ok: false, error: { kind: "untrusted_key", keyId: bundle.keyId } };
	}
	const input = policyBundleSigningInput(bundle.orgId, bundle);
	if (!input.ok) return input;
	return crypto.verify(key.publicKey, input.value, bundle.sig)
		? { ok: true, value: undefined }
		: { ok: false, error: { kind: "bad_signature" } };
}

/**
 * Verifies a policy bundle against the org's pinned policy-bundle keys and
 * the bundle held before it (`null` when none). Nothing is written.
 */
export function verifyBundle(
	raw: unknown,
	trust: BundleTrust,
	held: HeldSummary | null,
	ports: Readonly<{ crypto: LinkCrypto; now: Date }>,
): Result<VerifiedBundle, BundleRefusal> {
	if (isRecord(raw) && !("sig" in raw)) {
		return { ok: false, error: { kind: "unsigned" } };
	}
	const parsed = parseWire("policy-bundle", raw);
	if (!parsed.ok) return parsed;
	const bundle = parsed.value;
	if (bundle.orgId !== trust.orgId) {
		return { ok: false, error: { kind: "wrong_org", orgId: bundle.orgId } };
	}
	const signature: ManagedSignature = isDark(bundle) ? "unsigned" : "signed";
	if (signature === "unsigned" && held?.signature === "signed") {
		return { ok: false, error: { kind: "unsigned" } };
	}
	if (signature === "signed") {
		const signed = checkSignature(bundle, trust, ports.crypto);
		if (!signed.ok) return signed;
	}
	if (Date.parse(bundle.notBefore) > ports.now.getTime() + MAX_SKEW_MS) {
		return {
			ok: false,
			error: { kind: "not_yet_valid", notBefore: bundle.notBefore },
		};
	}
	if (
		held !== null &&
		(bundle.version < held.version ||
			(bundle.version === held.version && bundle.etag !== held.etag))
	) {
		return {
			ok: false,
			error: { kind: "downgrade", version: bundle.version, held: held.version },
		};
	}
	const layer = parseManagedLayer({
		policy: bundle.policy,
		version: bundle.version,
		etag: bundle.etag,
		signature,
		keyId: bundle.keyId,
		issuedAt: bundle.issuedAt,
		budgetDirectives: bundle.budgetDirectives,
	});
	if (!layer.ok) {
		return {
			ok: false,
			error: { kind: "invalid_policy", errors: layer.error },
		};
	}
	return { ok: true, value: { bundle, signature, layer: layer.value } };
}

// ── The held file ───────────────────────────────────────────────────────────

/** A bundle the device refused: what, when, and the version it carried. */
type Refusal = Readonly<{ kind: string; at: string; version?: number }>;

type Held = Readonly<{
	bundle: PolicyBundle;
	signature: ManagedSignature;
	receivedAt: string;
}>;

/** `<link dir>/policy/bundle.json`. */
type HeldFile = Readonly<{
	v: 1;
	held: Held | null;
	lastRefusal: Refusal | null;
}>;

const EMPTY: HeldFile = { v: 1, held: null, lastRefusal: null };

function parseRefusal(value: unknown): Refusal | null | undefined {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		typeof value.kind !== "string" ||
		typeof value.at !== "string"
	) {
		return undefined;
	}
	return {
		kind: value.kind,
		at: value.at,
		...(typeof value.version === "number" ? { version: value.version } : {}),
	};
}

function parseHeld(value: unknown): Held | null | undefined {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		(value.signature !== "signed" && value.signature !== "unsigned") ||
		typeof value.receivedAt !== "string"
	) {
		return undefined;
	}
	const bundle = parseWire("policy-bundle", value.bundle);
	if (!bundle.ok) return undefined;
	return {
		bundle: bundle.value,
		signature: value.signature,
		receivedAt: value.receivedAt,
	};
}

type HeldFileError = StoreError | Readonly<{ kind: "corrupt_policy" }>;

function readHeldFile(store: LinkStore): Result<HeldFile, HeldFileError> {
	const text = store.readPolicy();
	if (!text.ok) return text;
	if (text.value === null) return { ok: true, value: EMPTY };
	let json: unknown;
	try {
		json = JSON.parse(text.value);
	} catch {
		return { ok: false, error: { kind: "corrupt_policy" } };
	}
	if (!isRecord(json) || json.v !== 1) {
		return { ok: false, error: { kind: "corrupt_policy" } };
	}
	const held = parseHeld(json.held);
	const lastRefusal = parseRefusal(json.lastRefusal);
	if (held === undefined || lastRefusal === undefined) {
		return { ok: false, error: { kind: "corrupt_policy" } };
	}
	return { ok: true, value: { v: 1, held, lastRefusal } };
}

const writeHeldFile = (
	store: LinkStore,
	file: HeldFile,
): Result<void, StoreError> =>
	store.writePolicy(`${JSON.stringify(file, null, "\t")}\n`);

/** Every policy-bundle key pinned for the device, whatever its window. */
const pinnedPolicyKeys = (state: DeviceState): readonly OrgKey[] =>
	state.enrolment.orgKeys.filter((k) => k.purpose === "policy-bundle");

/**
 * The held bundle as a managed layer, checked again: it must still verify
 * under a key pinned for this device (the key's window is not checked: it
 * was valid when the bundle arrived).
 */
function heldLayer(
	held: Held,
	state: DeviceState,
	ports: Readonly<{ crypto: LinkCrypto; now: Date }>,
): Result<ManagedLayer, BundleRefusal> {
	const verified = verifyBundle(
		held.bundle,
		{ orgId: state.enrolment.orgId, keys: pinnedPolicyKeys(state) },
		null,
		ports,
	);
	return verified.ok ? { ok: true, value: verified.value.layer } : verified;
}

// ── The poller ──────────────────────────────────────────────────────────────

type PolicySyncError = LinkFailure | BundleRefusal | HeldFileError;

type PolicySync = Readonly<{
	/** One pull; resolves to the milliseconds until the next. */
	tick: () => Promise<number>;
	status: () => Readonly<{ lastError: PolicySyncError | null }>;
}>;

export function createPolicySync(
	ports: LinkPorts,
	options: Readonly<{ intervalMs?: number }> = {},
): PolicySync {
	const interval = options.intervalMs ?? POLICY_POLL_MS;
	const client = createLinkClient(ports);
	let lastError: PolicySyncError | null = null;

	async function pull(): Promise<PolicySyncError | null> {
		const read = ports.store.readState();
		if (!read.ok) return read.error;
		const state = read.value;
		// Not enrolled, or revoked: nothing to pull (a revoked device keeps
		// the last good bundle; `maina cloud logout` removes it).
		if (state === null || state.revokedAt !== null) return null;
		const file = readHeldFile(ports.store);
		// A held file that cannot be read is replaced by the next good bundle.
		const current = file.ok ? file.value : EMPTY;
		const held = current.held;
		const now = ports.clock();
		// The held ETag goes out whenever the held bundle still verifies, so
		// an unchanged bundle is a 304 (adr/0012 §4 and §5).
		const reusable =
			held !== null && heldLayer(held, state, { crypto: ports.crypto, now }).ok;
		const sent = await client.send({
			method: "GET",
			path: state.enrolment.endpoints.policy,
			...(reusable && held !== null
				? { headers: { "If-None-Match": httpEtag(held.bundle) } }
				: {}),
		});
		if (!sent.ok) {
			const e = sent.error;
			// Nothing published for this org yet is not a failure.
			return e.kind === "refused" && e.code === "no_policy" ? null : e;
		}
		if (sent.value.status === NOT_MODIFIED) return file.ok ? null : file.error;
		const verified = verifyBundle(
			sent.value.data,
			{
				orgId: state.enrolment.orgId,
				keys: trustedOrgKeys(state, now, "policy-bundle"),
			},
			held === null
				? null
				: {
						version: held.bundle.version,
						etag: held.bundle.etag,
						signature: held.signature,
					},
			{ crypto: ports.crypto, now },
		);
		if (!verified.ok) {
			const data = sent.value.data;
			const version =
				isRecord(data) && typeof data.version === "number"
					? { version: data.version }
					: {};
			const written = writeHeldFile(ports.store, {
				...current,
				lastRefusal: {
					kind: verified.error.kind,
					at: now.toISOString(),
					...version,
				},
			});
			return written.ok ? verified.error : written.error;
		}
		const written = writeHeldFile(ports.store, {
			v: 1,
			held: {
				bundle: verified.value.bundle,
				signature: verified.value.signature,
				receivedAt: now.toISOString(),
			},
			lastRefusal: null,
		});
		return written.ok ? null : written.error;
	}

	return {
		tick: async () => {
			lastError = await pull();
			return interval;
		},
		status: () => ({ lastError }),
	};
}

// ── Reading the managed layer ───────────────────────────────────────────────

type ReadPorts = Readonly<{
	store: LinkStore;
	crypto: LinkCrypto;
	clock: () => Date;
}>;

function policyError(message: string): readonly PolicyError[] {
	return [
		{ kind: "invalid", source: "managed", file: undefined, path: "", message },
	];
}

function describeStoreError(e: HeldFileError): string {
	switch (e.kind) {
		case "corrupt_policy":
			return "the held policy bundle file is not readable";
		case "store":
			return `${e.op}: ${e.message}`;
		case "insecure_key":
			return `${e.path} is readable by others`;
		case "corrupt_state":
			return `${e.path}: ${e.message}`;
		default: {
			const unknown: never = e;
			return String(unknown);
		}
	}
}

/**
 * The held bundle as the managed layer, for `loadPolicy`: `undefined` when
 * the device is not enrolled or holds none, so the policy is the v1 one. Its
 * budget directives are those still in force at the clock's now.
 */
export function readManagedLayer(
	ports: ReadPorts,
): Result<ManagedLayer | undefined, readonly PolicyError[]> {
	const state = ports.store.readState();
	if (!state.ok)
		return { ok: false, error: policyError(describeStoreError(state.error)) };
	if (state.value === null) return { ok: true, value: undefined };
	const file = readHeldFile(ports.store);
	if (!file.ok)
		return { ok: false, error: policyError(describeStoreError(file.error)) };
	const held = file.value.held;
	if (held === null) return { ok: true, value: undefined };
	const now = ports.clock();
	const layer = heldLayer(held, state.value, { crypto: ports.crypto, now });
	if (!layer.ok) {
		return {
			ok: false,
			error: policyError(
				`the held policy bundle v${held.bundle.version} does not verify (${layer.error.kind})`,
			),
		};
	}
	return {
		ok: true,
		value: {
			...layer.value,
			budgetDirectives: activeBudgetDirectives(
				layer.value.budgetDirectives,
				layer.value.issuedAt,
				now,
			),
		},
	};
}

/**
 * `readManagedLayer` for the gate, which asks per event: the held file is
 * read each time (a new bundle applies at the next event) but verified only
 * when its text changes.
 */
export function managedLayerReader(
	ports: ReadPorts,
): () => Result<ManagedLayer | undefined, readonly PolicyError[]> {
	let cached:
		| Readonly<{
				text: string | null;
				result: Result<ManagedLayer | undefined, readonly PolicyError[]>;
		  }>
		| undefined;
	return () => {
		const text = ports.store.readPolicy();
		if (!text.ok) {
			return { ok: false, error: policyError(describeStoreError(text.error)) };
		}
		if (cached === undefined || cached.text !== text.value) {
			cached = { text: text.value, result: readManagedLayer(ports) };
		}
		const { result } = cached;
		if (!result.ok || result.value === undefined) return result;
		const layer = result.value;
		return {
			ok: true,
			value: {
				...layer,
				budgetDirectives: activeBudgetDirectives(
					layer.budgetDirectives,
					layer.issuedAt,
					ports.clock(),
				),
			},
		};
	};
}

/** What `maina doctor` and `maina cloud status` show of the managed policy. */
export type ManagedPolicyStatus =
	| Readonly<{ kind: "not_enrolled" }>
	| Readonly<{ kind: "none"; lastRefusal: Refusal | null }>
	| Readonly<{
			kind: "held";
			version: number;
			signature: ManagedSignature;
			keyId: string;
			etag: string;
			issuedAt: string;
			receivedAt: string;
			budgetDirectives: ManagedLayer["budgetDirectives"];
			lastRefusal: Refusal | null;
	  }>
	| Readonly<{ kind: "unreadable"; message: string }>;

export function managedPolicyStatus(ports: ReadPorts): ManagedPolicyStatus {
	const state = ports.store.readState();
	if (!state.ok) {
		return { kind: "unreadable", message: describeStoreError(state.error) };
	}
	if (state.value === null) return { kind: "not_enrolled" };
	const file = readHeldFile(ports.store);
	if (!file.ok) {
		return { kind: "unreadable", message: describeStoreError(file.error) };
	}
	const { held, lastRefusal } = file.value;
	if (held === null) return { kind: "none", lastRefusal };
	const layer = readManagedLayer(ports);
	if (!layer.ok || layer.value === undefined) {
		return {
			kind: "unreadable",
			message: layer.ok
				? "no managed layer"
				: layer.error.map((e) => e.message).join("; "),
		};
	}
	return {
		kind: "held",
		version: held.bundle.version,
		signature: held.signature,
		keyId: held.bundle.keyId,
		etag: held.bundle.etag,
		issuedAt: held.bundle.issuedAt,
		receivedAt: held.receivedAt,
		budgetDirectives: layer.value.budgetDirectives,
		lastRefusal,
	};
}
