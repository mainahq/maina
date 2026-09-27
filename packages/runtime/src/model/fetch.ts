/**
 * The System 1 model cache (#338, system1-artifact.md §3 step 3).
 *
 * The pinned release is downloaded once, into a temp directory under the
 * cache, verified in full (`verify.ts`: the manifest against the pin and
 * its signature, every file this target needs by hash and signature), and
 * only then renamed to `<cache>/<name>/<version>/`. A directory at that
 * path has always been verified; it is verified again on every load, so a
 * cache edited afterwards is refused, and a pull replaces it.
 *
 * The cache is the host plugin's data dir (`PLUGIN_DATA`, else
 * `CLAUDE_PLUGIN_DATA`, as the launcher picks it), so uninstalling the
 * plugin removes the model; otherwise `~/.maina/models`. Inside the plugin,
 * a release already in `~/.maina/models` (pulled from a terminal, which has
 * no plugin data dir) is used too, verified like any other. The runtime never
 * downloads on its own: `maina model pull` does. This file is the
 * imperative shell (network, filesystem); nothing here throws.
 */

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "@mainahq/core";
import {
	fetchPinnedManifest,
	type ModelPin,
	type ModelPinFile,
	releaseUrl,
} from "./pin";
import {
	neededFiles,
	type SignatureCheck,
	type VerifiedModelRelease,
	verifyModelRelease,
} from "./verify";

type Env = Readonly<Record<string, string | undefined>>;

/** Fetches a URL: `globalThis.fetch` in production, a fixture host in tests. */
type FetchPort = (url: string) => Promise<Response>;

/** Where the pinned release is cached, and how it is checked. */
type CacheInput = Readonly<{
	pin: ModelPinFile;
	/** The cache root (`modelCacheRoot`): where a pull writes. */
	root: string;
	/**
	 * Roots a release may already be cached in (`modelCacheFallbacks`),
	 * looked in after `root`; each copy is verified in full like any other.
	 */
	fallbackRoots?: readonly string[];
	/** The runtime target, e.g. `darwin-arm64`. */
	target: string;
	verifySignature: SignatureCheck;
}>;

type ModelCacheError = Readonly<{
	kind:
		| "unpinned"
		| "not_installed"
		| "unverified"
		| "fetch_failed"
		| "io_failed";
	message: string;
}>;

/** A cached release that verified, and a reader over the bytes it checked. */
type CachedModel = Readonly<{
	dir: string;
	release: VerifiedModelRelease;
	/**
	 * The release's files by manifest path, as verified: read once, so the
	 * loader uses exactly the bytes whose hashes and signatures it checked.
	 */
	read: (file: string) => Uint8Array | undefined;
}>;

type PulledModel = CachedModel & Readonly<{ downloaded: boolean }>;

/** The largest file a release may hold (the model is at most 600 MB). */
const MAX_FILE_BYTES = 1024 ** 3;

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

const failure = (
	kind: ModelCacheError["kind"],
	message: string,
): Result<never, ModelCacheError> => ({ ok: false, error: { kind, message } });

/** The model cache root: the plugin's data dir, else `~/.maina/models`. */
export function modelCacheRoot(env: Env, home: string): string {
	const pluginData = env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA;
	return pluginData
		? join(pluginData, "models")
		: join(home, ".maina", "models");
}

/**
 * Where else a release may already be cached: `~/.maina/models`, for a
 * process inside the plugin, when `maina model pull` ran outside it (a
 * terminal has no plugin data dir). Empty when that is the root already.
 */
export function modelCacheFallbacks(env: Env, home: string): readonly string[] {
	const homeRoot = join(home, ".maina", "models");
	return modelCacheRoot(env, home) === homeRoot ? [] : [homeRoot];
}

/** Where `pin`'s release is cached under `root`. */
export function modelReleaseDir(root: string, pin: ModelPin): string {
	return join(root, pin.name, pin.version);
}

/** A reader over `dir` that reads each file once and keeps its bytes. */
function dirReader(dir: string): (file: string) => Uint8Array | undefined {
	const read = new Map<string, Uint8Array | undefined>();
	return (file) => {
		if (read.has(file)) return read.get(file);
		let bytes: Uint8Array | undefined;
		try {
			bytes = new Uint8Array(readFileSync(join(dir, ...file.split("/"))));
		} catch {
			bytes = undefined;
		}
		read.set(file, bytes);
		return bytes;
	};
}

const unpinned = (pin: ModelPinFile) =>
	failure("unpinned", `no ${pin.name} release is pinned in model.json`);

/** Verifies `dir` as `pin`'s release for `input.target`. */
function verifyDir(
	input: CacheInput,
	pin: ModelPin,
	dir: string,
): Result<CachedModel, ModelCacheError> {
	const read = dirReader(dir);
	const verified = verifyModelRelease({
		pin,
		read,
		verifySignature: input.verifySignature,
		target: input.target,
	});
	return verified.ok
		? { ok: true, value: { dir, release: verified.value, read } }
		: failure("unverified", verified.error.message);
}

/** The release cached under one `root`, verified, or why not. */
function verifyRoot(
	input: CacheInput,
	pin: ModelPin,
	root: string,
): Result<CachedModel, ModelCacheError> {
	const dir = modelReleaseDir(root, pin);
	if (dirReader(dir)("manifest.json") === undefined) {
		return failure(
			"not_installed",
			`${pin.name} ${pin.version} is not installed (run \`maina model pull\`)`,
		);
	}
	return verifyDir(input, pin, dir);
}

/**
 * The cached release, verified again in full (every hash and signature),
 * from `root` or else a fallback root, or why it cannot be used. A copy
 * that is there but fails verification is reported over one that is not
 * there at all.
 */
export function verifyCachedModel(
	input: CacheInput,
): Result<CachedModel, ModelCacheError> {
	const { pin } = input;
	if (pin.version === null) return unpinned(pin);
	let result = verifyRoot(input, pin, input.root);
	for (const root of input.fallbackRoots ?? []) {
		if (result.ok) break;
		const found = verifyRoot(input, pin, root);
		if (found.ok || result.error.kind === "not_installed") result = found;
	}
	return result;
}

/** The body of `url`, or why it could not be fetched. */
async function download(
	fetchUrl: FetchPort,
	url: string,
): Promise<Result<Uint8Array, ModelCacheError>> {
	try {
		const response = await fetchUrl(url);
		if (!response.ok) {
			return failure("fetch_failed", `${url}: HTTP ${response.status}`);
		}
		const declared = Number(response.headers.get("content-length"));
		if (declared > MAX_FILE_BYTES) {
			return failure(
				"fetch_failed",
				`${url}: larger than ${MAX_FILE_BYTES} bytes`,
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		return bytes.byteLength > MAX_FILE_BYTES
			? failure("fetch_failed", `${url}: larger than ${MAX_FILE_BYTES} bytes`)
			: { ok: true, value: bytes };
	} catch (e) {
		return failure("fetch_failed", `${url}: ${errorText(e)}`);
	}
}

/** Downloads every file `pin`'s release needs for `target` into `tmp`. */
async function downloadInto(
	input: CacheInput & Readonly<{ fetchUrl: FetchPort }>,
	pin: ModelPin,
	tmp: string,
	manifest: Uint8Array,
): Promise<Result<void, ModelCacheError>> {
	writeFileSync(join(tmp, "manifest.json"), manifest);
	for (const file of [
		"manifest.json.sig",
		...neededFiles(manifest, input.target),
	]) {
		const url = releaseUrl(pin, file);
		if (!url.ok) {
			return failure("unverified", `the manifest lists an unsafe path ${file}`);
		}
		const body = await download(input.fetchUrl, url.value);
		if (!body.ok) return body;
		const path = join(tmp, ...file.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body.value);
	}
	return { ok: true, value: undefined };
}

/**
 * The pinned release, from the cache when it is there and verifies,
 * otherwise downloaded, verified and moved into place. A release that
 * fails verification never reaches the cache. Never rejects.
 */
export async function pullModel(
	input: CacheInput & Readonly<{ fetchUrl: FetchPort }>,
): Promise<Result<PulledModel, ModelCacheError>> {
	const { pin } = input;
	if (pin.version === null) return unpinned(pin);
	const cached = verifyCachedModel(input);
	if (cached.ok)
		return { ok: true, value: { ...cached.value, downloaded: false } };

	const manifest = await fetchPinnedManifest(pin, input.fetchUrl);
	if (!manifest.ok) {
		return failure(
			manifest.error.kind === "fetch_failed" ? "fetch_failed" : "unverified",
			manifest.error.message,
		);
	}
	let tmp: string | undefined;
	try {
		mkdirSync(input.root, { recursive: true });
		tmp = mkdtempSync(join(input.root, ".pull-"));
		const downloaded = await downloadInto(
			input,
			pin,
			tmp,
			manifest.value.bytes,
		);
		if (!downloaded.ok) return downloaded;
		const verified = verifyDir(input, pin, tmp);
		if (!verified.ok) return verified;
		const dir = modelReleaseDir(input.root, pin);
		// Only a release that failed verification can be there now.
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dirname(dir), { recursive: true });
		renameSync(tmp, dir);
		tmp = undefined;
		// The reader holds every verified file's bytes already.
		return { ok: true, value: { ...verified.value, dir, downloaded: true } };
	} catch (e) {
		return failure(
			"io_failed",
			`cannot write the model cache: ${errorText(e)}`,
		);
	} finally {
		if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
	}
}
