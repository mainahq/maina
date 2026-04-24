/**
 * JSON canonicalization for receipt integrity.
 *
 * Sorts object keys lexicographically (depth-first) and serializes with
 * JSON.stringify. This is RFC 8785 compliant for the receipt v1 subset:
 * strings, integers, booleans, nulls, arrays, and nested objects.
 *
 * NOT supported (would need a stricter impl if added to v2): non-integer
 * numbers (floats with exponents), surrogate pairs in strings beyond what
 * JSON.stringify emits, NaN/Infinity (banned by JSON anyway).
 *
 * If any field is found to contain a non-integer number, the receipt
 * schema should reject it at validation time, so canonical output stays
 * deterministic in practice.
 */

export function canonicalize(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error(`Cannot canonicalize non-finite number: ${value}`);
		}
		return JSON.stringify(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(canonicalize).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
			.join(",")}}`;
	}
	throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}
