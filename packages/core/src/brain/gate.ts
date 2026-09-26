/**
 * Who may write the repo brain (FR-FAC-5). Pure.
 *
 * Unattended runs never write it: nobody is there to vouch for what a
 * background agent decided to remember. In an attended run a write needs
 * an approval, from a named human or from a `decide` decision that
 * answered yes; without one the gate asks.
 */

import type { Answer } from "../decide/types";
import type { RunContext } from "../policy/schema";

export type BrainApproval =
	| Readonly<{ by: "human"; who: string }>
	| Readonly<{
			by: "decide";
			/** The decision that approved the write: its id, answer and confidence. */
			decision: Readonly<{ id: string; answer: Answer; confidence: number }>;
	  }>;

export type BrainGateInput = Readonly<{
	context: RunContext;
	approval?: BrainApproval;
}>;

export type BrainGateVerdict =
	| Readonly<{ verdict: "allow"; by: BrainApproval["by"] }>
	| Readonly<{ verdict: "ask"; reason: "needs_approval" }>
	| Readonly<{ verdict: "deny"; reason: "unattended" | "declined" }>;

export function gateBrainWrite(input: BrainGateInput): BrainGateVerdict {
	if (input.context === "unattended") {
		return { verdict: "deny", reason: "unattended" };
	}
	const approval = input.approval;
	if (approval === undefined)
		return { verdict: "ask", reason: "needs_approval" };
	switch (approval.by) {
		case "human":
			return approval.who.trim() === ""
				? { verdict: "ask", reason: "needs_approval" }
				: { verdict: "allow", by: "human" };
		case "decide":
			return approval.decision.answer === true
				? { verdict: "allow", by: "decide" }
				: { verdict: "deny", reason: "declined" };
		default: {
			const never: never = approval;
			return never;
		}
	}
}
