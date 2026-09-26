/**
 * The artifact store (FR-FAC-6): write-once files under
 * `.maina/artifacts/<id>`, read back only through a ref whose hash they
 * must match. Filesystem access goes through the injected `FsPort`.
 */

import { join } from "node:path";
import type { Result } from "../db/index";
import type { FsPort } from "../ports/fs";
import {
	type ArtifactError,
	type ArtifactRef,
	artifactRef,
	checkArtifact,
	hashArtifact,
} from "./ref";

/** Where the artifact `id` is kept. `id` must be a valid artifact id. */
export function artifactPath(root: string, id: string): string {
	return join(root, ".maina", "artifacts", id);
}

/**
 * Stores `content` under `id` and returns its ref. Artifacts are immutable:
 * putting the same content again is a no-op, different content a `conflict`.
 */
export async function putArtifact(
	fs: FsPort,
	root: string,
	id: string,
	content: string,
): Promise<Result<ArtifactRef, ArtifactError>> {
	const ref = artifactRef(id, hashArtifact(content));
	if (!ref.ok) return ref;
	const path = artifactPath(root, id);
	const existing = await fs.readFile(path);
	if (existing.ok) {
		return existing.value === content
			? ref
			: { ok: false, error: { kind: "conflict", id } };
	}
	if (existing.error.kind !== "not_found") {
		return {
			ok: false,
			error: { kind: "io", id, message: existing.error.message },
		};
	}
	const written = await fs.writeFile(path, content);
	if (!written.ok) {
		const message =
			written.error.kind === "io" ? written.error.message : "write failed";
		return { ok: false, error: { kind: "io", id, message } };
	}
	return ref;
}

/** The content `ref` points at, after checking it still hashes to `ref.hash`. */
export async function getArtifact(
	fs: FsPort,
	root: string,
	ref: ArtifactRef,
): Promise<Result<string, ArtifactError>> {
	const valid = artifactRef(ref.id, ref.hash);
	if (!valid.ok) return valid;
	const read = await fs.readFile(artifactPath(root, ref.id));
	if (!read.ok) {
		return read.error.kind === "not_found"
			? { ok: false, error: { kind: "not_found", id: ref.id } }
			: {
					ok: false,
					error: { kind: "io", id: ref.id, message: read.error.message },
				};
	}
	return checkArtifact(ref, read.value);
}
