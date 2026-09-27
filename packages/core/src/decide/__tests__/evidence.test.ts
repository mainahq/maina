import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFixedClock } from "../../ports/testing";
import { pythonCanonicalJson, REVERSED_SUFFIX } from "../encoding";
import {
	approxTokens,
	confidenceOf,
	LENGTH_BUCKETS,
	lengthBucket,
	OUTCOME_ERROR,
	readLogSlice,
	verdictOf,
} from "../evidence";
import {
	logDecision,
	outcomePorts,
	unwrap,
} from "../outcomes/__tests__/fixtures";
import { linkOutcome } from "../outcomes/link";
import { OUTCOMES } from "../outcomes/types";
import type { DecideRequest } from "../types";
import { riskRecord, SYSTEM1 } from "./slice-fixtures";

describe("confidenceOf", () => {
	test("the largest logged probability without diagnostics", () => {
		const record = riskRecord({
			id: "a",
			model: SYSTEM1,
			answer: "deny",
			p: 0.7,
		});
		expect(confidenceOf(record)).toBe(0.7);
	});

	test("the calibrated probability of the answer when the log has one (#577)", () => {
		const calibrated = [0.55, 0.25, 0.2];
		const ask = {
			...riskRecord({ id: "a", model: SYSTEM1, answer: "ask", p: 1 }),
			diagnostics: { calibrated },
		};
		expect(confidenceOf(ask)).toBe(0.25);
		const allow = {
			...riskRecord({ id: "b", model: SYSTEM1, answer: "allow", p: 0.55 }),
			diagnostics: { calibrated },
		};
		expect(confidenceOf(allow)).toBe(0.55);
	});
});

describe("readLogSlice", () => {
	test("keeps only the outcomes of decisions in the slice", () => {
		const { db } = outcomePorts();
		const clock = createFixedClock(5_000);
		for (const id of ["a", "b", "c"]) {
			logDecision(db, { id, type: "slop" });
			unwrap(
				linkOutcome({ db, clock }, id, { kind: "accepted", source: "gate" }),
			);
		}
		logDecision(db, { id: "d", type: "finding.real" });
		unwrap(
			linkOutcome({ db, clock }, "d", { kind: "dismissed", source: "gate" }),
		);

		const slice = unwrap(readLogSlice({ db }, { type: "slop", limit: 2 }));
		expect(slice.decisions.map((r) => r.id)).toEqual(["a", "b"]);
		expect(slice.outcomes.map((o) => o.decisionId)).toEqual(["a", "b"]);
	});
});

describe("OUTCOME_ERROR (#588)", () => {
	test("is exported with the error kind of every outcome", () => {
		expect(Object.keys(OUTCOME_ERROR).sort()).toEqual([...OUTCOMES].sort());
		expect(OUTCOME_ERROR).toEqual({
			accepted: null,
			override: "false_positive",
			dismissed: "false_positive",
			rejected: "false_positive",
			reverted: "false_negative",
			hotfixed: "false_negative",
			test_failed_after_allow: "false_negative",
		});
	});

	test("is frozen, so an importer cannot change what verdictOf reads", () => {
		expect(Object.isFrozen(OUTCOME_ERROR)).toBe(true);
	});

	test("is the table verdictOf reads", () => {
		for (const outcome of OUTCOMES) {
			const kind = OUTCOME_ERROR[outcome];
			expect(verdictOf([outcome])).toEqual(
				kind === null ? { kind: "right" } : { kind: "wrong", errors: [kind] },
			);
		}
	});
});

describe("verdictOf", () => {
	test("reads a decision's outcomes as right, wrong or unlabelled", () => {
		expect(verdictOf(undefined)).toEqual({ kind: "unlabelled" });
		expect(verdictOf([])).toEqual({ kind: "unlabelled" });
		expect(verdictOf(["accepted"])).toEqual({ kind: "right" });
		expect(verdictOf(["override", "dismissed", "rejected"])).toEqual({
			kind: "wrong",
			errors: ["false_positive", "false_positive", "false_positive"],
		});
		expect(
			verdictOf([
				"accepted",
				"reverted",
				"hotfixed",
				"test_failed_after_allow",
			]),
		).toEqual({
			kind: "wrong",
			errors: ["false_negative", "false_negative", "false_negative"],
		});
	});
});

// ── Length buckets (maina-model contracts/buckets.py) ───────────────────────

type ParityFixture = Readonly<{
	name: string;
	request: Readonly<{
		type: DecideRequest["type"];
		trusted: Readonly<Record<string, unknown>>;
		untrusted: Readonly<Record<string, unknown>>;
		questions: DecideRequest["questions"];
	}>;
	bucket: string;
	approxTokens: number;
}>;

const PARITY = JSON.parse(
	readFileSync(
		join(import.meta.dir, "..", "__fixtures__", "encoding-parity.json"),
		"utf-8",
	),
) as Readonly<{ fixtures: readonly ParityFixture[] }>;

const decideRequest = ({ request }: ParityFixture): DecideRequest => ({
	type: request.type,
	state: { trusted: request.trusted, untrusted: request.untrusted },
	questions: request.questions,
});

/** An action.risk request whose untrusted text is `n` bytes of padding. */
function padded(n: number, id = "d1"): DecideRequest {
	return {
		type: "action.risk",
		state: { trusted: {}, untrusted: { pad: "x".repeat(n) } },
		questions: [{ kind: "choice", id, options: ["allow", "ask", "deny"] }],
	};
}

/** The smallest padding whose request measures more than `edge` tokens. */
function firstPast(edge: number): number {
	let n = 0;
	while (approxTokens(padded(n)) <= edge && n <= 4 * edge) n += 1;
	return n;
}

describe("lengthBucket", () => {
	test("the buckets are the model's, in order", () => {
		expect(LENGTH_BUCKETS).toEqual(["le128", "le512", "le2048", "gt2048"]);
	});

	for (const f of PARITY.fixtures) {
		test(`parity with contracts/buckets.py: ${f.name}`, () => {
			const request = decideRequest(f);
			expect(approxTokens(request)).toBe(f.approxTokens);
			expect(lengthBucket(request) as string).toBe(f.bucket);
		});
	}

	test("measures ceil(utf-8 bytes / 4) of the Python canonical input", () => {
		const request = padded(10);
		const text = pythonCanonicalJson({
			questions: request.questions,
			trusted: {},
			type: "action.risk",
			untrusted: { pad: "x".repeat(10) },
		});
		expect(text).toBe(
			'{"questions":[{"id":"d1","kind":"choice","options":["allow","ask","deny"]}],"trusted":{},"type":"action.risk","untrusted":{"pad":"xxxxxxxxxx"}}',
		);
		expect(approxTokens(request)).toBe(Math.ceil(text.length / 4));
		// Non-ASCII counts in utf-8 bytes, not UTF-16 code units.
		const wide: DecideRequest = {
			...request,
			state: { trusted: {}, untrusted: { pad: "é".repeat(10) } },
		};
		expect(approxTokens(wide)).toBe(Math.ceil((text.length + 10) / 4));
	});

	test("each edge belongs to the bucket below it", () => {
		for (const [i, edge] of [128, 512, 2048].entries()) {
			const n = firstPast(edge);
			expect(approxTokens(padded(n - 1))).toBe(edge);
			expect(lengthBucket(padded(n - 1)) as string).toBe(
				LENGTH_BUCKETS[i] as string,
			);
			expect(lengthBucket(padded(n)) as string).toBe(
				LENGTH_BUCKETS[i + 1] as string,
			);
		}
	});

	test("the gate's reversed call shares its base's bucket, even at an edge", () => {
		const n = firstPast(128) - 1;
		const reversed = padded(n, `d1${REVERSED_SUFFIX}`);
		expect(approxTokens(reversed)).toBe(approxTokens(padded(n)));
		expect(lengthBucket(reversed)).toBe("le128");
		// Only a trailing suffix is removed.
		expect(lengthBucket(padded(n, `d1${REVERSED_SUFFIX}x`))).toBe("le512");
	});
});

describe("pythonCanonicalJson", () => {
	test("numbers read back from JavaScript's JSON print as Python prints them", () => {
		expect(
			pythonCanonicalJson([
				1.0,
				-0,
				1.5,
				1e-7,
				1e16,
				0.0001,
				1e22,
				123456789.123,
				-1.5e-10,
				1000000000000000.5,
				1e-5,
				5e-324,
				1.7976931348623157e308,
				Number.NaN,
			]),
		).toBe(
			"[1,0,1.5,1e-07,10000000000000000,0.0001,1e+22,123456789.123,-1.5e-10,1000000000000000.5,1e-05,5e-324,1.7976931348623157e+308,null]",
		);
	});

	test("keys sort by code point, which differs from UTF-16 above the BMP", () => {
		expect(pythonCanonicalJson({ "🎉": 2, Ａ: 1, "10": 0, "9": 0 })).toBe(
			'{"10":0,"9":0,"Ａ":1,"🎉":2}',
		);
	});

	test("strings escape like json.dumps(ensure_ascii=False)", () => {
		expect(pythonCanonicalJson({ s: '"\\\b\f\n\r\t\u0001é' })).toBe(
			'{"s":"\\"\\\\\\b\\f\\n\\r\\t\\u0001é"}',
		);
	});

	test("undefined object values are dropped, as JSON drops them", () => {
		expect(pythonCanonicalJson({ a: undefined, b: [undefined] })).toBe(
			'{"b":[null]}',
		);
	});
});
