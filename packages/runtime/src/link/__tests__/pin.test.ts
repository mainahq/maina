/**
 * The vendored Maina Link protocol v1 (#589, cloud adr/0009).
 *
 * `protocol/v1/` is a byte-for-byte copy of the cloud's published
 * `protocol/link/v1/`, and `protocol/pin.ts` pins the sha256 of its
 * `manifest.json`. These tests fail when a vendored file drifts from the
 * manifest, when the manifest drifts from the pin, when a wire type is
 * declared anywhere but under `link/protocol` (the cloud defines every wire
 * shape, Global Constraint 8), and when a Link module reaches for anything
 * the Node build cannot load.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	cpSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { Glob } from "bun";
import { testTmpDir } from "../../__tests__/test-tmp";
import { checkManifest, verifyProtocolDir } from "../protocol/manifest";
import { LINK_V1_MANIFEST_SHA256 } from "../protocol/pin";

const LINK = join(import.meta.dir, "..");
const V1 = join(LINK, "protocol", "v1");
const PACKAGES = join(LINK, "..", "..", "..");

const sha256 = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** Every file under `dir`, as `/`-separated paths relative to it. */
function listFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			const full = join(d, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(relative(dir, full).split(sep).join("/"));
		}
	};
	walk(dir);
	return out.sort();
}

function dirReader(dir: string) {
	return {
		read: (path: string): Uint8Array | null => {
			try {
				return new Uint8Array(readFileSync(join(dir, path)));
			} catch {
				return null;
			}
		},
		list: () => listFiles(dir),
	};
}

describe("vendored protocol v1", () => {
	test("manifest.json hashes to the pin in protocol/pin.ts", () => {
		const bytes = new Uint8Array(readFileSync(join(V1, "manifest.json")));
		expect(sha256(bytes)).toBe(LINK_V1_MANIFEST_SHA256);
		const manifest = checkManifest(bytes, LINK_V1_MANIFEST_SHA256);
		expect(manifest.ok).toBe(true);
	});

	test("every vendored file matches its manifest hash and size, and nothing else is vendored", () => {
		const manifest = JSON.parse(
			readFileSync(join(V1, "manifest.json"), "utf-8"),
		) as { files: Record<string, { sha256: string; bytes: number }> };
		const listed = Object.keys(manifest.files).sort();
		expect(listFiles(V1)).toEqual([...listed, "manifest.json"].sort());
		for (const [path, entry] of Object.entries(manifest.files)) {
			const bytes = new Uint8Array(readFileSync(join(V1, path)));
			expect({ path, sha256: sha256(bytes), bytes: bytes.length }).toEqual({
				path,
				sha256: entry.sha256,
				bytes: entry.bytes,
			});
		}
		const { read, list } = dirReader(V1);
		const verified = verifyProtocolDir(read, list, LINK_V1_MANIFEST_SHA256);
		expect(verified.ok).toBe(true);
	});

	test("a vendored file that drifts from the manifest fails the check", () => {
		const dir = testTmpDir("maina-link-pin-");
		try {
			cpSync(V1, dir, { recursive: true });
			const target = join(dir, "privacy.json");
			writeFileSync(target, `${readFileSync(target, "utf-8")} `);
			writeFileSync(join(dir, "extra.json"), "{}");
			const { read, list } = dirReader(dir);
			const verified = verifyProtocolDir(read, list, LINK_V1_MANIFEST_SHA256);
			expect(verified.ok).toBe(false);
			if (verified.ok) return;
			expect(verified.error.problems.join("\n")).toContain("privacy.json");
			expect(verified.error.problems.join("\n")).toContain("extra.json");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a manifest that is not the pinned one is refused", () => {
		const bytes = new Uint8Array(readFileSync(join(V1, "manifest.json")));
		const edited = new Uint8Array([...bytes, 0x0a]);
		const refused = checkManifest(edited, LINK_V1_MANIFEST_SHA256);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.kind).toBe("pin_mismatch");
	});

	test("a manifest path that escapes the protocol dir is refused", () => {
		const manifest = {
			protocol: "maina-link",
			v: 1,
			files: { "../evil.json": { sha256: "0".repeat(64), bytes: 2 } },
		};
		const bytes = new TextEncoder().encode(JSON.stringify(manifest));
		const refused = checkManifest(bytes, sha256(bytes));
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.kind).toBe("invalid_manifest");
	});
});

// ── Static checks ──────────────────────────────────────────────────────────

/** The wire type names: every schema title the cloud publishes. */
function wireTypeNames(): string[] {
	const names = new Set<string>();
	for (const path of listFiles(V1)) {
		if (!path.endsWith(".schema.json")) continue;
		const schema = JSON.parse(readFileSync(join(V1, path), "utf-8")) as {
			title?: unknown;
		};
		if (typeof schema.title === "string") names.add(schema.title);
	}
	return [...names].sort();
}

/**
 * Declarations of `names`: a type alias, interface, class or enum, or a
 * `<Name>Schema` const (a hand-written validator). `import { type X }` is a
 * use, not a declaration, so an alias must be followed by `=`.
 */
function wireDeclarations(source: string, names: readonly string[]): string[] {
	// Schema titles are identifiers; anything else is dropped, never interpolated.
	const alternatives = names.filter((n) => /^[A-Za-z]\w*$/.test(n)).join("|");
	const pattern = new RegExp(
		[
			`\\btype\\s+(${alternatives})\\s*(?:<[^>]*>)?\\s*=`,
			`\\b(?:interface|class|enum)\\s+(${alternatives})\\b`,
			`\\bconst\\s+(${alternatives})Schema\\b`,
		].join("|"),
		"g",
	);
	return [...source.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

describe("wire types live only under link/protocol", () => {
	const names = wireTypeNames();

	test("the published schemas name the wire types", () => {
		expect(names).toContain("EnrolStart");
		expect(names).toContain("TokenGrant");
		expect(names).toContain("ControlMessage");
	});

	test("the scanner finds a declaration", () => {
		expect(
			wireDeclarations("export type TokenGrant = { a: 1 };", names),
		).toEqual(["TokenGrant"]);
		expect(wireDeclarations("interface EnrolStart {}", names)).toEqual([
			"EnrolStart",
		]);
		expect(wireDeclarations("type TokenGrantish = 1;", names)).toEqual([]);
		expect(
			wireDeclarations('import { type TokenGrant } from "./wire";', names),
		).toEqual([]);
	});

	test("no source outside link/protocol declares a wire type", async () => {
		const offenders: string[] = [];
		const glob = new Glob("*/src/**/*.ts");
		for await (const file of glob.scan({ cwd: PACKAGES })) {
			const path = file.split(sep).join("/");
			if (path.includes("/node_modules/")) continue;
			if (path.startsWith("runtime/src/link/protocol/")) continue;
			if (path.includes("/__tests__/")) continue;
			const found = wireDeclarations(
				readFileSync(join(PACKAGES, file), "utf-8"),
				names,
			);
			for (const name of found) offenders.push(`${path}: ${name}`);
		}
		expect(offenders).toEqual([]);
	});
});

describe("the Node build can load every Link module", () => {
	test("Link sources import only node builtins, core, ajv and each other, and use no Bun API", async () => {
		const offenders: string[] = [];
		const glob = new Glob("**/*.ts");
		for await (const file of glob.scan({ cwd: LINK })) {
			if (file.split(sep).includes("__tests__")) continue;
			const source = readFileSync(join(LINK, file), "utf-8");
			const specifiers = [
				...source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g),
			].map((m) => m[1] ?? "");
			for (const spec of specifiers) {
				const allowed =
					spec.startsWith("node:") ||
					spec === "@mainahq/core" ||
					spec === "ajv/dist/2020" ||
					spec.startsWith("./") ||
					spec.startsWith("../");
				if (!allowed) offenders.push(`${file}: imports ${spec}`);
				if (spec.startsWith("../../")) {
					offenders.push(`${file}: reaches outside link/ (${spec})`);
				}
			}
			if (/\bBun\.[A-Za-z]|["']bun:|from ["']bun["']/.test(source)) {
				offenders.push(`${file}: uses a Bun-only API`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
