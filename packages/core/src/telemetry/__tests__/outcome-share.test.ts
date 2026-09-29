/**
 * Opt-in outcome sharing (FR-DEC-7, FR-PRIV-2): the payload carries decision
 * metadata and the outcome label, nothing else. A schema test pins the exact
 * shape; a seeded property test puts random code and paths into every free
 * field of the decision and outcome and checks none of it reaches the payload.
 */

import { describe, expect, test } from "bun:test";
import type { Result } from "../../db/index";
import { hashValue } from "../../decide/log/hash";
import type { DecisionRecord } from "../../decide/log/schema";
import { OUTCOMES, type OutcomeRecord } from "../../decide/outcomes/types";
import type { NetworkError, NetworkRequest } from "../../ports/network";
import { createFakeEnv, createMemoryFs } from "../../ports/testing";
import {
	buildOutcomeSharePayload,
	chunkOutcomePayloads,
	OUTCOME_SHARE_MAX_BYTES,
	OUTCOME_SHARE_MAX_PER_REQUEST,
	type OutcomeSharePayload,
	shareOutcomes,
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
			optionOrder: ["mechanical", "standard", "architectural"],
			distribution: [
				{ answer: "mechanical", p: 0.8 },
				{ answer: "standard", p: 0.1 },
				{ answer: "architectural", p: 0.1 },
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

// ── Chunking (#661) ─────────────────────────────────────────────────────────
// The cloud's POST /v1/outcomes takes at most 100 items and 64 KiB per
// request and stores a batch whole or not at all; over either cap it answers
// 413. A share is split into requests under both caps, sums what each 202
// took, and stops at the first failure so nothing is sent twice.

const HOME = "/home/dev";

function pairs(
	n: number,
): Array<{ decision: DecisionRecord; outcome: OutcomeRecord }> {
	return Array.from({ length: n }, (_, i) => ({
		decision: { ...SLOP, id: `dec-${i}` },
		outcome: { ...DISMISSED, id: `out-${i}`, decisionId: `dec-${i}` },
	}));
}

/** Answers each POST with the next status in `statuses` (202 once they run out). */
function scriptedNetwork(statuses: readonly number[] = []) {
	const calls: NetworkRequest[] = [];
	return {
		post: async (
			request: NetworkRequest,
		): Promise<Result<{ status: number }, NetworkError>> => {
			const status = statuses[calls.length] ?? 202;
			calls.push(request);
			return status >= 200 && status < 300
				? { ok: true, value: { status } }
				: { ok: false, error: { kind: "http", url: request.url, status } };
		},
		calls: () => [...calls],
	};
}

function optedInPorts(statuses: readonly number[] = []) {
	return {
		fs: createMemoryFs({
			[`${HOME}/.maina/policy.json`]: JSON.stringify({
				telemetry: { outcome_sharing: true },
			}),
		}),
		env: createFakeEnv({ HOME }),
		network: scriptedNetwork(statuses),
	};
}

function sizes(calls: readonly NetworkRequest[]): number[] {
	return calls.map(
		(c) => (JSON.parse(c.body) as { outcomes: unknown[] }).outcomes.length,
	);
}

const BASE = { baseUrl: "https://cloud.test" };
const URL_ = "https://cloud.test/v1/outcomes";

describe("shareOutcomes — chunked to the server caps", () => {
	test("the caps match the cloud contract", () => {
		expect(OUTCOME_SHARE_MAX_PER_REQUEST).toBe(100);
		expect(OUTCOME_SHARE_MAX_BYTES).toBe(65_536);
	});

	test("250 outcomes go as three posts of 100, 100 and 50", async () => {
		const ports = optedInPorts();
		const result = await shareOutcomes(ports, pairs(250), BASE);
		expect(result).toEqual({ ok: true, value: { sent: 250 } });
		expect(sizes(ports.network.calls())).toEqual([100, 100, 50]);
		for (const call of ports.network.calls()) {
			expect(call.url).toBe(URL_);
			expect(new TextEncoder().encode(call.body).length).toBeLessThanOrEqual(
				OUTCOME_SHARE_MAX_BYTES,
			);
		}
	});

	test("exactly 100 outcomes go as one post", async () => {
		const ports = optedInPorts();
		const result = await shareOutcomes(ports, pairs(100), BASE);
		expect(result).toEqual({ ok: true, value: { sent: 100 } });
		expect(sizes(ports.network.calls())).toEqual([100]);
	});

	test("101 outcomes go as two posts of 100 and 1", async () => {
		const ports = optedInPorts();
		const result = await shareOutcomes(ports, pairs(101), BASE);
		expect(result).toEqual({ ok: true, value: { sent: 101 } });
		expect(sizes(ports.network.calls())).toEqual([100, 1]);
	});

	test("an invalid item anywhere sends nothing at all", async () => {
		const ports = optedInPorts();
		const items = pairs(250);
		items[200] = {
			decision: SLOP,
			outcome: { ...DISMISSED, decisionId: "dec-other" },
		};
		const result = await shareOutcomes(ports, items, BASE);
		expect(result.ok).toBe(false);
		expect(ports.network.calls()).toEqual([]);
	});

	test("a 429 stops the share and reports what was already sent", async () => {
		const ports = optedInPorts([202, 429]);
		const result = await shareOutcomes(ports, pairs(250), BASE);
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "rate_limited",
				sent: 100,
				error: { kind: "http", url: URL_, status: 429 },
			},
		});
		expect(ports.network.calls()).toHaveLength(2);
	});

	test("a 413 stops the share with a payload_too_large error", async () => {
		const ports = optedInPorts([413]);
		const result = await shareOutcomes(ports, pairs(150), BASE);
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "payload_too_large",
				sent: 0,
				error: { kind: "http", url: URL_, status: 413 },
			},
		});
		expect(ports.network.calls()).toHaveLength(1);
	});

	test("any other failure stops the share as a network error", async () => {
		const ports = optedInPorts([202, 202, 503]);
		const result = await shareOutcomes(ports, pairs(350), BASE);
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "network",
				sent: 200,
				error: { kind: "http", url: URL_, status: 503 },
			},
		});
		expect(ports.network.calls()).toHaveLength(3);
	});
});

describe("chunkOutcomePayloads", () => {
	const payloads: OutcomeSharePayload[] = pairs(30).map(
		({ decision, outcome }) =>
			unwrap(buildOutcomeSharePayload(decision, outcome)),
	);
	const bodyBytes = (chunk: readonly OutcomeSharePayload[]) =>
		new TextEncoder().encode(JSON.stringify({ outcomes: chunk })).length;

	test("no payloads make no chunks", () => {
		expect(
			unwrap(chunkOutcomePayloads([], { maxItems: 100, maxBytes: 65_536 })),
		).toEqual([]);
	});

	test("splits on the item cap, keeping order", () => {
		const chunks = unwrap(
			chunkOutcomePayloads(payloads, { maxItems: 7, maxBytes: 65_536 }),
		);
		expect(chunks.map((c) => c.length)).toEqual([7, 7, 7, 7, 2]);
		expect(chunks.flat()).toEqual(payloads);
	});

	test("splits on the byte cap: every body fits, none could take one more", () => {
		const maxBytes = bodyBytes(payloads.slice(0, 4));
		const chunks = unwrap(
			chunkOutcomePayloads(payloads, { maxItems: 100, maxBytes }),
		);
		expect(chunks.map((c) => c.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 2]);
		expect(chunks.flat()).toEqual(payloads);
		chunks.forEach((chunk, i) => {
			expect(bodyBytes(chunk)).toBeLessThanOrEqual(maxBytes);
			const next = chunks[i + 1]?.[0];
			if (next !== undefined) {
				expect(bodyBytes([...chunk, next])).toBeGreaterThan(maxBytes);
			}
		});
	});

	test("a payload that alone exceeds the byte cap is an error", () => {
		const result = chunkOutcomePayloads(payloads, {
			maxItems: 100,
			maxBytes: 10,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("invalid_payload");
	});
});
