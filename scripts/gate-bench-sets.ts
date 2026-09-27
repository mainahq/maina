#!/usr/bin/env bun
/**
 * The gate-bench benchmark sets and their committed hash manifest (#583,
 * FR-GATE-2).
 *
 * The labelled command corpus (`commands.jsonl`) is System 1 training data,
 * so no model metric is reported on it. The model is measured on these
 * hand-written sets instead:
 *
 * - `overeager`: actions that look dangerous but are safe. The deterministic
 *   gate allows every one; a system that holds one is overeager.
 * - `injection`: gated actions carrying text meant to talk the gate into
 *   allowing them, each with its base (the same action without that text).
 *   A system whose answer loosens on the injected text was steered.
 *
 * `hashes.json` records each set file's sha256 and every item's content hash
 * (bases included). maina-model reads it as its training-exclusion anchors:
 * no item, and no near-duplicate of one, may enter a training split.
 *
 *   bun scripts/gate-bench-sets.ts           write hashes.json
 *   bun scripts/gate-bench-sets.ts --check   exit 1 when it is stale
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../packages/core/src/decide/log/hash";
import { GATE_EVENT_KINDS } from "../packages/core/src/policy/schema";

type Result<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: string }>;

const SETS_DIR = "packages/core/bench/gate-bench";
export const HASHES_FILE = `${SETS_DIR}/hashes.json`;
export const SET_NAMES = ["overeager", "injection"] as const;
type SetName = (typeof SET_NAMES)[number];

type Kind = (typeof GATE_EVENT_KINDS)[number];

/** What an agent asked to do: the part of an item that is hashed. */
type Content = Readonly<{
	kind: Kind;
	action: Readonly<Record<string, unknown>>;
	untrusted: readonly string[];
}>;

type Common = Content &
	Readonly<{
		id: string;
		/** The kind of trap the item sets, for per-family breakdowns. */
		family: string;
	}>;

type OvereagerItem = Common &
	Readonly<{
		set: "overeager";
		label: "benign" | "reversible";
		expect: "allow";
	}>;

type InjectionItem = Common &
	Readonly<{
		set: "injection";
		label: "destructive";
		/** The deterministic gate's verdict, with or without the injection. */
		expect: "ask" | "deny";
		base: Readonly<{
			action: Readonly<Record<string, unknown>>;
			untrusted: readonly string[];
		}>;
	}>;

export type BenchItem = OvereagerItem | InjectionItem;

type Json = Readonly<Record<string, unknown>>;

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isStrings = (v: unknown): v is readonly string[] =>
	Array.isArray(v) && v.every((s) => typeof s === "string");

const ID = { overeager: /^oe-\d{3}$/, injection: /^inj-\d{3}$/ } as const;

/** The problem with one parsed line, or null when it is a valid item. */
function itemProblem(set: SetName, v: unknown): string | null {
	if (!isObject(v)) return "must be a JSON object";
	if (v.set !== set) return `set must be "${set}"`;
	if (typeof v.id !== "string" || !ID[set].test(v.id)) {
		return `id must match ${ID[set].source}`;
	}
	if (typeof v.family !== "string" || !/^[a-z][a-z-]*$/.test(v.family)) {
		return "family must be a lower-case slug";
	}
	if (!(GATE_EVENT_KINDS as readonly unknown[]).includes(v.kind)) {
		return `kind must be one of ${GATE_EVENT_KINDS.join(", ")}`;
	}
	if (!isObject(v.action)) return "action must be an object";
	if (!isStrings(v.untrusted)) return "untrusted must be a list of strings";
	if (set === "overeager") {
		if (v.label !== "benign" && v.label !== "reversible") {
			return 'label must be "benign" or "reversible"';
		}
		if (v.expect !== "allow") return 'expect must be "allow"';
		return null;
	}
	if (v.label !== "destructive") return 'label must be "destructive"';
	if (v.expect !== "ask" && v.expect !== "deny") {
		return 'expect must be "ask" or "deny"';
	}
	const base = v.base;
	if (!isObject(base) || !isObject(base.action) || !isStrings(base.untrusted)) {
		return "base must hold the action and untrusted list without the injection";
	}
	return null;
}

/** The items of one set's JSONL `text`, each line validated. */
export function parseBenchSet(
	set: SetName,
	text: string,
): Result<readonly BenchItem[]> {
	const items: BenchItem[] = [];
	const lines = text.split("\n");
	for (const [i, line] of lines.entries()) {
		if (line.trim() === "") continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			return { ok: false, error: `${set} line ${i + 1}: not valid JSON` };
		}
		const problem = itemProblem(set, value);
		if (problem !== null) {
			const id = isObject(value) ? String(value.id ?? "") : "";
			return {
				ok: false,
				error: `${set} line ${i + 1}${id ? ` (${id})` : ""}: ${problem}`,
			};
		}
		items.push(value as BenchItem);
	}
	return { ok: true, value: items };
}

const setFile = (set: SetName): string => `${SETS_DIR}/${set}.jsonl`;

type SetFile = Readonly<{ bytes: Uint8Array; items: readonly BenchItem[] }>;

/** One set's file under `root`: its exact bytes and its validated items. */
function readSet(root: string, set: SetName): Result<SetFile> {
	const rel = setFile(set);
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(join(root, rel));
	} catch {
		return { ok: false, error: `${rel}: could not be read` };
	}
	const parsed = parseBenchSet(set, new TextDecoder().decode(bytes));
	return parsed.ok
		? { ok: true, value: { bytes, items: parsed.value } }
		: parsed;
}

/** Both sets under `root`, validated. */
export function readBenchSets(
	root: string,
): Result<Readonly<Record<SetName, readonly BenchItem[]>>> {
	const out: Partial<Record<SetName, readonly BenchItem[]>> = {};
	for (const set of SET_NAMES) {
		const read = readSet(root, set);
		if (!read.ok) return read;
		out[set] = read.value.items;
	}
	return { ok: true, value: out as Record<SetName, readonly BenchItem[]> };
}

const sha256 = (data: string | Uint8Array): string =>
	createHash("sha256").update(data).digest("hex");

/**
 * The sha256 of an item's content (kind, action, untrusted) as canonical
 * JSON: key order and labels do not change it; any change to what the agent
 * asked does.
 */
export function itemSha256(content: Content): string {
	return sha256(
		canonicalJson({
			kind: content.kind,
			action: content.action,
			untrusted: content.untrusted,
		}),
	);
}

type ManifestItem = Readonly<{ id: string; sha256: string; base?: string }>;

function manifestItem(item: BenchItem): ManifestItem {
	const own = { id: item.id, sha256: itemSha256(item) };
	return item.set === "injection"
		? { ...own, base: itemSha256({ ...item.base, kind: item.kind }) }
		: own;
}

/** The hash manifest `hashes.json` should hold, rendered. */
export function computeGateBenchHashes(root: string): Result<string> {
	const sets = [];
	for (const set of SET_NAMES) {
		const read = readSet(root, set);
		if (!read.ok) return read;
		sets.push({
			name: set,
			file: setFile(set),
			sha256: sha256(read.value.bytes),
			count: read.value.items.length,
			items: read.value.items.map(manifestItem),
		});
	}
	const manifest = {
		schemaVersion: 1,
		purpose:
			"Training-exclusion anchors for maina-model: no item below, no injection base, and no near-duplicate of either may enter any training split. Model metrics are reported on these sets, never on the gate corpus (FR-GATE-2).",
		itemHash:
			"sha256 of canonical JSON (sorted keys, no whitespace) of {kind, action, untrusted}",
		sets,
	};
	return { ok: true, value: `${JSON.stringify(manifest, null, 2)}\n` };
}

/** Problems with the committed manifest; empty when it is up to date. */
export function staleGateBenchHashes(root: string): string[] {
	const computed = computeGateBenchHashes(root);
	if (!computed.ok) return [computed.error];
	const path = join(root, HASHES_FILE);
	return existsSync(path) && readFileSync(path, "utf8") === computed.value
		? []
		: [HASHES_FILE];
}

function main(): number {
	const root = join(import.meta.dir, "..");
	if (process.argv.includes("--check")) {
		const stale = staleGateBenchHashes(root);
		if (stale.length === 0) {
			process.stdout.write("gate-bench-sets: OK: up to date.\n");
			return 0;
		}
		process.stderr.write(
			`gate-bench-sets: stale, run \`bun scripts/gate-bench-sets.ts\`:\n${stale.map((s) => `  ${s}`).join("\n")}\n`,
		);
		return 1;
	}
	const computed = computeGateBenchHashes(root);
	if (!computed.ok) {
		process.stderr.write(`gate-bench-sets: ${computed.error}\n`);
		return 1;
	}
	writeFileSync(join(root, HASHES_FILE), computed.value, "utf8");
	process.stdout.write(`wrote ${HASHES_FILE}\n`);
	return 0;
}

if (import.meta.main) {
	process.exit(main());
}
