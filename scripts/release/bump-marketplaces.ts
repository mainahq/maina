#!/usr/bin/env bun
/**
 * Marketplace bumps (v1 task 9.7, FR-INS-2). The Claude Code, Cursor and
 * Codex marketplaces install maina from this repo, so a release reaches
 * them as a repo change: the launcher's runtime manifest, signed and at the
 * release version, and every host package regenerated from it, so each
 * plugin manifest carries that version (the listings themselves pin none).
 *
 * `bumpMarketplaces` is pure and returns the files by path from the repo
 * root; `build-all.ts` writes them under `<release>/marketplaces/`. After a
 * real release the workflow applies that tree and opens a pull request:
 *
 *   bun scripts/release/bump-marketplaces.ts --from dist/release
 *
 * which replaces each `packages/plugins/dist/<host>/` and writes the other
 * files, so `bun run plugins:check` holds on the result.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PLUGIN } from "../../packages/plugins/src/definition";
import {
	type GeneratedFile,
	generate,
	HOSTS,
	type Sources,
} from "../../packages/plugins/src/generate";
import { cursorMcpInstall } from "../../packages/plugins/src/generate/deeplink";
import {
	claudeMarketplace,
	codexMarketplace,
	cursorMarketplace,
} from "../../packages/plugins/src/generate/marketplace";
import { pluginVersion } from "../../packages/plugins/src/sources";
import {
	type Manifest,
	publicKeyXml,
	renderManifest,
	TARGETS,
	type Target,
} from "../../packages/runtime/build/standalone";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

const LAUNCHER_DIR = "packages/runtime/launcher";

/** The launcher's committed runtime manifest, from the repo root. */
export const LAUNCHER_MANIFEST_PATH = `${LAUNCHER_DIR}/manifest.json`;

/** The release key the launchers pin: PEM for `sh`, XML for PowerShell. */
const KEY_FILES = ["release.pub.pem", "release.pub.xml"] as const;

/** The generated host packages, from the repo root. */
export const PLUGIN_DIST = "packages/plugins/dist";

export type BumpError = Readonly<
	| { kind: "version_mismatch"; manifest: string; release: string }
	| { kind: "missing_target"; target: Target }
	| { kind: "unsigned_target"; target: Target }
>;

export function describeBumpError(error: BumpError): string {
	switch (error.kind) {
		case "version_mismatch":
			return `runtime manifest is at ${error.manifest}, not the release version ${error.release}`;
		case "missing_target":
			return `runtime manifest has no ${error.target} artifact`;
		case "unsigned_target":
			return `runtime manifest leaves ${error.target} unsigned`;
		default: {
			const never: never = error;
			return String(never);
		}
	}
}

function manifestProblem(
	version: string,
	manifest: Manifest,
): BumpError | null {
	if (manifest.version !== version) {
		return {
			kind: "version_mismatch",
			manifest: manifest.version,
			release: version,
		};
	}
	for (const target of TARGETS) {
		const artifact = manifest.artifacts[target];
		if (artifact === undefined) return { kind: "missing_target", target };
		if (artifact.signature === "") return { kind: "unsigned_target", target };
	}
	return null;
}

/**
 * The repo files that publish `version` to every marketplace: the launcher
 * manifest and release key, each host package under
 * `packages/plugins/dist/<host>/` (whose launcher pins both), the three
 * marketplace listings and the Cursor MCP install data. Refuses a runtime
 * manifest at another version, or one missing a target or a signature: a
 * plugin that pins it could not install the runtime.
 */
export function bumpMarketplaces(
	version: string,
	manifest: Manifest,
	sources: Sources,
	publicKeyPem: string,
): Result<readonly GeneratedFile[], BumpError> {
	const problem = manifestProblem(version, manifest);
	if (problem !== null) return { ok: false, error: problem };
	const launcherManifest = renderManifest(manifest);
	const keys: readonly GeneratedFile[] = [
		{ path: "release.pub.pem", content: publicKeyPem, executable: false },
		{
			path: "release.pub.xml",
			content: publicKeyXml(publicKeyPem),
			executable: false,
		},
	];
	const bumped: Sources = {
		...sources,
		version,
		launcher: [
			...sources.launcher
				.filter((f) => !(KEY_FILES as readonly string[]).includes(f.path))
				.map((f) =>
					f.path === "manifest.json" ? { ...f, content: launcherManifest } : f,
				),
			...keys,
		],
	};
	const packages = HOSTS.flatMap((host) =>
		generate(host, bumped).map((f) => ({
			...f,
			path: `${PLUGIN_DIST}/${host}/${f.path}`,
		})),
	);
	return {
		ok: true,
		value: [
			{
				path: LAUNCHER_MANIFEST_PATH,
				content: launcherManifest,
				executable: false,
			},
			...keys.map((f) => ({ ...f, path: `${LAUNCHER_DIR}/${f.path}` })),
			...packages,
			claudeMarketplace(PLUGIN),
			cursorMarketplace(PLUGIN),
			codexMarketplace(PLUGIN),
			cursorMcpInstall(PLUGIN, version),
		],
	};
}

/** The listing's plugin source folder, from the repo root. */
function listingSource(content: string): string | null {
	try {
		const listing = JSON.parse(content) as {
			plugins?: { source?: string | { path?: string } }[];
		};
		const source = listing.plugins?.[0]?.source;
		const path = typeof source === "string" ? source : source?.path;
		return typeof path === "string" ? path.replace(/^\.\//, "") : null;
	} catch {
		return null;
	}
}

/**
 * The version a marketplace serves: that of the plugin manifest in the
 * package its listing points at, among `files`.
 */
export function pluginManifestVersion(
	files: readonly GeneratedFile[],
	listingPath: string,
): Result<string, string> {
	const listing = files.find((f) => f.path === listingPath);
	const source = listing === undefined ? null : listingSource(listing.content);
	if (source === null)
		return { ok: false, error: `${listingPath}: no plugin source` };
	const manifest = files.find(
		(f) => f.path.startsWith(`${source}/`) && f.path.endsWith("plugin.json"),
	);
	if (manifest === undefined) {
		return {
			ok: false,
			error: `${listingPath}: no plugin manifest under ${source}`,
		};
	}
	try {
		const version = (JSON.parse(manifest.content) as { version?: unknown })
			.version;
		return typeof version === "string"
			? { ok: true, value: version }
			: { ok: false, error: `${manifest.path}: no version` };
	} catch {
		return { ok: false, error: `${manifest.path}: not JSON` };
	}
}

/**
 * Copies a release's `marketplaces/` tree over the repo at `root`, less the
 * listings' detached signatures, replacing each host package folder whole so
 * a file the generator dropped does not linger.
 */
function apply(tree: string, root: string): number {
	for (const host of HOSTS) {
		const fresh = join(tree, PLUGIN_DIST, host);
		if (existsSync(fresh)) {
			rmSync(join(root, PLUGIN_DIST, host), { recursive: true, force: true });
		}
	}
	let count = 0;
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const from = join(dir, entry.name);
			const to = join(root, rel, entry.name);
			if (entry.isDirectory()) {
				walk(from, join(rel, entry.name));
			} else if (!entry.name.endsWith(".sig")) {
				// A listing's `.sig` is a release file, not a repo file.
				mkdirSync(dirname(to), { recursive: true });
				cpSync(from, to);
				count++;
			}
		}
	};
	walk(tree, "");
	return count;
}

function main(argv: readonly string[]): number {
	let from: string | undefined;
	try {
		const { values } = parseArgs({
			args: [...argv],
			strict: true,
			options: { from: { type: "string" } },
		});
		from = values.from;
	} catch (err) {
		process.stderr.write(`bump-marketplaces: ${String(err)}\n`);
		return 2;
	}
	if (from === undefined) {
		process.stderr.write(
			"bump-marketplaces: --from <release dir> is required\n",
		);
		return 2;
	}
	const tree = join(from, "marketplaces");
	if (!existsSync(join(tree, LAUNCHER_MANIFEST_PATH))) {
		process.stderr.write(
			`bump-marketplaces: ${tree} holds no marketplace bump\n`,
		);
		return 1;
	}
	const version = pluginVersion(
		readFileSync(join(tree, LAUNCHER_MANIFEST_PATH), "utf-8"),
	);
	if (!version.ok) {
		process.stderr.write(`bump-marketplaces: ${version.error}\n`);
		return 1;
	}
	const count = apply(tree, resolve(import.meta.dir, "..", ".."));
	process.stderr.write(
		`bump-marketplaces: wrote ${count} files pinning ${version.value}\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
