/**
 * The org keys a device trusts (#589, spec §6.3, cloud adr/0010).
 *
 * They are pinned at enrolment (one per purpose: policy bundles, approval
 * resolutions, control messages) and change only through a `key_rotation`
 * control message that verifies under a link-control key the device already
 * trusts. Nothing else (no config file, no environment variable, no
 * unsigned answer) can add or retire one.
 *
 * A control message is accepted when it matches the published schema, names
 * this device and its org, is signed by a trusted link-control key valid
 * now, has not expired, and was not applied before. A rotation that would
 * leave no link-control key is refused: the device could never verify
 * another rotation.
 */

import type { Result } from "@mainahq/core";
import {
	type CryptoFailure,
	controlSigningInput,
	type LinkCrypto,
} from "./keys";
import {
	type ControlMessage,
	type OrgKey,
	type OrgKeyPurpose,
	parseWire,
	type WireRefusal,
} from "./protocol/wire";
import type { DeviceState, LinkStore, StoreError } from "./store";

export type ControlRefusal =
	| WireRefusal
	| Readonly<{ kind: "not_enrolled" }>
	| Readonly<{ kind: "revoked" }>
	| Readonly<{ kind: "wrong_device"; deviceId: string }>
	| Readonly<{ kind: "wrong_org"; orgId: string }>
	| Readonly<{ kind: "untrusted_key"; keyId: string }>
	| Readonly<{ kind: "bad_signature" }>
	| Readonly<{ kind: "expired"; expiresAt: string }>
	| Readonly<{ kind: "not_yet_valid"; issuedAt: string }>
	| Readonly<{ kind: "replayed"; messageId: string }>
	| Readonly<{ kind: "would_lock_out" }>
	| CryptoFailure
	| StoreError;

/** Clock skew tolerated on `issuedAt`. */
const MAX_SKEW_MS = 5 * 60_000;
/** Applied control message ids kept for replay refusal (they expire fast). */
const APPLIED_KEPT = 64;

function validAt(key: OrgKey, now: number): boolean {
	return (
		Date.parse(key.notBefore) <= now &&
		(key.notAfter === undefined || now < Date.parse(key.notAfter))
	);
}

/** The org keys pinned for this device and valid at `now`, by purpose. */
export function trustedOrgKeys(
	state: DeviceState,
	now: Date,
	purpose?: OrgKeyPurpose,
): readonly OrgKey[] {
	return state.enrolment.orgKeys.filter(
		(k) =>
			(purpose === undefined || k.purpose === purpose) &&
			validAt(k, now.getTime()),
	);
}

function verifyControl(
	state: DeviceState,
	crypto: LinkCrypto,
	raw: unknown,
	now: Date,
): Result<ControlMessage, ControlRefusal> {
	const parsed = parseWire("control-message", raw);
	if (!parsed.ok) return parsed;
	const message = parsed.value;
	if (message.deviceId !== state.enrolment.deviceId) {
		return {
			ok: false,
			error: { kind: "wrong_device", deviceId: message.deviceId },
		};
	}
	if (message.orgId !== state.enrolment.orgId) {
		return { ok: false, error: { kind: "wrong_org", orgId: message.orgId } };
	}
	const key = trustedOrgKeys(state, now, "link-control").find(
		(k) => k.keyId === message.keyId,
	);
	if (key === undefined) {
		return {
			ok: false,
			error: { kind: "untrusted_key", keyId: message.keyId },
		};
	}
	const input = controlSigningInput(message.orgId, message);
	if (!input.ok) return input;
	if (!crypto.verify(key.publicKey, input.value, message.sig)) {
		return { ok: false, error: { kind: "bad_signature" } };
	}
	if (now.getTime() >= Date.parse(message.expiresAt)) {
		return {
			ok: false,
			error: { kind: "expired", expiresAt: message.expiresAt },
		};
	}
	if (Date.parse(message.issuedAt) > now.getTime() + MAX_SKEW_MS) {
		return {
			ok: false,
			error: { kind: "not_yet_valid", issuedAt: message.issuedAt },
		};
	}
	if (state.appliedControls.includes(message.messageId)) {
		return {
			ok: false,
			error: { kind: "replayed", messageId: message.messageId },
		};
	}
	return { ok: true, value: message };
}

function rotated(
	state: DeviceState,
	add: readonly OrgKey[],
	retire: readonly string[],
	now: Date,
): Result<DeviceState, ControlRefusal> {
	const retired = new Set(retire);
	const added = new Set(add.map((k) => k.keyId));
	const orgKeys = [
		...state.enrolment.orgKeys.filter(
			(k) => !retired.has(k.keyId) && !added.has(k.keyId),
		),
		...add.filter((k) => !retired.has(k.keyId)),
	];
	// The rotated enrolment must still be the published shape (at most 16 keys).
	const enrolment = parseWire("enrol-complete-result", {
		...state.enrolment,
		orgKeys,
	});
	if (!enrolment.ok) return enrolment;
	const next: DeviceState = { ...state, enrolment: enrolment.value };
	if (trustedOrgKeys(next, now, "link-control").length === 0) {
		return { ok: false, error: { kind: "would_lock_out" } };
	}
	return { ok: true, value: next };
}

/**
 * Verifies a control message and records it. A `key_rotation` is applied to
 * the pinned keys; a `stop` or `revision_grant` is returned for the caller
 * to act on. Nothing changes unless every check passes.
 */
export function acceptControlMessage(
	ports: Readonly<{ store: LinkStore; crypto: LinkCrypto; clock: () => Date }>,
	raw: unknown,
): Result<ControlMessage, ControlRefusal> {
	const read = ports.store.readState();
	if (!read.ok) return read;
	const state = read.value;
	if (state === null) return { ok: false, error: { kind: "not_enrolled" } };
	if (state.revokedAt !== null)
		return { ok: false, error: { kind: "revoked" } };
	const now = ports.clock();
	const verified = verifyControl(state, ports.crypto, raw, now);
	if (!verified.ok) return verified;
	const message = verified.value;

	let next = state;
	if (message.kind === "key_rotation") {
		const applied = rotated(state, message.body.add, message.body.retire, now);
		if (!applied.ok) return applied;
		next = applied.value;
	}
	const written = ports.store.writeState({
		...next,
		appliedControls: [...state.appliedControls, message.messageId].slice(
			-APPLIED_KEPT,
		),
	});
	if (!written.ok) return written;
	return verified;
}
