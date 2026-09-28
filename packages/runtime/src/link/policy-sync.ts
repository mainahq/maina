/**
 * Policy pull (#592, spec §6.3 "Policy pull", cloud plan Task 6.3, cloud
 * adr/0012): the org's policy bundle becomes this machine's managed policy
 * layer.
 *
 * - `tick` polls `GET /link/v1/policy` every `POLICY_POLL_MS` (inside the
 *   5-minute propagation goal, G1), always sending the held bundle's HTTP
 *   ETag (`"<version>.<content hex>"`) in `If-None-Match`; a 304 keeps it.
 * - Each new bundle is checked by `verifyBundle` (`policy-bundle.ts`):
 *   schema, org, pinned policy-bundle key, validity, no downgrade and a
 *   valid policy body. A bundle from the dark cloud signer is refused
 *   (adr/0012 §6): no pinned key verifies it.
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
	type Result,
} from "@mainahq/core";
import { createLinkClient } from "./client";
import { type LinkFailure, NOT_MODIFIED } from "./http";
import type { LinkCrypto } from "./keys";
import { type BundleRefusal, verifyBundle } from "./policy-bundle";
import { type OrgKey, type PolicyBundle, parseWire } from "./protocol/wire";
import type { DeviceState, LinkStore, StoreError } from "./store";
import type { LinkPorts } from "./token";
import { trustedOrgKeys } from "./trust";

/** How often the device asks for a newer bundle. */
export const POLICY_POLL_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The HTTP ETag the cloud serves for `bundle` (adr/0012 §5). */
const httpEtag = (bundle: PolicyBundle): string =>
	`"${bundle.version}.${bundle.etag.replace(/^sha256:/, "")}"`;

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
		// an unchanged bundle is a 304 (adr/0012 §4 and §5). Only a held
		// bundle that verifies sets the downgrade baseline: one edited on disk
		// (a raised version, say) must not refuse every good bundle after it.
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
			reusable && held !== null
				? { version: held.bundle.version, etag: held.bundle.etag }
				: null,
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
		// From the verification, not the file's own label.
		signature: layer.value.signature,
		keyId: held.bundle.keyId,
		etag: held.bundle.etag,
		issuedAt: held.bundle.issuedAt,
		receivedAt: held.receivedAt,
		budgetDirectives: layer.value.budgetDirectives,
		lastRefusal,
	};
}
