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

// Same shape, line-bound (no /m), used to test individual lines after splitting.
const LINE_VERIFIED_BY_PATTERN =
	/^Verified-by:[ \t]*Maina@sha256:[0-9a-f]{64}[ \t]*$/;

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
		// Collapse N existing Verified-by trailers into exactly one carrying
		// `hash`. Line-based filter — no in-band sentinel that could collide
		// with real commit message content.
		const lines = message.split("\n");
		const filtered: string[] = [];
		let kept = false;
		for (const line of lines) {
			if (LINE_VERIFIED_BY_PATTERN.test(line)) {
				if (!kept) {
					filtered.push(trailer);
					kept = true;
				}
				continue;
			}
			filtered.push(line);
		}
		return { ok: true, data: filtered.join("\n") };
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
