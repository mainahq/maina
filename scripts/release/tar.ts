/**
 * A minimal, deterministic ustar + gzip writer and reader for the plugin
 * archives (v1 task 9.7). Pure. `Bun.Archive` drops file modes, and a plugin
 * whose `launcher/launch.sh` is not executable cannot start: hosts run it by
 * path. Every entry gets mtime 0 and owner 0, so the same files always make
 * the same bytes and the same signature.
 */

import { gunzipSync, gzipSync } from "bun";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

export type TarEntry = Readonly<{
	path: string;
	content: string | Uint8Array;
	executable: boolean;
}>;

export type ReadEntry = Readonly<{
	path: string;
	content: Uint8Array;
	executable: boolean;
}>;

type TarError = Readonly<
	{ kind: "path_too_long"; path: string } | { kind: "not_a_tar" }
>;

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** ustar splits a long path into a prefix (155 bytes) and a name (100). */
function splitPath(path: string): readonly [string, string] | null {
	if (encoder.encode(path).length <= 100) return ["", path];
	for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
		const prefix = path.slice(0, i);
		const name = path.slice(i + 1);
		if (
			encoder.encode(prefix).length <= 155 &&
			encoder.encode(name).length <= 100
		)
			return [prefix, name];
	}
	return null;
}

const octal = (value: number, width: number): string =>
	`${value.toString(8).padStart(width - 1, "0")}\0`;

function header(
	prefix: string,
	name: string,
	size: number,
	mode: number,
): Uint8Array {
	const block = new Uint8Array(BLOCK);
	const put = (offset: number, text: string) =>
		block.set(encoder.encode(text), offset);
	put(0, name);
	put(100, octal(mode, 8));
	put(108, octal(0, 8));
	put(116, octal(0, 8));
	put(124, octal(size, 12));
	put(136, octal(0, 12));
	put(148, "        ");
	put(156, "0");
	put(257, "ustar\u000000");
	put(345, prefix);
	const sum = block.reduce((acc, byte) => acc + byte, 0);
	put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
	return block;
}

/** A gzipped ustar archive of `entries`, in the order given. */
export function tarGz(
	entries: readonly TarEntry[],
): Result<Uint8Array, TarError> {
	const parts: Uint8Array[] = [];
	for (const entry of entries) {
		const split = splitPath(entry.path);
		if (split === null) {
			return { ok: false, error: { kind: "path_too_long", path: entry.path } };
		}
		const content =
			typeof entry.content === "string"
				? encoder.encode(entry.content)
				: entry.content;
		parts.push(
			header(
				split[0],
				split[1],
				content.length,
				entry.executable ? 0o755 : 0o644,
			),
		);
		parts.push(content);
		const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
		parts.push(new Uint8Array(pad));
	}
	parts.push(new Uint8Array(BLOCK * 2));
	const total = parts.reduce((n, p) => n + p.length, 0);
	const tar = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		tar.set(p, offset);
		offset += p.length;
	}
	return { ok: true, value: gzipSync(tar, { level: 9 }) };
}

const field = (block: Uint8Array, offset: number, width: number): string => {
	const raw = block.subarray(offset, offset + width);
	const end = raw.indexOf(0);
	return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
};

/** The regular files of a gzipped ustar archive. */
export function untarGz(
	bytes: Uint8Array,
): Result<readonly ReadEntry[], TarError> {
	let tar: Uint8Array;
	try {
		tar = gunzipSync(new Uint8Array(bytes));
	} catch {
		return { ok: false, error: { kind: "not_a_tar" } };
	}
	const entries: ReadEntry[] = [];
	let offset = 0;
	while (offset + BLOCK <= tar.length) {
		const block = tar.subarray(offset, offset + BLOCK);
		if (block.every((b) => b === 0)) return { ok: true, value: entries };
		if (field(block, 257, 6) !== "ustar") {
			return { ok: false, error: { kind: "not_a_tar" } };
		}
		const size = Number.parseInt(field(block, 124, 12).trim(), 8);
		const mode = Number.parseInt(field(block, 100, 8).trim(), 8);
		const prefix = field(block, 345, 155);
		const name = field(block, 0, 100);
		const start = offset + BLOCK;
		if (field(block, 156, 1) === "0" || field(block, 156, 1) === "") {
			entries.push({
				path: prefix === "" ? name : `${prefix}/${name}`,
				content: tar.slice(start, start + size),
				executable: (mode & 0o111) !== 0,
			});
		}
		offset = start + Math.ceil(size / BLOCK) * BLOCK;
	}
	return { ok: false, error: { kind: "not_a_tar" } };
}
