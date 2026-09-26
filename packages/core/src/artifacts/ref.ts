/**
 * Artifact references (FR-FAC-6). Large evidence (plans, memos, logs, diffs)
 * moves between workflow steps as an id plus a content hash, never pasted
 * into a prompt, so every step stays small and auditable: whoever reads the
 * artifact checks it is byte-for-byte what the ref was taken over.
 *
 * Pure: no I/O. `store.ts` keeps the bytes.
 */

import { createHash } from "node:crypto";
import type { Result } from "../db/index";

export type ArtifactRef = Readonly<{
	/** A file name in the artifact store: letters, digits, `.`, `_`, `-`. */
	id: string;
	/** `sha256:<64 hex>` of the content. */
	hash: string;
}>;

export type ArtifactError =
	| Readonly<{ kind: "invalid_id"; id: string }>
	| Readonly<{ kind: "invalid_hash"; hash: string }>
	| Readonly<{ kind: "not_found"; id: string }>
	| Readonly<{
			kind: "hash_mismatch";
			id: string;
			expected: string;
			actual: string;
	  }>
	| Readonly<{ kind: "conflict"; id: string }>
	| Readonly<{ kind: "io"; id: string; message: string }>;

/** No leading dot and no separators, so an id never leaves the store. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** `sha256:<64 hex>` of `content` (UTF-8). */
export function hashArtifact(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function artifactRef(
	id: string,
	hash: string,
): Result<ArtifactRef, ArtifactError> {
	if (!ID_PATTERN.test(id))
		return { ok: false, error: { kind: "invalid_id", id } };
	if (!HASH_PATTERN.test(hash)) {
		return { ok: false, error: { kind: "invalid_hash", hash } };
	}
	return { ok: true, value: { id, hash } };
}

/** `content` when it hashes to `ref.hash`; a `hash_mismatch` otherwise. */
export function checkArtifact(
	ref: ArtifactRef,
	content: string,
): Result<string, ArtifactError> {
	const actual = hashArtifact(content);
	return actual === ref.hash
		? { ok: true, value: content }
		: {
				ok: false,
				error: {
					kind: "hash_mismatch",
					id: ref.id,
					expected: ref.hash,
					actual,
				},
			};
}
