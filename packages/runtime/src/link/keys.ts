/**
 * The device key and the Link signatures (#589, spec §6.3, cloud adr/0010).
 *
 * A device holds one Ed25519 key pair, generated on the machine. The public
 * half is sent as unpadded base64url of its 32 raw bytes; the private half
 * is a PKCS#8 PEM that only `store.ts` writes (owner-only) and only `sign`
 * reads. It is never logged or sent.
 *
 * Signed messages sign a domain-separated input:
 *
 *   device  utf8("maina-link/sig/v1\n" + purpose + "\n") || JCS(message without its signature field)
 *   cloud   utf8("maina-cloud/sig/v1\nlink-control\n" + orgId + "\n") || JCS(message without sig)
 *
 * JCS is RFC 8785; the Link messages carry only strings and safe integers,
 * the subset core's receipt canonicalizer implements.
 */

import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	sign,
	verify,
} from "node:crypto";
import { canonicalizeReceipt, type Result } from "@mainahq/core";

export type DeviceKeyPair = Readonly<{
	/** Unpadded base64url of the 32-byte Ed25519 public key. */
	publicKey: string;
	/** PKCS#8 PEM. Secret: only the store and `sign` touch it. */
	privateKey: string;
}>;

export type CryptoFailure = Readonly<{ kind: "crypto"; message: string }>;

/** The key operations Link needs; `nodeLinkCrypto` in production. */
export type LinkCrypto = Readonly<{
	generateKeyPair: () => Result<DeviceKeyPair, CryptoFailure>;
	/** Unpadded base64url Ed25519 signature of `data`. */
	sign: (privateKey: string, data: Uint8Array) => Result<string, CryptoFailure>;
	verify: (publicKey: string, data: Uint8Array, signature: string) => boolean;
	/** `bytes` random bytes as unpadded base64url (a challenge nonce). */
	randomToken: (bytes: number) => string;
}>;

type DevicePurpose = "enrol-proof" | "token-challenge";

function failure(e: unknown): CryptoFailure {
	return {
		kind: "crypto",
		message: e instanceof Error ? e.message : String(e),
	};
}

/** `node:crypto` Ed25519: the same code under Node and Bun. */
export const nodeLinkCrypto: LinkCrypto = {
	generateKeyPair: () => {
		try {
			const pair = generateKeyPairSync("ed25519");
			const jwk = pair.publicKey.export({ format: "jwk" });
			if (typeof jwk.x !== "string") {
				return { ok: false, error: failure("no raw public key") };
			}
			return {
				ok: true,
				value: {
					publicKey: jwk.x,
					privateKey: String(
						pair.privateKey.export({ type: "pkcs8", format: "pem" }),
					),
				},
			};
		} catch (e) {
			return { ok: false, error: failure(e) };
		}
	},
	sign: (privateKey, data) => {
		try {
			const sig = sign(null, data, createPrivateKey(privateKey));
			return { ok: true, value: sig.toString("base64url") };
		} catch (e) {
			// The message of a key parse error never carries the key itself.
			return { ok: false, error: failure(e) };
		}
	},
	verify: (publicKey, data, signature) => {
		try {
			const key = createPublicKey({
				key: { kty: "OKP", crv: "Ed25519", x: publicKey },
				format: "jwk",
			});
			return verify(null, data, key, Buffer.from(signature, "base64url"));
		} catch {
			return false;
		}
	},
	randomToken: (bytes) => randomBytes(bytes).toString("base64url"),
};

function concat(prefix: string, body: string): Uint8Array {
	const encoder = new TextEncoder();
	const a = encoder.encode(prefix);
	const b = encoder.encode(body);
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

function withoutField(
	message: Readonly<Record<string, unknown>>,
	field: string,
): Record<string, unknown> {
	const { [field]: _signature, ...rest } = message;
	return rest;
}

function jcs(value: unknown): Result<string, CryptoFailure> {
	const c = canonicalizeReceipt(value);
	return c.ok
		? { ok: true, value: c.data }
		: { ok: false, error: failure(c.message) };
}

/** The bytes a device signs for `purpose`, `field` being the signature. */
export function deviceSigningInput(
	purpose: DevicePurpose,
	message: Readonly<Record<string, unknown>>,
	field: string,
): Result<Uint8Array, CryptoFailure> {
	const body = jcs(withoutField(message, field));
	if (!body.ok) return body;
	return {
		ok: true,
		value: concat(`maina-link/sig/v1\n${purpose}\n`, body.value),
	};
}

/** The bytes the org's link-control key signs for a control message. */
export function controlSigningInput(
	orgId: string,
	message: Readonly<Record<string, unknown>>,
): Result<Uint8Array, CryptoFailure> {
	const body = jcs(withoutField(message, "sig"));
	if (!body.ok) return body;
	return {
		ok: true,
		value: concat(`maina-cloud/sig/v1\nlink-control\n${orgId}\n`, body.value),
	};
}
