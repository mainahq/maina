/**
 * Encryption at rest for the Link outbox (#590).
 *
 * The key is HKDF-SHA256 over the device private key's PKCS#8 bytes,
 * salted with a fixed domain string and bound to the device id, so it
 * exists only where the device key does and is never stored itself. Each
 * record is sealed with AES-256-GCM under a fresh 96-bit IV, with the
 * caller's associated data (the outbox header), as unpadded base64url of
 * `iv || ciphertext || tag`. The tag length is pinned to 16 bytes on both
 * sides, so a truncated tag never verifies.
 */

import {
	createCipheriv,
	createDecipheriv,
	createPrivateKey,
	hkdfSync,
	randomBytes,
} from "node:crypto";
import type { Result } from "@mainahq/core";
import type { CryptoFailure } from "./keys";

/** The HKDF salt: domain-separates the outbox key from every other use. */
const KDF_SALT = "maina-link/outbox/v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function cryptoFailure(e: unknown): CryptoFailure {
	return {
		kind: "crypto",
		message: e instanceof Error ? e.message : String(e),
	};
}

/** The outbox key for `deviceId`, from the device's PKCS#8 PEM. */
export function outboxKey(
	privateKey: string,
	deviceId: string,
): Result<Buffer, CryptoFailure> {
	try {
		const der = createPrivateKey(privateKey).export({
			type: "pkcs8",
			format: "der",
		});
		const key = hkdfSync(
			"sha256",
			der,
			Buffer.from(KDF_SALT, "utf-8"),
			Buffer.from(deviceId, "utf-8"),
			32,
		);
		return { ok: true, value: Buffer.from(key) };
	} catch (e) {
		// A key parse error names the problem, never the key.
		return { ok: false, error: cryptoFailure(e) };
	}
}

/** `plaintext` sealed as one base64url line. */
export function seal(key: Buffer, aad: Buffer, plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv, {
		authTagLength: TAG_BYTES,
	});
	cipher.setAAD(aad);
	const body = Buffer.concat([
		cipher.update(plaintext, "utf-8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The plaintext of a sealed line, or null when it does not verify. */
export function unseal(key: Buffer, aad: Buffer, line: string): string | null {
	const raw = Buffer.from(line, "base64url");
	if (raw.length < IV_BYTES + TAG_BYTES) return null;
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			raw.subarray(0, IV_BYTES),
			{ authTagLength: TAG_BYTES },
		);
		decipher.setAAD(aad);
		decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
		return Buffer.concat([
			decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
			decipher.final(),
		]).toString("utf-8");
	} catch {
		return null;
	}
}
