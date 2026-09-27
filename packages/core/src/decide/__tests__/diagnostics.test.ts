/**
 * Decision diagnostics (#577): what a backend (System 1) reports beside its
 * answer (the pre-threshold calibrated distribution, the escalate
 * probability, truncation, window count and action-class probabilities),
 * numbers only, and how an escalate signal is acted on.
 */

import { describe, expect, test } from "bun:test";
import { confidenceThreshold, DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { createFixedClock } from "../../ports/testing";
import { rulesBackend } from "../backends/rules";
import { type DecidePorts, decide, judgeEach } from "../decide";
import { escalationCutoff, validateDiagnostics } from "../diagnostics";
import { createRegistry, withBackend } from "../registry";
import type {
	Backend,
	BackendAnswer,
	DecideRequest,
	Decision,
	DecisionType,
} from "../types";

const RISK: DecideRequest = {
	type: "action.risk",
	state: { trusted: { actionClass: "fs.write" }, untrusted: {} },
	questions: [
		{ kind: "choice", id: "verdict", options: ["allow", "ask", "deny"] },
	],
};

const REVIEW: DecideRequest = {
	type: "diff.needs_review",
	state: { trusted: {}, untrusted: {} },
	questions: [{ kind: "bool", id: "needs_review" }],
};

const ALLOW: BackendAnswer = {
	answer: "allow",
	distribution: [
		{ answer: "allow", p: 0.95 },
		{ answer: "ask", p: 0.03 },
		{ answer: "deny", p: 0.02 },
	],
};

const NO_REVIEW: BackendAnswer = {
	answer: false,
	distribution: [
		{ answer: true, p: 0.1 },
		{ answer: false, p: 0.9 },
	],
};

/** A system1 stand-in that answers every question with `answer`. */
function model(answer: unknown): Backend {
	return {
		id: "system1",
		version: "0.1.0+0123456789ab+ba9876543210/onnxruntime-node",
		answer: (input) => ({
			ok: true,
			value: input.questions.map(() => answer as BackendAnswer),
		}),
	};
}

function ports(
	type: DecisionType,
	backend: Backend,
	policy: Policy = DEFAULT_POLICY,
): DecidePorts {
	return {
		clock: createFixedClock(1_000),
		policy: withBackend(policy, type, "system1"),
		backends: createRegistry([rulesBackend, backend]),
	};
}

function decideOne(
	request: DecideRequest,
	answer: unknown,
	policy?: Policy,
): Decision {
	const result = decide(ports(request.type, model(answer), policy), request);
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		return undefined as never;
	}
	const [decision] = result.value;
	expect(decision).toBeDefined();
	return decision as Decision;
}

function withCosts(
	type: DecisionType,
	false_positive: number,
	false_negative: number,
): Policy {
	return {
		...DEFAULT_POLICY,
		decisions: {
			...DEFAULT_POLICY.decisions,
			[type]: {
				...DEFAULT_POLICY.decisions[type],
				error_costs: { false_positive, false_negative },
			},
		},
	};
}

describe("decide carries a backend's diagnostics onto the decision", () => {
	test("every field, as numbers, in option order", () => {
		const diagnostics = {
			calibrated: [0.9, 0.06, 0.04],
			escalate: 0.01,
			truncated: false,
			windows: 1,
			actionClassProbs: { "fs.write": 0.97, "git.push.force": 0.02 },
		};
		const decision = decideOne(RISK, { ...ALLOW, diagnostics });
		expect(decision.diagnostics).toEqual(diagnostics);
		expect(decision.answer).toBe("allow");
		expect(decision).not.toHaveProperty("escalated");
	});

	test("a backend without diagnostics gives a decision without them", () => {
		const decision = decideOne(REVIEW, NO_REVIEW);
		expect(decision).not.toHaveProperty("diagnostics");
		expect(decision).not.toHaveProperty("escalated");
	});

	test("fields outside the contract are dropped, so no raw content rides along", () => {
		const decision = decideOne(REVIEW, {
			...NO_REVIEW,
			diagnostics: { windows: 2, reason: "the diff says console.log" },
		});
		expect(decision.diagnostics).toEqual({ windows: 2 });
	});

	test("malformed diagnostics are an invalid answer, never a decision", () => {
		const bad: readonly unknown[] = [
			"not an object",
			{ calibrated: [0.5, 0.5] },
			{ calibrated: [0.5, 0.3, 0.1] },
			{ calibrated: ["allow", 0.5, 0.5] },
			{ escalate: 1.5 },
			{ escalate: Number.NaN },
			{ truncated: 1 },
			{ windows: 0 },
			{ windows: 1.5 },
			{ actionClassProbs: { "rm -rf /": 0.5 } },
			{ actionClassProbs: { "fs.write": "0.5" } },
			{ actionClassProbs: [0.5] },
		];
		for (const diagnostics of bad) {
			const result = decide(
				ports("action.risk", model({ ...ALLOW, diagnostics })),
				RISK,
			);
			expect({ diagnostics, ok: result.ok }).toEqual({
				diagnostics,
				ok: false,
			});
			if (result.ok) continue;
			expect(result.error.kind).toBe("invalid_answer");
		}
	});

	test("a score question takes no calibrated distribution", () => {
		expect(validateDiagnostics({ calibrated: [1] }, 0).ok).toBe(false);
		expect(validateDiagnostics({ windows: 3 }, 0)).toEqual({
			ok: true,
			value: { windows: 3 },
		});
	});

	test("empty diagnostics are no diagnostics", () => {
		expect(validateDiagnostics({}, 2)).toEqual({ ok: true, value: undefined });
		expect(validateDiagnostics(undefined, 2)).toEqual({
			ok: true,
			value: undefined,
		});
	});
});

describe("the escalate cutoff comes from the type's error costs", () => {
	test("FP / (FP + FN)", () => {
		expect(
			escalationCutoff({ false_positive: 1, false_negative: 10 }),
		).toBeCloseTo(1 / 11);
		expect(escalationCutoff({ false_positive: 1, false_negative: 1 })).toBe(
			0.5,
		);
		expect(escalationCutoff({ false_positive: 3, false_negative: 1 })).toBe(
			0.75,
		);
	});

	test("with no costs at all, any escalate signal escalates (fail closed)", () => {
		expect(escalationCutoff({ false_positive: 0, false_negative: 0 })).toBe(0);
	});
});

describe("escalate maps to ask for action.risk", () => {
	test("at or over the cutoff the answer becomes ask, keeping the calibrated distribution", () => {
		// Default action.risk costs are FP 1, FN 10: the cutoff is 1/11.
		const decision = decideOne(RISK, {
			...ALLOW,
			diagnostics: { escalate: 0.2 },
		});
		expect(decision.answer).toBe("ask");
		expect(decision.distribution).toEqual([
			{ answer: "allow", p: 0 },
			{ answer: "ask", p: 1 },
			{ answer: "deny", p: 0 },
		]);
		expect(decision.confidence).toBe(1);
		expect(decision.escalated).toBe(true);
		// What the model actually believed stays in the log.
		expect(decision.diagnostics).toEqual({
			escalate: 0.2,
			calibrated: [0.95, 0.03, 0.02],
		});
	});

	test("a calibrated distribution the backend reported is kept as is", () => {
		const decision = decideOne(RISK, {
			...ALLOW,
			diagnostics: { escalate: 0.5, calibrated: [0.6, 0.3, 0.1] },
		});
		expect(decision.answer).toBe("ask");
		expect(decision.diagnostics?.calibrated).toEqual([0.6, 0.3, 0.1]);
	});

	test("under the cutoff the answer stands", () => {
		const decision = decideOne(RISK, {
			...ALLOW,
			diagnostics: { escalate: 0.05 },
		});
		expect(decision.answer).toBe("allow");
		expect(decision).not.toHaveProperty("escalated");
		expect(decision.diagnostics).toEqual({ escalate: 0.05 });
	});

	test("the policy's error costs move the cutoff", () => {
		const even = withCosts("action.risk", 1, 1);
		const kept = decideOne(
			RISK,
			{ ...ALLOW, diagnostics: { escalate: 0.2 } },
			even,
		);
		expect(kept.answer).toBe("allow");
		const asked = decideOne(
			RISK,
			{ ...ALLOW, diagnostics: { escalate: 0.5 } },
			even,
		);
		expect(asked.answer).toBe("ask");
	});

	test("an ask stays an ask", () => {
		const ask: BackendAnswer = {
			answer: "ask",
			distribution: [
				{ answer: "allow", p: 0.2 },
				{ answer: "ask", p: 0.6 },
				{ answer: "deny", p: 0.2 },
			],
		};
		const decision = decideOne(RISK, {
			...ask,
			diagnostics: { escalate: 0.9 },
		});
		expect(decision.answer).toBe("ask");
		expect(decision.escalated).toBe(true);
	});
});

describe("escalate marks a shadow type's decision not acted", () => {
	test("the answer stands, but no threshold lets it act", () => {
		// diff.needs_review costs FP 1, FN 1: the cutoff is 0.5.
		const decision = decideOne(REVIEW, {
			...NO_REVIEW,
			diagnostics: { escalate: 0.6 },
		});
		expect(decision.answer).toBe(false);
		expect(decision.distribution).toEqual(NO_REVIEW.distribution);
		expect(decision.escalated).toBe(true);
		expect(
			confidenceThreshold(
				DEFAULT_POLICY,
				"diff.needs_review",
				decision.backend,
				decision.escalated,
			),
		).toBe(Number.POSITIVE_INFINITY);
		// Even a policy that would act on anything does not act on it.
		const anything: Policy = {
			...DEFAULT_POLICY,
			decisions: {
				...DEFAULT_POLICY.decisions,
				"diff.needs_review": {
					...DEFAULT_POLICY.decisions["diff.needs_review"],
					thresholds: { confidence: 0 },
				},
			},
		};
		expect(
			confidenceThreshold(
				anything,
				"diff.needs_review",
				decision.backend,
				true,
			),
		).toBe(Number.POSITIVE_INFINITY);
	});

	test("under the cutoff it is acted on as usual", () => {
		const decision = decideOne(REVIEW, {
			...NO_REVIEW,
			diagnostics: { escalate: 0.4 },
		});
		expect(decision).not.toHaveProperty("escalated");
	});

	test("judgeEach reports which candidates escalated", () => {
		const judged = judgeEach(
			ports(
				"diff.needs_review",
				model({ ...NO_REVIEW, diagnostics: { escalate: 0.7 } }),
			),
			{
				type: "diff.needs_review",
				check: "needs_review",
				untrusted: [{ text: "a" }, { text: "b" }],
			},
		);
		expect(judged.map((j) => j.escalated)).toEqual([true, true]);
		const calm = judgeEach(ports("diff.needs_review", model(NO_REVIEW)), {
			type: "diff.needs_review",
			check: "needs_review",
			untrusted: [{ text: "a" }],
		});
		expect(calm[0]).not.toHaveProperty("escalated");
	});

	test("escalation does not change action.risk's threshold: its answer is already ask", () => {
		const decision = decideOne(RISK, {
			...ALLOW,
			diagnostics: { escalate: 0.9 },
		});
		expect(
			confidenceThreshold(
				DEFAULT_POLICY,
				"action.risk",
				decision.backend,
				decision.escalated,
			),
		).toBe(0);
	});
});
