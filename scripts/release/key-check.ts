#!/usr/bin/env bun
/**
 * Release signing key check (mainahq/maina#424, ADR 0045). Proves that a
 * private key (the `MAINA_RUNTIME_SIGNING_KEY` secret) is the key the
 * committed launcher pins, without publishing anything:
 *
 *   - its public half is `release.pub.pem` (the release preflight's check),
 *   - `release.pub.xml`, the key `launch.ps1` verifies with, is the same key,
 *   - every artifact of a runtime build signed with it (`standalone.ts
 *     --signing-key`) matches its manifest sha256 and verifies against the
 *     pinned key, as the launcher checks a download.
 *
 *   bun scripts/release/key-check.ts --signing-key key.pem \
 *     --launcher packages/runtime/launcher --dir dist/key-check
 *
 * Prints the pinned key's SHA-256 fingerprint (of its SPKI DER) so the
 * maintainer can compare it with the local public key; it never prints key
 * material. Exits 0 when the key checks out, 1 when it does not, 2 on usage.
 */

import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	artifactName,
	type Manifest,
	publicKeyXml,
	sha256Hex,
	TARGETS,
	type Target,
} from "../../packages/runtime/build/standalone";
import { publicKeyOf, verifySignature } from "./sign";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

export type KeyCheckInput = Readonly<{
	privateKeyPem: string;
	/** The committed `release.pub.pem`. */
	pinnedPem: string;
	/** The committed `release.pub.xml`. */
	pinnedXml: string;
	/** The manifest of a runtime build signed with `privateKeyPem`. */
	manifest: Manifest;
	/** The bytes of the build's artifact for `target`, if it exists. */
	read: (target: Target) => Uint8Array | undefined;
}>;

export type KeyCheckError = Readonly<
	| { kind: "invalid_key" }
	| { kind: "invalid_pin" }
	| { kind: "not_pinned"; fingerprint: string; pinned: string }
	| { kind: "xml_mismatch" }
	| { kind: "no_artifacts" }
	| { kind: "missing_artifact"; target: Target }
	| { kind: "sha256_mismatch"; target: Target }
	| { kind: "bad_signature"; target: Target }
>;

export type KeyCheckOk = Readonly<{
	/** SHA-256 of the pinned key's SPKI DER, lowercase hex. */
	fingerprint: string;
	/** The targets whose artifact verified against the pinned key. */
	verified: readonly Target[];
}>;

export function describeKeyCheckError(error: KeyCheckError): string {
	switch (error.kind) {
		case "invalid_key":
			return "the signing key is not an RSA private key in PEM form";
		case "invalid_pin":
			return "release.pub.pem is not a public key in PEM form";
		case "not_pinned":
			return `the signing key (${error.fingerprint}) is not the key the launcher pins (${error.pinned}): launchers would refuse this release`;
		case "xml_mismatch":
			return "release.pub.xml is not the key in release.pub.pem: launch.ps1 would refuse this release";
		case "no_artifacts":
			return "the build's manifest lists no artifact to prove a signature on";
		case "missing_artifact":
			return `the ${error.target} artifact in the manifest is missing`;
		case "sha256_mismatch":
			return `the ${error.target} artifact is not the one the manifest hashes`;
		case "bad_signature":
			return `the ${error.target} signature does not verify against the pinned key`;
		default: {
			const never: never = error;
			return String(never);
		}
	}
}

/** SHA-256 of a public key's SPKI DER, or undefined when it is not one. */
function fingerprintOf(publicPem: string): string | undefined {
	try {
		return createHash("sha256")
			.update(
				createPublicKey(publicPem).export({ type: "spki", format: "der" }),
			)
			.digest("hex");
	} catch {
		return undefined;
	}
}

function publicHalf(privateKeyPem: string): string | undefined {
	try {
		return publicKeyOf(privateKeyPem);
	} catch {
		return undefined;
	}
}

/** Whether `privateKeyPem` is the pinned key and its signatures verify. Pure. */
export function checkSigningKey(
	input: KeyCheckInput,
): Result<KeyCheckOk, KeyCheckError> {
	const publicPem = publicHalf(input.privateKeyPem);
	if (publicPem === undefined)
		return { ok: false, error: { kind: "invalid_key" } };
	const pinned = fingerprintOf(input.pinnedPem);
	if (pinned === undefined)
		return { ok: false, error: { kind: "invalid_pin" } };
	const fingerprint = fingerprintOf(publicPem) ?? "";
	if (fingerprint !== pinned) {
		return { ok: false, error: { kind: "not_pinned", fingerprint, pinned } };
	}
	if (publicKeyXml(input.pinnedPem) !== input.pinnedXml) {
		return { ok: false, error: { kind: "xml_mismatch" } };
	}
	const targets = TARGETS.filter((t) => input.manifest.artifacts[t]);
	if (targets.length === 0)
		return { ok: false, error: { kind: "no_artifacts" } };
	for (const target of targets) {
		const entry = input.manifest.artifacts[target];
		const bytes = input.read(target);
		if (entry === undefined || bytes === undefined) {
			return { ok: false, error: { kind: "missing_artifact", target } };
		}
		if (sha256Hex(bytes) !== entry.sha256) {
			return { ok: false, error: { kind: "sha256_mismatch", target } };
		}
		if (!verifySignature(bytes, entry.signature, input.pinnedPem)) {
			return { ok: false, error: { kind: "bad_signature", target } };
		}
	}
	return { ok: true, value: { fingerprint: pinned, verified: targets } };
}

// ── I/O edge: the script ─────────────────────────────────────────────────────

function readBytes(path: string): Uint8Array | undefined {
	try {
		return new Uint8Array(readFileSync(path));
	} catch {
		return undefined;
	}
}

function main(argv: readonly string[]): number {
	let values: Record<string, string | boolean | undefined>;
	try {
		values = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				"signing-key": { type: "string" },
				launcher: { type: "string" },
				dir: { type: "string" },
			},
		}).values;
	} catch (err) {
		process.stderr.write(`key-check: ${String(err)}\n`);
		return 2;
	}
	const keyPath = values["signing-key"];
	const launcher = values.launcher;
	const dir = values.dir;
	if (
		typeof keyPath !== "string" ||
		typeof launcher !== "string" ||
		typeof dir !== "string"
	) {
		process.stderr.write(
			"key-check: --signing-key, --launcher and --dir are required\n",
		);
		return 2;
	}
	let privateKeyPem: string;
	let pinnedPem: string;
	let pinnedXml: string;
	let manifest: Manifest;
	try {
		privateKeyPem = readFileSync(keyPath, "utf-8");
		pinnedPem = readFileSync(join(launcher, "release.pub.pem"), "utf-8");
		pinnedXml = readFileSync(join(launcher, "release.pub.xml"), "utf-8");
		manifest = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf-8"),
		) as Manifest;
	} catch (err) {
		// The message names the path, never the contents.
		process.stderr.write(
			`key-check: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return 1;
	}
	const out = resolve(dir);
	const checked = checkSigningKey({
		privateKeyPem,
		pinnedPem,
		pinnedXml,
		manifest,
		read: (target) =>
			readBytes(join(out, artifactName(manifest.version, target))),
	});
	if (!checked.ok) {
		process.stderr.write(
			`key-check: ${describeKeyCheckError(checked.error)}\n`,
		);
		return 1;
	}
	process.stdout.write(
		`key-check: the signing key is the key the launcher pins (sha256 ${checked.value.fingerprint}); release.pub.xml matches; ${checked.value.verified.join(", ")} signed and verified against it\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
