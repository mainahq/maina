/**
 * JSON canonicalization for receipt integrity.
 *
 * Sorts object keys lexicographically (depth-first) and serializes with
 * JSON.stringify. RFC 8785 compliant for the receipt v1 subset: strings,
 * integers, booleans, nulls, arrays, and nested objects.
 *
 * NOT supported (v2 may widen): non-integer numbers with exponents,
 * bigints, symbols, functions. The validator in ./verify rejects such
 * values before they reach canonicalization.
 */

export type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue | undefined };

export type CanonicalizeResult =
	| { ok: true; data: string }
	| {
			ok: false;
			code: "unsupported-type" | "non-finite-number";
			message: string;
	  };

/**
 * Total, non-throwing canonicalization. Returns a Result — every code path
 * produces either a canonical string or a structured error, so callers don't
 * have to wrap in try/catch.
 */
export function canonicalize(value: unknown): CanonicalizeResult {
	try {
		return { ok: true, data: canonicalizeUnsafe(value) };
	} catch (e) {
		const err = e as CanonicalizationError;
		return { ok: false, code: err.code, message: err.message };
	}
}

class CanonicalizationError extends Error {
	constructor(
		public readonly code: "unsupported-type" | "non-finite-number",
		message: string,
	) {
		super(message);
	}
}

function canonicalizeUnsafe(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new CanonicalizationError(
				"non-finite-number",
				`Cannot canonicalize non-finite number: ${value}`,
			);
		}
		return JSON.stringify(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeUnsafe).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeUnsafe(v)}`)
			.join(",")}}`;
	}
	throw new CanonicalizationError(
		"unsupported-type",
		`Cannot canonicalize value of type ${typeof value}`,
	);
}
