/**
 * The precomputed backend (#572, option b): an async model (onnxruntime's
 * `run()`) infers before the gate runs, and core's synchronous `decide` reads
 * the outputs through this backend. It answers an input it was given answers
 * for, matching question ids loosely (the runtime plans before the gate
 * mints ids); anything else, or a failed pre-inference, is an error, so the
 * caller fails closed.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../policy/defaults";
import { precomputedBackend } from "../backends/precomputed";
import { decide } from "../decide";
import { createRegistry, withBackend } from "../registry";
import type { BackendAnswer, BackendInput } from "../types";

const input = (id: string, reversed = false): BackendInput => ({
	type: "action.risk",
	state: {
		trusted: { eventKind: "shell", rule: "no_rule" },
		untrusted: { action: { command: "ls" } },
	},
	questions: [
		{
			kind: "choice",
			id,
			options: reversed ? ["deny", "ask", "allow"] : ["allow", "ask", "deny"],
		},
	],
	policy: DEFAULT_POLICY,
});

const allowAnswer = (options: readonly string[]): BackendAnswer => ({
	answer: "allow",
	distribution: options.map((o) => ({ answer: o, p: o === "allow" ? 1 : 0 })),
});

const META = { id: "system1", version: "onnx-test" } as const;

describe("precomputedBackend", () => {
	test("answers a precomputed input synchronously, whatever its question ids", () => {
		const backend = precomputedBackend(META, {
			ok: true,
			value: [
				{
					input: input("plan"),
					answers: [allowAnswer(["allow", "ask", "deny"])],
				},
			],
		});
		expect(backend.id).toBe("system1");
		expect(backend.version).toBe("onnx-test");
		const result = backend.answer(input("d1"));
		expect(result).not.toBeInstanceOf(Promise);
		expect(result).toEqual({
			ok: true,
			value: [allowAnswer(["allow", "ask", "deny"])],
		});
	});

	test("keeps each order's answers apart", () => {
		const reversedAnswer = allowAnswer(["deny", "ask", "allow"]);
		const backend = precomputedBackend(META, {
			ok: true,
			value: [
				{
					input: input("plan"),
					answers: [allowAnswer(["allow", "ask", "deny"])],
				},
				{ input: input("plan", true), answers: [reversedAnswer] },
			],
		});
		expect(backend.answer(input("d1:reversed", true))).toEqual({
			ok: true,
			value: [reversedAnswer],
		});
	});

	test("an input with no precomputed answer is unsupported", () => {
		const backend = precomputedBackend(META, { ok: true, value: [] });
		const result = backend.answer(input("d1"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("unsupported");
			expect(result.error.message).toContain("precomputed");
		}
	});

	test("an input under another policy is not served the planned answer", () => {
		const backend = precomputedBackend(META, {
			ok: true,
			value: [
				{
					input: input("plan"),
					answers: [allowAnswer(["allow", "ask", "deny"])],
				},
			],
		});
		const other: BackendInput = {
			...input("d1"),
			policy: withBackend(DEFAULT_POLICY, "action.risk", "heuristic"),
		};
		expect(backend.answer(other).ok).toBe(false);
	});

	test("a changed state is not served another state's answer", () => {
		const backend = precomputedBackend(META, {
			ok: true,
			value: [
				{
					input: input("plan"),
					answers: [allowAnswer(["allow", "ask", "deny"])],
				},
			],
		});
		const other: BackendInput = {
			...input("d1"),
			state: { trusted: {}, untrusted: { action: { command: "rm -rf /" } } },
		};
		expect(backend.answer(other).ok).toBe(false);
	});

	test("a failed pre-inference answers every input with its error", () => {
		const backend = precomputedBackend(META, {
			ok: false,
			error: {
				kind: "unsupported",
				questionId: undefined,
				message: "onnx session failed",
			},
		});
		const result = backend.answer(input("d1"));
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "unsupported",
				questionId: undefined,
				message: "onnx session failed",
			},
		});
	});

	test("carries the model's calibration onto every decision it answers (#338)", () => {
		const calibration = {
			sha256: "c".repeat(64),
			thresholds: { "diff.sensitive": { confidence: 0.8 } },
		};
		const policy = withBackend(DEFAULT_POLICY, "action.risk", "system1");
		const backend = precomputedBackend(
			{ ...META, calibration },
			{
				ok: true,
				value: [
					{
						input: { ...input("plan"), policy },
						answers: [allowAnswer(["allow", "ask", "deny"])],
					},
				],
			},
		);
		expect(backend.calibration).toEqual(calibration);
		const result = decide(
			{ clock: { now: () => 0 }, policy, backends: createRegistry([backend]) },
			input("q1"),
		);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value[0]?.backend.calibration).toEqual(calibration);
		// Without one, none is invented.
		expect(precomputedBackend(META, { ok: true, value: [] }).calibration).toBe(
			undefined,
		);
	});

	test("serves synchronous decide once registered", () => {
		const policy = withBackend(DEFAULT_POLICY, "action.risk", "system1");
		const backend = precomputedBackend(META, {
			ok: true,
			value: [
				{
					input: { ...input("plan"), policy },
					answers: [allowAnswer(["allow", "ask", "deny"])],
				},
			],
		});
		const request = input("q1");
		const result = decide(
			{
				clock: { now: () => 0 },
				policy,
				backends: createRegistry([backend]),
			},
			request,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.map((d) => [d.id, d.answer, d.backend.id])).toEqual([
				["q1", "allow", "system1"],
			]);
		}
	});
});
