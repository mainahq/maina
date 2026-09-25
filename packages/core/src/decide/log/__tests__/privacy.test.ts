/**
 * Property test: whatever code or paths a decision was made over, no stored
 * field carries them. Random code strings come from a seeded generator so a
 * failure reproduces; the seed is in the test name.
 */

import { describe, expect, test } from "bun:test";
import { createRegistry, DEFAULT_REGISTRY } from "../../registry";
import type { Backend, DecideRequest } from "../../types";
import { appendDecision } from "../append";
import { queryDecisions } from "../query";
import type { DecisionRecord } from "../schema";
import { decidePorts, migratedDb, recordFor, unwrap } from "./fixtures";

const SEED = 0x5eed303;
const RUNS = 200;

/** mulberry32: a tiny deterministic PRNG. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const FRAGMENTS = [
	"const ",
	"let ",
	"function ",
	"return ",
	"import ",
	"export ",
	"=> ",
	"{ ",
	"} ",
	"(",
	")",
	";",
	"\n",
	"\t",
	" = ",
	"===",
	'"',
	"'",
	"`${",
	"}`",
	"// ",
	"/* */",
	"password",
	"apiKey",
	"process.env.SECRET",
	"SELECT * FROM users",
	"<script>",
	"é",
	"🙂",
	"\\",
];

function randomCode(next: () => number): string {
	const pick = <T>(xs: readonly T[]): T =>
		xs[Math.floor(next() * xs.length)] as T;
	const ident = () =>
		Array.from({ length: 3 + Math.floor(next() * 8) }, () =>
			pick([
				..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$0123456789",
			]),
		).join("");
	const parts = Array.from({ length: 4 + Math.floor(next() * 12) }, () =>
		next() < 0.5 ? pick(FRAGMENTS) : ident(),
	);
	// Always long enough and never a bare word, so a hit is never chance.
	return `${ident()}(${parts.join("")});`;
}

function randomPath(next: () => number): string {
	const seg = () => Math.floor(next() * 1e9).toString(36);
	return `src/${seg()}/${seg()}-${seg()}.ts`;
}

/** Answers every choice uniformly, picking the first option. */
const uniformBackend: Backend = {
	id: "heuristic",
	version: "test",
	answer: ({ questions }) => ({
		ok: true,
		value: questions.map((q) => {
			const options: readonly (string | boolean)[] =
				q.kind === "choice" ? q.options : [true, false];
			return {
				answer: options[0] as string | boolean,
				distribution: options.map((answer) => ({
					answer,
					p: 1 / options.length,
				})),
			};
		}),
	}),
};

function leaks(haystack: string, secrets: readonly string[]): string[] {
	return secrets.filter((s) => haystack.includes(s));
}

const TIER_ONLY: DecideRequest = {
	type: "task.tier",
	state: { trusted: { task: "commit" }, untrusted: {} },
	questions: [
		{
			kind: "choice",
			id: "tier",
			options: ["mechanical", "standard", "architectural", "local"],
		},
	],
};

describe("no field contains raw file content (property)", () => {
	test(`${RUNS} random code strings and paths, seed ${SEED}`, () => {
		const next = prng(SEED);
		const db = migratedDb();
		const ports = decidePorts({
			backends: createRegistry([...DEFAULT_REGISTRY.values(), uniformBackend]),
		});
		const secrets: string[] = [];

		for (let i = 0; i < RUNS; i++) {
			const code = randomCode(next);
			const pathA = randomPath(next);
			const pathB = randomPath(next);
			secrets.push(code, pathA, pathB);

			const requests: readonly DecideRequest[] = [
				{
					type: "context.select",
					state: {
						trusted: { nodes: [pathA, pathB] },
						untrusted: { diff: code, file: pathA },
					},
					questions: [{ kind: "choice", id: "pick", options: [pathA, pathB] }],
				},
				{
					type: "slop",
					state: { trusted: {}, untrusted: { text: code, path: pathB } },
					questions: [{ kind: "bool", id: "ai-console" }],
				},
			];
			for (const [j, request] of requests.entries()) {
				const record = recordFor(request, { id: `r${i}-${j}`, ports });
				expect(leaks(JSON.stringify(record), [code, pathA, pathB])).toEqual([]);
				unwrap(appendDecision({ db }, record));
			}
		}

		const rows = unwrap(db.all("SELECT * FROM decision_log"));
		expect(rows.length).toBe(RUNS * 2);
		const stored = rows
			.flatMap((row) => Object.values(row).map((v) => String(v)))
			.join("\u0000");
		expect(leaks(stored, secrets)).toEqual([]);
	});

	test("a hand-built record carrying raw content is rejected", () => {
		const next = prng(SEED + 1);
		const db = migratedDb();
		const base = recordFor({
			type: "task.tier",
			state: { trusted: { task: "commit" }, untrusted: {} },
			questions: [
				{
					kind: "choice",
					id: "tier",
					options: ["mechanical", "standard", "architectural", "local"],
				},
			],
		});
		for (let i = 0; i < 50; i++) {
			const code = randomCode(next);
			const tainted: readonly DecisionRecord[] = [
				{ ...base, id: `o${i}`, optionOrder: [code, ...base.optionOrder] },
				{ ...base, id: `a${i}`, answer: code },
				{
					...base,
					id: `d${i}`,
					distribution: [{ answer: code, p: 1 }],
				},
				{ ...base, id: `f${i}`, finalAction: code },
				{ ...base, id: `h${i}`, host: code },
			];
			for (const record of tainted) {
				expect(appendDecision({ db }, record).ok).toBe(false);
			}
		}
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([]);
	});

	test("rawOptions never lets a fixed-catalog type carry other strings", () => {
		const db = migratedDb();
		const raw = { rawOptions: true } as const;
		const base = recordFor(TIER_ONLY, { privacy: raw });
		const code = randomCode(prng(SEED + 2));
		const tainted: readonly DecisionRecord[] = [
			{ ...base, id: "o", optionOrder: [code, ...base.optionOrder] },
			{ ...base, id: "a", answer: code },
			{ ...base, id: "h", answer: `sha256:${"a".repeat(64)}` },
		];
		for (const record of tainted) {
			expect(appendDecision({ db, privacy: raw }, record).ok).toBe(false);
		}
		unwrap(appendDecision({ db, privacy: raw }, base));
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([base]);
	});

	test("free-form options are stored raw only when privacy allows it", () => {
		const db = migratedDb();
		const ports = decidePorts({
			backends: createRegistry([...DEFAULT_REGISTRY.values(), uniformBackend]),
		});
		const request: DecideRequest = {
			type: "context.select",
			state: { trusted: {}, untrusted: {} },
			questions: [
				{ kind: "choice", id: "pick", options: ["src/a.ts", "src/b.ts"] },
			],
		};
		const hashed = recordFor(request, { ports });
		expect(hashed.optionOrder).not.toContain("src/a.ts");
		expect(
			hashed.optionOrder.every((o) => String(o).startsWith("sha256:")),
		).toBe(true);
		expect(hashed.answer).toBe(hashed.optionOrder[0] as string);

		const raw = recordFor(request, {
			id: "raw",
			ports,
			privacy: { rawOptions: true },
		});
		expect(raw.optionOrder).toEqual(["src/a.ts", "src/b.ts"]);
		expect(appendDecision({ db }, raw).ok).toBe(false);
		unwrap(appendDecision({ db, privacy: { rawOptions: true } }, raw));
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([raw]);
	});
});
