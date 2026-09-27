/**
 * System 1 pre-inference (#572, option b). onnxruntime only offers an async
 * `run()`, while core's `decide` and `evaluateGate` stay synchronous and
 * pure. So the runtime plans the gate's `action.risk` inputs, runs the model
 * on all of them in one pass (both orders of the two-order check), and hands
 * the gate a synchronous backend over the outputs. The pre-inference time
 * counts against the gate's budget; every failure asks.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
	type BackendAnswer,
	type BackendInput,
	DEFAULT_POLICY,
	type GateContext,
	loadShellParser,
	type Policy,
	type Verdict,
	withBackend,
} from "@mainahq/core";
import {
	createGateEvaluator,
	type GateEvaluatorDeps,
	type GateEvent,
} from "../gate";
import { type InferencePort, preInfer } from "../system1";

const ROOT = "/work/repo";
let ctx: GateContext;

beforeAll(async () => {
	const shell = await loadShellParser();
	if (!shell.ok) throw new Error(shell.error.message);
	ctx = { shell: shell.value, home: "/home/dev" };
});

const modelPolicy: Policy = withBackend(
	DEFAULT_POLICY,
	"action.risk",
	"system1",
);

/** Answers `verdict` in each question's own option order, certain. */
function answerAll(input: BackendInput, verdict: Verdict): BackendAnswer[] {
	return input.questions.map((q) => ({
		answer: verdict,
		distribution: (q.kind === "choice" ? q.options : []).map((o) => ({
			answer: o,
			p: o === verdict ? 1 : 0,
		})),
	}));
}

type FakeModel = InferencePort & { calls: (readonly BackendInput[])[] };

/**
 * An async model stand-in, shaped like an onnxruntime session: `infer`
 * resolves on a later tick. `before` runs first (to advance a fake clock).
 */
function fakeModel(
	verdict: Verdict,
	options: Readonly<{ before?: () => void }> = {},
): FakeModel {
	const calls: (readonly BackendInput[])[] = [];
	return {
		id: "system1",
		version: "fake-onnx",
		calls,
		infer: async (inputs) => {
			calls.push(inputs);
			options.before?.();
			await new Promise((resolve) => setTimeout(resolve, 1));
			return { ok: true, value: inputs.map((i) => answerAll(i, verdict)) };
		},
	};
}

function deps(overrides: Partial<GateEvaluatorDeps> = {}): GateEvaluatorDeps {
	let n = 0;
	return {
		rootOf: () => ROOT,
		policyFor: async () => ({ ok: true, value: modelPolicy }),
		context: async () => ctx,
		clock: { now: () => 0 },
		newId: () => `id-${++n}`,
		...overrides,
	};
}

const risky = (command: string): GateEvent => ({
	kind: "shell",
	input: { command, untrusted: ["web page"] },
	cwd: ROOT,
});

const plain = (command: string): GateEvent => ({
	kind: "shell",
	input: { command },
	cwd: ROOT,
});

const input = (id: string): BackendInput => ({
	type: "action.risk",
	state: { trusted: {}, untrusted: { action: { command: "ls" } } },
	questions: [{ kind: "choice", id, options: ["allow", "ask", "deny"] }],
	policy: modelPolicy,
});

describe("preInfer", () => {
	test("runs the model once over every input and serves the outputs synchronously", async () => {
		const model = fakeModel("allow");
		let now = 0;
		const clock = {
			now: () => {
				now += 7;
				return now;
			},
		};
		const { backend, elapsedMs } = await preInfer(
			model,
			clock,
			[input("a"), input("b")],
			250,
		);
		expect(model.calls.length).toBe(1);
		expect(model.calls[0]?.length).toBe(2);
		expect(elapsedMs).toBe(7);
		expect(backend.id).toBe("system1");
		expect(backend.version).toBe("fake-onnx");
		expect(backend.answer(input("z"))).toEqual({
			ok: true,
			value: answerAll(input("z"), "allow"),
		});
	});

	test.each([
		[
			"an error",
			async () => ({
				ok: false as const,
				error: {
					kind: "unsupported" as const,
					questionId: undefined,
					message: "session closed",
				},
			}),
		],
		["a rejection", async () => Promise.reject(new Error("onnx crashed"))],
		[
			"the wrong number of outputs",
			async () => ({ ok: true as const, value: [] }),
		],
	] as const)("a model that returns %s serves no answer", async (_, infer) => {
		const model: InferencePort = { id: "system1", version: "x", infer };
		const { backend } = await preInfer(
			model,
			{ now: () => 0 },
			[input("a")],
			250,
		);
		const answered = backend.answer(input("a"));
		expect(answered.ok).toBe(false);
		if (!answered.ok) expect(answered.error.kind).toBe("unsupported");
	});

	test("a model that never answers is cut off at the budget", async () => {
		const model: InferencePort = {
			id: "system1",
			version: "x",
			infer: () => new Promise(() => {}),
		};
		const { backend } = await preInfer(
			model,
			{ now: () => 0 },
			[input("a")],
			5,
		);
		const answered = backend.answer(input("a"));
		expect(answered.ok).toBe(false);
		if (!answered.ok) expect(answered.error.message).toContain("5 ms");
	});
});

describe("the gate over an async model", () => {
	test("both orders of a high-risk event come from one inference pass", async () => {
		const model = fakeModel("allow");
		const decision = await createGateEvaluator(deps({ model }))(
			risky("ls -la"),
		);
		expect(model.calls.length).toBe(1);
		expect(model.calls[0]?.length).toBe(2);
		expect(decision.verdict).toBe("allow");
		expect(decision.decisionIds).toEqual(["id-1", "id-1:reversed"]);
		expect(decision.degraded).toBe(false);
	});

	test("the model's answer tightens the verdict", async () => {
		const decision = await createGateEvaluator(
			deps({ model: fakeModel("deny") }),
		)(plain("ls -la"));
		expect(decision.verdict).toBe("deny");
	});

	test("pre-inference time counts against the gate budget", async () => {
		let now = 0;
		const model = fakeModel("allow", {
			before: () => {
				now += 300;
			},
		});
		const decision = await createGateEvaluator(
			deps({ model, clock: { now: () => now } }),
		)(plain("ls -la"));
		expect(decision.verdict).toBe("ask");
		expect(decision.degraded).toBe(true);
		expect(decision.reason).toContain("300 ms, over the 250 ms budget");
	});

	test("a model that fails hands the event to the rules backend (#586)", async () => {
		const model: InferencePort = {
			id: "system1",
			version: "x",
			infer: async () => Promise.reject(new Error("onnx crashed")),
		};
		const evaluate = createGateEvaluator(deps({ model }));
		// No rule decides `ls`: the rules backend answers its class, allow.
		const allowed = await evaluate(plain("ls -la"));
		expect(allowed.verdict).toBe("allow");
		expect(allowed.degraded).toBe(false);
		// A class the rules ask about still asks.
		const asked = await evaluate(plain("rm -rf dist"));
		expect(asked.verdict).toBe("ask");
	});

	test("a model that fails leaves a listed allow standing, as the rules backend does (#586)", async () => {
		// `git push origin main` is `git.push.protected`, a reversible `ask`
		// class; the allow rule lists it. With `backend: rules` the gate
		// never asks a backend once a rule decided, so the allow stands. A
		// failed model delegating to rules must not tighten it to the class's
		// own `ask`.
		const allowRule = (backend: "rules" | "system1"): Policy => ({
			...withBackend(DEFAULT_POLICY, "action.risk", backend),
			rules: { allow: [{ match: "git push origin main" }], deny: [] },
		});
		const failing: InferencePort = {
			id: "system1",
			version: "x",
			infer: async () => Promise.reject(new Error("onnx crashed")),
		};
		const push = plain("git push origin main");
		const rulesOnly = await createGateEvaluator(
			deps({
				policyFor: async () => ({ ok: true, value: allowRule("rules") }),
			}),
		)(push);
		expect(rulesOnly.verdict).toBe("allow");
		const delegated = await createGateEvaluator(
			deps({
				model: failing,
				policyFor: async () => ({ ok: true, value: allowRule("system1") }),
			}),
		)(push);
		expect(delegated.verdict).toBe("allow");
		expect(delegated.degraded).toBe(false);
	});

	test("a model that fails slower than the budget still asks, degraded", async () => {
		let now = 0;
		const model: InferencePort = {
			id: "system1",
			version: "x",
			infer: async () => {
				now += 300;
				return Promise.reject(new Error("onnx crashed"));
			},
		};
		const decision = await createGateEvaluator(
			deps({ model, clock: { now: () => now } }),
		)(plain("ls -la"));
		expect(decision.verdict).toBe("ask");
		expect(decision.degraded).toBe(true);
	});

	test("a self-disabled model is never run; the rules backend answers (#586)", async () => {
		const model: FakeModel = {
			...fakeModel("deny"),
			disabled: () =>
				"system1: model 0.1.0 failed verification; using heuristics",
		};
		const decision = await createGateEvaluator(deps({ model }))(
			plain("ls -la"),
		);
		expect(model.calls.length).toBe(0);
		expect(decision.verdict).toBe("allow");
		expect(decision.degraded).toBe(false);
	});

	test("the model is not run when the gate would not ask it", async () => {
		const model = fakeModel("deny");
		// The policy names another backend.
		await createGateEvaluator(
			deps({
				model,
				policyFor: async () => ({ ok: true, value: DEFAULT_POLICY }),
			}),
		)(plain("ls -la"));
		// The hook client's rules-only fallback.
		const fallback = await createGateEvaluator(
			deps({ model }),
			"rules_only",
		)(plain("ls -la"));
		expect(model.calls.length).toBe(0);
		expect(fallback.verdict).not.toBe("deny");
	});
});
