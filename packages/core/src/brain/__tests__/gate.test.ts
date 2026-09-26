import { describe, expect, test } from "bun:test";
import { gateBrainWrite } from "../gate";

const yes = { id: "brain.write", answer: true, confidence: 0.9 };

describe("gateBrainWrite: repo brain writes are gated by run context (FR-FAC-5)", () => {
	test("unattended writes are denied, whatever approval they carry", () => {
		expect(gateBrainWrite({ context: "unattended" })).toEqual({
			verdict: "deny",
			reason: "unattended",
		});
		expect(
			gateBrainWrite({
				context: "unattended",
				approval: { by: "human", who: "maintainer" },
			}),
		).toEqual({ verdict: "deny", reason: "unattended" });
		expect(
			gateBrainWrite({
				context: "unattended",
				approval: { by: "decide", decision: yes },
			}),
		).toEqual({ verdict: "deny", reason: "unattended" });
	});

	test("attended writes without an approval ask", () => {
		expect(gateBrainWrite({ context: "interactive" })).toEqual({
			verdict: "ask",
			reason: "needs_approval",
		});
	});

	test("attended writes go through a human or decide", () => {
		expect(
			gateBrainWrite({
				context: "interactive",
				approval: { by: "human", who: "maintainer" },
			}),
		).toEqual({ verdict: "allow", by: "human" });
		expect(
			gateBrainWrite({
				context: "interactive",
				approval: { by: "decide", decision: yes },
			}),
		).toEqual({ verdict: "allow", by: "decide" });
	});

	test("decide saying anything but yes declines the write", () => {
		for (const answer of [false, "maybe", 1]) {
			expect(
				gateBrainWrite({
					context: "interactive",
					approval: { by: "decide", decision: { ...yes, answer } },
				}),
			).toEqual({ verdict: "deny", reason: "declined" });
		}
	});

	test("a human approval with no name is no approval", () => {
		expect(
			gateBrainWrite({
				context: "interactive",
				approval: { by: "human", who: "  " },
			}),
		).toEqual({ verdict: "ask", reason: "needs_approval" });
	});
});
