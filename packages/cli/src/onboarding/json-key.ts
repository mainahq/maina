/**
 * Keyed JSON merge: the JSON equivalent of a markdown managed region.
 *
 * JSON cannot carry region comments, so maina owns exactly one key path
 * (for example `mcpServers.maina`). Every other key is kept, and the file is
 * re-serialised with its own indentation and trailing newline, so a file in
 * the usual `JSON.stringify` layout keeps its other bytes unchanged.
 *
 * Fails closed: malformed JSON, or a container of the wrong type on the
 * path (such as `"mcpServers": []`), is reported as `invalid` and never
 * replaced.
 */

type JsonObject = Readonly<Record<string, unknown>>;

type JsonKeyMerge =
	| { readonly kind: "merged"; readonly text: string; readonly hadKey: boolean }
	| { readonly kind: "unchanged" }
	| { readonly kind: "invalid"; readonly reason: string };

function isPlainObject(value: unknown): value is JsonObject {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/** Indent of the first indented line, or two spaces. */
function detectIndent(text: string): string {
	const match = /\n([ \t]+)\S/.exec(text);
	return match?.[1] ?? "  ";
}

function serialise(value: unknown, indent: string, newline: boolean): string {
	return `${JSON.stringify(value, null, indent)}${newline ? "\n" : ""}`;
}

/** A fresh document holding only `value` at `keyPath`. */
export function createJsonKeyText(
	keyPath: readonly string[],
	value: unknown,
): string {
	const doc = keyPath.reduceRight<unknown>(
		(inner, key) => ({ [key]: inner }),
		value,
	);
	return serialise(doc, "  ", true);
}

/** Replace `obj[keyPath]` with `value`, cloning along the path. */
function setAt(
	obj: JsonObject,
	keyPath: readonly string[],
	value: unknown,
): JsonObject {
	const [head, ...rest] = keyPath;
	if (head === undefined) return obj;
	if (rest.length === 0) return { ...obj, [head]: value };
	const child = obj[head];
	return {
		...obj,
		[head]: setAt(isPlainObject(child) ? child : {}, rest, value),
	};
}

/**
 * Merge `value` into `text` at `keyPath`. Empty text counts as `{}`.
 */
export function mergeJsonKey(
	text: string,
	keyPath: readonly string[],
	value: unknown,
): JsonKeyMerge {
	if (keyPath.length === 0) {
		return { kind: "invalid", reason: "empty key path" };
	}
	let root: unknown = {};
	if (text.trim().length > 0) {
		try {
			root = JSON.parse(text);
		} catch {
			return { kind: "invalid", reason: "malformed JSON" };
		}
	}
	if (!isPlainObject(root)) {
		return { kind: "invalid", reason: "top level is not an object" };
	}

	let cursor: JsonObject = root;
	for (const key of keyPath.slice(0, -1)) {
		const next = cursor[key];
		if (next === undefined) {
			cursor = {};
			continue;
		}
		if (!isPlainObject(next)) {
			return { kind: "invalid", reason: `"${key}" is not an object` };
		}
		cursor = next;
	}

	const last = keyPath[keyPath.length - 1] as string;
	const current = cursor[last];
	if (
		current !== undefined &&
		JSON.stringify(current) === JSON.stringify(value)
	) {
		return { kind: "unchanged" };
	}
	const newline = text.trim().length === 0 || text.endsWith("\n");
	return {
		kind: "merged",
		text: serialise(setAt(root, keyPath, value), detectIndent(text), newline),
		hadKey: current !== undefined,
	};
}
