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

type CanonicalizeResult =
	| { ok: true; data: string }
	| {
			ok: false;
			code: "unsupported-type" | "non-finite-number" | "cyclic-reference";
			message: string;
	  };

/**
 * Total, non-throwing canonicalization. Returns a Result — every code path
 * produces either a canonical string or a structured error, so callers don't
 * have to wrap in try/catch. The first unsupported value found (depth-first,
 * in canonical key order) short-circuits the walk. A value that contains
 * itself comes back as `cyclic-reference` instead of overflowing the stack;
 * shared references that are not cycles canonicalize normally.
 */
export function canonicalize(value: unknown): CanonicalizeResult {
	return canonicalizeWithin(value, []);
}

/** `ancestors` holds the arrays/objects on the path from the root to `value`. */
function canonicalizeWithin(
	value: unknown,
	ancestors: ReadonlyArray<object>,
): CanonicalizeResult {
	if (value === null) return { ok: true, data: "null" };
	if (typeof value === "boolean") {
		return { ok: true, data: value ? "true" : "false" };
	}
	if (typeof value === "number") {
		return Number.isFinite(value)
			? { ok: true, data: JSON.stringify(value) }
			: {
					ok: false,
					code: "non-finite-number",
					message: `Cannot canonicalize non-finite number: ${value}`,
				};
	}
	if (typeof value === "string")
		return { ok: true, data: JSON.stringify(value) };
	if (typeof value === "object" && ancestors.includes(value)) {
		return {
			ok: false,
			code: "cyclic-reference",
			message: "Cannot canonicalize a value that contains itself",
		};
	}
	const path = typeof value === "object" ? [...ancestors, value] : ancestors;
	if (Array.isArray(value)) {
		// Array.from visits holes as `undefined` (unsupported), where `map`
		// would skip them and leave a gap that `joinAll` cannot call.
		return joinAll(
			Array.from(value, (item) => () => canonicalizeWithin(item, path)),
			"[",
			"]",
		);
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return joinAll(
			entries.map(([k, v]) => () => {
				const inner = canonicalizeWithin(v, path);
				return inner.ok
					? { ok: true, data: `${JSON.stringify(k)}:${inner.data}` }
					: inner;
			}),
			"{",
			"}",
		);
	}
	return {
		ok: false,
		code: "unsupported-type",
		message: `Cannot canonicalize value of type ${typeof value}`,
	};
}

/**
 * Evaluate each part lazily and join the canonical strings, stopping at the
 * first error so a bad value deep in a large structure costs no extra work.
 */
function joinAll(
	parts: ReadonlyArray<() => CanonicalizeResult>,
	open: string,
	close: string,
): CanonicalizeResult {
	const out: string[] = [];
	for (const part of parts) {
		const result = part();
		if (!result.ok) return result;
		out.push(result.data);
	}
	return { ok: true, data: `${open}${out.join(",")}${close}` };
}
