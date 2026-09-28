/**
 * The model release key pinned in the runtime (#574, #424).
 *
 * The runtime verifies model releases against the public half of the
 * release key, the same key the launchers pin (`launcher/release.pub.pem`).
 * It is bundled into the runtime at build time, so no environment variable
 * or file on the machine can replace it. The signature check is built from a
 * key, so tests hand the verifier one over a dev key.
 */

import { describe, expect, test } from "bun:test";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_PUBLIC_KEY, releaseSignatureCheck } from "../release-key";
import { verifyModelRelease } from "../verify";
import {
	buildRelease,
	devKey,
	pinOn,
	signWith,
	utf8,
} from "./fixtures/model-release";

const RUNTIME = join(import.meta.dir, "..", "..", "..");
const LAUNCHER_PEM = readFileSync(
	join(RUNTIME, "launcher", "release.pub.pem"),
	"utf-8",
);
const KEY = devKey();

const fingerprint = (pem: string): string =>
	createHash("sha256").update(pem).digest("hex");

function verifyWith(pem: string) {
	const built = buildRelease(KEY.privatePem);
	return verifyModelRelease({
		pin: pinOn(built.manifestBytes),
		read: (file) => built.files.get(file),
		verifySignature: releaseSignatureCheck(pem),
		target: "linux-x64",
	});
}

describe("the pinned release key", () => {
	test("is the key the launchers pin", () => {
		expect(RELEASE_PUBLIC_KEY).toBe(LAUNCHER_PEM);
	});

	test("is a 4096-bit RSA public key", () => {
		const key = createPublicKey(RELEASE_PUBLIC_KEY);
		expect(key.asymmetricKeyType).toBe("rsa");
		expect(key.asymmetricKeyDetails?.modulusLength).toBe(4096);
	});

	test("refuses a release signed with any other key", () => {
		const result = verifyWith(RELEASE_PUBLIC_KEY);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.problems.map((p) => p.kind)).toContain(
			"manifest_signature",
		);
	});

	test("no environment variable replaces it", async () => {
		const env = {
			...process.env,
			MAINA_RELEASE_PUBLIC_KEY: KEY.publicPem,
			MAINA_MODEL_PUBLIC_KEY: KEY.publicPem,
			MAINA_MODEL_SIGNING_KEY: KEY.privatePem,
			MAINA_RUNTIME_SIGNING_KEY: KEY.privatePem,
		};
		const proc = Bun.spawn(
			[
				process.execPath,
				"-e",
				`import { RELEASE_PUBLIC_KEY } from ${JSON.stringify(join(import.meta.dir, "..", "release-key.ts"))};
				 process.stdout.write(RELEASE_PUBLIC_KEY);`,
			],
			{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		expect(code).toBe(0);
		expect(fingerprint(stdout)).toBe(fingerprint(LAUNCHER_PEM));
	});

	test("its module reads nothing at run time", () => {
		const source = readFileSync(
			join(import.meta.dir, "..", "release-key.ts"),
			"utf-8",
		);
		expect(source).not.toMatch(
			/process\.env|Bun\.env|readFile|import\.meta\.env/,
		);
	});
});

describe("releaseSignatureCheck: the key is a port", () => {
	test("a check over a dev key accepts the release that key signed", () => {
		expect(verifyWith(KEY.publicPem).ok).toBe(true);
	});

	test("checks one signature against the key it was built with", () => {
		const bytes = utf8("maina-system1");
		const signature = signWith(KEY.privatePem, bytes);
		expect(releaseSignatureCheck(KEY.publicPem)(bytes, signature)).toBe(true);
		expect(releaseSignatureCheck(RELEASE_PUBLIC_KEY)(bytes, signature)).toBe(
			false,
		);
		expect(releaseSignatureCheck(KEY.publicPem)(utf8("other"), signature)).toBe(
			false,
		);
	});
});
