#!/usr/bin/env bun
/**
 * Release signatures (v1 task 9.7, spec §8): RSA-SHA256 (PKCS#1 v1.5) with
 * the release key, the scheme the launchers already verify (ADR 0045). One
 * key signs every artifact of a lockstep release: the CLI tarballs, the
 * runtime executables, the plugin archives and the marketplace listings.
 *
 *   bun scripts/release/sign.ts --dir dist/release --public-key pub.pem
 *
 * `build-all.ts` signs as it builds (the runtime manifest the plugins bundle
 * needs the runtime signatures first); run as a script, this verifies a
 * built release: `release.json`, its signature, the runtime manifest's, and
 * the lockstep check, exiting 1 on any missing, mis-versioned, altered or
 * unsigned artifact. The real key is the
 * `MAINA_RUNTIME_SIGNING_KEY` secret (mainahq/maina#424); a dry run signs
 * with a throwaway key.
 */

import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	sha256Hex,
	signArtifact,
} from "../../packages/runtime/build/standalone";
import {
	checkRelease,
	describeProblems,
	parseRelease,
	type Release,
	type ReleaseArtifact,
	renderRelease,
} from "./lockstep";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

/** Base64 RSA-SHA256 signature of `bytes`. */
export const signBytes = (bytes: Uint8Array, privateKeyPem: string): string =>
	signArtifact(bytes, privateKeyPem);

/** Whether `signature` is `bytes` signed by the key `publicKeyPem` pairs. */
export function verifySignature(
	bytes: Uint8Array,
	signature: string,
	publicKeyPem: string,
): boolean {
	if (signature === "") return false;
	try {
		return verify(
			"sha256",
			bytes,
			createPublicKey(publicKeyPem),
			Buffer.from(signature, "base64"),
		);
	} catch {
		return false;
	}
}

/** The public half of `privateKeyPem`, as SPKI PEM. */
export const publicKeyOf = (privateKeyPem: string): string =>
	createPublicKey(createPrivateKey(privateKeyPem)).export({
		type: "spki",
		format: "pem",
	}) as string;

type Unsigned = Omit<ReleaseArtifact, "sha256" | "signature">;

/** Each artifact with the sha256 and signature of its file. */
export function signArtifacts(
	artifacts: readonly Unsigned[],
	read: (file: string) => Uint8Array | undefined,
	privateKeyPem: string,
): Result<
	readonly ReleaseArtifact[],
	Readonly<{ kind: "missing_file"; file: string }>
> {
	const signed: ReleaseArtifact[] = [];
	for (const a of artifacts) {
		const bytes = read(a.file);
		if (bytes === undefined) {
			return { ok: false, error: { kind: "missing_file", file: a.file } };
		}
		signed.push({
			...a,
			sha256: sha256Hex(bytes),
			signature: signBytes(bytes, privateKeyPem),
		});
	}
	return { ok: true, value: signed };
}

/** Reads release files from `dir`; undefined when one is missing. */
export const readFrom =
	(dir: string) =>
	(file: string): Uint8Array | undefined => {
		try {
			return new Uint8Array(readFileSync(join(dir, file)));
		} catch {
			return undefined;
		}
	};

/** Where the signed runtime manifest sits in a release directory. */
export const RUNTIME_MANIFEST = "runtime/manifest.json";

/** Writes `content` to `dir/file` and its signature to `dir/file.sig`. */
export function writeSigned(
	dir: string,
	file: string,
	content: string,
	privateKeyPem: string,
): void {
	writeFileSync(join(dir, file), content);
	writeFileSync(
		join(dir, `${file}.sig`),
		`${signBytes(new TextEncoder().encode(content), privateKeyPem)}\n`,
	);
}

/** Writes every `<file>.sig`, then `release.json` and its signature. */
export function writeRelease(
	dir: string,
	release: Release,
	privateKeyPem: string,
): void {
	for (const a of release.artifacts) {
		writeFileSync(join(dir, `${a.file}.sig`), `${a.signature}\n`);
	}
	writeSigned(dir, "release.json", renderRelease(release), privateKeyPem);
}

/** Why the detached signature `<file>.sig` does not check out, or nothing. */
function detachedProblem(
	read: (file: string) => Uint8Array | undefined,
	file: string,
	publicKeyPem: string,
): readonly string[] {
	const bytes = read(file);
	const sig = read(`${file}.sig`);
	return bytes !== undefined &&
		sig !== undefined &&
		verifySignature(bytes, new TextDecoder().decode(sig).trim(), publicKeyPem)
		? []
		: [`${file}: bad or missing signature`];
}

/**
 * Why the runtime manifest (what the launchers install from) does not pin
 * this release: another version, or a target whose sha256 is not that of
 * the released runtime artifact. Its signature alone cannot show this: a
 * stale manifest signed by the same key verifies too.
 */
function manifestProblems(
	read: (file: string) => Uint8Array | undefined,
	release: Release,
): readonly string[] {
	const bytes = read(RUNTIME_MANIFEST);
	if (bytes === undefined) return [];
	let manifest: {
		version?: unknown;
		artifacts?: Record<string, { sha256?: unknown } | undefined>;
	};
	try {
		manifest = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return [`${RUNTIME_MANIFEST}: not JSON`];
	}
	const versionProblem =
		manifest.version === release.version
			? []
			: [
					`${RUNTIME_MANIFEST}: version ${String(manifest.version)}, expected ${release.version}`,
				];
	const pinProblems = release.artifacts
		.filter((a) => a.kind === "runtime")
		.flatMap((a) =>
			manifest.artifacts?.[a.id]?.sha256 === a.sha256
				? []
				: [`${RUNTIME_MANIFEST}: ${a.id} does not pin the released runtime`],
		);
	return [...versionProblem, ...pinProblems];
}

/** Every reason the release in `dir` is not complete and signed. */
export function verifyReleaseDir(
	dir: string,
	publicKeyPem: string,
): Result<Release, readonly string[]> {
	const read = readFrom(dir);
	const text = read("release.json");
	const release =
		text === undefined ? null : parseRelease(new TextDecoder().decode(text));
	if (release === null) {
		return { ok: false, error: ["release.json is missing or invalid"] };
	}
	const checked = checkRelease(release, read, publicKeyPem);
	const problems = [
		...detachedProblem(read, "release.json", publicKeyPem),
		...detachedProblem(read, RUNTIME_MANIFEST, publicKeyPem),
		...manifestProblems(read, release),
		...(checked.ok ? [] : describeProblems(checked.error)),
	];
	return problems.length === 0
		? { ok: true, value: release }
		: { ok: false, error: problems };
}

function main(argv: readonly string[]): number {
	let values: Record<string, string | boolean | undefined>;
	try {
		values = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				dir: { type: "string" },
				"public-key": { type: "string" },
			},
		}).values;
	} catch (err) {
		process.stderr.write(`sign: ${String(err)}\n`);
		return 2;
	}
	const { dir, "public-key": keyPath } = values;
	if (typeof dir !== "string" || typeof keyPath !== "string") {
		process.stderr.write("sign: --dir and --public-key are required\n");
		return 2;
	}
	let key: string;
	try {
		key = readFileSync(keyPath, "utf-8");
	} catch (err) {
		process.stderr.write(`sign: cannot read ${keyPath}: ${String(err)}\n`);
		return 2;
	}
	const verified = verifyReleaseDir(dir, key);
	if (!verified.ok) {
		process.stderr.write(
			`sign: the release in ${dir} is incomplete:\n  ${verified.error.join("\n  ")}\n`,
		);
		return 1;
	}
	process.stderr.write(
		`sign: release ${verified.value.version}: ${verified.value.artifacts.length} artifacts, all present, at one version and signed\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
