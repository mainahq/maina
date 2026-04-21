/**
 * Delimited maina-managed region utilities.
 *
 * Agent files wrap Maina-authored content in a delimited region so re-runs
 * of the setup wizard only update that region — user-authored content above
 * and below is preserved verbatim.
 */

export const MAINA_REGION_START = "<!-- maina-managed:start -->";
export const MAINA_REGION_END = "<!-- maina-managed:end -->";

/**
 * Wrap raw managed content with the maina-managed delimiters.
 * The returned string is a drop-in block that can be appended or inserted
 * into any markdown file.
 */
export function wrapManaged(content: string): string {
	const body = content.endsWith("\n") ? content.slice(0, -1) : content;
	return `${MAINA_REGION_START}\n${body}\n${MAINA_REGION_END}`;
}

/**
 * Merge maina-managed content into an existing file.
 * - If the file already contains a maina-managed region, replace it in place.
 * - Otherwise, append the wrapped region to the end with a blank line separator.
 * - If the existing content is empty/whitespace, return the wrapped region alone.
 */
export function mergeManaged(existing: string, managed: string): string {
	const wrapped = wrapManaged(managed);
	const trimmed = existing.trim();

	if (trimmed.length === 0) {
		return `${wrapped}\n`;
	}

	const startIdx = existing.indexOf(MAINA_REGION_START);
	const endIdx = existing.indexOf(MAINA_REGION_END);

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + MAINA_REGION_END.length);
		return `${before}${wrapped}${after}`;
	}

	// No existing region — append with blank line separator.
	const trailing = existing.endsWith("\n") ? "" : "\n";
	return `${existing}${trailing}\n${wrapped}\n`;
}

/**
 * Extract the content inside the maina-managed region (delimiters excluded).
 * Returns null if no region is present.
 */
export function extractManaged(content: string): string | null {
	const startIdx = content.indexOf(MAINA_REGION_START);
	const endIdx = content.indexOf(MAINA_REGION_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return null;
	}
	const inner = content.slice(startIdx + MAINA_REGION_START.length, endIdx);
	// Trim one leading and one trailing newline introduced by wrapManaged.
	return inner.replace(/^\n/, "").replace(/\n$/, "");
}

// ── JSON keyed merge ────────────────────────────────────────────────────────
//
// Markdown files use the `<!-- maina-managed:* -->` delimiters above; JSON
// configs (`.claude/settings.json`, `.cursor/mcp.json`, …) cannot carry
// comments, so the "managed region" concept maps to a specific keyed path
// inside the JSON object. Everything outside that path is preserved byte
// for byte after serialisation.

export interface MergeJsonKeyedOptions {
	/**
	 * Dotted path (or array path) into the parsed JSON where the maina
	 * entry should live. Intermediate containers are created if missing.
	 * Example: `["mcpServers", "maina"]`.
	 */
	path: string[];
	/** The value to place at `path`. */
	value: unknown;
	/** Indent for serialisation. Default: 2. */
	indent?: number;
}

export type MergeJsonKeyedResult =
	| { kind: "merged"; text: string }
	| { kind: "created"; text: string }
	| { kind: "malformed"; text: string };

/**
 * Merge a single keyed value into a JSON document, preserving every other
 * key. Pure function — callers decide how to persist the output.
 *
 * - If `existingText` is empty/whitespace, returns a fresh document with
 *   just the path populated (`kind: "created"`).
 * - If `existingText` parses to an object, the key at `path` is replaced
 *   (`kind: "merged"`). Other keys are untouched.
 * - If `existingText` is unparseable JSON, returns `kind: "malformed"`
 *   and a fresh document. The caller is expected to preserve the original
 *   somewhere (typically a `.bak.<ts>` sibling) before overwriting.
 */
export function mergeJsonKeyed(
	existingText: string,
	opts: MergeJsonKeyedOptions,
): MergeJsonKeyedResult {
	const indent = opts.indent ?? 2;
	const trimmed = existingText.trim();

	if (trimmed.length === 0) {
		const fresh = setAtPath({}, opts.path, opts.value);
		return {
			kind: "created",
			text: `${JSON.stringify(fresh, null, indent)}\n`,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(existingText);
	} catch {
		const fresh = setAtPath({}, opts.path, opts.value);
		return {
			kind: "malformed",
			text: `${JSON.stringify(fresh, null, indent)}\n`,
		};
	}

	if (!isPlainObject(parsed)) {
		// e.g. JSON array/primitive at top level — we can't merge into it.
		// Treat as malformed so the caller backs it up.
		const fresh = setAtPath({}, opts.path, opts.value);
		return {
			kind: "malformed",
			text: `${JSON.stringify(fresh, null, indent)}\n`,
		};
	}

	const next = setAtPath(parsed, opts.path, opts.value);
	return {
		kind: "merged",
		text: `${JSON.stringify(next, null, indent)}\n`,
	};
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return (
		typeof x === "object" &&
		x !== null &&
		!Array.isArray(x) &&
		Object.getPrototypeOf(x) === Object.prototype
	);
}

function setAtPath(
	root: Record<string, unknown>,
	path: string[],
	value: unknown,
): Record<string, unknown> {
	if (path.length === 0) return root;
	// Work on a shallow-cloned tree so callers holding references to `root`
	// don't see mutations. JSON round-tripping already de-duplicated aliases,
	// so a clone at each level is safe and cheap.
	const out: Record<string, unknown> = { ...root };
	let cursor: Record<string, unknown> = out;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i];
		if (key === undefined) continue;
		const existing = cursor[key];
		if (isPlainObject(existing)) {
			const clone = { ...existing };
			cursor[key] = clone;
			cursor = clone;
		} else {
			const fresh: Record<string, unknown> = {};
			cursor[key] = fresh;
			cursor = fresh;
		}
	}
	const last = path[path.length - 1];
	if (last !== undefined) {
		cursor[last] = value;
	}
	return out;
}
