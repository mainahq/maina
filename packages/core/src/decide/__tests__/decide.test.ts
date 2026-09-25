import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { createFixedClock } from "../../ports/testing";
import { heuristicBackend } from "../backends/heuristic";
import { rulesBackend } from "../backends/rules";
import { type DecidePorts, decide } from "../decide";
import { createRegistry, DEFAULT_REGISTRY } from "../registry";
import type {
	Answer,
	Backend,
	DecideRequest,
	Decision,
	DecisionState,
	Question,
} from "../types";

const EMPTY_STATE: DecisionState = { trusted: {}, untrusted: {} };

function ports(overrides: Partial<DecidePorts> = {}): DecidePorts {
	return {
		clock: createFixedClock(1_000),
		policy: DEFAULT_POLICY,
		backends: DEFAULT_REGISTRY,
		...overrides,
	};
}

function decisionsOf(result: ReturnType<typeof decide>): readonly Decision[] {
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		return [];
	}
	return result.value;
}

function withBackend(
	policy: Policy,
	type: keyof Policy["decisions"],
	backend: "rules" | "heuristic" | "system1",
): Policy {
	return {
		...policy,
		decisions: {
			...policy.decisions,
			[type]: { ...policy.decisions[type], backend },
		},
	};
}

/** One valid request per type the built-in backends answer. */
const SAMPLES: readonly DecideRequest[] = [
	{
		type: "action.risk",
		state: { trusted: { actionClass: "git.push.force" }, untrusted: {} },
		questions: [
			{ kind: "choice", id: "verdict", options: ["allow", "ask", "deny"] },
		],
	},
	{
		type: "task.tier",
		state: { trusted: { task: "commit" }, untrusted: {} },
		questions: [
			{
				kind: "choice",
				id: "tier",
				options: ["mechanical", "standard", "architectural", "local"],
			},
		],
	},
	{
		type: "review.category",
		state: { trusted: {}, untrusted: { body: "this is dead code" } },
		questions: [
			{
				kind: "choice",
				id: "category",
				options: [
					"api-mismatch",
					"signature-drift",
					"dead-code",
					"security",
					"style",
					"other",
				],
			},
		],
	},
	{
		type: "review.reviewer_kind",
		state: { trusted: {}, untrusted: { reviewer: "renovate[bot]" } },
		questions: [{ kind: "choice", id: "kind", options: ["bot", "human"] }],
	},
	{
		type: "finding.real",
		state: {
			trusted: {
				candidates: { "0": { falsePositiveRate: 0.8, totalCount: 10 } },
			},
			untrusted: {},
		},
		questions: [{ kind: "bool", id: "rule:0" }],
	},
	{
		type: "spec.coverage",
		state: {
			trusted: { candidates: { "0": { matched: 3, total: 4 } } },
			untrusted: {},
		},
		questions: [{ kind: "bool", id: "criterion:0" }],
	},
	{
		type: "spec.orphan",
		state: {
			trusted: {
				candidates: { "0": { hasSpecRef: false, matched: 0, total: 5 } },
			},
			untrusted: {},
		},
		questions: [{ kind: "bool", id: "task:0" }],
	},
	{
		type: "spec.contradiction",
		state: {
			trusted: { candidates: { "0": { matched: 1, total: 4 } } },
			untrusted: {},
		},
		questions: [{ kind: "bool", id: "task:0" }],
	},
	{
		type: "spec.impl_leak",
		state: {
			trusted: {},
			untrusted: { candidates: { "0": { text: "Store it in SQL" } } },
		},
		questions: [{ kind: "bool", id: "impl-in-spec:0" }],
	},
	{
		type: "spec.quality",
		state: {
			trusted: {
				criteria: 4,
				measurable: 2,
				testable: 3,
				weaselWords: 1,
				sectionsPresent: 5,
				sectionsRequired: 5,
				clarificationMarkers: 0,
			},
			untrusted: {},
		},
		questions: [
			{ kind: "score", id: "measurability", min: 0, max: 100 },
			{ kind: "score", id: "overall", min: 0, max: 100 },
		],
	},
	{
		type: "slop",
		state: { trusted: {}, untrusted: { text: "console.log(1)" } },
		questions: [{ kind: "bool", id: "ai-console" }],
	},
	{
		type: "wiki.relevance",
		state: {
			trusted: {},
			untrusted: {
				keywords: ["cache", "sqlite"],
				candidates: { "0": { tokens: ["cache", "layer"] } },
			},
		},
		questions: [{ kind: "bool", id: "article:0" }],
	},
	{
		type: "context.select",
		state: {
			trusted: {
				nodes: ["a.ts", "b.ts"],
				edges: [["a.ts", "b.ts", 1]],
				touched: ["a.ts"],
				mentioned: [],
			},
			untrusted: {},
		},
		questions: [
			{ kind: "score", id: "file:0", min: 0, max: 1 },
			{ kind: "score", id: "file:1", min: 0, max: 1 },
		],
	},
];

function optionsOf(question: Question): readonly Answer[] | null {
	switch (question.kind) {
		case "choice":
			return question.options;
		case "bool":
			return [true, false];
		case "score":
			return null;
		default: {
			const unreachable: never = question;
			return unreachable;
		}
	}
}

describe("decide", () => {
	test("returns one Decision per question, in question order, with the full shape", () => {
		const request = SAMPLES[1] as DecideRequest;
		const [decision] = decisionsOf(decide(ports(), request));
		expect(decision).toEqual({
			id: "tier",
			type: "task.tier",
			answer: "mechanical",
			distribution: [
				{ answer: "mechanical", p: 1 },
				{ answer: "standard", p: 0 },
				{ answer: "architectural", p: 0 },
				{ answer: "local", p: 0 },
			],
			confidence: 1,
			backend: { id: "heuristic", version: heuristicBackend.version },
			latencyMs: 0,
		});
	});

	test.each(
		SAMPLES.map((s) => [s.type, s] as const),
	)("%s: the distribution sums to 1 and has one entry per option", (_type, request) => {
		const decisions = decisionsOf(decide(ports(), request));
		expect(decisions.map((d) => d.id)).toEqual(
			request.questions.map((q) => q.id),
		);
		decisions.forEach((decision, i) => {
			const question = request.questions[i] as Question;
			const total = decision.distribution.reduce((sum, e) => sum + e.p, 0);
			expect(total).toBeCloseTo(1, 9);
			const options = optionsOf(question);
			if (options === null) {
				expect(decision.distribution).toHaveLength(1);
			} else {
				expect(decision.distribution.map((e) => e.answer)).toEqual([
					...options,
				]);
			}
			const max = Math.max(...decision.distribution.map((e) => e.p));
			expect(decision.confidence).toBe(max);
			const chosen = decision.distribution.find(
				(e) => e.answer === decision.answer,
			);
			expect(chosen?.p).toBe(max);
		});
	});

	test("rejects invalid questions before calling any backend", () => {
		let called = false;
		const spy: Backend = {
			id: "heuristic",
			version: "spy",
			answer: () => {
				called = true;
				return { ok: true, value: [] };
			},
		};
		const result = decide(ports({ backends: createRegistry([spy]) }), {
			type: "slop",
			state: EMPTY_STATE,
			questions: [],
		});
		expect(result.ok).toBe(false);
		expect(called).toBe(false);
	});

	test("a type the heuristic backend has no heuristic for is an unsupported error", () => {
		const result = decide(ports(), {
			type: "diff.sensitive",
			state: EMPTY_STATE,
			questions: [{ kind: "bool", id: "sensitive" }],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "unsupported",
			type: "diff.sensitive",
			backend: "heuristic",
		});
	});
});

describe("backend selection follows the policy", () => {
	const fakeSystem1: Backend = {
		id: "system1",
		version: "test-1",
		answer: (input) => ({
			ok: true,
			value: input.questions.map(() => ({
				answer: false,
				distribution: [
					{ answer: true, p: 0.3 },
					{ answer: false, p: 0.7 },
				],
			})),
		}),
	};
	const slop: DecideRequest = {
		type: "slop",
		state: { trusted: {}, untrusted: { text: "console.log(1)" } },
		questions: [{ kind: "bool", id: "ai-console" }],
	};

	test("uses the default policy's backend for each type", () => {
		const [risk] = decisionsOf(decide(ports(), SAMPLES[0] as DecideRequest));
		expect(risk?.backend.id).toBe("rules");
		const [tier] = decisionsOf(decide(ports(), SAMPLES[1] as DecideRequest));
		expect(tier?.backend.id).toBe("heuristic");
	});

	test("uses the backend the policy names when it is registered", () => {
		const policy = withBackend(DEFAULT_POLICY, "slop", "system1");
		const backends = createRegistry([
			rulesBackend,
			heuristicBackend,
			fakeSystem1,
		]);
		const [decision] = decisionsOf(decide(ports({ policy, backends }), slop));
		expect(decision).toMatchObject({
			answer: false,
			confidence: 0.7,
			backend: { id: "system1", version: "test-1" },
		});
	});

	test("falls back to the catalog default when the named backend is not registered", () => {
		const policy = withBackend(DEFAULT_POLICY, "slop", "system1");
		const [decision] = decisionsOf(decide(ports({ policy }), slop));
		expect(decision?.backend.id).toBe("heuristic");
		expect(decision?.answer).toBe(true);
	});

	test("errors when neither the named nor the default backend is registered", () => {
		const result = decide(ports({ backends: createRegistry([]) }), slop);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({ kind: "no_backend", type: "slop" });
	});
});

describe("backend output is validated", () => {
	const request: DecideRequest = {
		type: "slop",
		state: EMPTY_STATE,
		questions: [{ kind: "bool", id: "a" }],
	};
	const run = (answer: Backend["answer"]) =>
		decide(
			ports({
				backends: createRegistry([{ id: "heuristic", version: "x", answer }]),
			}),
			request,
		);
	const kindOf = (result: ReturnType<typeof decide>) =>
		result.ok ? "ok" : result.error.kind;

	test("a distribution that does not sum to 1 is rejected", () => {
		const result = run(() => ({
			ok: true,
			value: [
				{
					answer: true,
					distribution: [
						{ answer: true, p: 0.6 },
						{ answer: false, p: 0.6 },
					],
				},
			],
		}));
		expect(kindOf(result)).toBe("invalid_answer");
	});

	test("a missing option entry is rejected", () => {
		const result = run(() => ({
			ok: true,
			value: [{ answer: true, distribution: [{ answer: true, p: 1 }] }],
		}));
		expect(kindOf(result)).toBe("invalid_answer");
	});

	test("an answer that is not a mode of its distribution is rejected", () => {
		const result = run(() => ({
			ok: true,
			value: [
				{
					answer: true,
					distribution: [
						{ answer: true, p: 0.2 },
						{ answer: false, p: 0.8 },
					],
				},
			],
		}));
		expect(kindOf(result)).toBe("invalid_answer");
	});

	test("a score that is not a finite number within range is rejected", () => {
		const score = (value: number) =>
			decide(
				ports({
					backends: createRegistry([
						{
							id: "heuristic",
							version: "x",
							answer: () => ({
								ok: true,
								value: [
									{ answer: value, distribution: [{ answer: value, p: 1 }] },
								],
							}),
						},
					]),
				}),
				{
					type: "spec.quality",
					state: EMPTY_STATE,
					questions: [{ kind: "score", id: "q", min: 0, max: 100 }],
				},
			);
		expect(kindOf(score(50))).toBe("ok");
		expect(kindOf(score(Number.NaN))).toBe("invalid_answer");
		expect(kindOf(score(101))).toBe("invalid_answer");
	});

	test("the wrong number of answers is rejected", () => {
		expect(kindOf(run(() => ({ ok: true, value: [] })))).toBe("invalid_answer");
	});

	test("a backend that throws becomes a backend_failed error", () => {
		const result = run(() => {
			throw new Error("boom");
		});
		expect(kindOf(result)).toBe("backend_failed");
	});
});

describe("decide is pure given its ports", () => {
	function deepFreeze<T>(value: T): T {
		if (value !== null && typeof value === "object") {
			for (const inner of Object.values(value)) deepFreeze(inner);
			Object.freeze(value);
		}
		return value;
	}

	test("the same ports and request give the same decisions", () => {
		for (const request of SAMPLES) {
			const first = decide(ports(), request);
			const second = decide(ports(), request);
			expect(second).toEqual(first);
		}
	});

	test("does not mutate its request", () => {
		const request = deepFreeze(structuredClone(SAMPLES[12] as DecideRequest));
		const result = decide(ports(), request);
		expect(result.ok).toBe(true);
	});

	test("latency comes only from the injected clock", () => {
		const clock = createFixedClock(5_000);
		const slowBackend: Backend = {
			id: "heuristic",
			version: "slow",
			answer: (input) => {
				clock.advance(7);
				return heuristicBackend.answer(input);
			},
		};
		const [decision] = decisionsOf(
			decide(
				ports({ clock, backends: createRegistry([slowBackend]) }),
				SAMPLES[1] as DecideRequest,
			),
		);
		expect(decision?.latencyMs).toBe(7);
	});
});

describe("rules backend", () => {
	const verdict = (actionClass: string, policy: Policy = DEFAULT_POLICY) => {
		const [decision] = decisionsOf(
			decide(ports({ policy }), {
				type: "action.risk",
				state: { trusted: { actionClass }, untrusted: {} },
				questions: [
					{ kind: "choice", id: "verdict", options: ["allow", "ask", "deny"] },
				],
			}),
		);
		return decision?.answer;
	};

	test("answers with the policy verdict for the action class", () => {
		expect(verdict("git.push.force")).toBe("ask");
		expect(verdict("fs.write")).toBe("allow");
	});

	test("follows a tightened policy", () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			action_classes: {
				...DEFAULT_POLICY.action_classes,
				deploy: { irreversible: true, verdict: "deny" },
			},
		};
		expect(verdict("deploy", policy)).toBe("deny");
	});

	test("fails closed to ask for an unknown action class", () => {
		expect(verdict("teleport.prod")).toBe("ask");
	});
});
