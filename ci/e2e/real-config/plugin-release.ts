/**
 * A maina release for the plugin install path, staged on this machine.
 *
 * The committed plugin packages pin the runtime version but carry no
 * artifacts: releasing adds the signed launcher manifest and the release
 * key (`runtime-artifacts.yml`). This does the same for the e2e: it
 * compiles the standalone runtime for this machine, signs it with a
 * throwaway key, serves it on 127.0.0.1 and writes a marketplace (the
 * repo's `.claude-plugin/marketplace.json`, `.cursor-plugin/
 * marketplace.json` and `.agents/plugins/marketplace.json`, plus every
 * plugin package they list and the Agent Plugins package, which is
 * installed from its directory) whose launchers pin that artifact. Installing
 * from it is installing a release, with the network kept local.
 *
 * Built once per test process; `stopPluginRelease` stops the server and
 * removes the files.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	artifactName,
	compileStandalone,
	type Manifest,
	publicKeyXml,
	renderManifest,
	sha256Hex,
	signArtifact,
} from "../../../packages/runtime/build/standalone";
import {
	type ArtifactServer,
	createReleaseKey,
	currentTarget,
	startArtifactServer,
} from "../../../packages/runtime/launcher/__tests__/fixture";
import type { Result } from "./types";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Each host's marketplace listing, from the repo root. */
const MARKETPLACE_FILES: readonly string[] = [
	".claude-plugin/marketplace.json",
	".cursor-plugin/marketplace.json",
	".agents/plugins/marketplace.json",
];

/**
 * Plugin packages no marketplace lists, installed from their directory:
 * the Agent Plugins package (VS Code agent mode, Copilot; #344).
 */
const DIRECTORY_SOURCES: readonly string[] = [
	"./packages/plugins/dist/agent-plugins",
];

export interface PluginRelease {
	/** A marketplace root to add, as a user adds the repo. */
	readonly marketplace: string;
	/** The runtime version the launchers pin. */
	readonly version: string;
	/** Paths the artifact server has served, in order. */
	readonly downloads: () => readonly string[];
}

let staged: Promise<Result<PluginRelease, string>> | undefined;
let cleanup: (() => void) | undefined;

const readJson = (path: string): unknown =>
	JSON.parse(readFileSync(path, "utf-8"));

/**
 * Relative plugin sources a marketplace lists (`./…`): a bare path (Claude
 * Code, Cursor) or a `local` source's `path` (Codex).
 */
function relativeSources(listing: unknown): readonly string[] {
	const plugins = (listing as { plugins?: unknown }).plugins;
	if (!Array.isArray(plugins)) return [];
	return plugins
		.map((p) => {
			const source = (p as { source?: unknown }).source;
			return typeof source === "object" && source !== null
				? (source as { path?: unknown }).path
				: source;
		})
		.filter((s): s is string => typeof s === "string" && s.startsWith("./"));
}

async function stage(): Promise<Result<PluginRelease, string>> {
	const missing = MARKETPLACE_FILES.filter(
		(file) => !existsSync(join(REPO_ROOT, file)),
	);
	if (missing.length > 0) {
		return {
			ok: false,
			error: `no marketplace listing at ${missing.join(", ")}`,
		};
	}
	const root = mkdtempSync(join(tmpdir(), "maina-plugin-release-"));
	let server: ArtifactServer | undefined;
	cleanup = () => {
		server?.stop();
		rmSync(root, { recursive: true, force: true });
	};
	try {
		const target = currentTarget();
		const marketplace = join(root, "marketplace");
		for (const file of MARKETPLACE_FILES) {
			mkdirSync(join(marketplace, dirname(file)), { recursive: true });
			cpSync(join(REPO_ROOT, file), join(marketplace, file));
		}
		const sources = [
			...new Set([
				...MARKETPLACE_FILES.flatMap((file) =>
					relativeSources(readJson(join(REPO_ROOT, file))),
				),
				...DIRECTORY_SOURCES,
			]),
		];
		const launcherManifest = (source: string) =>
			join(marketplace, source, "launcher", "manifest.json");
		for (const source of sources) {
			cpSync(join(REPO_ROOT, source), join(marketplace, source), {
				recursive: true,
			});
		}
		const pinned = sources.find((s) => existsSync(launcherManifest(s)));
		if (pinned === undefined) {
			return { ok: false, error: "no listed plugin bundles a launcher" };
		}
		const version = (readJson(launcherManifest(pinned)) as Manifest).version;
		const outfile = join(root, artifactName(version, target));
		const built = await compileStandalone({ target, outfile });
		if (!built.ok) return { ok: false, error: built.error.message };
		const bytes = new Uint8Array(readFileSync(outfile));
		const path = `/runtime-v${version}/${artifactName(version, target)}`;
		server = startArtifactServer({ [path]: bytes });
		const key = createReleaseKey();
		const manifest: Manifest = {
			schema: 1,
			version,
			artifacts: {
				[target]: {
					url: `${server.url}${path}`,
					sha256: sha256Hex(bytes),
					signature: signArtifact(bytes, key.privateKeyPem),
				},
			},
		};
		for (const source of sources) {
			const launcher = dirname(launcherManifest(source));
			if (!existsSync(launcher)) continue;
			writeFileSync(join(launcher, "manifest.json"), renderManifest(manifest));
			writeFileSync(join(launcher, "release.pub.pem"), key.publicKeyPem);
			writeFileSync(
				join(launcher, "release.pub.xml"),
				publicKeyXml(key.publicKeyPem),
			);
		}
		const { requests } = server;
		return {
			ok: true,
			value: { marketplace, version, downloads: () => [...requests] },
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export function pluginRelease(): Promise<Result<PluginRelease, string>> {
	staged ??= stage();
	return staged;
}

export function stopPluginRelease(): void {
	cleanup?.();
	cleanup = undefined;
	staged = undefined;
}
