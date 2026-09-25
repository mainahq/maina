import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../../policy/defaults";
import {
	canonicalJson,
	hashInput,
	hashModel,
	hashPolicy,
	hashSchema,
	hashValue,
	isHash,
} from "../hash";
import { recordFor, SLOP_REQUEST, TIER_REQUEST } from "./fixtures";

describe("canonicalJson", () => {
	test("sorts object keys so key order never changes the output", () => {
		expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe(
			'{"a":[true,null,"x"],"b":1}',
		);
		expect(canonicalJson({ a: [true, null, "x"], b: 1 })).toBe(
			canonicalJson({ b: 1, a: [true, null, "x"] }),
		);
	});

	test("never throws on values JSON.stringify rejects", () => {
		const cyclic: Record<string, unknown> = { a: 1 };
		cyclic.self = cyclic;
		const values: readonly unknown[] = [
			10n,
			cyclic,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			new Date(Number.NaN),
			new Map([["k", 1]]),
			new Set([2, 1]),
			new Uint8Array([1, 2]),
			undefined,
			() => 1,
			Symbol("s"),
		];
		for (const value of values) {
			expect(typeof canonicalJson(value)).toBe("string");
		}
	});

	test("array holes encode as null, like JSON (valid JSON output)", () => {
		// biome-ignore lint/suspicious/noSparseArray: the hole is the point
		const sparse = [, 1];
		expect(canonicalJson(sparse)).toBe("[null,1]");
		expect(canonicalJson(sparse)).toBe(canonicalJson([undefined, 1]));
		expect(JSON.parse(canonicalJson({ a: sparse }))).toEqual({ a: [null, 1] });
	});

	test("a plain object never encodes like a tagged form", () => {
		const date = new Date(0);
		expect(canonicalJson({ $date: date.toISOString() })).not.toBe(
			canonicalJson(date),
		);
		expect(canonicalJson({ $set: [1, 2] })).not.toBe(
			canonicalJson(new Set([1, 2])),
		);
		expect(canonicalJson({ $bigint: "10" })).not.toBe(canonicalJson(10n));
		expect(canonicalJson({ $circular: true })).not.toBe(
			canonicalJson({ $$circular: true }),
		);
	});

	test("distinguishes values JSON.stringify would conflate", () => {
		expect(canonicalJson(Number.NaN)).not.toBe(canonicalJson(null));
		expect(canonicalJson(10n)).not.toBe(canonicalJson("10"));
		expect(canonicalJson(new Set([1, 2]))).toBe(canonicalJson(new Set([2, 1])));
	});
});

describe("hashes are stable across runs", () => {
	test("hashValue is sha256 of the canonical JSON (pinned)", () => {
		expect(hashValue({ b: 1, a: [true, null, "x"] })).toBe(
			"sha256:54a65415ad370228851a1da4b31b6fd42dc58b19a50d35cae759325f7388ce64",
		);
	});

	test("hashInput is pinned for a fixed request", () => {
		const [question] = SLOP_REQUEST.questions;
		expect(
			hashInput(SLOP_REQUEST.type, SLOP_REQUEST.state, question?.id ?? ""),
		).toBe(
			"sha256:72f797ed53d8f461c5b4cc538d1eaf1a1d755cf6c66abd35a2056ab27db3d614",
		);
	});

	test("independently built equal inputs hash equal", () => {
		const a = hashInput(
			"slop",
			{ trusted: { x: 1, y: 2 }, untrusted: { text: "t" } },
			"q",
		);
		const b = hashInput(
			"slop",
			{ untrusted: { text: "t" }, trusted: { y: 2, x: 1 } },
			"q",
		);
		expect(a).toBe(b);
		expect(hashPolicy(DEFAULT_POLICY)).toBe(
			hashPolicy(structuredClone(DEFAULT_POLICY)),
		);
		expect(hashModel({ id: "heuristic", version: "1" })).toBe(
			hashModel({ version: "1", id: "heuristic" }),
		);
	});

	test("different inputs hash differently", () => {
		const state = { trusted: {}, untrusted: { text: "a" } };
		expect(hashInput("slop", state, "q1")).not.toBe(
			hashInput("slop", state, "q2"),
		);
		expect(hashInput("slop", state, "q")).not.toBe(
			hashInput("finding.real", state, "q"),
		);
		expect(hashModel({ id: "heuristic", version: "1" })).not.toBe(
			hashModel({ id: "heuristic", version: "2" }),
		);
		expect(
			hashSchema("task.tier", {
				kind: "choice",
				id: "t",
				options: ["mechanical", "standard"],
			}),
		).not.toBe(
			hashSchema("task.tier", {
				kind: "choice",
				id: "t",
				options: ["standard", "mechanical"],
			}),
		);
	});

	test("the schema hash ignores the question id", () => {
		expect(hashSchema("slop", { kind: "bool", id: "a" })).toBe(
			hashSchema("slop", { kind: "bool", id: "b" }),
		);
	});

	test("records built twice from the same request carry identical hashes", () => {
		for (const request of [SLOP_REQUEST, TIER_REQUEST]) {
			const first = recordFor(request);
			const second = recordFor(structuredClone(request));
			expect(second.inputHash).toBe(first.inputHash);
			expect(second.schemaHash).toBe(first.schemaHash);
			expect(second.policyHash).toBe(first.policyHash);
			expect(second.modelHash).toBe(first.modelHash);
			for (const hash of [
				first.inputHash,
				first.schemaHash,
				first.policyHash,
				first.modelHash,
			]) {
				expect(isHash(hash)).toBe(true);
			}
		}
	});
});

describe("isHash", () => {
	test("accepts only sha256:<64 lower-case hex>", () => {
		expect(isHash(`sha256:${"a".repeat(64)}`)).toBe(true);
		expect(isHash(`sha256:${"A".repeat(64)}`)).toBe(false);
		expect(isHash(`sha256:${"a".repeat(63)}`)).toBe(false);
		expect(isHash("a".repeat(64))).toBe(false);
		expect(isHash(42)).toBe(false);
	});
});
