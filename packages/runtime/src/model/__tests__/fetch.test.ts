/**
 * Downloading the pinned System 1 release once (#338, system1-artifact.md
 * §3 step 3). A release is downloaded into a temp directory under the model
 * cache, verified (the manifest against the pin and its signature, every
 * file this target needs by hash and signature), and only then renamed to
 * `<cache>/<name>/<version>/`: a directory at that path has always been
 * verified. The cache is the host plugin's data dir when there is one,
 * else `~/.maina/models`. A second pull downloads nothing.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	modelCacheFallbacks,
	modelCacheRoot,
	modelReleaseDir,
	pullModel,
	verifyCachedModel,
} from "../fetch";
import { checkerFor, devKey, pinOn, sha256 } from "./fixtures/model-release";
import {
	buildSystem1Release,
	releaseHost,
	S1_VERSION,
} from "./fixtures/system1-release";

const TARGET = "linux-x64-musl";

let key: ReturnType<typeof devKey>;
let release: ReturnType<typeof buildSystem1Release>;
let scratch: string;

beforeAll(() => {
	key = devKey();
	release = buildSystem1Release(key.privatePem);
	scratch = testTmpDir("maina-338-fetch-");
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
const freshRoot = () => join(scratch, `root-${++n}`);

function source(
	root: string,
	files: ReadonlyMap<string, Uint8Array> = release.files,
) {
	const pin = pinOn(release.manifestBytes, S1_VERSION);
	const host = releaseHost(pin, files);
	return {
		host,
		input: {
			pin,
			root,
			target: TARGET,
			verifySignature: checkerFor(key.publicPem),
			fetchUrl: host.fetchUrl,
		},
	};
}

describe("the model cache", () => {
	test("lives in the host plugin's data dir when there is one", () => {
		expect(modelCacheRoot({ CLAUDE_PLUGIN_DATA: "/p/data" }, "/home/u")).toBe(
			join("/p/data", "models"),
		);
		expect(
			modelCacheRoot({ PLUGIN_DATA: "/q", CLAUDE_PLUGIN_DATA: "/p" }, "/h"),
		).toBe(join("/q", "models"));
	});

	test("is ~/.maina/models otherwise", () => {
		expect(modelCacheRoot({}, "/home/u")).toBe(
			join("/home/u", ".maina", "models"),
		);
		expect(modelCacheRoot({ CLAUDE_PLUGIN_DATA: "" }, "/home/u")).toBe(
			join("/home/u", ".maina", "models"),
		);
	});

	test("falls back to ~/.maina/models from inside the plugin, and only then (#620)", () => {
		expect(
			modelCacheFallbacks({ CLAUDE_PLUGIN_DATA: "/p" }, "/home/u"),
		).toEqual([join("/home/u", ".maina", "models")]);
		expect(modelCacheFallbacks({}, "/home/u")).toEqual([]);
	});

	test("keys a release on its name and version", () => {
		const pin = pinOn(release.manifestBytes, S1_VERSION);
		expect(modelReleaseDir("/c", pin)).toBe(
			join("/c", "maina-system1", S1_VERSION),
		);
	});
});

describe("pullModel", () => {
	test("downloads the release once, verified, into <cache>/<name>/<version>", async () => {
		const root = freshRoot();
		const { host, input } = source(root);
		const pulled = await pullModel(input);
		if (!pulled.ok) throw new Error(pulled.error.message);
		const dir = join(root, "maina-system1", S1_VERSION);
		expect(pulled.value.dir).toBe(dir);
		expect(pulled.value.downloaded).toBe(true);
		expect(pulled.value.release.manifest.version).toBe(S1_VERSION);
		// Every file this target needs, byte for byte; no other target's.
		for (const file of [
			"manifest.json",
			"manifest.json.sig",
			"model.int8.onnx",
			"tokenizer.json",
			"wasm/ort-wasm-simd-threaded.wasm",
		]) {
			expect(sha256(readFileSync(join(dir, file)))).toBe(
				sha256(release.files.get(file) ?? new Uint8Array()),
			);
		}
		// Nothing but the release is left in the cache.
		expect(readdirSync(root)).toEqual(["maina-system1"]);
		expect(readdirSync(join(root, "maina-system1"))).toEqual([S1_VERSION]);

		const asked = host.requests.length;
		expect(asked).toBeGreaterThan(0);
		const again = await pullModel(input);
		if (!again.ok) throw new Error(again.error.message);
		expect(again.value.downloaded).toBe(false);
		expect(host.requests.length).toBe(asked);
	});

	test("a tampered download is refused and never lands in the cache", async () => {
		const root = freshRoot();
		const tampered = new Map(release.files);
		const model = new Uint8Array(release.files.get("model.int8.onnx") ?? []);
		model[model.length - 1] = (model[model.length - 1] ?? 0) ^ 0xff;
		tampered.set("model.int8.onnx", model);
		const { input } = source(root, tampered);
		const pulled = await pullModel(input);
		expect(pulled.ok).toBe(false);
		if (!pulled.ok) {
			expect(pulled.error.kind).toBe("unverified");
			expect(pulled.error.message).toContain("model int8: sha256 mismatch");
		}
		expect(existsSync(join(root, "maina-system1", S1_VERSION))).toBe(false);
		// The temp directory is gone too.
		expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
	});

	test("a release signed with another key is refused", async () => {
		const root = freshRoot();
		const other = buildSystem1Release(devKey().privatePem);
		const { input } = source(root, other.files);
		const pulled = await pullModel({
			...input,
			pin: pinOn(other.manifestBytes, S1_VERSION),
		});
		expect(pulled.ok).toBe(false);
		if (!pulled.ok) expect(pulled.error.message).toContain("signature");
	});

	test("a manifest that is not the pinned one is refused before any file is fetched", async () => {
		const root = freshRoot();
		const { host, input } = source(root);
		const pulled = await pullModel({
			...input,
			pin: { ...input.pin, manifestSha256: "0".repeat(64) },
		});
		expect(pulled.ok).toBe(false);
		expect(host.requests.every((u) => u.endsWith("/manifest.json"))).toBe(true);
	});

	test("nothing is fetched while no release is pinned", async () => {
		const root = freshRoot();
		const { host, input } = source(root);
		const pulled = await pullModel({
			...input,
			pin: {
				name: "maina-system1",
				version: null,
				manifestSha256: null,
				baseUrl: input.pin.baseUrl,
			},
		});
		expect(pulled.ok).toBe(false);
		if (!pulled.ok) expect(pulled.error.kind).toBe("unpinned");
		expect(host.requests).toEqual([]);
	});

	test("a missing asset is a fetch failure, not a throw", async () => {
		const root = freshRoot();
		const partial = new Map(release.files);
		partial.delete("tokenizer.json");
		const { input } = source(root, partial);
		const pulled = await pullModel(input);
		expect(pulled.ok).toBe(false);
		if (!pulled.ok) {
			expect(pulled.error.kind).toBe("fetch_failed");
			expect(pulled.error.message).toContain("404");
		}
		expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
	});

	test("a cached release that no longer verifies is replaced by a fresh download", async () => {
		const root = freshRoot();
		const { input } = source(root);
		const first = await pullModel(input);
		if (!first.ok) throw new Error(first.error.message);
		writeFileSync(join(first.value.dir, "metadata.json"), "{}");
		expect(verifyCachedModel(input).ok).toBe(false);
		const again = await pullModel(input);
		if (!again.ok) throw new Error(again.error.message);
		expect(again.value.downloaded).toBe(true);
		expect(verifyCachedModel(input).ok).toBe(true);
	});
});

describe("verifyCachedModel", () => {
	test("reports a release that was never pulled", () => {
		const { input } = source(freshRoot());
		const cached = verifyCachedModel(input);
		expect(cached.ok).toBe(false);
		if (!cached.ok) {
			expect(cached.error.kind).toBe("not_installed");
			expect(cached.error.message).toContain("maina model pull");
		}
	});

	test("re-verifies every hash and signature of the cached files", async () => {
		const root = freshRoot();
		const { input } = source(root);
		const pulled = await pullModel(input);
		if (!pulled.ok) throw new Error(pulled.error.message);
		expect(verifyCachedModel(input).ok).toBe(true);
		const path = join(pulled.value.dir, "model.int8.onnx");
		const bytes = new Uint8Array(readFileSync(path));
		bytes[0] = (bytes[0] ?? 0) ^ 1;
		writeFileSync(path, bytes);
		const cached = verifyCachedModel(input);
		expect(cached.ok).toBe(false);
		if (!cached.ok) {
			expect(cached.error.kind).toBe("unverified");
			expect(cached.error.message).toBe(
				`model ${S1_VERSION} failed verification (model int8: sha256 mismatch)`,
			);
		}
	});

	test("finds a release pulled outside the plugin, in ~/.maina/models (#620)", async () => {
		const home = freshRoot();
		const plugin = freshRoot();
		const { host, input } = source(home);
		const pulled = await pullModel(input);
		if (!pulled.ok) throw new Error(pulled.error.message);
		const asked = host.requests.length;
		const inside = { ...input, root: plugin, fallbackRoots: [home] };
		const cached = verifyCachedModel(inside);
		if (!cached.ok) throw new Error(cached.error.message);
		expect(cached.value.dir).toBe(pulled.value.dir);
		// A pull from inside the plugin downloads nothing again.
		const again = await pullModel(inside);
		if (!again.ok) throw new Error(again.error.message);
		expect(again.value.downloaded).toBe(false);
		expect(again.value.dir).toBe(pulled.value.dir);
		expect(host.requests.length).toBe(asked);
		expect(existsSync(plugin)).toBe(false);
	});

	test("a tampered fallback copy is reported, not hidden as not installed (#620)", async () => {
		const home = freshRoot();
		const { input } = source(home);
		const pulled = await pullModel(input);
		if (!pulled.ok) throw new Error(pulled.error.message);
		writeFileSync(join(pulled.value.dir, "metadata.json"), "{}");
		const cached = verifyCachedModel({
			...input,
			root: freshRoot(),
			fallbackRoots: [home],
		});
		expect(cached.ok).toBe(false);
		if (!cached.ok) expect(cached.error.kind).toBe("unverified");
	});
});
