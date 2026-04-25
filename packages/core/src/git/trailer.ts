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

/** Returns true if the message already contains a `Verified-by: Maina@sha256:...` trailer. */
export function hasVerifiedByTrailer(message: string): boolean {
	return VERIFIED_BY_PATTERN.test(message);
}

/**
 * Append a `Verified-by: Maina@sha256:<hash>` trailer to a commit message.
 *
 * Idempotent: if the message already has one, the message is returned
 * unchanged. If it has a different sha256 in an existing trailer, the
 * existing line is replaced (single source of truth — re-verify wins).
 */
export function appendVerifiedByTrailer(message: string, hash: string): string {
	if (!/^[0-9a-f]{64}$/.test(hash)) {
		throw new Error(`Invalid sha256 hash for trailer: ${hash}`);
	}
	const trailer = `Verified-by: Maina@sha256:${hash}`;

	// Replace existing Verified-by line, keeping all other trailers + body.
	if (VERIFIED_BY_PATTERN.test(message)) {
		return message.replace(VERIFIED_BY_PATTERN, trailer);
	}

	const trimmed = message.trimEnd();
	if (trimmed.length === 0) {
		return `${trailer}\n`;
	}

	// If the last paragraph already looks like trailers (Key: value lines),
	// append to it. Otherwise add a blank line separator first.
	if (lastParagraphIsTrailers(trimmed)) {
		return `${trimmed}\n${trailer}\n`;
	}
	return `${trimmed}\n\n${trailer}\n`;
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
 * it can still record a stable proof identity). */
export function computeProofHash(value: unknown): string {
	const c = canonicalize(value);
	if (!c.ok) {
		throw new Error(`Cannot compute proof hash: ${c.message}`);
	}
	return createHash("sha256").update(c.data).digest("hex");
}
