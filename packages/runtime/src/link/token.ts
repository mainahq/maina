/**
 * Short-lived, key-bound Link tokens (#589, spec §6.3, cloud adr/0010).
 *
 * `linkToken` signs a fresh `TokenChallenge` (`{ deviceId, nonce, ts }`)
 * with the device key and exchanges it at the enrolment's `tokenExchange`
 * endpoint for an access token of at most 15 minutes. The token lives in
 * memory only: nothing here writes it anywhere, and a stolen token is
 * useless without the key (every signed Link message must verify under the
 * token's device key). A `device_revoked` answer marks the device revoked,
 * which stops Link until it enrols again.
 */

import type { HttpPort, Result } from "@mainahq/core";
import {
	checkBaseUrl,
	isSuccess,
	type LinkFailure,
	linkCall,
	refusal,
} from "./http";
import { deviceSigningInput, type LinkCrypto } from "./keys";
import { LINK_CODES, parseWire } from "./protocol/wire";
import { type LinkStore, markRevoked } from "./store";

/** What every Link operation after enrolment runs on. */
export type LinkPorts = Readonly<{
	http: HttpPort;
	store: LinkStore;
	crypto: LinkCrypto;
	clock: () => Date;
}>;

export type AccessToken = Readonly<{
	deviceId: string;
	token: string;
	/** Epoch milliseconds. */
	expiresAt: number;
}>;

/** 32 random bytes: 43 base64url characters, inside the schema's 22–86. */
const NONCE_BYTES = 32;

/**
 * Marks the device revoked and returns the refusal that says so. The
 * refusal is `revoked` even when the mark cannot be written (it then carries
 * the store error as `unrecorded`), so the caller stops Link either way.
 */
export function revokedFailure(
	store: LinkStore,
	now: Date,
): Result<never, LinkFailure> {
	const marked = markRevoked(store, now);
	if (!marked.ok) {
		return {
			ok: false,
			error: {
				kind: "revoked",
				revokedAt: now.toISOString(),
				unrecorded: marked.error,
			},
		};
	}
	return {
		ok: false,
		error: {
			kind: "revoked",
			revokedAt: marked.value?.revokedAt ?? now.toISOString(),
		},
	};
}

/** A fresh access token, bought with a challenge signed by the device key. */
export async function linkToken(
	ports: LinkPorts,
): Promise<Result<AccessToken, LinkFailure>> {
	const read = ports.store.readState();
	if (!read.ok) return read;
	const state = read.value;
	if (state === null) return { ok: false, error: { kind: "not_enrolled" } };
	if (state.revokedAt !== null) {
		return {
			ok: false,
			error: { kind: "revoked", revokedAt: state.revokedAt },
		};
	}
	const key = ports.store.readPrivateKey();
	if (!key.ok) return key;
	if (key.value === null) {
		return {
			ok: false,
			error: {
				kind: "store",
				op: "read",
				message:
					"the device key is missing; run `maina cloud logout` and enrol again",
			},
		};
	}
	const base = checkBaseUrl(state.baseUrl);
	if (!base.ok) return base;

	const now = ports.clock();
	const unsigned = {
		v: 1,
		deviceId: state.enrolment.deviceId,
		nonce: ports.crypto.randomToken(NONCE_BYTES),
		ts: now.toISOString(),
	} as const;
	const input = deviceSigningInput("token-challenge", unsigned, "sig");
	if (!input.ok) return input;
	const sig = ports.crypto.sign(key.value, input.value);
	if (!sig.ok) return sig;
	const challenge = parseWire("token-challenge", {
		...unsigned,
		sig: sig.value,
	});
	if (!challenge.ok) return challenge;

	const answer = await linkCall(
		ports.http,
		"POST",
		`${base.value}${state.enrolment.endpoints.tokenExchange}`,
		challenge.value,
	);
	if (!answer.ok) return answer;
	if (answer.value.envelope.error === LINK_CODES.device_revoked) {
		return revokedFailure(ports.store, now);
	}
	if (!isSuccess(answer.value))
		return { ok: false, error: refusal(answer.value) };
	const grant = parseWire("token-grant", answer.value.envelope.data);
	if (!grant.ok) return grant;
	if (grant.value.deviceId !== state.enrolment.deviceId) {
		return {
			ok: false,
			error: {
				kind: "invalid_response",
				message: "the token grant names another device",
			},
		};
	}
	return {
		ok: true,
		value: {
			deviceId: grant.value.deviceId,
			token: grant.value.accessToken,
			expiresAt: now.getTime() + grant.value.expiresIn * 1000,
		},
	};
}
