/**
 * The `decision` producer (#591, spec §6.3): each decision-log record
 * becomes one metadata event of hashes, labels and numbers.
 */

import { describe, expect, test } from "bun:test";
import type { DecisionRecord } from "@mainahq/core";
import { decisionEvent, emitDecision } from "../decision";
import { asWireEvent, capturingSink, HASH_A, HASH_B, HASH_C } from "./helpers";

function record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
	return {
		id: "d-1",
		ts: 1_000,
		type: "action.risk",
		inputHash: HASH_A,
		schemaHash: HASH_B,
		optionOrder: ["allow", "ask", "deny"],
		policyHash: HASH_B,
		modelHash: HASH_C,
		distribution: [
			{ answer: "allow", p: 0.9412 },
			{ answer: "ask", p: 0.0488 },
			{ answer: "deny", p: 0.01 },
		],
		answer: "allow",
		finalAction: "allow",
		latencyMs: 6.6,
		host: "claude-code",
		sessionId: "0b5c3f5e-2d7a-4a53-9a51-3b1f4f0c9d11",
		...overrides,
	};
}

describe("decisionEvent", () => {
	test("validates against the pinned schema", () => {
		const input = decisionEvent(record());
		expect(input).not.toBeNull();
		if (input === null) return;
		const event = asWireEvent(input);
		expect(event.type).toBe("decision");
		expect(event.dataClass).toBe("metadata");
		expect(event.data).toEqual({
			decisionType: "action.risk",
			inputHash: HASH_A,
			policyHash: HASH_B,
			modelHash: HASH_C,
			finalAction: "allow",
			confidenceBp: 9412,
			latencyMs: 7,
			host: "claude-code",
			sessionId: "0b5c3f5e-2d7a-4a53-9a51-3b1f4f0c9d11",
		});
	});

	test("confidence is the answer's probability; a score is certain", () => {
		const ask = decisionEvent(record({ answer: "ask", finalAction: "ask" }));
		expect(ask?.data.confidenceBp).toBe(488);
		const score = decisionEvent(
			record({
				type: "spec.quality",
				optionOrder: [],
				distribution: [{ answer: 0.7, p: 1 }],
				answer: 0.7,
			}),
		);
		expect(score?.data.confidenceBp).toBe(10_000);
		if (score !== null) asWireEvent(score);
	});

	test("the schema, the option order and the distribution never leave", () => {
		const data = decisionEvent(record())?.data ?? {};
		for (const field of [
			"schemaHash",
			"optionOrder",
			"distribution",
			"answer",
			"id",
		]) {
			expect(Object.hasOwn(data, field)).toBe(false);
		}
	});

	test("a host or session that is not an opaque label is left out", () => {
		const input = decisionEvent(
			record({ host: "Claude Code", sessionId: "repo:src.main" }),
		);
		expect(input?.data.host).toBeUndefined();
		expect(input?.data.sessionId).toBeUndefined();
		if (input !== null) asWireEvent(input);
	});

	test("a record without real hashes is not sent", () => {
		expect(decisionEvent(record({ inputHash: "not-a-hash" }))).toBeNull();
	});
});

describe("emitDecision", () => {
	test("enqueues the event on the sink", () => {
		const { sink, inputs } = capturingSink();
		const emitted = emitDecision(sink, record());
		expect(emitted).toEqual({
			ok: true,
			value: { queued: true, eventId: "evt_1", seq: 1 },
		});
		expect(inputs.map((i) => i.type)).toEqual(["decision"]);
	});

	test("an unrepresentable record enqueues nothing", () => {
		const { sink, inputs } = capturingSink();
		const emitted = emitDecision(sink, record({ policyHash: "x" }));
		expect(emitted).toEqual({
			ok: true,
			value: { queued: false, reason: "unrepresentable" },
		});
		expect(inputs).toEqual([]);
	});
});
