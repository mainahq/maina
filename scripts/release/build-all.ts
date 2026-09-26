#!/usr/bin/env bun
/**
 * Lockstep release build (v1 task 9.7, FR-INS-2, spec §8). One run builds,
 * at the CLI version:
 *
 *   npm/            the CLI packages (the changesets `fixed` group), packed
 *   runtime/        the standalone runtime for every OS/arch + manifest.json
 *   plugins/        every host plugin package, as a .tar.gz
 *   marketplaces/   the marketplace bump: repo files, from the repo root
 *
 * signs every artifact with the release key (`<file>.sig`), writes
 * `release.json` (+ `.sig`) and fails, writing no `release.json`, when any
 * artifact is missing or at another version.
 *
 *   bun scripts/release/build-all.ts --out dist/release --dry-run
 *   bun scripts/release/build-all.ts --out dist/release --signing-key key.pem
 *
 * A dry run without `--signing-key` signs with a throwaway key and writes its
 * public half to `test-key.pub.pem`, for `sign.ts` to verify against; its
 * `release.json` says `dryRun`, and `publish-artifacts.ts` never publishes
 * it. A real run needs the release key (mainahq/maina#424) and refuses one
 * whose public half is not the key the launcher pins.
 */

import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import type {
	GeneratedFile,
	Sources,
} from "../../packages/plugins/src/generate";
import { HOSTS } from "../../packages/plugins/src/generate";
import { loadSources } from "../../packages/plugins/src/sources";
import {
	artifactName,
	compileStandalone,
	type Manifest,
	type ManifestArtifact,
	releaseUrl,
	renderManifest,
	sha256Hex,
	signArtifact,
	TARGETS,
	type Target,
} from "../../packages/runtime/build/standalone";
import {
	type BumpError,
	bumpMarketplaces,
	describeBumpError,
	PLUGIN_DIST,
	pluginManifestVersion,
} from "./bump-marketplaces";
import {
	CLI_PACKAGES,
	type CliPackage,
	checkRelease,
	describeProblems,
	MARKETPLACES,
	type Release,
	type ReleaseArtifact,
	type ReleaseProblem,
} from "./lockstep";
import {
	publicKeyOf,
	RUNTIME_MANIFEST,
	readFrom,
	signArtifacts,
	writeRelease,
	writeSigned,
} from "./sign";
import { tarGz } from "./tar";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

export type PackedPackage = Readonly<{
	/** The tarball's path. */
	file: string;
	/** The version in the packed package.json. */
	version: string;
}>;

/** The slow, external steps, injected so a test can fake them. */
export type BuildPorts = Readonly<{
	pack: (
		pkg: CliPackage,
		outDir: string,
	) => Promise<Result<PackedPackage, string>>;
	compile: (target: Target, outfile: string) => Promise<Result<void, string>>;
}>;

export type BuildError = Readonly<
	| { kind: "pack_failed"; pkg: CliPackage; message: string }
	| { kind: "compile_failed"; target: Target; message: string }
	| { kind: "bump_failed"; error: BumpError }
	| { kind: "archive_failed"; host: string; path: string }
	| { kind: "missing_artifact"; file: string }
	| { kind: "check_failed"; problems: readonly ReleaseProblem[] }
>;

export function describeBuildError(error: BuildError): string {
	switch (error.kind) {
		case "pack_failed":
			return `cannot pack ${error.pkg}: ${error.message}`;
		case "compile_failed":
			return `cannot compile the ${error.target} runtime: ${error.message}`;
		case "bump_failed":
			return `cannot bump the marketplaces: ${describeBumpError(error.error)}`;
		case "archive_failed":
			return `cannot archive the ${error.host} plugin: ${error.path} is too long for ustar`;
		case "missing_artifact":
			return `${error.file} vanished before it was signed`;
		case "check_failed":
			return `the release is incomplete:\n  ${describeProblems(error.problems).join("\n  ")}`;
		default: {
			const never: never = error;
			return String(never);
		}
	}
}

export type BuildAllOptions = Readonly<{
	out: string;
	/** The release version: the CLI package's. */
	version: string;
	dryRun: boolean;
	signingKeyPem: string;
	/** The files the plugins bundle (`packages/plugins/src/sources.ts`). */
	sources: Sources;
	ports: BuildPorts;
	baseUrl?: string;
}>;

const DEFAULT_BASE_URL = "https://github.com/mainahq/maina/releases/download";

const posix = (path: string): string => path.split(sep).join("/");

/** The version in the one `plugin.json` among a package's files, or "". */
function packageVersion(files: readonly GeneratedFile[]): string {
	const manifest = files.find((f) => f.path.endsWith("plugin.json"));
	try {
		const version = (
			JSON.parse(manifest?.content ?? "") as { version?: unknown }
		).version;
		return typeof version === "string" ? version : "";
	} catch {
		return "";
	}
}

function writeTree(root: string, files: readonly GeneratedFile[]): void {
	for (const f of files) {
		const full = join(root, f.path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, f.content);
		chmodSync(full, f.executable ? 0o755 : 0o644);
	}
}

type Unsigned = Omit<ReleaseArtifact, "sha256" | "signature">;

async function buildRuntime(
	o: BuildAllOptions,
): Promise<
	Result<
		Readonly<{ artifacts: readonly Unsigned[]; manifest: Manifest }>,
		BuildError
	>
> {
	const artifacts: Unsigned[] = [];
	const entries: Partial<Record<Target, ManifestArtifact>> = {};
	for (const target of TARGETS) {
		const file = `runtime/${artifactName(o.version, target)}`;
		const compiled = await o.ports.compile(target, join(o.out, file));
		if (!compiled.ok) {
			return {
				ok: false,
				error: { kind: "compile_failed", target, message: compiled.error },
			};
		}
		const bytes = new Uint8Array(readFileSync(join(o.out, file)));
		entries[target] = {
			url: releaseUrl(o.baseUrl ?? DEFAULT_BASE_URL, o.version, target),
			sha256: sha256Hex(bytes),
			signature: signArtifact(bytes, o.signingKeyPem),
		};
		artifacts.push({ kind: "runtime", id: target, file, version: o.version });
	}
	return {
		ok: true,
		value: {
			artifacts,
			manifest: { schema: 1, version: o.version, artifacts: entries },
		},
	};
}

/** Builds, signs and checks a lockstep release into `options.out`. */
export async function buildAll(
	o: BuildAllOptions,
): Promise<Result<Release, BuildError>> {
	for (const dir of ["npm", "runtime", "plugins", "marketplaces"]) {
		mkdirSync(join(o.out, dir), { recursive: true });
	}

	const npm: Unsigned[] = [];
	for (const pkg of CLI_PACKAGES) {
		const packed = await o.ports.pack(pkg, join(o.out, "npm"));
		if (!packed.ok) {
			return {
				ok: false,
				error: { kind: "pack_failed", pkg, message: packed.error },
			};
		}
		npm.push({
			kind: "npm",
			id: pkg,
			file: posix(relative(o.out, packed.value.file)),
			version: packed.value.version,
		});
	}

	const runtime = await buildRuntime(o);
	if (!runtime.ok) return runtime;
	writeSigned(
		o.out,
		RUNTIME_MANIFEST,
		renderManifest(runtime.value.manifest),
		o.signingKeyPem,
	);

	const bump = bumpMarketplaces(
		o.version,
		runtime.value.manifest,
		o.sources,
		publicKeyOf(o.signingKeyPem),
	);
	if (!bump.ok)
		return { ok: false, error: { kind: "bump_failed", error: bump.error } };
	writeTree(join(o.out, "marketplaces"), bump.value);

	const plugins: Unsigned[] = [];
	for (const host of HOSTS) {
		const prefix = `${PLUGIN_DIST}/${host}/`;
		const files = bump.value
			.filter((f) => f.path.startsWith(prefix))
			.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
		const archive = tarGz(files);
		if (!archive.ok) {
			const path =
				archive.error.kind === "path_too_long" ? archive.error.path : "";
			return { ok: false, error: { kind: "archive_failed", host, path } };
		}
		const file = `plugins/maina-plugin-${host}-${o.version}.tar.gz`;
		writeFileSync(join(o.out, file), archive.value);
		plugins.push({
			kind: "plugin",
			id: host,
			file,
			version: packageVersion(files),
		});
	}

	const marketplaces: Unsigned[] = MARKETPLACES.map((m) => {
		const version = pluginManifestVersion(bump.value, m.listing);
		return {
			kind: "marketplace",
			id: m.host,
			file: `marketplaces/${m.listing}`,
			version: version.ok ? version.value : "",
		};
	});

	const read = readFrom(o.out);
	const signed = signArtifacts(
		[...npm, ...runtime.value.artifacts, ...plugins, ...marketplaces],
		read,
		o.signingKeyPem,
	);
	if (!signed.ok) {
		return {
			ok: false,
			error: { kind: "missing_artifact", file: signed.error.file },
		};
	}
	const release: Release = {
		schema: 1,
		version: o.version,
		dryRun: o.dryRun,
		artifacts: signed.value,
	};
	const checked = checkRelease(release, read, publicKeyOf(o.signingKeyPem));
	if (!checked.ok)
		return {
			ok: false,
			error: { kind: "check_failed", problems: checked.error },
		};
	writeRelease(o.out, release, o.signingKeyPem);
	return { ok: true, value: release };
}

// ── I/O edge: the real packer and compiler, and the script ──────────────────

const ROOT = resolve(import.meta.dir, "..", "..");

const packageDir = (pkg: CliPackage): string =>
	join(ROOT, "packages", pkg.slice("@mainahq/".length));

async function run(
	cmd: readonly string[],
	cwd: string,
): Promise<Result<string, string>> {
	const proc = Bun.spawn([...cmd], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return code === 0
		? { ok: true, value: stdout }
		: {
				ok: false,
				error: `${cmd.join(" ")} exited ${code}: ${(stderr || stdout).slice(-2_000)}`,
			};
}

const realPorts: BuildPorts = {
	pack: async (pkg, outDir) => {
		const dir = packageDir(pkg);
		const packed = await run(
			[
				process.execPath,
				"pm",
				"pack",
				"--destination",
				outDir,
				"--ignore-scripts",
				"--quiet",
			],
			dir,
		);
		if (!packed.ok) return packed;
		const line = packed.value.trim().split("\n").pop() ?? "";
		try {
			const { version } = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf-8"),
			) as {
				version: string;
			};
			return { ok: true, value: { file: resolve(dir, line.trim()), version } };
		} catch (err) {
			return {
				ok: false,
				error: `cannot read ${pkg}'s package.json: ${String(err)}`,
			};
		}
	},
	compile: async (target, outfile) => {
		const built = await compileStandalone({ target, outfile });
		return built.ok ? built : { ok: false, error: built.error.message };
	},
};

const sameKey = (a: string, b: string): boolean =>
	a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

function throwawayKey(): string {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	return privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

async function main(argv: readonly string[]): Promise<number> {
	let values: Record<string, string | boolean | undefined>;
	try {
		values = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				out: { type: "string" },
				"dry-run": { type: "boolean" },
				"signing-key": { type: "string" },
				"base-url": { type: "string" },
			},
		}).values;
	} catch (err) {
		process.stderr.write(`build-all: ${String(err)}\n`);
		return 2;
	}
	const out = typeof values.out === "string" ? resolve(values.out) : undefined;
	if (out === undefined) {
		process.stderr.write("build-all: --out is required\n");
		return 2;
	}
	const dryRun = values["dry-run"] === true;
	const keyPath = values["signing-key"];
	let key: string;
	try {
		key = typeof keyPath === "string" ? readFileSync(keyPath, "utf-8") : "";
	} catch (err) {
		process.stderr.write(
			`build-all: cannot read the signing key: ${String(err)}\n`,
		);
		return 2;
	}
	if (key === "" && !dryRun) {
		process.stderr.write(
			"build-all: a release needs --signing-key (the MAINA_RUNTIME_SIGNING_KEY secret); use --dry-run to sign with a throwaway key\n",
		);
		return 2;
	}
	if (!dryRun) {
		let pinned = "";
		try {
			pinned = readFileSync(
				join(ROOT, "packages", "runtime", "launcher", "release.pub.pem"),
				"utf-8",
			);
		} catch {
			// No committed launcher key yet (mainahq/maina#424).
		}
		if (!sameKey(pinned, publicKeyOf(key))) {
			process.stderr.write(
				"build-all: the signing key is not the one the launcher pins (packages/runtime/launcher/release.pub.pem): launchers would refuse this release\n",
			);
			return 1;
		}
	}
	const signingKeyPem = key === "" ? throwawayKey() : key;
	mkdirSync(out, { recursive: true });
	if (key === "") {
		writeFileSync(join(out, "test-key.pub.pem"), publicKeyOf(signingKeyPem));
		process.stderr.write("build-all: dry run, signing with a throwaway key\n");
	}
	const sources = loadSources();
	if (!sources.ok) {
		process.stderr.write(`build-all: ${sources.error}\n`);
		return 1;
	}
	const { version } = JSON.parse(
		readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf-8"),
	) as { version: string };
	const built = await buildAll({
		out,
		version,
		dryRun,
		signingKeyPem,
		sources: sources.value,
		ports: realPorts,
		...(typeof values["base-url"] === "string"
			? { baseUrl: values["base-url"] }
			: {}),
	});
	if (!built.ok) {
		process.stderr.write(`build-all: ${describeBuildError(built.error)}\n`);
		return 1;
	}
	const count = (kind: string) =>
		built.value.artifacts.filter((a) => a.kind === kind).length;
	process.stderr.write(
		`build-all: ${dryRun ? "dry-run " : ""}release ${version}: ${count("npm")} CLI packages, ${count("runtime")} runtimes, ${count("plugin")} plugins, ${count("marketplace")} marketplace bumps, all signed, in ${out}\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
