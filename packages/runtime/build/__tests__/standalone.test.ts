/**
 * Standalone runtime build helpers (v1 task 2.3; ADR 0045): target names,
 * the manifest the launcher parses, checksums and release signatures.
 */

import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
	artifactName,
	bunTarget,
	hostTarget,
	type Manifest,
	parseBuildArgs,
	publicKeyXml,
	releaseUrl,
	renderManifest,
	sha256Hex,
	signArtifact,
	TARGETS,
} from "../standalone";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const privatePem = privateKey.export({
	type: "pkcs8",
	format: "pem",
}) as string;
const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;

describe("targets", () => {
	test("cover macOS, Linux (glibc and musl) and Windows", () => {
		expect(TARGETS).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
			"linux-x64-musl",
			"linux-arm64-musl",
			"windows-x64",
		]);
	});

	test("artifact names carry the version, and .exe on Windows", () => {
		expect(artifactName("2.0.0", "darwin-arm64")).toBe(
			"maina-2.0.0-darwin-arm64",
		);
		expect(artifactName("2.0.0", "windows-x64")).toBe(
			"maina-2.0.0-windows-x64.exe",
		);
	});

	test("map to bun --compile targets", () => {
		expect(bunTarget("linux-arm64-musl")).toBe("bun-linux-arm64-musl");
		expect(bunTarget("windows-x64")).toBe("bun-windows-x64");
	});

	test("hostTarget maps node platform/arch the way the launcher does", () => {
		expect(hostTarget("darwin", "arm64", false)).toBe("darwin-arm64");
		expect(hostTarget("darwin", "x64", false)).toBe("darwin-x64");
		expect(hostTarget("linux", "x64", false)).toBe("linux-x64");
		expect(hostTarget("linux", "arm64", true)).toBe("linux-arm64-musl");
		expect(hostTarget("win32", "x64", false)).toBe("windows-x64");
		expect(hostTarget("win32", "arm64", false)).toBeNull();
		expect(hostTarget("freebsd", "x64", false)).toBeNull();
	});

	test("release URLs point at the version's GitHub release", () => {
		expect(
			releaseUrl(
				"https://github.com/mainahq/maina/releases/download",
				"2.0.0",
				"linux-x64",
			),
		).toBe(
			"https://github.com/mainahq/maina/releases/download/runtime-v2.0.0/maina-2.0.0-linux-x64",
		);
	});
});

describe("manifest", () => {
	const manifest: Manifest = {
		schema: 1,
		version: "2.0.0",
		artifacts: {
			"linux-x64": {
				url: "https://example.test/maina-2.0.0-linux-x64",
				sha256: "a".repeat(64),
				signature: "c2ln",
			},
			"darwin-arm64": {
				url: "https://example.test/maina-2.0.0-darwin-arm64",
				sha256: "b".repeat(64),
				signature: "c2ln",
			},
		},
	};

	test("renders one field per line in target order, as the launcher parses it", () => {
		expect(renderManifest(manifest)).toBe(
			[
				"{",
				'  "schema": 1,',
				'  "version": "2.0.0",',
				'  "artifacts": {',
				'    "darwin-arm64": {',
				'      "url": "https://example.test/maina-2.0.0-darwin-arm64",',
				`      "sha256": "${"b".repeat(64)}",`,
				'      "signature": "c2ln"',
				"    },",
				'    "linux-x64": {',
				'      "url": "https://example.test/maina-2.0.0-linux-x64",',
				`      "sha256": "${"a".repeat(64)}",`,
				'      "signature": "c2ln"',
				"    }",
				"  }",
				"}",
				"",
			].join("\n"),
		);
	});

	test("renders an empty artifact map", () => {
		expect(renderManifest({ schema: 1, version: "2.0.0", artifacts: {} })).toBe(
			'{\n  "schema": 1,\n  "version": "2.0.0",\n  "artifacts": {}\n}\n',
		);
	});

	test("round-trips through JSON", () => {
		expect(JSON.parse(renderManifest(manifest))).toEqual(manifest);
	});
});

describe("checksums and signatures", () => {
	const bytes = new TextEncoder().encode("maina runtime bytes");

	test("sha256Hex is the lowercase hex digest", () => {
		expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	test("signArtifact is an RSA-SHA256 signature the public key verifies", () => {
		const signature = signArtifact(bytes, privatePem);
		expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
		expect(
			verify("sha256", bytes, publicPem, Buffer.from(signature, "base64")),
		).toBe(true);
		const other = new TextEncoder().encode("tampered");
		expect(
			verify("sha256", other, publicPem, Buffer.from(signature, "base64")),
		).toBe(false);
	});

	test("publicKeyXml carries the same modulus and exponent as the PEM", () => {
		const jwk = createPublicKey(publicPem).export({ format: "jwk" });
		const xml = publicKeyXml(publicPem);
		const b64 = (v: string | undefined) =>
			Buffer.from(v ?? "", "base64url").toString("base64");
		expect(xml).toBe(
			`<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>\n`,
		);
	});
});

describe("parseBuildArgs", () => {
	test("defaults to every target and the GitHub release URL", () => {
		const parsed = parseBuildArgs(["--out", "dist/runtime"]);
		expect(parsed).toEqual({
			ok: true,
			value: {
				out: "dist/runtime",
				targets: TARGETS,
				baseUrl: "https://github.com/mainahq/maina/releases/download",
				signingKey: undefined,
				manifest: undefined,
				prebuilt: false,
			},
		});
	});

	test("takes a target list, a signing key file and a manifest path", () => {
		const parsed = parseBuildArgs([
			"--out",
			"o",
			"--targets",
			"linux-x64,darwin-arm64",
			"--signing-key",
			"key.pem",
			"--manifest",
			"m.json",
			"--base-url",
			"http://127.0.0.1:1",
		]);
		expect(parsed.ok && parsed.value).toEqual({
			out: "o",
			targets: ["linux-x64", "darwin-arm64"],
			baseUrl: "http://127.0.0.1:1",
			signingKey: "key.pem",
			manifest: "m.json",
			prebuilt: false,
		});
	});

	test("--prebuilt signs artifacts already in --out instead of compiling", () => {
		const parsed = parseBuildArgs(["--out", "o", "--prebuilt"]);
		expect(parsed.ok && parsed.value.prebuilt).toBe(true);
	});

	test("rejects an unknown target and a missing --out", () => {
		expect(parseBuildArgs(["--out", "o", "--targets", "plan9-mips"])).toEqual({
			ok: false,
			error: "unknown target: plan9-mips",
		});
		expect(parseBuildArgs([]).ok).toBe(false);
	});
});
