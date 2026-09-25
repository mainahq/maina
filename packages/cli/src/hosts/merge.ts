/**
 * Merge maina's MCP entry into a host config file (FR-INS-4, fixes P8).
 *
 * Pure: `mergeEntry` takes the file's current bytes (and any backup) as a
 * `Snapshot` and returns one `FileOp`; `./apply.ts` carries it out.
 *
 * Rules:
 * - maina owns exactly one entry (`mcpServers.maina`, `[mcp_servers.maina]`,
 *   …). Every other key, server, comment and byte of the file is kept:
 *   JSON is re-serialised in the file's own layout, TOML is edited as text.
 * - The first merge into an existing file asks for a backup of the
 *   original; once a backup exists it is never replaced.
 * - Fails closed: a file that cannot be parsed, or whose maina entry
 *   cannot be edited safely, is reported as `skipped` and left alone.
 */

import * as toml from "@iarna/toml";
import {
	mergeJsonKey,
	parseJsonObject,
	removeJsonKey,
	serialiseLike,
} from "../onboarding/json-key";
import type { TargetFile } from "./targets";

// ── Types ────────────────────────────────────────────────────────────────────

/** The bytes on disk when the op is planned; null = the file is absent. */
export interface Snapshot {
	readonly text: string | null;
	readonly backup: string | null;
}

export type HostAction =
	| "created"
	| "updated"
	| "unchanged"
	| "removed"
	| "restored"
	| "absent"
	| "skipped";

/** One planned change to one host config file. */
export interface FileOp {
	readonly path: string;
	readonly action: HostAction;
	/** New contents; `null` deletes the file; absent leaves it untouched. */
	readonly content?: string | null;
	/** Copy to keep before writing — only if no backup exists yet. */
	readonly backup?: { readonly path: string; readonly content: string };
	/** Backup file to delete once `content` is written. */
	readonly dropBackup?: string;
	/** Why the file was skipped. */
	readonly reason?: string;
}

type Read =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly reason: string };

type Edit =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly reason: string };

type Obj = Readonly<Record<string, unknown>>;

function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function named(entryKey: string): (e: unknown) => boolean {
	return (e) => isObj(e) && e.name === entryKey;
}

// ── JSON ────────────────────────────────────────────────────────────────────

/** The container at `path`: undefined when a hop is missing. */
function jsonContainer(root: Obj, path: readonly string[]): Read {
	let cursor: unknown = root;
	for (const key of path) {
		if (!isObj(cursor)) return { ok: false, reason: "not an object" };
		cursor = cursor[key];
		if (cursor === undefined) return { ok: true, value: undefined };
	}
	return { ok: true, value: cursor };
}

function readJson(t: TargetFile, text: string): Read {
	const parsed = parseJsonObject(text);
	if (!parsed.ok) return parsed;
	const found = jsonContainer(parsed.value, t.containerPath);
	if (!found.ok || found.value === undefined) {
		return found.ok ? found : { ok: false, reason: found.reason };
	}
	const c = found.value;
	if (t.container === "array") {
		if (!Array.isArray(c)) {
			return {
				ok: false,
				reason: `"${t.containerPath.join(".")}" is not a list`,
			};
		}
		return { ok: true, value: c.find(named(t.entryKey)) };
	}
	if (!isObj(c)) {
		return {
			ok: false,
			reason: `"${t.containerPath.join(".")}" is not an object`,
		};
	}
	return { ok: true, value: c[t.entryKey] };
}

/** Replace the array at `path` (creating objects on the way) with `next`. */
function withArray(
	root: Obj,
	path: readonly string[],
	next: (current: readonly unknown[]) => readonly unknown[],
): Obj {
	const [head, ...rest] = path;
	if (head === undefined) return root;
	const child = root[head];
	if (rest.length === 0) {
		return { ...root, [head]: next(Array.isArray(child) ? child : []) };
	}
	return { ...root, [head]: withArray(isObj(child) ? child : {}, rest, next) };
}

function editJsonArray(
	t: TargetFile,
	text: string,
	next: (current: readonly unknown[]) => readonly unknown[],
): Edit {
	const parsed = parseJsonObject(text);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		text: serialiseLike(text, withArray(parsed.value, t.containerPath, next)),
	};
}

function setJson(t: TargetFile, text: string, entry: unknown): Edit {
	if (t.container === "array") {
		const isMaina = named(t.entryKey);
		return editJsonArray(t, text, (arr) =>
			arr.some(isMaina)
				? arr.map((e) => (isMaina(e) ? entry : e))
				: [...arr, entry],
		);
	}
	const merged = mergeJsonKey(text, [...t.containerPath, t.entryKey], entry);
	if (merged.kind === "invalid") return { ok: false, reason: merged.reason };
	return { ok: true, text: merged.kind === "merged" ? merged.text : text };
}

function deleteJson(t: TargetFile, text: string): Edit {
	if (t.container === "array") {
		const isMaina = named(t.entryKey);
		return editJsonArray(t, text, (arr) => arr.filter((e) => !isMaina(e)));
	}
	const removed = removeJsonKey(text, [...t.containerPath, t.entryKey]);
	if (removed.kind === "invalid") return { ok: false, reason: removed.reason };
	return { ok: true, text: removed.kind === "merged" ? removed.text : text };
}

/** `{}`, or nothing but empty containers along `path`. */
function isSkeleton(value: unknown, path: readonly string[]): boolean {
	if (Array.isArray(value)) return value.length === 0 && path.length === 0;
	if (!isObj(value)) return false;
	const keys = Object.keys(value);
	if (keys.length === 0) return true;
	const [head, ...rest] = path;
	return (
		head !== undefined &&
		keys.length === 1 &&
		keys[0] === head &&
		isSkeleton(value[head], rest)
	);
}

// ── TOML ────────────────────────────────────────────────────────────────────
//
// TOML is edited as text so comments and layout survive: maina owns the
// `[mcp_servers.maina]` table and its sub-tables, from each header to the
// next header (trailing blank and comment lines stay with what follows).

const HEADER = /^\s*\[\[?\s*([^[\]]+?)\s*\]\]?\s*(#.*)?$/;

function headerPath(line: string): readonly string[] | null {
	const m = HEADER.exec(line);
	if (m?.[1] === undefined) return null;
	return m[1].split(".").map((s) => s.trim().replace(/^(["'])(.*)\1$/, "$2"));
}

interface Range {
	readonly start: number;
	readonly end: number;
}

function ownedRanges(t: TargetFile, lines: readonly string[]): Range[] {
	const own = [...t.containerPath, t.entryKey];
	const isOwned = (p: readonly string[]) =>
		p.length >= own.length && own.every((k, i) => p[i] === k);
	const ranges: Range[] = [];
	for (let i = 0; i < lines.length; i++) {
		const path = headerPath(lines[i] ?? "");
		if (path === null || !isOwned(path)) continue;
		let end = i + 1;
		while (end < lines.length && headerPath(lines[end] ?? "") === null) end++;
		let last = end;
		while (last > i + 1 && /^\s*(#.*)?$/.test(lines[last - 1] ?? "")) last--;
		ranges.push({ start: i, end: last });
		i = end - 1;
	}
	return ranges;
}

function parseToml(text: string): Read {
	try {
		return { ok: true, value: toml.parse(text) };
	} catch (e) {
		return {
			ok: false,
			reason: `invalid TOML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
		};
	}
}

function readToml(t: TargetFile, text: string): Read {
	const parsed = parseToml(text);
	if (!parsed.ok) return parsed;
	let cursor: unknown = parsed.value;
	for (const key of [...t.containerPath, t.entryKey]) {
		if (!isObj(cursor)) return { ok: true, value: undefined };
		cursor = cursor[key];
	}
	return { ok: true, value: cursor };
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

function tomlKey(k: string): string {
	return BARE_KEY.test(k) ? k : JSON.stringify(k);
}

function tomlValue(v: unknown): string | null {
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (Array.isArray(v)) {
		const items = v.map(tomlValue);
		return items.every((i) => i !== null) ? `[${items.join(", ")}]` : null;
	}
	return null;
}

/** `[a.b]` tables for `value`, sub-objects as sub-tables. */
function renderTable(path: readonly string[], value: Obj): string | null {
	const scalars: string[] = [];
	const tables: string[] = [];
	for (const [k, v] of Object.entries(value)) {
		if (isObj(v)) {
			const sub = renderTable([...path, k], v);
			if (sub === null) return null;
			tables.push(sub);
			continue;
		}
		const rendered = tomlValue(v);
		if (rendered === null) return null;
		scalars.push(`${tomlKey(k)} = ${rendered}\n`);
	}
	return [`[${path.map(tomlKey).join(".")}]\n${scalars.join("")}`, ...tables]
		.join("\n")
		.replace(/\n+$/, "\n");
}

function hasEntry(t: TargetFile, text: string): Read {
	const current = readToml(t, text);
	if (!current.ok || current.value === undefined) return current;
	const lines = text.split("\n");
	return ownedRanges(t, lines).length > 0
		? current
		: {
				ok: false,
				reason: `maina's entry is not a [${[...t.containerPath, t.entryKey].join(".")}] table; left untouched`,
			};
}

/** JSON with object keys sorted, so key order never counts as a change. */
function canonical(v: unknown): string {
	return JSON.stringify(v, (_k, x: unknown) =>
		isObj(x)
			? Object.fromEntries(
					Object.keys(x)
						.sort()
						.map((k) => [k, x[k]]),
				)
			: x,
	);
}

/** `doc` minus maina's entry, dropping containers that end up empty. */
function withoutEntry(doc: unknown, path: readonly string[]): unknown {
	const [head, ...rest] = path;
	if (head === undefined || !isObj(doc) || !(head in doc)) return doc;
	const { [head]: child, ...others } = doc;
	if (rest.length === 0) return others;
	const next = withoutEntry(child, rest);
	return isObj(next) && Object.keys(next).length === 0
		? others
		: { ...others, [head]: next };
}

/**
 * Fail closed on a text edit: `after` must parse, hold exactly `expected`
 * as maina's entry (undefined = none), and otherwise mean the same as
 * `before`. A layout the line editor misreads (an inline or array
 * `mcp_servers`, a header-looking line inside a multi-line string) is
 * skipped instead of breaking the user's config.
 */
function verifiedToml(
	t: TargetFile,
	before: string,
	after: string,
	expected: unknown,
): Edit {
	const unsafe: Edit = {
		ok: false,
		reason: `cannot edit [${[...t.containerPath, t.entryKey].join(".")}] safely in this file; left untouched`,
	};
	const prev = parseToml(before);
	const next = parseToml(after);
	if (!prev.ok || !next.ok) return unsafe;
	const entry = readToml(t, after);
	if (!entry.ok || canonical(entry.value) !== canonical(expected)) {
		return unsafe;
	}
	const own = [...t.containerPath, t.entryKey];
	return canonical(withoutEntry(next.value, own)) ===
		canonical(withoutEntry(prev.value, own))
		? { ok: true, text: after }
		: unsafe;
}

function setToml(t: TargetFile, text: string, entry: unknown): Edit {
	const current = hasEntry(t, text);
	if (!current.ok) return current;
	const block = isObj(entry)
		? renderTable([...t.containerPath, t.entryKey], entry)
		: null;
	if (block === null) {
		return { ok: false, reason: "entry cannot be written as a TOML table" };
	}
	const lines = text.split("\n");
	const ranges = ownedRanges(t, lines);
	if (ranges.length === 0) {
		const appended =
			text.length === 0
				? block
				: `${text.endsWith("\n") ? text : `${text}\n`}\n${block}`;
		return verifiedToml(t, text, appended, entry);
	}
	const blockLines = block.replace(/\n$/, "").split("\n");
	const out = lines.flatMap((line, i) => {
		const r = ranges.find((x) => i >= x.start && i < x.end);
		if (r === undefined) return [line];
		return r === ranges[0] && i === r.start ? blockLines : [];
	});
	return verifiedToml(t, text, out.join("\n"), entry);
}

function deleteToml(t: TargetFile, text: string): Edit {
	const current = hasEntry(t, text);
	if (!current.ok) return current;
	const lines = text.split("\n");
	const ranges = ownedRanges(t, lines);
	const kept = lines.filter(
		(_, i) => !ranges.some((r) => i >= r.start && i < r.end),
	);
	const last = ranges[ranges.length - 1];
	const atEnd =
		last !== undefined &&
		lines.slice(last.end).every((l) => l.trim().length === 0);
	const out = kept.join("\n");
	// Undo the blank separator an append added.
	return verifiedToml(
		t,
		text,
		atEnd ? out.replace(/\n{2,}$/, "\n") : out,
		undefined,
	);
}

// ── Format dispatch ─────────────────────────────────────────────────────────

/** The maina entry in `text`, undefined when absent. */
export function readEntry(t: TargetFile, text: string): Read {
	return t.format === "toml" ? hasEntry(t, text) : readJson(t, text);
}

/** `text` with maina's entry set to `entry`. */
export function setEntry(t: TargetFile, text: string, entry: unknown): Edit {
	return t.format === "toml"
		? setToml(t, text, entry)
		: setJson(t, text, entry);
}

/** `text` without maina's entry. */
export function deleteEntry(t: TargetFile, text: string): Edit {
	return t.format === "toml" ? deleteToml(t, text) : deleteJson(t, text);
}

/** True when `text` holds nothing but what maina put there. */
export function isEmptyConfig(t: TargetFile, text: string): boolean {
	if (t.format === "toml") return text.trim().length === 0;
	const parsed = parseJsonObject(text);
	return parsed.ok && isSkeleton(parsed.value, t.containerPath);
}

// ── mergeEntry ──────────────────────────────────────────────────────────────

/** Plan writing `entry` as maina's entry in `target`. */
export function mergeEntry(
	target: TargetFile,
	entry: unknown,
	snapshot: Snapshot,
): FileOp {
	const { path } = target;
	const current = snapshot.text;
	const existing = readEntry(target, current ?? "");
	if (!existing.ok) {
		return { path, action: "skipped", reason: existing.reason };
	}
	if (existing.value !== undefined && same(existing.value, entry)) {
		return { path, action: "unchanged" };
	}
	const next = setEntry(target, current ?? "", entry);
	if (!next.ok) return { path, action: "skipped", reason: next.reason };
	if (current === null) {
		return { path, action: "created", content: next.text };
	}
	return {
		path,
		action: "updated",
		content: next.text,
		...(snapshot.backup === null
			? { backup: { path: target.backupPath, content: current } }
			: {}),
	};
}
