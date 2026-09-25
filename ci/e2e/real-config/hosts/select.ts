/** Walk `path` into a parsed config; undefined if any hop is missing. */
export function at(value: unknown, path: readonly string[]): unknown {
	let cursor: unknown = value;
	for (const key of path) {
		if (
			cursor === null ||
			typeof cursor !== "object" ||
			Array.isArray(cursor)
		) {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}
