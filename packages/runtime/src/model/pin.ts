/**
 * The pinned System 1 model release (#573).
 *
 * Model releases are public `model-v<version>` GitHub Releases on
 * mainahq/maina, published by maina-model's release job. One release is
 * laid out as
 *
 *   <baseUrl>/model-v<version>/<asset>
 *
 * with `manifest.json` (maina-model ADR 0017), its `.sig`, and every file the
 * manifest lists, each with its `.sig`. GitHub Release assets are flat, so a
 * file's asset name is its manifest path with each `/` written as `--`:
 * `ort/darwin-arm64/onnxruntime_binding.node` is served as
 * `ort--darwin-arm64--onnxruntime_binding.node`. A path segment may not
 * contain `--` or start or end with `-` or `.`, so the mapping is one-to-one
 * and GitHub never renames an asset. `packages/runtime/model.json` pins
 * `{name, version, manifestSha256, baseUrl}`. It is bundled into the runtime
 * at build time, so neither the environment nor a config file can move it.
 *
 * The runtime uses the one release the pin names. It refuses any manifest
 * whose sha256, name or version differs from the pin. A signed release that
 * was later withdrawn fails that check too, so it cannot be rolled back to.
 * While `version` and `manifestSha256` are null, no release is pinned and
 * every manifest is refused.
 *
 * This checks the manifest against the pin only. The manifest signature and
 * the per-file hashes and signatures are the release verifier's job (#575).
 */

import { createHash } from "node:crypto";
import type { Result } from "@mainahq/core";
import shipped from "../../model.json" with { type: "json" };

/** A pin on one published release. */
export type ModelPin = Readonly<{
	name: string;
	version: string;
	manifestSha256: string;
	baseUrl: string;
}>;

/** The pin file before the first release: the host is known, no release is. */
type Unpinned = Readonly<{
	name: string;
	version: null;
	manifestSha256: null;
	baseUrl: string;
}>;

export type ModelPinFile = ModelPin | Unpinned;

/** A manifest that matches the pin, with the bytes that were checked. */
type PinnedManifest = Readonly<{
	name: string;
	version: string;
	bytes: Uint8Array;
}>;

type PinRefusal =
	| Readonly<{ kind: "unpinned"; message: string }>
	| Readonly<{ kind: "fetch_failed"; url: string; message: string }>
	| Readonly<{
			kind: "mismatch";
			problems: readonly string[];
			message: string;
	  }>;

/** Why a pin file was refused: every problem found, not only the first. */
type PinFileRefusal = Readonly<{
	kind: "invalid_pin";
	problems: readonly string[];
}>;

/** A manifest path that cannot be mapped to a release asset. */
type ReleasePathRefusal = Readonly<{ kind: "unsafe_path"; file: string }>;

/** Fetches a URL. `globalThis.fetch` in production, a fixture host in tests. */
type FetchPort = (url: string) => Promise<Response>;

const TAG_PREFIX = "model-v";
const FIELDS = ["baseUrl", "manifestSha256", "name", "version"] as const;
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Starts and ends with a letter, digit or `_`; `.` and `-` only inside. */
const SEGMENT = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/;
/** What a `/` in a manifest path becomes in the flat asset name. */
const ASSET_SEPARATOR = "--";
/** A manifest lists a few dozen files; anything this large is not one. */
const MAX_MANIFEST_BYTES = 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Why `url` cannot be a release host base URL, or nothing. */
function baseUrlProblems(url: unknown): readonly string[] {
	if (typeof url !== "string") return ["baseUrl must be a string"];
	if (url.endsWith("/")) return ["baseUrl must not end with /"];
	let parsed: URL;
	try {
		parsed = new URL(`${url}/`);
	} catch {
		return [`baseUrl ${url} is not a URL`];
	}
	if (parsed.protocol !== "https:") return ["baseUrl must be https"];
	// No query, fragment or credentials, and the canonical spelling.
	const plain =
		parsed.search === "" &&
		parsed.hash === "" &&
		parsed.username === "" &&
		parsed.password === "" &&
		parsed.href === `${url}/`;
	return plain ? [] : [`baseUrl ${url} must be a plain https URL`];
}

/** `value` as a pin file, or every reason it is not one. */
export function parseModelPin(
	value: unknown,
): Result<ModelPinFile, PinFileRefusal> {
	if (!isRecord(value)) {
		return {
			ok: false,
			error: { kind: "invalid_pin", problems: ["pin must be an object"] },
		};
	}
	const keys = Object.keys(value);
	const problems: string[] = [
		...FIELDS.filter((f) => !(f in value)).map((f) => `missing ${f}`),
		...keys
			.filter((k) => !(FIELDS as readonly string[]).includes(k))
			.map((k) => `unknown field ${k}`),
	];
	const { name, version, manifestSha256, baseUrl } = value;
	if (typeof name !== "string" || !NAME.test(name)) {
		problems.push("name must be lower-case letters, digits and -");
	}
	if (version === null || manifestSha256 === null) {
		if (version !== manifestSha256) {
			problems.push("version and manifestSha256 must be set together");
		}
	} else {
		if (typeof version !== "string" || !SEMVER.test(version)) {
			problems.push("version must be semver");
		}
		if (typeof manifestSha256 !== "string" || !SHA256.test(manifestSha256)) {
			problems.push("manifestSha256 must be a lower-case sha256");
		}
	}
	problems.push(...baseUrlProblems(baseUrl));
	return problems.length === 0
		? { ok: true, value: value as ModelPinFile }
		: { ok: false, error: { kind: "invalid_pin", problems } };
}

/** The pin this runtime was built with. */
export const SHIPPED_PIN = parseModelPin(shipped);

/** The URL the pinned release's files are served under. */
const releaseBase = (pin: ModelPin): string =>
	`${pin.baseUrl}/${TAG_PREFIX}${pin.version}`;

/**
 * Where `file` of the pinned release is served. `file` is a manifest path:
 * relative and `/`-separated. Its asset name joins the segments with `--`.
 */
export function releaseUrl(
	pin: ModelPin,
	file: string,
): Result<string, ReleasePathRefusal> {
	const segments = file.split("/");
	const safe = segments.every(
		(s) => SEGMENT.test(s) && !s.includes(ASSET_SEPARATOR),
	);
	return safe
		? {
				ok: true,
				value: `${releaseBase(pin)}/${segments.join(ASSET_SEPARATOR)}`,
			}
		: { ok: false, error: { kind: "unsafe_path", file } };
}

const unpinned = (pin: ModelPinFile): PinRefusal => ({
	kind: "unpinned",
	message: `no ${pin.name} release is pinned in model.json`,
});

/** Every way the manifest `bytes` differs from the release `pin` names. */
function mismatches(pin: ModelPin, bytes: Uint8Array): readonly string[] {
	const sha = createHash("sha256").update(bytes).digest("hex");
	const problems =
		sha === pin.manifestSha256
			? []
			: [`manifest sha256 ${sha}, pinned ${pin.manifestSha256}`];
	let manifest: unknown;
	try {
		manifest = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return [...problems, "manifest is not JSON"];
	}
	if (!isRecord(manifest)) return [...problems, "manifest is not an object"];
	const { name, version } = manifest;
	if (name !== pin.name) {
		problems.push(`manifest name ${String(name)}, pinned ${pin.name}`);
	}
	if (version !== pin.version) {
		problems.push(`manifest version ${String(version)}, pinned ${pin.version}`);
	}
	return problems;
}

/**
 * The manifest `bytes`, if they are exactly the manifest `pin` names;
 * otherwise every way they differ. A manifest is refused outright while no
 * release is pinned.
 */
export function checkPinnedManifest(
	pin: ModelPinFile,
	bytes: Uint8Array,
): Result<PinnedManifest, PinRefusal> {
	if (pin.version === null) return { ok: false, error: unpinned(pin) };
	const problems = mismatches(pin, bytes);
	if (problems.length > 0) {
		return {
			ok: false,
			error: {
				kind: "mismatch",
				problems,
				message: `${pin.name} ${pin.version}: the manifest does not match the pin (${problems.join("; ")})`,
			},
		};
	}
	return {
		ok: true,
		value: { name: pin.name, version: pin.version, bytes },
	};
}

/** The response body, or undefined once it passes `MAX_MANIFEST_BYTES`. */
async function readCapped(response: Response): Promise<Uint8Array | undefined> {
	const reader = response.body?.getReader();
	if (reader === undefined) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_MANIFEST_BYTES) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

/**
 * Downloads the pinned release's `manifest.json` from the release host and
 * checks it against the pin. Never rejects.
 */
export async function fetchPinnedManifest(
	pin: ModelPinFile,
	fetchUrl: FetchPort,
): Promise<Result<PinnedManifest, PinRefusal>> {
	if (pin.version === null) return { ok: false, error: unpinned(pin) };
	const url = `${releaseBase(pin)}/manifest.json`;
	const failed = (message: string): Result<never, PinRefusal> => ({
		ok: false,
		error: { kind: "fetch_failed", url, message: `${url}: ${message}` },
	});
	let bytes: Uint8Array | undefined;
	try {
		const response = await fetchUrl(url);
		if (!response.ok) return failed(`HTTP ${response.status}`);
		bytes = await readCapped(response);
	} catch (e) {
		return failed(e instanceof Error ? e.message : String(e));
	}
	if (bytes === undefined) {
		return failed(`larger than ${MAX_MANIFEST_BYTES} bytes`);
	}
	return checkPinnedManifest(pin, bytes);
}
