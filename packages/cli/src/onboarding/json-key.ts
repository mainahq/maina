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

/** Parse `text` as a JSON object; empty text counts as `{}`. */
export function parseJsonObject(
	text: string,
):
	| { readonly ok: true; readonly value: JsonObject }
	| { readonly ok: false; readonly reason: string } {
	if (text.trim().length === 0) return { ok: true, value: {} };
	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch {
		return { ok: false, reason: "malformed JSON" };
	}
	return isPlainObject(root)
		? { ok: true, value: root }
		: { ok: false, reason: "top level is not an object" };
}

/**
 * Serialise `value` in the layout of `text`: its indentation, and its
 * trailing newline (always one for a new file).
 */
export function serialiseLike(text: string, value: unknown): string {
	const newline = text.trim().length === 0 || text.endsWith("\n");
	return serialise(value, detectIndent(text), newline);
}

/** Remove `obj[keyPath]`, cloning along the path; missing hops are kept. */
function deleteAt(obj: JsonObject, keyPath: readonly string[]): JsonObject {
	const [head, ...rest] = keyPath;
	if (head === undefined || !(head in obj)) return obj;
	if (rest.length === 0) {
		const { [head]: _removed, ...others } = obj;
		return others;
	}
	const child = obj[head];
	if (!isPlainObject(child)) return obj;
	const nextChild = deleteAt(child, rest);
	return nextChild === child ? obj : { ...obj, [head]: nextChild };
}

/**
 * Remove the key at `keyPath` from `text`, keeping every other key and the
 * file's layout. Containers along the path are left in place, even empty.
 */
export function removeJsonKey(
	text: string,
	keyPath: readonly string[],
): JsonKeyMerge {
	const parsed = parseJsonObject(text);
	if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
	const next = deleteAt(parsed.value, keyPath);
	if (next === parsed.value) return { kind: "unchanged" };
	return { kind: "merged", text: serialiseLike(text, next), hadKey: true };
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
	const parsed = parseJsonObject(text);
	if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
	const root = parsed.value;

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
	return {
		kind: "merged",
		text: serialiseLike(text, setAt(root, keyPath, value)),
		hadKey: current !== undefined,
	};
}
