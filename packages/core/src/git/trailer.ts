/**
 * Git trailer helpers — `Verified-by: Maina@sha256:<hash>` and friends.
 *
 * Trailers per https://git-scm.com/docs/git-interpret-trailers — `Key: value`
 * lines in the *last paragraph* of the commit message, separated from the
 * subject + body by a blank line.
 *
 * All helpers are pure + idempotent.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "../receipt/canonical";

// Use [ \t]* (not \s*) so trailing whitespace doesn't gobble line breaks; \s in
// JS includes \n and would consume the line terminator on replace, which makes
// idempotent re-runs change the message length.
const VERIFIED_BY_PATTERN =
	/^Verified-by:[ \t]*Maina@sha256:[0-9a-f]{64}[ \t]*$/m;

/** Global pattern for replaceAll — collapses any number of existing
 * Verified-by lines into one, so duplicates that snuck in get cleaned up. */
const VERIFIED_BY_PATTERN_GLOBAL =
	/^Verified-by:[ \t]*Maina@sha256:[0-9a-f]{64}[ \t]*$/gm;

export type AppendTrailerResult =
	| { ok: true; data: string }
	| { ok: false; code: "invalid-hash"; message: string };

export type ProofHashResult =
	| { ok: true; data: string }
	| { ok: false; code: "canonicalize-failed"; message: string };

/** Returns true if the message already contains a `Verified-by: Maina@sha256:...` trailer. */
export function hasVerifiedByTrailer(message: string): boolean {
	return VERIFIED_BY_PATTERN.test(message);
}

/**
 * Append a `Verified-by: Maina@sha256:<hash>` trailer to a commit message.
 *
 * Idempotent: re-running with the same hash is a no-op. If the message
 * already has one or more `Verified-by` trailers (with any hash), they are
 * collapsed into a single line carrying `hash` — single source of truth.
 *
 * Returns a Result; matches the repo's "never throw" convention.
 */
export function appendVerifiedByTrailer(
	message: string,
	hash: string,
): AppendTrailerResult {
	if (!/^[0-9a-f]{64}$/.test(hash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `Invalid sha256 hash for trailer: ${hash}`,
		};
	}
	const trailer = `Verified-by: Maina@sha256:${hash}`;

	if (VERIFIED_BY_PATTERN.test(message)) {
		// Collapse duplicates into one line, then de-dup blank lines created by
		// removing leading/trailing matches.
		let count = 0;
		const collapsed = message.replace(VERIFIED_BY_PATTERN_GLOBAL, () => {
			count += 1;
			return count === 1 ? trailer : "__MAINA_REMOVE__";
		});
		const cleaned = collapsed
			.replace(/\n__MAINA_REMOVE__/g, "")
			.replace(/__MAINA_REMOVE__\n?/g, "");
		return { ok: true, data: cleaned };
	}

	const trimmed = message.trimEnd();
	if (trimmed.length === 0) {
		return { ok: true, data: `${trailer}\n` };
	}

	if (lastParagraphIsTrailers(trimmed)) {
		return { ok: true, data: `${trimmed}\n${trailer}\n` };
	}
	return { ok: true, data: `${trimmed}\n\n${trailer}\n` };
}

/** Heuristic — last paragraph is "trailer-like" when every non-empty line in
 * it matches the conventional `Key: value` pattern. */
function lastParagraphIsTrailers(message: string): boolean {
	const paragraphs = message.split(/\n{2,}/);
	const last = paragraphs[paragraphs.length - 1];
	if (!last) return false;
	const lines = last.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length === 0) return false;
	return lines.every((l) => /^[A-Z][A-Za-z0-9-]*:\s/.test(l));
}

/** Compute a sha256 hash of an arbitrary value via canonicalized JSON.
 * Suitable for the `Verified-by` trailer when no full receipt is available
 * (e.g. `maina commit` runs verify but doesn't produce a receipt artifact;
 * it can still record a stable proof identity).
 *
 * Returns a Result; matches the repo's "never throw" convention. */
export function computeProofHash(value: unknown): ProofHashResult {
	const c = canonicalize(value);
	if (!c.ok) {
		return {
			ok: false,
			code: "canonicalize-failed",
			message: c.message,
		};
	}
	return {
		ok: true,
		data: createHash("sha256").update(c.data).digest("hex"),
	};
}
