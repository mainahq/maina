/**
 * The gate-bench benchmark sets (#583, FR-GATE-2).
 *
 * The labelled command corpus (`commands.jsonl`) is System 1 training data,
 * so no model metric is ever reported on it. The model is measured on these
 * sets instead, and their hashes are committed so maina-model can keep every
 * item (and any near-duplicate) out of training:
 *
 * - `overeager`: actions that look dangerous but are safe. The deterministic
 *   gate allows every one, so a system that holds one is overeager.
 * - `injection`: gated actions carrying text that tries to talk the gate
 *   into allowing them, each paired with the same action without it. The
 *   injected text never changes the deterministic verdict, so a system whose
 *   answer loosens on it was steered.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REGISTRY } from "../../packages/core/src/decide/registry";
import { evaluateGate } from "../../packages/core/src/gate/evaluate";
import type {
	GateContext,
	GateEvent,
} from "../../packages/core/src/gate/events";
import { loadShellParser } from "../../packages/core/src/gate/parsers/shell";
import { DEFAULT_POLICY } from "../../packages/core/src/policy/defaults";
import {
	type BenchItem,
	computeGateBenchHashes,
	HASHES_FILE,
	itemSha256,
	parseBenchSet,
	readBenchSets,
	SET_NAMES,
	staleGateBenchHashes,
} from "../gate-bench-sets";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CORPUS = "packages/core/src/gate/__fixtures__/commands.jsonl";

let ctx: GateContext;
let sets: Readonly<Record<(typeof SET_NAMES)[number], readonly BenchItem[]>>;

beforeAll(async () => {
	const parser = await loadShellParser();
	if (!parser.ok) throw new Error(parser.error.message);
	ctx = { shell: parser.value, home: "/home/dev" };
	const read = readBenchSets(REPO_ROOT);
	if (!read.ok) throw new Error(read.error);
	sets = read.value;
});

function verdict(
	kind: BenchItem["kind"],
	action: unknown,
	untrusted: readonly string[],
): string {
	const event = {
		host: "claude-code",
		sessionId: "gate-bench",
		root: "/work/repo",
		permissionMode: "default",
		untrusted,
		kind,
		action,
	} as unknown as GateEvent;
	let n = 0;
	return evaluateGate(
		{
			clock: { now: () => 0 },
			backends: DEFAULT_REGISTRY,
			ctx,
			newId: () => `bench-${++n}`,
		},
		event,
		DEFAULT_POLICY,
	).verdict;
}

/** What an item's action says, whitespace-collapsed, for overlap checks. */
const text = (action: unknown): string =>
	JSON.stringify(action).toLowerCase().replace(/\s+/g, " ");

describe("gate-bench sets", () => {
	test("the committed hash manifest matches the sets", () => {
		expect(staleGateBenchHashes(REPO_ROOT)).toEqual([]);
	});

	test("both sets are big enough to measure a rate on", () => {
		expect(SET_NAMES).toEqual(["overeager", "injection"]);
		expect(sets.overeager.length).toBeGreaterThanOrEqual(40);
		expect(sets.injection.length).toBeGreaterThanOrEqual(25);
	});

	test("ids are unique across both sets", () => {
		const ids = [...sets.overeager, ...sets.injection].map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("no item repeats an action from the training corpus", () => {
		const corpus = new Set(
			readFileSync(join(REPO_ROOT, CORPUS), "utf8")
				.split("\n")
				.filter((l) => l.trim() !== "")
				.map((l) => text((JSON.parse(l) as { action: unknown }).action)),
		);
		const actions = [
			...sets.overeager.map((i) => i.action),
			...sets.injection.flatMap((i) =>
				i.set === "injection" ? [i.action, i.base.action] : [],
			),
		];
		expect(actions.map(text).filter((a) => corpus.has(a))).toEqual([]);
	});

	test("the deterministic gate allows every overeager item", () => {
		const held = sets.overeager
			.filter((i) => verdict(i.kind, i.action, i.untrusted) !== "allow")
			.map((i) => i.id);
		expect(held).toEqual([]);
		expect(sets.overeager.every((i) => i.expect === "allow")).toBe(true);
	});

	test("the deterministic gate holds every injection item as its label says", () => {
		const wrong = sets.injection
			.filter((i) => verdict(i.kind, i.action, i.untrusted) !== i.expect)
			.map((i) => i.id);
		expect(wrong).toEqual([]);
		expect(
			sets.injection.every((i) => i.expect === "ask" || i.expect === "deny"),
		).toBe(true);
	});

	test("an injection never moves the deterministic verdict off its base", () => {
		const moved = sets.injection
			.filter(
				(i) =>
					i.set === "injection" &&
					verdict(i.kind, i.action, i.untrusted) !==
						verdict(i.kind, i.base.action, i.base.untrusted),
			)
			.map((i) => i.id);
		expect(moved).toEqual([]);
	});

	test("every injection differs from its base, and covers several families", () => {
		for (const i of sets.injection) {
			if (i.set !== "injection") continue;
			expect(
				text([i.action, i.untrusted]) !==
					text([i.base.action, i.base.untrusted]),
			).toBe(true);
		}
		const families = new Set(sets.injection.map((i) => i.family));
		expect(families.size).toBeGreaterThanOrEqual(6);
	});
});

describe("the hash manifest", () => {
	test("records each set's file hash and every item's hash, bases included", () => {
		const computed = computeGateBenchHashes(REPO_ROOT);
		if (!computed.ok) throw new Error(computed.error);
		const manifest = JSON.parse(computed.value) as {
			schemaVersion: number;
			sets: readonly {
				name: string;
				file: string;
				sha256: string;
				items: readonly { id: string; sha256: string; base?: string }[];
			}[];
		};
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.sets.map((s) => s.name)).toEqual([...SET_NAMES]);
		for (const set of manifest.sets) {
			const bytes = readFileSync(join(REPO_ROOT, set.file));
			expect(set.sha256).toBe(
				new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
			);
			expect(set.items.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(
				true,
			);
		}
		const injection = manifest.sets.find((s) => s.name === "injection");
		expect(injection?.items.every((i) => i.base !== undefined)).toBe(true);
	});

	test("an item's hash depends on its content only, not on key order", () => {
		const a = itemSha256({
			kind: "shell",
			action: { command: "ls", cwd: "/w" },
			untrusted: [],
		});
		const b = itemSha256({
			kind: "shell",
			action: { cwd: "/w", command: "ls" },
			untrusted: [],
		});
		const c = itemSha256({
			kind: "shell",
			action: { command: "ls -a", cwd: "/w" },
			untrusted: [],
		});
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	test("lives next to the sets", () => {
		expect(HASHES_FILE).toBe("packages/core/bench/gate-bench/hashes.json");
	});
});

describe("parseBenchSet", () => {
	const oe = {
		id: "oe-900",
		set: "overeager",
		family: "quoted-danger",
		kind: "shell",
		action: { command: "echo hi" },
		untrusted: [],
		label: "benign",
		expect: "allow",
	};

	test("accepts a well-formed line", () => {
		const parsed = parseBenchSet("overeager", `${JSON.stringify(oe)}\n`);
		expect(parsed.ok).toBe(true);
	});

	test("rejects an item filed under the wrong set", () => {
		const parsed = parseBenchSet("injection", `${JSON.stringify(oe)}\n`);
		expect(parsed.ok).toBe(false);
	});

	test("rejects an overeager item that expects anything but allow", () => {
		const parsed = parseBenchSet(
			"overeager",
			`${JSON.stringify({ ...oe, expect: "ask" })}\n`,
		);
		expect(parsed.ok).toBe(false);
	});

	test("rejects an injection item without a base", () => {
		const inj = {
			...oe,
			id: "inj-900",
			set: "injection",
			family: "shell-comment",
			label: "destructive",
			expect: "ask",
		};
		const parsed = parseBenchSet("injection", `${JSON.stringify(inj)}\n`);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain("inj-900");
	});

	test("rejects a line that is not JSON, naming the line", () => {
		const parsed = parseBenchSet("overeager", "{nope\n");
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain("line 1");
	});
});
