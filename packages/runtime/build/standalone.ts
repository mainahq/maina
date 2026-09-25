/**
 * Standalone runtime build (v1 task 2.3, FR-INS-1, FR-INS-2; ADR 0045).
 *
 * Compiles `src/standalone/main.ts` into one self-contained executable per
 * OS/arch with `bun build --compile`, so a host can run maina without bun or
 * node on its PATH. For every artifact it records the download URL, the
 * sha256 and an RSA-SHA256 signature in `manifest.json`, which the launcher
 * (`launcher/launch.sh`, `launcher/launch.ps1`) checks before it runs a
 * download.
 *
 *   bun packages/runtime/build/standalone.ts --out dist/runtime \
 *     [--targets linux-x64,darwin-arm64] [--signing-key key.pem] \
 *     [--base-url https://…/releases/download] [--manifest launcher/manifest.json] \
 *     [--prebuilt]
 *
 * `--prebuilt` skips compiling and records artifacts already in `--out`: the
 * release workflow builds each target on its own runner, then signs them all
 * in one job that holds the key.
 *
 * Without `--signing-key` the manifest carries empty signatures, which every
 * launcher refuses: such a build is only good for smoke tests.
 */

import {
	createHash,
	createPrivateKey,
	createPublicKey,
	sign,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "@mainahq/core";

export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
	"linux-x64-musl",
	"linux-arm64-musl",
	"windows-x64",
] as const;

export type Target = (typeof TARGETS)[number];

export type ManifestArtifact = Readonly<{
	url: string;
	/** Lowercase hex sha256 of the artifact. */
	sha256: string;
	/** Base64 RSA-SHA256 (PKCS#1 v1.5) signature of the artifact. */
	signature: string;
}>;

export type Manifest = Readonly<{
	schema: 1;
	version: string;
	artifacts: Readonly<Partial<Record<Target, ManifestArtifact>>>;
}>;

const DEFAULT_BASE_URL = "https://github.com/mainahq/maina/releases/download";

const isTarget = (value: string): value is Target =>
	(TARGETS as readonly string[]).includes(value);

export function artifactName(version: string, target: Target): string {
	const exe = target.startsWith("windows-") ? ".exe" : "";
	return `maina-${version}-${target}${exe}`;
}

export function bunTarget(target: Target): string {
	return `bun-${target}`;
}

export function releaseUrl(
	baseUrl: string,
	version: string,
	target: Target,
): string {
	return `${baseUrl}/runtime-v${version}/${artifactName(version, target)}`;
}

/** The target for a node `platform`/`arch`, or null when none is built. */
export function hostTarget(
	platform: string,
	arch: string,
	musl: boolean,
): Target | null {
	const os =
		platform === "darwin"
			? "darwin"
			: platform === "linux"
				? "linux"
				: platform === "win32"
					? "windows"
					: null;
	const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
	if (os === null || cpu === null) return null;
	const name = `${os}-${cpu}${os === "linux" && musl ? "-musl" : ""}`;
	return isTarget(name) ? name : null;
}

/**
 * The manifest in the one layout the launchers parse without a JSON tool:
 * two-space indent, one field per line, artifacts in `TARGETS` order.
 */
export function renderManifest(manifest: Manifest): string {
	const entries = TARGETS.flatMap((target) => {
		const a = manifest.artifacts[target];
		return a === undefined
			? []
			: [
					[
						`    ${JSON.stringify(target)}: {`,
						`      "url": ${JSON.stringify(a.url)},`,
						`      "sha256": ${JSON.stringify(a.sha256)},`,
						`      "signature": ${JSON.stringify(a.signature)}`,
						"    }",
					].join("\n"),
				];
	});
	const artifacts =
		entries.length === 0 ? "{}" : `{\n${entries.join(",\n")}\n  }`;
	return [
		"{",
		`  "schema": ${manifest.schema},`,
		`  "version": ${JSON.stringify(manifest.version)},`,
		`  "artifacts": ${artifacts}`,
		"}",
		"",
	].join("\n");
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Base64 RSA-SHA256 signature of `bytes`. */
export function signArtifact(bytes: Uint8Array, privateKeyPem: string): string {
	return sign("sha256", bytes, createPrivateKey(privateKeyPem)).toString(
		"base64",
	);
}

/** The public key as .NET `RSAKeyValue` XML, for `launch.ps1`. */
export function publicKeyXml(publicKeyPem: string): string {
	const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" });
	const b64 = (value: string | undefined): string =>
		Buffer.from(value ?? "", "base64url").toString("base64");
	return `<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>\n`;
}

type BuildOptions = Readonly<{
	out: string;
	targets: readonly Target[];
	baseUrl: string;
	signingKey: string | undefined;
	manifest: string | undefined;
	/** Sign artifacts already in `out` (built on native runners) instead of compiling. */
	prebuilt: boolean;
}>;

export function parseBuildArgs(
	argv: readonly string[],
): Result<BuildOptions, string> {
	let values: Record<string, string | boolean | undefined>;
	try {
		values = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				out: { type: "string" },
				targets: { type: "string" },
				"base-url": { type: "string" },
				"signing-key": { type: "string" },
				manifest: { type: "string" },
				prebuilt: { type: "boolean" },
			},
		}).values;
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
	const str = (key: string): string | undefined => {
		const value = values[key];
		return typeof value === "string" ? value : undefined;
	};
	const out = str("out");
	if (!out) return { ok: false, error: "--out is required" };
	const list = str("targets");
	const names = list?.split(",").map((t) => t.trim()) ?? [...TARGETS];
	const unknown = names.find((t) => !isTarget(t));
	if (unknown !== undefined) {
		return { ok: false, error: `unknown target: ${unknown}` };
	}
	return {
		ok: true,
		value: {
			out,
			targets: list === undefined ? TARGETS : names.filter(isTarget),
			baseUrl: str("base-url") ?? DEFAULT_BASE_URL,
			signingKey: str("signing-key"),
			manifest: str("manifest"),
			prebuilt: values.prebuilt === true,
		},
	};
}

const ENTRY = resolve(import.meta.dir, "..", "src", "standalone", "main.ts");

type CompileError = Readonly<{ kind: "compile_failed"; message: string }>;

/** Compiles the standalone runtime for `target` into `outfile`. */
export async function compileStandalone(
	options: Readonly<{ target: Target; outfile: string; bun?: string }>,
): Promise<Result<void, CompileError>> {
	const proc = Bun.spawn(
		[
			options.bun ?? process.execPath,
			"build",
			"--compile",
			"--minify",
			`--target=${bunTarget(options.target)}`,
			ENTRY,
			"--outfile",
			options.outfile,
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode === 0) return { ok: true, value: undefined };
	return {
		ok: false,
		error: {
			kind: "compile_failed",
			message: `bun build --compile (${options.target}) exited ${exitCode}: ${(stderr || stdout).slice(-2_000)}`,
		},
	};
}

/** The product version: the CLI package's, the single version source. */
function productVersion(): string {
	const pkg = JSON.parse(
		readFileSync(
			resolve(import.meta.dir, "..", "..", "cli", "package.json"),
			"utf-8",
		),
	) as { version: string };
	return pkg.version;
}

async function main(argv: readonly string[]): Promise<number> {
	const parsed = parseBuildArgs(argv);
	if (!parsed.ok) {
		process.stderr.write(`standalone: ${parsed.error}\n`);
		return 2;
	}
	const options = parsed.value;
	const version = productVersion();
	let key: string | undefined;
	try {
		key =
			options.signingKey === undefined
				? undefined
				: readFileSync(options.signingKey, "utf-8");
	} catch (err) {
		process.stderr.write(
			`standalone: cannot read signing key: ${String(err)}\n`,
		);
		return 2;
	}
	if (key === undefined) {
		process.stderr.write(
			"standalone: no --signing-key; signatures are empty and every launcher will refuse these artifacts\n",
		);
	}
	mkdirSync(options.out, { recursive: true });
	const artifacts: Partial<Record<Target, ManifestArtifact>> = {};
	for (const target of options.targets) {
		const outfile = join(options.out, artifactName(version, target));
		if (!options.prebuilt) {
			const built = await compileStandalone({ target, outfile });
			if (!built.ok) {
				process.stderr.write(`standalone: ${built.error.message}\n`);
				return 1;
			}
		}
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(readFileSync(outfile));
		} catch {
			process.stderr.write(`standalone: missing artifact ${outfile}\n`);
			return 1;
		}
		artifacts[target] = {
			url: releaseUrl(options.baseUrl, version, target),
			sha256: sha256Hex(bytes),
			signature: key === undefined ? "" : signArtifact(bytes, key),
		};
		process.stderr.write(
			`standalone: ${options.prebuilt ? "signed" : "built"} ${outfile}\n`,
		);
	}
	const manifest = renderManifest({ schema: 1, version, artifacts });
	writeFileSync(join(options.out, "manifest.json"), manifest);
	if (options.manifest !== undefined) {
		writeFileSync(options.manifest, manifest);
	}
	return 0;
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
