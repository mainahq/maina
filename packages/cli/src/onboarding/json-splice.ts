/**
 * Layout-preserving edits of one top-level key in a JSON object.
 *
 * The keyed merge of `json-key.ts` re-serialises the whole file, which keeps
 * a file in the usual `JSON.stringify` layout byte-identical but rewrites a
 * hand-formatted one (inline arrays, `1.0`, `é` escapes, a minified
 * file). These functions splice the text instead: only the key's own member
 * changes, and every other byte stays as it was, so setting a key and then
 * removing it gives back the original text.
 *
 * Each returns null when it cannot splice safely (not a JSON object, an
 * empty object, a duplicated key, or removing the only key), so the caller
 * falls back to the keyed merge.
 */

type Member = Readonly<{
	key: string;
	keyStart: number;
	keyEnd: number;
	valueStart: number;
	valueEnd: number;
}>;

type ObjectScan = Readonly<{ open: number; members: readonly Member[] }>;

const isWhitespace = (c: string | undefined): boolean =>
	c === " " || c === "\t" || c === "\n" || c === "\r";

function skipWhitespace(text: string, from: number): number {
	let i = from;
	while (i < text.length && isWhitespace(text[i])) i++;
	return i;
}

/** The index just past the string that starts at `from`, or -1. */
function skipString(text: string, from: number): number {
	let i = from + 1;
	while (i < text.length) {
		const c = text[i];
		if (c === "\\") i += 2;
		else if (c === '"') return i + 1;
		else i++;
	}
	return -1;
}

/** The index just past the value that starts at `from`, or -1. */
function skipValue(text: string, from: number): number {
	const first = text[from];
	if (first === '"') return skipString(text, from);
	if (first !== "{" && first !== "[") {
		let i = from;
		while (i < text.length && !/[\s,}\]]/.test(text[i] ?? "")) i++;
		return i;
	}
	let depth = 0;
	let i = from;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			i = skipString(text, i);
			if (i < 0) return -1;
			continue;
		}
		if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") {
			depth--;
			if (depth === 0) return i + 1;
		}
		i++;
	}
	return -1;
}

function decodeKey(token: string): string | null {
	try {
		const key: unknown = JSON.parse(token);
		return typeof key === "string" ? key : null;
	} catch {
		return null;
	}
}

/** The top-level members of `text`, a JSON object; null for anything else. */
function scanObject(text: string): ObjectScan | null {
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return null;
		}
	} catch {
		return null;
	}
	const open = skipWhitespace(text, 0);
	if (text[open] !== "{") return null;
	const members: Member[] = [];
	let i = skipWhitespace(text, open + 1);
	if (text[i] === "}") return { open, members };
	for (;;) {
		const keyStart = skipWhitespace(text, i);
		if (text[keyStart] !== '"') return null;
		const keyEnd = skipString(text, keyStart);
		if (keyEnd < 0) return null;
		const key = decodeKey(text.slice(keyStart, keyEnd));
		const colon = skipWhitespace(text, keyEnd);
		if (key === null || text[colon] !== ":") return null;
		const valueStart = skipWhitespace(text, colon + 1);
		const valueEnd = skipValue(text, valueStart);
		if (valueEnd < 0) return null;
		members.push({ key, keyStart, keyEnd, valueStart, valueEnd });
		i = skipWhitespace(text, valueEnd);
		if (text[i] === "}") return { open, members };
		if (text[i] !== ",") return null;
		i++;
	}
}

/** The whitespace between the token before `index` and `index`. */
function leadingWhitespace(text: string, index: number): string {
	let i = index;
	while (i > 0 && isWhitespace(text[i - 1])) i--;
	return text.slice(i, index);
}

/**
 * `value` laid out for a member whose key follows `lead`: one line when the
 * member shares its line, else indented like the member.
 */
function layoutValue(value: unknown, lead: string): string {
	const lastNewline = lead.lastIndexOf("\n");
	if (lastNewline < 0) return JSON.stringify(value);
	const indent = lead.slice(lastNewline + 1);
	const newline = lead.includes("\r\n") ? "\r\n" : "\n";
	return JSON.stringify(value, null, indent || "  ").replace(
		/\n/g,
		`${newline}${indent}`,
	);
}

/**
 * `text` with its top-level `key` set to `value`: the value replaced in
 * place, or a new last member laid out like the one before it.
 */
export function setTopLevelKey(
	text: string,
	key: string,
	value: unknown,
): string | null {
	const scan = scanObject(text);
	if (scan === null || scan.members.length === 0) return null;
	const matches = scan.members.filter((m) => m.key === key);
	if (matches.length > 1) return null;
	const [match] = matches;
	if (match !== undefined) {
		const lead = leadingWhitespace(text, match.keyStart);
		return `${text.slice(0, match.valueStart)}${layoutValue(value, lead)}${text.slice(match.valueEnd)}`;
	}
	const last = scan.members[scan.members.length - 1] as Member;
	const lead = leadingWhitespace(text, last.keyStart);
	const colon = text.slice(last.keyEnd, last.valueStart);
	const member = `,${lead}${JSON.stringify(key)}${colon}${layoutValue(value, lead)}`;
	return `${text.slice(0, last.valueEnd)}${member}${text.slice(last.valueEnd)}`;
}

/** `text` without its top-level `key`, every other byte kept. */
export function removeTopLevelKey(text: string, key: string): string | null {
	const scan = scanObject(text);
	if (scan === null || scan.members.length < 2) return null;
	const at = scan.members.map((m) => m.key).indexOf(key);
	if (at < 0 || scan.members.map((m) => m.key).lastIndexOf(key) !== at) {
		return null;
	}
	const member = scan.members[at] as Member;
	const before = scan.members[at - 1];
	if (before !== undefined) {
		return `${text.slice(0, before.valueEnd)}${text.slice(member.valueEnd)}`;
	}
	const after = scan.members[at + 1] as Member;
	return `${text.slice(0, member.keyStart)}${text.slice(after.keyStart)}`;
}
