/**
 * `scripts/link/sync-protocol.ts` (#589, cloud adr/0009): fetches a
 * published Maina Link protocol version, checks the manifest against the pin
 * it is given and every file against the manifest, and only then replaces
 * the vendored directory. Served here from the vendored copy itself.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINK_V1_MANIFEST_SHA256 } from "../../../packages/runtime/src/link/protocol/pin";
import { type SyncFetch, syncProtocol } from "../sync-protocol";

const V1 = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"packages",
	"runtime",
	"src",
	"link",
	"protocol",
	"v1",
);
const BASE = "https://api.cloud.test";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-link-sync-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Serves the vendored v1 files as the cloud's schema route does. */
function servedFrom(
	root: string,
	tamper?: (
		path: string,
		bytes: Uint8Array<ArrayBuffer>,
	) => Uint8Array<ArrayBuffer>,
): { fetch: SyncFetch; urls: string[] } {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (url) => {
			urls.push(url);
			const u = new URL(url);
			const path = u.pathname.replace(/^\/link\/v1\/schemas\//, "");
			const file = join(root, path);
			if (!existsSync(file)) return new Response("missing", { status: 404 });
			const bytes = new Uint8Array(readFileSync(file));
			return new Response(tamper ? tamper(path, bytes) : bytes);
		},
	};
}

describe("syncProtocol", () => {
	test("writes a verified copy of the pinned version and asks each file by its hash", async () => {
		const out = join(dir, "v1");
		const { fetch, urls } = servedFrom(V1);
		const synced = await syncProtocol({
			fetch,
			baseUrl: BASE,
			pin: LINK_V1_MANIFEST_SHA256,
			outDir: out,
		});
		expect(synced.ok).toBe(true);
		if (!synced.ok) return;
		expect(synced.value.files).toBeGreaterThan(10);
		expect(readFileSync(join(out, "privacy.json"))).toEqual(
			readFileSync(join(V1, "privacy.json")),
		);
		expect(readFileSync(join(out, "manifest.json"))).toEqual(
			readFileSync(join(V1, "manifest.json")),
		);
		expect(urls[0]).toBe(`${BASE}/link/v1/schemas/manifest.json`);
		expect(urls.slice(1).every((u) => /\?sha256=[0-9a-f]{64}$/.test(u))).toBe(
			true,
		);
	});

	test("a manifest that is not the pinned one writes nothing", async () => {
		const out = join(dir, "v1");
		const { fetch } = servedFrom(V1);
		const synced = await syncProtocol({
			fetch,
			baseUrl: BASE,
			pin: "0".repeat(64),
			outDir: out,
		});
		expect(synced.ok).toBe(false);
		if (!synced.ok) expect(synced.error.kind).toBe("pin_mismatch");
		expect(existsSync(out)).toBe(false);
	});

	test("a file that does not match the manifest writes nothing and keeps the old copy", async () => {
		const out = join(dir, "v1");
		mkdirSync(out);
		writeFileSync(join(out, "keep.json"), "{}");
		const { fetch } = servedFrom(V1, (path, bytes) =>
			path === "privacy.json" ? new Uint8Array([...bytes, 0x20]) : bytes,
		);
		const synced = await syncProtocol({
			fetch,
			baseUrl: BASE,
			pin: LINK_V1_MANIFEST_SHA256,
			outDir: out,
		});
		expect(synced.ok).toBe(false);
		if (!synced.ok) {
			expect(synced.error.kind).toBe("file_mismatch");
			expect(JSON.stringify(synced.error)).toContain("privacy.json");
		}
		expect(existsSync(join(out, "keep.json"))).toBe(true);
		expect(existsSync(join(out, "privacy.json"))).toBe(false);
	});

	test("an unreachable cloud is an error, not a throw", async () => {
		const synced = await syncProtocol({
			fetch: async () => {
				throw new Error("offline");
			},
			baseUrl: BASE,
			pin: LINK_V1_MANIFEST_SHA256,
			outDir: join(dir, "v1"),
		});
		expect(synced.ok).toBe(false);
		if (!synced.ok) expect(synced.error.kind).toBe("fetch_failed");
	});
});
