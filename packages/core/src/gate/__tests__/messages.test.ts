/**
 * Gate messages (FR-GATE-8): what the host shows the user for one gate
 * result. Every message is one line carrying the reason, a confidence band
 * and, for `ask` and `deny`, how to override it.
 */

import { describe, expect, test } from "bun:test";
import type { GateResult } from "../evaluate";
import { confidenceBand, formatGateMessage } from "../messages";

function result(overrides: Partial<GateResult> = {}): GateResult {
	return {
		verdict: "ask",
		reason: "git.push.force is irreversible",
		decisionIds: ["d-1"],
		degraded: false,
		...overrides,
	};
}

describe("formatGateMessage", () => {
	test("an ask is one line with the reason, the band and the override hint", () => {
		const message = formatGateMessage(result({ confidence: 0.95 }));
		expect(message).not.toContain("\n");
		expect(message).toContain("git.push.force is irreversible");
		expect(message).toContain("confidence high");
		expect(message).toContain("maina allow d-1");
	});

	test("a deny is one line with the reason, the band and the override hint", () => {
		const message = formatGateMessage(
			result({
				verdict: "deny",
				reason: "action.risk: deny",
				decisionIds: ["d-7", "d-7:reversed"],
				confidence: 0.8,
			}),
		);
		expect(message.split("\n")).toHaveLength(1);
		expect(message).toContain("deny");
		expect(message).toContain("action.risk: deny");
		expect(message).toContain("confidence medium");
		expect(message).toContain("maina allow d-7");
		expect(message).not.toContain("d-7:reversed");
	});

	test("a multi-line or control-character reason is folded onto one line", () => {
		const message = formatGateMessage(
			result({ reason: "first line\nsecond\r\nthird\u0007\u001b[31m red" }),
		);
		const control = [...message].filter((c) => {
			const code = c.charCodeAt(0);
			return code < 0x20 || code === 0x7f;
		});
		expect(control).toEqual([]);
		expect(message).toContain("first line second third");
	});

	test("C1 controls and bidi or zero-width format characters are folded too", () => {
		const message = formatGateMessage(
			result({
				reason: "a\u0085b\u009bc\u2028d\u202ee\u2066f\u200bg\ufeffh",
			}),
		);
		const hidden = [...message].filter((c) =>
			/[\u0080-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(c),
		);
		expect(hidden).toEqual([]);
		expect(message).toContain("a b c d e f g h");
	});

	test("cutting a long reason never splits a surrogate pair", () => {
		const message = formatGateMessage(
			result({ reason: `${"x".repeat(238)}\u{1F600}\u{1F600}tail` }),
		);
		const lone = [...message].filter((c) => {
			const code = c.charCodeAt(0);
			return c.length === 1 && code >= 0xd800 && code <= 0xdfff;
		});
		expect(lone).toEqual([]);
	});

	test("a very long reason is cut, keeping the band and the hint", () => {
		const message = formatGateMessage(result({ reason: "x".repeat(5_000) }));
		expect(message.length).toBeLessThan(400);
		expect(message).toContain("confidence");
		expect(message).toContain("maina allow d-1");
	});

	test("an ask without a logged decision says how to approve it", () => {
		const message = formatGateMessage(result({ decisionIds: [] }));
		expect(message).not.toContain("maina allow");
		expect(message).toMatch(/override: .+/);
	});

	test("a deny without a logged decision still names an override path", () => {
		const message = formatGateMessage(
			result({ verdict: "deny", reason: "denied by rule", decisionIds: [] }),
		);
		expect(message).toMatch(/override: .*policy/);
	});

	test("an allow needs no override hint", () => {
		const message = formatGateMessage(
			result({ verdict: "allow", reason: "allowed by rule", decisionIds: [] }),
		);
		expect(message).toContain("allowed by rule");
		expect(message).toContain("confidence high");
		expect(message).not.toContain("override");
	});

	test("a rule reason that ends in '; asking' is not duplicated by the verdict", () => {
		const message = formatGateMessage(
			result({ reason: "no decision; asking", decisionIds: [] }),
		);
		expect(message.match(/asking/g)?.length ?? 0).toBeLessThanOrEqual(1);
	});
});

describe("confidenceBand", () => {
	test("a verdict a rule decided without the model is high", () => {
		expect(confidenceBand(result({ decisionIds: [] }))).toBe("high");
	});

	test("a degraded evaluation is low whatever else it says", () => {
		expect(confidenceBand(result({ degraded: true, confidence: 0.99 }))).toBe(
			"low",
		);
	});

	test("the model's confidence maps onto high, medium and low", () => {
		expect(confidenceBand(result({ confidence: 0.9 }))).toBe("high");
		expect(confidenceBand(result({ confidence: 0.75 }))).toBe("medium");
		expect(confidenceBand(result({ confidence: 0.4 }))).toBe("low");
	});

	test("a model decision with no reported confidence is low", () => {
		expect(confidenceBand(result({ decisionIds: ["d-1"] }))).toBe("low");
	});
});
