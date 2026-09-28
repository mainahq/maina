/**
 * The `receipt` producer (#591, spec §6.3): a receipt reaches the cloud as
 * its summary and its hash, never its title, findings or walkthrough.
 */

import { describe, expect, test } from "bun:test";
import { emitReceipt, receiptEvent } from "../receipt";
import { asWireEvent, capturingSink, HASH_A } from "./helpers";

const COMMIT = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

describe("receiptEvent", () => {
	test("validates against the pinned schema", () => {
		const input = receiptEvent({ receiptHash: HASH_A, passed: true }, COMMIT);
		expect(input).not.toBeNull();
		if (input === null) return;
		const event = asWireEvent(input);
		expect(event.type).toBe("receipt");
		expect(event.dataClass).toBe("metadata");
		expect(event.data).toEqual({
			receiptHash: HASH_A,
			passed: true,
			commit: COMMIT,
		});
	});

	test("the commit is optional and must be a full sha", () => {
		expect(receiptEvent({ receiptHash: HASH_A, passed: false })?.data).toEqual({
			receiptHash: HASH_A,
			passed: false,
		});
		expect(
			receiptEvent({ receiptHash: HASH_A, passed: false }, "HEAD~1")?.data
				.commit,
		).toBeUndefined();
	});

	test("a summary without a real hash is not sent", () => {
		expect(receiptEvent({ receiptHash: "abc", passed: true })).toBeNull();
	});
});

describe("emitReceipt", () => {
	test("enqueues the event on the sink", () => {
		const { sink, inputs } = capturingSink();
		expect(emitReceipt(sink, { receiptHash: HASH_A, passed: true }).ok).toBe(
			true,
		);
		expect(inputs.map((i) => i.type)).toEqual(["receipt"]);
	});
});
