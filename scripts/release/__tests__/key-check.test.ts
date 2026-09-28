/**
 * Release signing key check (mainahq/maina#424, ADR 0045).
 *
 * Before the first real release, and whenever the key is rotated, the
 * maintainer proves that the `MAINA_RUNTIME_SIGNING_KEY` secret is the key
 * the committed launcher pins: its public half is `release.pub.pem`, the
 * PowerShell form `release.pub.xml` is the same key, and an artifact signed
 * with it verifies against the pinned key. Nothing is published.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createPublicKey } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	artifactName,
	type Manifest,
	publicKeyXml,
	renderManifest,
	sha256Hex,
	signArtifact,
} from "../../../packages/runtime/build/standalone";
import {
	checkSigningKey,
	describeKeyCheckError,
	type KeyCheckError,
	type KeyCheckInput,
} from "../key-check";
import { testKeys } from "./support";

const keys = testKeys();
const other = testKeys();
const VERSION = "2.0.0";
const BYTES = new TextEncoder().encode("a standalone runtime");

const fingerprintOf = (publicPem: string): string =>
	createHash("sha256")
		.update(createPublicKey(publicPem).export({ type: "spki", format: "der" }))
		.digest("hex");

function manifestFor(signature: string, bytes = BYTES): Manifest {
	return {
		schema: 1,
		version: VERSION,
		artifacts: {
			"linux-x64": {
				url: `https://example.test/runtime-v${VERSION}/x`,
				sha256: sha256Hex(bytes),
				signature,
			},
		},
	};
}

function input(overrides: Partial<KeyCheckInput> = {}): KeyCheckInput {
	return {
		privateKeyPem: keys.privatePem,
		pinnedPem: keys.publicPem,
		pinnedXml: publicKeyXml(keys.publicPem),
		manifest: manifestFor(signArtifact(BYTES, keys.privatePem)),
		read: (target) => (target === "linux-x64" ? BYTES : undefined),
		...overrides,
	};
}

const errorOf = (i: KeyCheckInput): KeyCheckError | undefined => {
	const r = checkSigningKey(i);
	return r.ok ? undefined : r.error;
};

describe("checkSigningKey", () => {
	test("passes when the key is the pinned one and its signature verifies", () => {
		expect(checkSigningKey(input())).toEqual({
			ok: true,
			value: {
				fingerprint: fingerprintOf(keys.publicPem),
				verified: ["linux-x64"],
			},
		});
	});

	test("ignores whitespace differences in the pinned PEM", () => {
		const pinnedPem = `${keys.publicPem.replace(/\n/g, "\r\n")}\n`;
		expect(checkSigningKey(input({ pinnedPem })).ok).toBe(true);
	});

	test("refuses a secret that is not a private key", () => {
		expect(errorOf(input({ privateKeyPem: "not a key" }))).toEqual({
			kind: "invalid_key",
		});
		expect(errorOf(input({ privateKeyPem: "" }))).toEqual({
			kind: "invalid_key",
		});
	});

	test("refuses a key the launcher does not pin", () => {
		expect(errorOf(input({ privateKeyPem: other.privatePem }))).toEqual({
			kind: "not_pinned",
			fingerprint: fingerprintOf(other.publicPem),
			pinned: fingerprintOf(keys.publicPem),
		});
	});

	test("refuses a pinned PEM that is not a public key", () => {
		expect(errorOf(input({ pinnedPem: "garbage" }))).toEqual({
			kind: "invalid_pin",
		});
	});

	test("refuses a PowerShell key that is not the PEM key", () => {
		expect(
			errorOf(input({ pinnedXml: publicKeyXml(other.publicPem) })),
		).toEqual({ kind: "xml_mismatch" });
	});

	test("refuses a manifest with no artifact to prove the signature on", () => {
		expect(
			errorOf(
				input({ manifest: { schema: 1, version: VERSION, artifacts: {} } }),
			),
		).toEqual({ kind: "no_artifacts" });
	});

	test("refuses a manifest artifact whose file is missing", () => {
		expect(errorOf(input({ read: () => undefined }))).toEqual({
			kind: "missing_artifact",
			target: "linux-x64",
		});
	});

	test("refuses an artifact whose bytes are not the manifest's", () => {
		const altered = new TextEncoder().encode("something else");
		expect(errorOf(input({ read: () => altered }))).toEqual({
			kind: "sha256_mismatch",
			target: "linux-x64",
		});
	});

	test("refuses an empty signature or one by another key", () => {
		for (const signature of ["", signArtifact(BYTES, other.privatePem)]) {
			expect(errorOf(input({ manifest: manifestFor(signature) }))).toEqual({
				kind: "bad_signature",
				target: "linux-x64",
			});
		}
	});

	test("no error message carries key material", () => {
		const errors: readonly KeyCheckError[] = [
			{ kind: "invalid_key" },
			{ kind: "invalid_pin" },
			{ kind: "not_pinned", fingerprint: "ab", pinned: "cd" },
			{ kind: "xml_mismatch" },
			{ kind: "no_artifacts" },
			{ kind: "missing_artifact", target: "linux-x64" },
			{ kind: "sha256_mismatch", target: "linux-x64" },
			{ kind: "bad_signature", target: "linux-x64" },
		];
		for (const e of errors) {
			const message = describeKeyCheckError(e);
			expect(message.length).toBeGreaterThan(0);
			expect(message).not.toMatch(/BEGIN|PRIVATE/);
		}
	});
});

describe("key-check script", () => {
	const SCRIPT = resolve(import.meta.dir, "..", "key-check.ts");
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maina-key-check-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** A launcher dir pinning `keys`, and a one-artifact build signed by `signer`. */
	function layout(signer: string): Readonly<{ launcher: string; out: string }> {
		const launcher = join(dir, "launcher");
		const out = join(dir, "out");
		mkdirSync(launcher);
		mkdirSync(out);
		writeFileSync(join(launcher, "release.pub.pem"), keys.publicPem);
		writeFileSync(
			join(launcher, "release.pub.xml"),
			publicKeyXml(keys.publicPem),
		);
		writeFileSync(join(out, artifactName(VERSION, "linux-x64")), BYTES);
		writeFileSync(
			join(out, "manifest.json"),
			renderManifest(manifestFor(signArtifact(BYTES, signer))),
		);
		writeFileSync(join(dir, "signing.pem"), signer);
		return { launcher, out };
	}

	const run = (launcher: string, out: string) => {
		const proc = Bun.spawnSync(
			[
				process.execPath,
				SCRIPT,
				"--signing-key",
				join(dir, "signing.pem"),
				"--launcher",
				launcher,
				"--dir",
				out,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		return {
			code: proc.exitCode,
			output: `${proc.stdout.toString()}${proc.stderr.toString()}`,
		};
	};

	test("exits 0 and names the pinned key's fingerprint when the key matches", () => {
		const { launcher, out } = layout(keys.privatePem);
		const { code, output } = run(launcher, out);
		expect(code).toBe(0);
		expect(output).toContain(fingerprintOf(keys.publicPem));
		expect(output).toContain("linux-x64");
		expect(output).not.toMatch(/PRIVATE/);
	});

	test("exits 1 when the key is not the pinned one", () => {
		const { launcher, out } = layout(other.privatePem);
		const { code, output } = run(launcher, out);
		expect(code).toBe(1);
		expect(output).toContain("not the key the launcher pins");
		expect(output).not.toMatch(/PRIVATE/);
	});

	test("exits 2 on missing arguments", () => {
		const proc = Bun.spawnSync([process.execPath, SCRIPT], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(proc.exitCode).toBe(2);
	});
});
