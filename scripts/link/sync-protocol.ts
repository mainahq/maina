#!/usr/bin/env bun
/**
 * Vendors a published Maina Link protocol version (#589, cloud adr/0009).
 *
 *   bun scripts/link/sync-protocol.ts --pin <manifest sha256> [--base-url <url>] [--out <dir>]
 *   bun scripts/link/sync-protocol.ts --check
 *
 * Sync: fetches `<base>/link/v1/schemas/manifest.json`, refuses it unless
 * its sha256 is the pin, fetches every file it lists as
 * `<path>?sha256=<file sha256>` (the cloud serves only matching bytes, as
 * immutable), checks each file's sha256 and size against the manifest, and
 * only then replaces `packages/runtime/src/link/protocol/v1/` and rewrites
 * the pin in `protocol/pin.ts`. Any mismatch writes nothing.
 *
 * Check: verifies the vendored directory against the pin in `pin.ts`, with
 * no network (the pin test does the same in CI).
 *
 * The base URL defaults to MAINA_CLOUD_URL, else the hosted cloud.
 */

import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { cloudBaseUrl } from "../../packages/core/src/cloud/client";
import type { Result } from "../../packages/core/src/db/index";
import {
	checkManifest,
	fileProblem,
	MANIFEST_FILE,
	verifyProtocolDir,
} from "../../packages/runtime/src/link/protocol/manifest";
import { LINK_V1_MANIFEST_SHA256 } from "../../packages/runtime/src/link/protocol/pin";

export type SyncFetch = (url: string) => Promise<Response>;

type SyncRefusal =
	| Readonly<{ kind: "fetch_failed"; url: string; message: string }>
	| Readonly<{ kind: "pin_mismatch"; expected: string; actual: string }>
	| Readonly<{ kind: "invalid_manifest"; problems: readonly string[] }>
	| Readonly<{ kind: "file_mismatch"; problems: readonly string[] }>
	| Readonly<{ kind: "write_failed"; message: string }>;

type SyncOptions = Readonly<{
	fetch: SyncFetch;
	baseUrl: string;
	pin: string;
	outDir: string;
}>;

const ROOT = resolve(import.meta.dir, "..", "..");
const PROTOCOL = join(ROOT, "packages", "runtime", "src", "link", "protocol");
const DEFAULT_OUT = join(PROTOCOL, "v1");
const PIN_FILE = join(PROTOCOL, "pin.ts");

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function fetchBytes(
	fetch: SyncFetch,
	url: string,
): Promise<Result<Uint8Array, SyncRefusal>> {
	try {
		const res = await fetch(url);
		if (!res.ok) {
			return {
				ok: false,
				error: { kind: "fetch_failed", url, message: `HTTP ${res.status}` },
			};
		}
		return { ok: true, value: new Uint8Array(await res.arrayBuffer()) };
	} catch (e) {
		return {
			ok: false,
			error: { kind: "fetch_failed", url, message: message(e) },
		};
	}
}

/** Writes `files` into a staging dir, then swaps it in for `outDir`. */
function replaceDir(
	outDir: string,
	files: ReadonlyMap<string, Uint8Array>,
): Result<void, SyncRefusal> {
	const staging = `${outDir}.sync-tmp`;
	try {
		rmSync(staging, { recursive: true, force: true });
		for (const [path, bytes] of files) {
			const target = join(staging, ...path.split("/"));
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, bytes);
		}
		rmSync(outDir, { recursive: true, force: true });
		renameSync(staging, outDir);
		return { ok: true, value: undefined };
	} catch (e) {
		rmSync(staging, { recursive: true, force: true });
		return { ok: false, error: { kind: "write_failed", message: message(e) } };
	}
}

/** Fetches, verifies and vendors the version whose manifest hashes to `pin`. */
export async function syncProtocol(
	options: SyncOptions,
): Promise<Result<Readonly<{ files: number }>, SyncRefusal>> {
	const base = `${options.baseUrl.replace(/\/+$/, "")}/link/v1/schemas`;
	const manifestBytes = await fetchBytes(
		options.fetch,
		`${base}/${MANIFEST_FILE}`,
	);
	if (!manifestBytes.ok) return manifestBytes;
	const manifest = checkManifest(manifestBytes.value, options.pin);
	if (!manifest.ok) return manifest;

	const files = new Map<string, Uint8Array>([
		[MANIFEST_FILE, manifestBytes.value],
	]);
	const problems: string[] = [];
	for (const [path, entry] of Object.entries(manifest.value.files)) {
		const bytes = await fetchBytes(
			options.fetch,
			`${base}/${path}?sha256=${entry.sha256}`,
		);
		if (!bytes.ok) return bytes;
		const problem = fileProblem(manifest.value, path, bytes.value);
		if (problem === null) files.set(path, bytes.value);
		else problems.push(problem);
	}
	if (problems.length > 0) {
		return { ok: false, error: { kind: "file_mismatch", problems } };
	}
	const written = replaceDir(options.outDir, files);
	if (!written.ok) return written;
	return { ok: true, value: { files: files.size - 1 } };
}

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
	return out;
}

function readOrNull(path: string): Uint8Array | null {
	try {
		return new Uint8Array(readFileSync(path));
	} catch {
		return null;
	}
}

async function main(): Promise<number> {
	const { values } = parseArgs({
		options: {
			pin: { type: "string" },
			"base-url": { type: "string" },
			out: { type: "string" },
			check: { type: "boolean" },
		},
	});
	if (values.check) {
		const verified = verifyProtocolDir(
			(path) => readOrNull(join(DEFAULT_OUT, path)),
			() => listFiles(DEFAULT_OUT),
			LINK_V1_MANIFEST_SHA256,
		);
		if (!verified.ok) {
			console.error(
				`link protocol v1 drifted from its pin:\n  ${verified.error.problems.join("\n  ")}`,
			);
			return 1;
		}
		console.log(`link protocol v1 matches pin ${LINK_V1_MANIFEST_SHA256}`);
		return 0;
	}
	if (values.pin === undefined || !/^[0-9a-f]{64}$/.test(values.pin)) {
		console.error(
			"usage: bun scripts/link/sync-protocol.ts --pin <sha256> [--base-url <url>] [--out <dir>] | --check",
		);
		return 64;
	}
	const baseUrl =
		values["base-url"] ?? cloudBaseUrl({ get: (name) => process.env[name] });
	const outDir = values.out === undefined ? DEFAULT_OUT : resolve(values.out);
	const synced = await syncProtocol({
		fetch,
		baseUrl,
		pin: values.pin,
		outDir,
	});
	if (!synced.ok) {
		console.error(`sync refused: ${JSON.stringify(synced.error, null, 2)}`);
		return 1;
	}
	if (outDir === DEFAULT_OUT) {
		const source = readFileSync(PIN_FILE, "utf-8");
		writeFileSync(
			PIN_FILE,
			source.replace(
				/(LINK_V1_MANIFEST_SHA256 =\s*")[0-9a-f]{64}(")/,
				`$1${values.pin}$2`,
			),
		);
	}
	console.log(
		`vendored ${synced.value.files} files of link protocol v1 (pin ${values.pin}) into ${outDir}`,
	);
	return 0;
}

if (import.meta.main) process.exit(await main());
