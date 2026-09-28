/**
 * Checks a Maina Link protocol directory against its pinned manifest (#589,
 * cloud adr/0009). Pure: the caller reads the bytes.
 *
 * `manifest.json` is `{ protocol: "maina-link", v, files: { <path>:
 * { sha256, bytes } } }`. The manifest itself must hash to the pin; then
 * every listed file must exist with exactly that sha256 and size, and no
 * other file may sit beside them.
 */

import { createHash } from "node:crypto";
import type { Result } from "@mainahq/core";

type ManifestEntry = Readonly<{ sha256: string; bytes: number }>;

type ProtocolManifest = Readonly<{
	protocol: "maina-link";
	v: number;
	files: Readonly<Record<string, ManifestEntry>>;
}>;

type ManifestRefusal =
	| Readonly<{ kind: "pin_mismatch"; expected: string; actual: string }>
	| Readonly<{ kind: "invalid_manifest"; problems: readonly string[] }>;

type ProtocolDirRefusal = Readonly<{
	kind: "protocol_mismatch";
	problems: readonly string[];
}>;

/** The manifest's own name inside the protocol directory. */
export const MANIFEST_FILE = "manifest.json";

const HEX64 = /^[0-9a-f]{64}$/;
/** Relative, `/`-separated, no `.`/`..` segment, no leading dot or dash. */
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(bytes: Uint8Array): Result<unknown, string> {
	try {
		return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function entryProblems(path: string, entry: unknown): string[] {
	const problems: string[] = [];
	if (!SAFE_PATH.test(path) || path.includes("..") || path === MANIFEST_FILE) {
		problems.push(`unsafe path ${JSON.stringify(path)}`);
	}
	if (!isRecord(entry)) return [...problems, `${path}: not an object`];
	if (typeof entry.sha256 !== "string" || !HEX64.test(entry.sha256)) {
		problems.push(`${path}: sha256 is not 64 hex digits`);
	}
	if (
		typeof entry.bytes !== "number" ||
		!Number.isSafeInteger(entry.bytes) ||
		entry.bytes < 0
	) {
		problems.push(`${path}: bytes is not a size`);
	}
	return problems;
}

/** The manifest, when `bytes` hash to `pin` and parse as a manifest. */
export function checkManifest(
	bytes: Uint8Array,
	pin: string,
): Result<ProtocolManifest, ManifestRefusal> {
	const actual = sha256Hex(bytes);
	if (actual !== pin) {
		return {
			ok: false,
			error: { kind: "pin_mismatch", expected: pin, actual },
		};
	}
	const parsed = parseJson(bytes);
	if (!parsed.ok) {
		return {
			ok: false,
			error: { kind: "invalid_manifest", problems: [parsed.error] },
		};
	}
	const value = parsed.value;
	if (!isRecord(value) || !isRecord(value.files)) {
		return {
			ok: false,
			error: { kind: "invalid_manifest", problems: ["no files map"] },
		};
	}
	const problems: string[] = [];
	if (value.protocol !== "maina-link")
		problems.push("protocol is not maina-link");
	if (typeof value.v !== "number") problems.push("v is not a number");
	for (const [path, entry] of Object.entries(value.files)) {
		problems.push(...entryProblems(path, entry));
	}
	if (problems.length > 0) {
		return { ok: false, error: { kind: "invalid_manifest", problems } };
	}
	return { ok: true, value: value as ProtocolManifest };
}

/** Why `bytes` are not the file `path` the manifest lists, or null. */
export function fileProblem(
	manifest: ProtocolManifest,
	path: string,
	bytes: Uint8Array | null,
): string | null {
	const entry = manifest.files[path];
	if (entry === undefined) return `${path}: not in the manifest`;
	if (bytes === null) return `${path}: missing`;
	const actual = sha256Hex(bytes);
	if (actual !== entry.sha256) {
		return `${path}: sha256 ${actual}, manifest says ${entry.sha256}`;
	}
	if (bytes.length !== entry.bytes) {
		return `${path}: ${bytes.length} bytes, manifest says ${entry.bytes}`;
	}
	return null;
}

/**
 * Checks a whole protocol directory: `read` returns a file's bytes (null
 * when absent), `list` every file in it as a relative `/` path.
 */
export function verifyProtocolDir(
	read: (path: string) => Uint8Array | null,
	list: () => readonly string[],
	pin: string,
): Result<ProtocolManifest, ProtocolDirRefusal> {
	const manifestBytes = read(MANIFEST_FILE);
	if (manifestBytes === null) {
		return {
			ok: false,
			error: {
				kind: "protocol_mismatch",
				problems: ["manifest.json: missing"],
			},
		};
	}
	const manifest = checkManifest(manifestBytes, pin);
	if (!manifest.ok) {
		const e = manifest.error;
		const problems =
			e.kind === "pin_mismatch"
				? [`manifest.json: sha256 ${e.actual}, pinned ${e.expected}`]
				: e.problems;
		return { ok: false, error: { kind: "protocol_mismatch", problems } };
	}
	const problems: string[] = [];
	for (const path of Object.keys(manifest.value.files)) {
		const problem = fileProblem(manifest.value, path, read(path));
		if (problem !== null) problems.push(problem);
	}
	for (const path of list()) {
		if (path !== MANIFEST_FILE && manifest.value.files[path] === undefined) {
			problems.push(`${path}: not in the manifest`);
		}
	}
	if (problems.length > 0) {
		return { ok: false, error: { kind: "protocol_mismatch", problems } };
	}
	return manifest;
}
