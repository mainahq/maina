/**
 * Policy bundle verification (#592, spec §6.3 "Policy pull", cloud
 * adr/0012). A bundle is accepted only when it matches the published schema,
 * names this device's org, is signed by a pinned policy-bundle key
 * (`trust.ts`), is valid now, is not older than the held one (no downgrade)
 * and its policy body validates as a managed layer (core
 * `parseManagedLayer`). An unsigned bundle is refused, and so is the one the
 * cloud serves while its production signer is dark (`keyId: "unsigned"`, an
 * all-zero `sig`): no pinned key verifies it, so the device keeps its last
 * good bundle (adr/0012 §6, fail closed). Refusing it by name reports it as
 * `unsigned` rather than as an unknown key.
 */

import {
	type ManagedLayer,
	type ManagedSignature,
	type PolicyError,
	parseManagedLayer,
	type Result,
} from "@mainahq/core";
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

/** Clock skew tolerated on `notBefore`. */
const MAX_SKEW_MS = 5 * 60_000;

/** How the dark production signer marks a bundle (cloud adr/0012 §6). */
const DARK_KEY_ID = "unsigned";
const DARK_SIG = "A".repeat(86);

export type BundleRefusal =
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
type HeldSummary = Readonly<{ version: number; etag: string }>;

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
	if (isDark(bundle)) return { ok: false, error: { kind: "unsigned" } };
	const signed = checkSignature(bundle, trust, ports.crypto);
	if (!signed.ok) return signed;
	const signature: ManagedSignature = "signed";
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
