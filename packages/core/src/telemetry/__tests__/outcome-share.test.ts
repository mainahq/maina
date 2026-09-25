/**
 * Opt-in outcome sharing (FR-DEC-7, FR-PRIV-2): the payload carries decision
 * metadata and the outcome label, nothing else. A schema test pins the exact
 * shape; a seeded property test puts random code and paths into every free
 * field of the decision and outcome and checks none of it reaches the payload.
 */

import { describe, expect, test } from "bun:test";
import { hashValue } from "../../decide/log/hash";
import type { DecisionRecord } from "../../decide/log/schema";
import { OUTCOMES, type OutcomeRecord } from "../../decide/outcomes/types";
import {
	buildOutcomeSharePayload,
	validateOutcomeSharePayload,
} from "../outcome-share";

const HASH = hashValue("model");

const SLOP: DecisionRecord = {
	id: "dec-1",
	ts: 1_700_000_000_000,
	type: "slop",
	inputHash: HASH,
	schemaHash: HASH,
	optionOrder: [true, false],
	policyHash: HASH,
	modelHash: HASH,
	distribution: [
		{ answer: true, p: 0.75 },
		{ answer: false, p: 0.25 },
	],
	answer: true,
	finalAction: "flag",
	latencyMs: 4.5,
	host: "claude-code",
	sessionId: "sess-1",
};

const DISMISSED: OutcomeRecord = {
	id: "out-1",
	decisionId: "dec-1",
	outcome: "dismissed",
	source: "gate",
	ref: "0123456789abcdef0123456789abcdef01234567",
	ts: 1_700_000_001_000,
};

function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
	if (!r.ok) throw new Error(JSON.stringify(r.error));
	return r.value;
}

describe("outcome share payload — schema", () => {
	test("carries exactly the decision metadata and the outcome label", () => {
		const payload = unwrap(buildOutcomeSharePayload(SLOP, DISMISSED));
		expect(payload).toEqual({
			v: 1,
			decision: {
				type: "slop",
				modelHash: HASH,
				answer: true,
				confidence: 0.75,
				finalAction: "flag",
				latencyMs: 5,
				host: "claude-code",
			},
			outcome: "dismissed",
		});
	});

	test("top-level and decision keys are a closed set", () => {
		const payload = unwrap(buildOutcomeSharePayload(SLOP, DISMISSED));
		expect(Object.keys(payload).sort()).toEqual(["decision", "outcome", "v"]);
		for (const key of Object.keys(payload.decision)) {
			expect([
				"type",
				"modelHash",
				"answer",
				"confidence",
				"finalAction",
				"latencyMs",
				"host",
			]).toContain(key);
		}
		expect(OUTCOMES).toContain(payload.outcome);
	});

	test("never carries ids, timestamps, hashes of the input, refs or sources", () => {
		const json = JSON.stringify(
			unwrap(buildOutcomeSharePayload(SLOP, DISMISSED)),
		);
		for (const leak of [
			"dec-1",
			"out-1",
			"sess-1",
			"gate",
			DISMISSED.ref as string,
			String(SLOP.ts),
			String(DISMISSED.ts),
		]) {
			expect(json).not.toContain(leak);
		}
	});

	test("a free-form answer is dropped, a fixed catalog option is kept", () => {
		const tier: DecisionRecord = {
			...SLOP,
			type: "task.tier",
			optionOrder: ["mechanical", "standard", "architectural", "local"],
			distribution: [
				{ answer: "mechanical", p: 0.7 },
				{ answer: "standard", p: 0.1 },
				{ answer: "architectural", p: 0.1 },
				{ answer: "local", p: 0.1 },
			],
			answer: "mechanical",
		};
		expect(
			unwrap(buildOutcomeSharePayload(tier, DISMISSED)).decision.answer,
		).toBe("mechanical");

		const hashed = hashValue("src/secret.ts");
		const select: DecisionRecord = {
			...SLOP,
			type: "context.select",
			optionOrder: [hashed, hashValue("b")],
			distribution: [
				{ answer: hashed, p: 0.6 },
				{ answer: hashValue("b"), p: 0.4 },
			],
			answer: hashed,
		};
		const payload = unwrap(buildOutcomeSharePayload(select, DISMISSED));
		expect("answer" in payload.decision).toBe(false);
		expect(payload.decision.confidence).toBe(0.6);
		expect(JSON.stringify(payload)).not.toContain(hashed);
	});

	test("an outcome linked to another decision is rejected", () => {
		const result = buildOutcomeSharePayload(SLOP, {
			...DISMISSED,
			decisionId: "dec-2",
		});
		expect(result.ok).toBe(false);
	});

	test("the validator accepts built payloads and rejects anything extra", () => {
		const payload = unwrap(buildOutcomeSharePayload(SLOP, DISMISSED));
		expect(validateOutcomeSharePayload(payload).ok).toBe(true);
		expect(
			validateOutcomeSharePayload({ ...payload, path: "/etc/passwd" }).ok,
		).toBe(false);
		expect(
			validateOutcomeSharePayload({
				...payload,
				decision: { ...payload.decision, code: "const a = 1" },
			}).ok,
		).toBe(false);
		expect(
			validateOutcomeSharePayload({
				...payload,
				decision: { ...payload.decision, answer: "src/secret.ts" },
			}).ok,
		).toBe(false);
		expect(
			validateOutcomeSharePayload({ ...payload, outcome: "src/a.ts" }).ok,
		).toBe(false);
		expect(
			validateOutcomeSharePayload({
				...payload,
				decision: { ...payload.decision, finalAction: "rm -rf /" },
			}).ok,
		).toBe(false);
	});
});

// ── Property test ───────────────────────────────────────────────────────────

const SEED = 0x5eed306;
const RUNS = 300;

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
	"function ",
	"return ",
	"import ",
	"=> ",
	"{ ",
	"} ",
	"(",
	")",
	";",
	"\n",
	" = ",
	'"',
	"`${",
	"// ",
	"password",
	"process.env.SECRET",
	"SELECT * FROM users",
	"é",
	"\\",
];

function generator(next: () => number) {
	const pick = <T>(xs: readonly T[]): T =>
		xs[Math.floor(next() * xs.length)] as T;
	const ident = () =>
		Array.from({ length: 4 + Math.floor(next() * 8) }, () =>
			pick([..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$"]),
		).join("");
	const code = () =>
		`${ident()}(${Array.from({ length: 4 + Math.floor(next() * 10) }, () =>
			next() < 0.5 ? pick(FRAGMENTS) : ident(),
		).join("")});`;
	const path = () => {
		const segs = Array.from(
			{ length: 2 + Math.floor(next() * 4) },
			() => `${ident()}${Math.floor(next() * 1e6).toString(36)}`,
		);
		return next() < 0.5
			? `/Users/${segs.join("/")}.ts`
			: `C:\\repo\\${segs.join("\\")}.py`;
	};
	return { code, path };
}

describe(`outcome share payload — property (seed ${SEED.toString(16)})`, () => {
	test(`no code or path reaches the payload in ${RUNS} random records`, () => {
		const next = prng(SEED);
		const gen = generator(next);
		for (let i = 0; i < RUNS; i++) {
			const [a, b, c, d, e] = [
				gen.path(),
				gen.code(),
				gen.path(),
				gen.code(),
				gen.path(),
			];
			const p = 0.5 + next() * 0.4;
			// Raw free-form options, as a log kept with `rawOptions: true` holds.
			const decision: DecisionRecord = {
				...SLOP,
				id: `dec-${i}`,
				type: "context.select",
				optionOrder: [a, b],
				distribution: [
					{ answer: a, p },
					{ answer: b, p: 1 - p },
				],
				answer: a,
				inputHash: hashValue(d),
				schemaHash: hashValue(c),
				sessionId: `s-${i}`,
			};
			const outcome: OutcomeRecord = {
				...DISMISSED,
				decisionId: decision.id,
				outcome: OUTCOMES[i % OUTCOMES.length] as OutcomeRecord["outcome"],
				ref: e,
				source: "git",
			};
			const payload = unwrap(buildOutcomeSharePayload(decision, outcome));
			expect(validateOutcomeSharePayload(payload).ok).toBe(true);
			const json = JSON.stringify(payload);
			for (const secret of [a, b, c, d, e]) {
				expect(json).not.toContain(JSON.stringify(secret).slice(1, -1));
			}
			for (const hash of [decision.inputHash, decision.schemaHash]) {
				expect(json).not.toContain(hash);
			}
			expect(json).not.toMatch(/\/Users\/|C:\\\\repo/);
		}
	});
});
