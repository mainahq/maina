/**
 * The pinned System 1 model release (#573). Model releases are hosted as
 * `model-v*` GitHub Releases on mainahq/maina; `packages/runtime/model.json`
 * pins `{name, version, manifestSha256, baseUrl}` and the runtime refuses
 * any manifest that does not match it, which also blocks a rollback to a
 * withdrawn release. No real release exists yet, so these tests serve
 * fixture releases from `fixtures/releases/`.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import shipped from "../../../model.json" with { type: "json" };
import {
	checkPinnedManifest,
	fetchPinnedManifest,
	type ModelPin,
	parseModelPin,
	releaseUrl,
	SHIPPED_PIN,
} from "../pin";

const RELEASES = join(import.meta.dir, "fixtures", "releases");
const GITHUB = "https://github.com/mainahq/maina/releases/download";

const manifestBytes = (version: string): Uint8Array<ArrayBuffer> =>
	new Uint8Array(
		readFileSync(join(RELEASES, `model-v${version}`, "manifest.json")),
	);

const sha256 = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** A pin on the fixture release `version`, as a release job would write it. */
const pinOn = (version: string): ModelPin => ({
	name: "maina-system1",
	version,
	manifestSha256: sha256(manifestBytes(version)),
	baseUrl: GITHUB,
});

type Served = Readonly<{ fetch: (url: string) => Promise<Response> }> & {
	urls: string[];
};

/** A release host serving the fixture releases at `<GITHUB>/<tag>/<file>`. */
function fixtureHost(
	override: (url: string) => Response | undefined = () => undefined,
): Served {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (url) => {
			urls.push(url);
			const replaced = override(url);
			if (replaced !== undefined) return replaced;
			if (!url.startsWith(`${GITHUB}/`)) {
				return new Response("not found", { status: 404 });
			}
			try {
				return new Response(
					readFileSync(join(RELEASES, url.slice(GITHUB.length + 1))),
				);
			} catch {
				return new Response("not found", { status: 404 });
			}
		},
	};
}

describe("the shipped pin (packages/runtime/model.json)", () => {
	test("parses, names the System 1 model and points at the public releases", () => {
		expect(SHIPPED_PIN.ok).toBe(true);
		if (!SHIPPED_PIN.ok) return;
		expect(SHIPPED_PIN.value.name).toBe("maina-system1");
		expect(SHIPPED_PIN.value.baseUrl).toBe(GITHUB);
	});

	test("holds exactly name, version, manifestSha256 and baseUrl", () => {
		expect(Object.keys(shipped).sort()).toEqual([
			"baseUrl",
			"manifestSha256",
			"name",
			"version",
		]);
	});
});

describe("parseModelPin", () => {
	test("accepts a full pin", () => {
		const pin = pinOn("0.2.0");
		expect(parseModelPin(pin)).toEqual({ ok: true, value: pin });
	});

	test("accepts an unpinned file: no release is pinned yet", () => {
		const unpinned = {
			name: "maina-system1",
			version: null,
			manifestSha256: null,
			baseUrl: GITHUB,
		};
		expect(parseModelPin(unpinned)).toEqual({ ok: true, value: unpinned });
	});

	test.each([
		["a non-object", "pin"],
		[
			"a missing field",
			{ name: "maina-system1", version: "0.2.0", baseUrl: GITHUB },
		],
		["an unknown field", { ...pinOn("0.2.0"), url: GITHUB }],
		["an empty name", { ...pinOn("0.2.0"), name: "" }],
		["a non-semver version", { ...pinOn("0.2.0"), version: "v0.2" }],
		[
			"an upper-case sha256",
			{ ...pinOn("0.2.0"), manifestSha256: "A".repeat(64) },
		],
		["a short sha256", { ...pinOn("0.2.0"), manifestSha256: "ab12" }],
		["a version without a sha256", { ...pinOn("0.2.0"), manifestSha256: null }],
		["a sha256 without a version", { ...pinOn("0.2.0"), version: null }],
		[
			"a plain-http host",
			{
				...pinOn("0.2.0"),
				baseUrl: "http://github.com/mainahq/maina/releases/download",
			},
		],
		["a trailing slash", { ...pinOn("0.2.0"), baseUrl: `${GITHUB}/` }],
		["a query string", { ...pinOn("0.2.0"), baseUrl: `${GITHUB}?x=1` }],
		["a non-URL host", { ...pinOn("0.2.0"), baseUrl: "releases" }],
	])("refuses %s", (_, value) => {
		const parsed = parseModelPin(value);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.kind).toBe("invalid_pin");
		expect(parsed.error.problems.length).toBeGreaterThan(0);
	});
});

describe("releaseUrl", () => {
	test("lays a release out as <baseUrl>/model-v<version>/<asset>", () => {
		expect(releaseUrl(pinOn("0.2.0"), "manifest.json")).toEqual({
			ok: true,
			value: `${GITHUB}/model-v0.2.0/manifest.json`,
		});
		expect(releaseUrl(pinOn("0.2.0"), "manifest.json.sig")).toEqual({
			ok: true,
			value: `${GITHUB}/model-v0.2.0/manifest.json.sig`,
		});
	});

	test("flattens a nested manifest path, since GitHub Release assets are flat", () => {
		expect(
			releaseUrl(pinOn("0.2.0"), "ort/darwin-arm64/onnxruntime_binding.node"),
		).toEqual({
			ok: true,
			value: `${GITHUB}/model-v0.2.0/ort--darwin-arm64--onnxruntime_binding.node`,
		});
	});

	test("gives each target's file its own asset, so none collide", () => {
		const urls = [
			"ort/darwin-arm64/onnxruntime_binding.node",
			"ort/linux-x64/onnxruntime_binding.node",
			"ort/darwin-arm64/libonnxruntime.1.30.0.dylib",
			"wasm/ort-wasm-simd-threaded.wasm",
		].map((file) => releaseUrl(pinOn("0.2.0"), file));
		const values = urls.map((u) => (u.ok ? u.value : ""));
		expect(values.every((v) => v !== "")).toBe(true);
		expect(new Set(values).size).toBe(values.length);
	});

	test.each([
		"../model-v0.1.0/manifest.json",
		"/etc/passwd",
		"ort//x",
		"",
		"a/./b",
		"a?b",
		"https://evil.example/manifest.json",
		// Would make the flattened asset name ambiguous or be renamed by GitHub.
		"a--b/c",
		"a-/b",
		"a/-b",
		".hidden",
		"trailing.",
	])("refuses the unsafe path %p", (file) => {
		const url = releaseUrl(pinOn("0.2.0"), file);
		expect(url.ok).toBe(false);
		if (url.ok) return;
		expect(url.error).toEqual({ kind: "unsafe_path", file });
	});
});

describe("checkPinnedManifest", () => {
	test("accepts the exact pinned manifest", () => {
		const bytes = manifestBytes("0.2.0");
		expect(checkPinnedManifest(pinOn("0.2.0"), bytes)).toEqual({
			ok: true,
			value: { name: "maina-system1", version: "0.2.0", bytes },
		});
	});

	test("refuses a pinned version whose manifest bytes changed", () => {
		const text = new TextDecoder()
			.decode(manifestBytes("0.2.0"))
			.replace('"dryRun": true', '"dryRun": false');
		const checked = checkPinnedManifest(
			pinOn("0.2.0"),
			new TextEncoder().encode(text),
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(checked.error.kind).toBe("mismatch");
		expect(checked.error.message).toContain("sha256");
	});

	test("refuses a rollback to a withdrawn release, even a well-formed one", () => {
		const checked = checkPinnedManifest(pinOn("0.2.0"), manifestBytes("0.1.0"));
		expect(checked.ok).toBe(false);
		if (checked.ok || checked.error.kind !== "mismatch") return;
		expect(checked.error.problems).toContain(
			"manifest version 0.1.0, pinned 0.2.0",
		);
		expect(checked.error.problems.some((p) => p.includes("sha256"))).toBe(true);
	});

	test("refuses a manifest whose name is not the pinned name", () => {
		const pin = { ...pinOn("0.2.0"), name: "maina-other" };
		const checked = checkPinnedManifest(pin, manifestBytes("0.2.0"));
		expect(checked.ok).toBe(false);
		if (checked.ok || checked.error.kind !== "mismatch") return;
		expect(checked.error.problems).toEqual([
			"manifest name maina-system1, pinned maina-other",
		]);
	});

	test("refuses bytes that are not a JSON manifest", () => {
		const bytes = new TextEncoder().encode("<html>not found</html>");
		const pin = { ...pinOn("0.2.0"), manifestSha256: sha256(bytes) };
		const checked = checkPinnedManifest(pin, bytes);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(checked.error.kind).toBe("mismatch");
	});

	test("refuses every manifest while no release is pinned", () => {
		const unpinned = {
			name: "maina-system1",
			version: null,
			manifestSha256: null,
			baseUrl: GITHUB,
		} as const;
		const checked = checkPinnedManifest(unpinned, manifestBytes("0.2.0"));
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(checked.error.kind).toBe("unpinned");
	});
});

describe("fetchPinnedManifest", () => {
	test("downloads the pinned manifest from the public release host", async () => {
		const host = fixtureHost();
		const fetched = await fetchPinnedManifest(pinOn("0.2.0"), host.fetch);
		expect(host.urls).toEqual([`${GITHUB}/model-v0.2.0/manifest.json`]);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) expect(fetched.value.version).toBe("0.2.0");
	});

	test("refuses a host that serves a withdrawn release under the pinned tag", async () => {
		const host = fixtureHost((url) =>
			url.endsWith("/model-v0.2.0/manifest.json")
				? new Response(manifestBytes("0.1.0"))
				: undefined,
		);
		const fetched = await fetchPinnedManifest(pinOn("0.2.0"), host.fetch);
		expect(fetched.ok).toBe(false);
		if (!fetched.ok) expect(fetched.error.kind).toBe("mismatch");
	});

	test("reports a release that is not on the host", async () => {
		const host = fixtureHost();
		const pin = { ...pinOn("0.2.0"), version: "9.9.9" };
		const fetched = await fetchPinnedManifest(pin, host.fetch);
		expect(fetched.ok).toBe(false);
		if (fetched.ok || fetched.error.kind !== "fetch_failed") return;
		expect(fetched.error.url).toBe(`${GITHUB}/model-v9.9.9/manifest.json`);
		expect(fetched.error.message).toContain("404");
	});

	test("reports a network failure instead of rejecting", async () => {
		const fetched = await fetchPinnedManifest(pinOn("0.2.0"), async () => {
			throw new Error("getaddrinfo ENOTFOUND github.com");
		});
		expect(fetched.ok).toBe(false);
		if (fetched.ok) return;
		expect(fetched.error.kind).toBe("fetch_failed");
		expect(fetched.error.message).toContain("ENOTFOUND");
	});

	test("refuses a response too large to be a manifest", async () => {
		const host = fixtureHost(
			() => new Response(new Uint8Array(2 * 1024 * 1024)),
		);
		const fetched = await fetchPinnedManifest(pinOn("0.2.0"), host.fetch);
		expect(fetched.ok).toBe(false);
		if (!fetched.ok) expect(fetched.error.kind).toBe("fetch_failed");
	});

	test("does not touch the network while no release is pinned", async () => {
		const host = fixtureHost();
		const fetched = await fetchPinnedManifest(
			{
				name: "maina-system1",
				version: null,
				manifestSha256: null,
				baseUrl: GITHUB,
			},
			host.fetch,
		);
		expect(host.urls).toEqual([]);
		expect(fetched.ok).toBe(false);
		if (!fetched.ok) expect(fetched.error.kind).toBe("unpinned");
	});
});
