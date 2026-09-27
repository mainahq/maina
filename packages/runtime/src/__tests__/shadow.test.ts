/**
 * Shadow mode in the gate and the runtime (#578). A candidate System 1
 * model answers every gate event in shadow, in both orders, after the gate
 * has answered the host: its records are logged as `<decision id>:shadow`,
 * so they pair with the gate's own records and the outcomes linked to them.
 * diff.* and spec.* inputs (up to 24 windows each) run through the same
 * async runner with a window cap. A WASM-only model stays shadow-only.
 * Nothing the shadow does reaches a verdict.
 */

import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import {
	type BackendAnswer,
	type BackendInput,
	type DbPort,
	DEFAULT_POLICY,
	type DecideRequest,
	type DecisionRecord,
	evaluatePromotion,
	type GateContext,
	hashModel,
	linkOutcome,
	loadShellParser,
	migrateDecisionLog,
	migrateDecisionOutcomes,
	migrateGateSubjects,
	type Policy,
	queryDecisions,
	readLogSlice,
	SHADOW_ACTION,
	toDbPort,
	type Verdict,
	withBackend,
} from "@mainahq/core";
import {
	createGateEvaluator,
	type GateEvaluatorDeps,
	type GateEvent,
} from "../gate";
import { createShadowRunner, SHADOW_MAX_WINDOWS } from "../shadow";
import type { InferencePort, InferOptions } from "../system1";

const ROOT = "/work/repo";
const SALT = "c".repeat(64);
let ctx: GateContext;

beforeAll(async () => {
	const shell = await loadShellParser();
	if (!shell.ok) throw new Error(shell.error.message);
	ctx = { shell: shell.value, home: "/home/dev" };
});

function memoryDb(): DbPort {
	const db = toDbPort(new Database(":memory:"));
	for (const migrate of [
		migrateDecisionLog,
		migrateGateSubjects,
		migrateDecisionOutcomes,
	]) {
		const migrated = migrate(db);
		if (!migrated.ok) throw new Error(JSON.stringify(migrated.error));
	}
	return db;
}

function logged(db: DbPort): readonly DecisionRecord[] {
	const records = queryDecisions({ db });
	if (!records.ok) throw new Error(records.error.message);
	return records.value;
}

/** Answers every question certain: `verdict` for a choice, `true` for a bool. */
function answerAll(input: BackendInput, verdict: Verdict): BackendAnswer[] {
	return input.questions.map((q) => {
		if (q.kind === "bool") {
			return {
				answer: true,
				distribution: [
					{ answer: true, p: 1 },
					{ answer: false, p: 0 },
				],
			};
		}
		const options = q.kind === "choice" ? q.options : [];
		return {
			answer: verdict,
			distribution: options.map((o) => ({
				answer: o,
				p: o === verdict ? 1 : 0,
			})),
		};
	});
}

type Call = Readonly<{
	inputs: readonly BackendInput[];
	options: InferOptions | undefined;
}>;
type FakeSystem1 = InferencePort & { calls: Call[] };

/** The System 1 stand-in until a real artifact ships: async, like onnxruntime. */
function fakeSystem1(
	verdict: Verdict,
	overrides: Partial<InferencePort> = {},
): FakeSystem1 {
	const calls: Call[] = [];
	return {
		id: "system1",
		version: "fake-onnx",
		calls,
		infer: async (inputs, options) => {
			calls.push({ inputs, options });
			await new Promise((resolve) => setTimeout(resolve, 1));
			return { ok: true, value: inputs.map((i) => answerAll(i, verdict)) };
		},
		...overrides,
	};
}

const clock = { now: () => 0 };

function deps(
	db: DbPort,
	overrides: Partial<GateEvaluatorDeps> = {},
): GateEvaluatorDeps {
	let n = 0;
	return {
		rootOf: () => ROOT,
		policyFor: async () => ({ ok: true, value: DEFAULT_POLICY }),
		context: async () => ctx,
		clock,
		newId: () => `id-${++n}`,
		logFor: async () => ({ ok: true, value: { db, salt: SALT, now: () => 7 } }),
		...overrides,
	};
}

const shell = (
	command: string,
	untrusted: readonly string[] = [],
): GateEvent => ({
	kind: "shell",
	input: { command, untrusted },
	cwd: ROOT,
});

const denyLs: Policy = {
	...DEFAULT_POLICY,
	rules: {
		...DEFAULT_POLICY.rules,
		deny: [...DEFAULT_POLICY.rules.deny, { match: "ls -la" }],
	},
};

describe("the gate runs system1 in shadow on every event", () => {
	test.each([
		["a rule-decided allow", shell("ls -la"), DEFAULT_POLICY],
		["a denied event", shell("ls -la"), denyLs],
		["a high-risk event", shell("ls -la", ["web page"]), DEFAULT_POLICY],
	] as const)("%s: both orders, linked to the decision ids", async (_, event, policy) => {
		const db = memoryDb();
		const shadow = createShadowRunner({ model: fakeSystem1("ask"), clock });
		const gate = createGateEvaluator(
			deps(db, {
				shadow,
				policyFor: async () => ({ ok: true, value: policy }),
			}),
		);
		const without = await createGateEvaluator(
			deps(memoryDb(), {
				policyFor: async () => ({ ok: true, value: policy }),
			}),
		)(event);

		const decision = await gate(event);
		await shadow.idle();

		// The shadow never changes what the host is told.
		expect(decision).toEqual(without);
		const [id] = decision.decisionIds;
		const records = logged(db);
		const shadows = records.filter((r) => r.finalAction === SHADOW_ACTION);
		expect(shadows.map((r) => r.id)).toEqual([
			`${id}:shadow`,
			`${id}:reversed:shadow`,
		]);
		for (const r of shadows) {
			expect(r.type).toBe("action.risk");
			expect(r.answer).toBe("ask");
			expect(r.ts).toBe(7);
			expect(r.modelHash).toBe(
				hashModel({ id: "system1", version: "fake-onnx" }),
			);
		}
		// Every primary record has its shadow, under the same input.
		const byId = new Map(records.map((r) => [r.id, r]));
		for (const primary of decision.decisionIds) {
			expect(byId.get(`${primary}:shadow`)?.inputHash).toBe(
				byId.get(primary)?.inputHash as string,
			);
		}
	});

	test("an outcome on the gate's decision labels the shadow pair", async () => {
		const db = memoryDb();
		const shadow = createShadowRunner({ model: fakeSystem1("deny"), clock });
		const decision = await createGateEvaluator(deps(db, { shadow }))(
			shell("ls -la"),
		);
		await shadow.idle();
		const [id] = decision.decisionIds;
		const linked = linkOutcome({ db, clock: { now: () => 9 } }, id ?? "", {
			kind: "override",
			source: "gate",
		});
		expect(linked.ok).toBe(true);
		const slice = readLogSlice({ db }, { type: "action.risk" });
		if (!slice.ok) throw new Error(JSON.stringify(slice.error));
		const [entry] = evaluatePromotion(slice.value, {
			minSamples: 1,
			minLabelled: 1,
			minAgreement: 0,
			maxErrorRateDelta: 1,
			maxCostDelta: 100,
			maxCalibrationError: 1,
			maxLatencyP95Ms: 1_000,
			errorCosts: { false_positive: 1, false_negative: 10 },
		}).entries;
		expect(entry?.metrics.samples).toBe(1);
		expect(entry?.metrics.labelled).toBe(1);
	});

	test("a failing or hung shadow never changes or delays the verdict", async () => {
		const models: InferencePort[] = [
			fakeSystem1("allow", {
				infer: async () => Promise.reject(new Error("onnx crashed")),
			}),
			fakeSystem1("allow", { infer: () => new Promise(() => {}) }),
		];
		for (const model of models) {
			const db = memoryDb();
			const shadow = createShadowRunner({ model, clock, budgetMs: 5 });
			const decision = await createGateEvaluator(deps(db, { shadow }))(
				shell("ls -la"),
			);
			expect(decision.verdict).toBe("allow");
			await shadow.idle();
			expect(logged(db).map((r) => r.finalAction)).toEqual(["allow"]);
		}
	});

	test("the shadow is not run where it has nothing to link to or would act", async () => {
		const model = fakeSystem1("deny");
		const shadow = createShadowRunner({ model, clock });
		// The hook client's rules-only fallback.
		await createGateEvaluator(
			deps(memoryDb(), { shadow }),
			"rules_only",
		)(shell("ls -la"));
		// A root that keeps no log.
		await createGateEvaluator(
			deps(memoryDb(), {
				shadow,
				logFor: async () => ({ ok: true, value: null }),
			}),
		)(shell("ls -la"));
		// The candidate is already the acting backend.
		const db = memoryDb();
		await createGateEvaluator(
			deps(db, {
				shadow,
				model: fakeSystem1("allow"),
				policyFor: async () => ({
					ok: true,
					value: withBackend(DEFAULT_POLICY, "action.risk", "system1"),
				}),
			}),
		)(shell("ls -la"));
		await shadow.idle();
		expect(model.calls.length).toBe(0);
		expect(logged(db).every((r) => r.finalAction !== SHADOW_ACTION)).toBe(true);
	});
});

describe("a WASM-only model stays shadow-only", () => {
	test("the gate never asks it, even where the policy names it", async () => {
		const db = memoryDb();
		const wasm = fakeSystem1("deny", { engine: "wasm" });
		const shadow = createShadowRunner({ model: wasm, clock });
		const decision = await createGateEvaluator(
			deps(db, {
				model: wasm,
				shadow,
				policyFor: async () => ({
					ok: true,
					value: withBackend(DEFAULT_POLICY, "action.risk", "system1"),
				}),
			}),
		)(shell("ls -la"));
		// The rules answer, as for a policy that names no model.
		expect(decision.verdict).toBe("allow");
		expect(decision.degraded).toBe(false);
		expect(wasm.calls.length).toBe(0);
		await shadow.idle();
		// It answered in shadow instead.
		expect(wasm.calls.length).toBe(1);
		const records = logged(db);
		expect(records.map((r) => r.finalAction)).toEqual([
			"allow",
			SHADOW_ACTION,
			SHADOW_ACTION,
		]);
		expect(records[0]?.modelHash).not.toBe(records[1]?.modelHash as string);
	});
});

describe("the shadow runner", () => {
	const request = (type: DecideRequest["type"], id: string): DecideRequest => ({
		type,
		state: { trusted: {}, untrusted: { text: "a long diff" } },
		questions: [{ kind: "bool", id }],
	});

	const batch = (db: DbPort, requests: readonly DecideRequest[]) => ({
		log: { db },
		policy: DEFAULT_POLICY,
		ts: 3,
		requests,
	});

	test("runs diff.* and spec.* async, capped at 24 windows per input", async () => {
		const db = memoryDb();
		const model = fakeSystem1("ask");
		const shadow = createShadowRunner({ model, clock });
		expect(
			shadow.submit(
				batch(db, [
					request("diff.sensitive", "diff:0"),
					request("spec.coverage", "spec:0"),
				]),
			),
		).toBe(true);
		// Submitting never waits for the model.
		expect(logged(db)).toEqual([]);
		await shadow.idle();
		expect(SHADOW_MAX_WINDOWS).toBe(24);
		expect(model.calls.map((c) => c.options)).toEqual([
			{ maxWindows: SHADOW_MAX_WINDOWS },
		]);
		expect(logged(db).map((r) => [r.id, r.type, r.finalAction])).toEqual([
			["diff:0:shadow", "diff.sensitive", SHADOW_ACTION],
			["spec:0:shadow", "spec.coverage", SHADOW_ACTION],
		]);
	});

	test("runs one inference at a time and drops batches past its queue", async () => {
		let running = 0;
		let peak = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const model = fakeSystem1("ask", {
			infer: async (inputs) => {
				running += 1;
				peak = Math.max(peak, running);
				await gate;
				running -= 1;
				return { ok: true, value: inputs.map((i) => answerAll(i, "ask")) };
			},
		});
		const db = memoryDb();
		const shadow = createShadowRunner({ model, clock, maxPending: 2 });
		const accepted = [1, 2, 3].map((i) =>
			shadow.submit(batch(db, [request("diff.needs_review", `q${i}`)])),
		);
		expect(accepted).toEqual([true, true, false]);
		release();
		await shadow.idle();
		expect(peak).toBe(1);
		expect(logged(db).map((r) => r.id)).toEqual(["q1:shadow", "q2:shadow"]);
		// The queue drains, so later batches are taken again.
		expect(shadow.submit(batch(db, [request("spec.orphan", "q4")]))).toBe(true);
		await shadow.idle();
		expect(logged(db).map((r) => r.id)).toContain("q4:shadow");
	});
});
