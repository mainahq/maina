/**
 * Running System 1 (#338): the encoder (encoding.md steps 5–6 over core's
 * canonical texts), the output mapping and calibration (system1-artifact.md
 * §4, calibration.md), and the `InferencePort` the gate and the shadow
 * runner use, with its session-level disable (§8).
 *
 * Session-level disable, as decided here: a model that fails to load
 * (verification, a bad artifact, no engine, the parity self-check) or whose
 * engine fails at run time (an error, a malformed output) disables itself
 * for the rest of the process, and `disabled()` returns the notice, shown
 * once. A request the model does not cover (a type or option outside
 * `metadata`, text that encodes to a special id) is not a model fault: that
 * one input is unsupported, and the built-in backend answers it.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BackendInput,
	type DbPort,
	DEFAULT_POLICY,
	type DecideRequest,
	type DecisionRecord,
	type DecisionState,
	type DecisionType,
	type GateContext,
	hashModel,
	loadShellParser,
	migrateDecisionLog,
	migrateDecisionOutcomes,
	migrateGateSubjects,
	type Policy,
	queryDecisions,
	SHADOW_ACTION,
	SYSTEM1_TYPES,
	toDbPort,
	withBackend,
} from "@mainahq/core";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	createGateEvaluator,
	type GateEvaluatorDeps,
	type GateEvent,
} from "../../gate";
import { createShadowRunner } from "../../shadow";
import { type OrtSession, openWasmSession } from "../engine";
import {
	answerQuestions,
	createSystem1Port,
	encodeState,
	type GraphOutputs,
	type LoadedModel,
} from "../infer";
import {
	type LoadRefusal,
	loadModel,
	parseCalibration,
	parseMetadata,
} from "../load";
import { loadTokenizer } from "../tokenizer";
import { checkerFor, devKey, pinOn } from "./fixtures/model-release";
import {
	buildSystem1Release,
	ENCODING_PARAMS,
	OPTION_VOCAB,
	S1_VERSION,
	system1Calibration,
	system1Metadata,
	system1Tokenizer,
	writeRelease,
} from "./fixtures/system1-release";

const LOAD_TIMEOUT = 60_000;

const tokenizer = (() => {
	const t = loadTokenizer(JSON.stringify(system1Tokenizer()));
	if (!t.ok) throw new Error(t.error.message);
	return t.value;
})();

const metadata = (() => {
	const m = parseMetadata(system1Metadata(S1_VERSION));
	if (!m.ok) throw new Error(m.error.join("; "));
	return m.value;
})();

const calibration = (() => {
	const c = parseCalibration(
		system1Calibration(S1_VERSION, "a".repeat(64)),
		"b".repeat(64),
	);
	if (!c.ok) throw new Error(c.error.join("; "));
	return c.value;
})();

// ── Encoder ─────────────────────────────────────────────────────────────────

describe("encodeState", () => {
	test("one window: [CLS] [TYPE] [TRUSTED] T [UNTRUSTED] U [SEP]", () => {
		const encoded = encodeState(ENCODING_PARAMS, tokenizer, "action.risk", {
			trusted: { a: 1 },
			untrusted: { b: "x" },
		});
		if (!encoded.ok) throw new Error(encoded.error);
		// `{"a":1}` and `{"b":"x"}`, one id per character (code - 0x20).
		const T = [91, 2, 65, 2, 26, 17, 93];
		const U = [91, 2, 66, 2, 26, 2, 88, 2, 93];
		expect(encoded.value).toEqual({
			windows: [
				{
					input_ids: [95, 100, 98, ...T, 99, ...U, 96],
					segment_ids: [
						...Array(3 + T.length + 1).fill(0),
						...Array(U.length).fill(1),
						0,
					],
				},
			],
			truncated: false,
		});
	});

	test("the marker is the request type's", () => {
		const encoded = encodeState(ENCODING_PARAMS, tokenizer, "spec.quality", {
			trusted: {},
			untrusted: {},
		});
		if (!encoded.ok) throw new Error(encoded.error);
		expect(encoded.value.windows[0]?.input_ids[1]).toBe(109);
	});

	const long = (n: number): DecisionState => ({
		trusted: {},
		untrusted: { t: "y".repeat(n) },
	});

	test("long untrusted text takes overlapping windows, each within the window size", () => {
		// 308 untrusted tokens, room 57, stride 49: 7 windows.
		const encoded = encodeState(
			ENCODING_PARAMS,
			tokenizer,
			"diff.sensitive",
			long(300),
		);
		if (!encoded.ok) throw new Error(encoded.error);
		const { windows, truncated } = encoded.value;
		expect(windows.length).toBe(7);
		expect(truncated).toBe(false);
		for (const w of windows) {
			expect(w.input_ids.length).toBeLessThanOrEqual(ENCODING_PARAMS.window);
			expect(w.input_ids.length).toBe(w.segment_ids.length);
		}
		const untrusted = (i: number) =>
			windows[i]?.input_ids.filter(
				(_, j) => windows[i]?.segment_ids[j] === 1,
			) ?? [];
		// Consecutive windows share `overlap` untrusted tokens.
		expect(untrusted(0).slice(-ENCODING_PARAMS.overlap)).toEqual(
			untrusted(1).slice(0, ENCODING_PARAMS.overlap),
		);
	});

	test("past max_windows the input is cut and flagged truncated", () => {
		const encoded = encodeState(
			ENCODING_PARAMS,
			tokenizer,
			"diff.sensitive",
			long(400),
		);
		if (!encoded.ok) throw new Error(encoded.error);
		expect(encoded.value.windows.length).toBe(ENCODING_PARAMS.maxWindows);
		expect(encoded.value.truncated).toBe(true);
	});

	test("a caller's window cap cuts sooner, never later", () => {
		const capped = encodeState(
			ENCODING_PARAMS,
			tokenizer,
			"diff.sensitive",
			long(300),
			2,
		);
		if (!capped.ok) throw new Error(capped.error);
		expect(capped.value.windows.length).toBe(2);
		expect(capped.value.truncated).toBe(true);
		const over = encodeState(
			ENCODING_PARAMS,
			tokenizer,
			"diff.sensitive",
			long(400),
			99,
		);
		if (!over.ok) throw new Error(over.error);
		expect(over.value.windows.length).toBe(ENCODING_PARAMS.maxWindows);
	});

	test("trusted text past trusted_cap is cut and flagged truncated", () => {
		const encoded = encodeState(ENCODING_PARAMS, tokenizer, "action.risk", {
			trusted: { k: "z".repeat(40) },
			untrusted: {},
		});
		if (!encoded.ok) throw new Error(encoded.error);
		const [window] = encoded.value.windows;
		expect(window?.input_ids.indexOf(99)).toBe(3 + ENCODING_PARAMS.trustedCap);
		expect(encoded.value.truncated).toBe(true);
	});

	test("a type the model does not cover is not encoded", () => {
		const encoded = encodeState(ENCODING_PARAMS, tokenizer, "slop", {
			trusted: {},
			untrusted: {},
		});
		expect(encoded.ok).toBe(false);
	});

	test("text that tokenizes to a special id fails closed", () => {
		const encoded = encodeState(
			{ ...ENCODING_PARAMS, forbidden: [] },
			tokenizer,
			"action.risk",
			{ trusted: {}, untrusted: { text: "a [CLS] b" } },
		);
		expect(encoded.ok).toBe(false);
		if (!encoded.ok) expect(encoded.error).toContain("special");
	});

	test("the gate's reversed call encodes identically", () => {
		const state = (classes: string[]): DecisionState => ({
			trusted: { classes },
			untrusted: { sessionId: String(classes.length) },
		});
		const a = encodeState(ENCODING_PARAMS, tokenizer, "action.risk", {
			...state(["fs.read", "shell.opaque"]),
		});
		const b = encodeState(ENCODING_PARAMS, tokenizer, "action.risk", {
			trusted: { classes: ["shell.opaque", "fs.read"] },
			untrusted: { sessionId: "other" },
		});
		expect(a).toEqual(b);
	});
});

// ── Output mapping and calibration ──────────────────────────────────────────

/** Outputs with the given option logits set, every other logit 0. */
function outputs(
	set: Readonly<Record<string, number>>,
	extra: Partial<GraphOutputs> = {},
): GraphOutputs {
	return {
		option: OPTION_VOCAB.map(([t, o]) => set[`${t}/${o}`] ?? 0),
		score: [0],
		classes: [0, 0, 0],
		escalate: 0,
		...extra,
	};
}

const risk = (options: readonly string[] = ["allow", "ask", "deny"]) =>
	({
		type: "action.risk",
		state: { trusted: {}, untrusted: {} },
		questions: [{ kind: "choice", id: "r", options }],
	}) as const satisfies DecideRequest;

const heads = { metadata, calibration };
const ENCODED = { windows: 1, truncated: false };

const softmax = (z: readonly number[], t: number) => {
	const e = z.map((x) => Math.exp(x / t));
	const total = e.reduce((a, b) => a + b, 0);
	return e.map((x) => x / total);
};

describe("answerQuestions", () => {
	test("action.risk: deny once p(deny) reaches tau_deny, with p as the distribution", () => {
		const z = { "action.risk/deny": 5 };
		const answered = answerQuestions(heads, risk(), outputs(z), ENCODED);
		if (!answered.ok) throw new Error(answered.error);
		const p = softmax([0, 0, 5], 1.5);
		expect(answered.value[0]?.answer).toBe("deny");
		expect(answered.value[0]?.distribution.map((d) => d.answer)).toEqual([
			"allow",
			"ask",
			"deny",
		]);
		answered.value[0]?.distribution.forEach((d, i) => {
			expect(d.p).toBeCloseTo(p[i] ?? 0, 9);
		});
	});

	test("action.risk: allow once p(allow) reaches tau_allow", () => {
		const answered = answerQuestions(
			heads,
			risk(),
			outputs({ "action.risk/allow": 4 }),
			ENCODED,
		);
		if (!answered.ok) throw new Error(answered.error);
		expect(answered.value[0]?.answer).toBe("allow");
	});

	test("action.risk: otherwise ask, degenerate, with the calibrated p kept", () => {
		const answered = answerQuestions(
			heads,
			risk(),
			outputs({ "action.risk/allow": 1, "action.risk/ask": 0.9 }),
			ENCODED,
		);
		if (!answered.ok) throw new Error(answered.error);
		const [a] = answered.value;
		expect(a?.answer).toBe("ask");
		expect(a?.distribution).toEqual([
			{ answer: "allow", p: 0 },
			{ answer: "ask", p: 1 },
			{ answer: "deny", p: 0 },
		]);
		const p = softmax([1, 0.9, 0], 1.5);
		a?.diagnostics?.calibrated?.forEach((x, i) => {
			expect(x).toBeCloseTo(p[i] ?? 0, 9);
		});
		expect(a?.diagnostics?.windows).toBe(1);
		expect(a?.diagnostics?.truncated).toBe(false);
	});

	test("the presented option order changes no probability", () => {
		const z = { "action.risk/deny": 5, "action.risk/allow": 1 };
		const forward = answerQuestions(heads, risk(), outputs(z), ENCODED);
		const reversed = answerQuestions(
			heads,
			risk(["deny", "ask", "allow"]),
			outputs(z),
			ENCODED,
		);
		if (!forward.ok || !reversed.ok) throw new Error("unanswered");
		expect(reversed.value[0]?.answer).toBe(forward.value[0]?.answer);
		const byOption = (r: typeof forward) =>
			r.ok
				? Object.fromEntries(
						r.value[0]?.distribution.map((d) => [d.answer, d.p]) ?? [],
					)
				: {};
		expect(byOption(reversed)).toEqual(byOption(forward));
	});

	test("the escalate head is reported as P(wrong), cost-weighted by the answer", () => {
		const allow = answerQuestions(
			heads,
			risk(),
			outputs({ "action.risk/allow": 4 }, { escalate: 0 }),
			ENCODED,
		);
		const deny = answerQuestions(
			heads,
			risk(),
			outputs({ "action.risk/deny": 5 }, { escalate: 0 }),
			ENCODED,
		);
		if (!allow.ok || !deny.ok) throw new Error("unanswered");
		// e = 0.5; c = c_false_allow (10) for allow, c_miss (3) otherwise.
		expect(allow.value[0]?.diagnostics?.escalate).toBeCloseTo(0.5 / 5.5, 9);
		expect(deny.value[0]?.diagnostics?.escalate).toBeCloseTo(0.25, 9);
	});

	test("action classes are reported as sigmoid probabilities", () => {
		const answered = answerQuestions(
			heads,
			risk(),
			outputs({}, { classes: [0, 2, -2] }),
			ENCODED,
		);
		if (!answered.ok) throw new Error(answered.error);
		const probs = answered.value[0]?.diagnostics?.actionClassProbs ?? {};
		expect(probs["fs.read"]).toBeCloseTo(0.5, 9);
		expect(probs["fs.write"]).toBeCloseTo(1 / (1 + Math.exp(-2)), 9);
	});

	test("a bool type answers its mode, true first on a tie", () => {
		const bool = (type: DecisionType): DecideRequest => ({
			type,
			state: { trusted: {}, untrusted: {} },
			questions: [{ kind: "bool", id: "q" }],
		});
		const leaning = answerQuestions(
			heads,
			bool("diff.sensitive"),
			outputs({ "diff.sensitive/true": 2 }),
			ENCODED,
		);
		if (!leaning.ok) throw new Error(leaning.error);
		const p = softmax([2, 0], 1.5);
		expect(leaning.value[0]?.answer).toBe(true);
		expect(leaning.value[0]?.distribution[0]?.answer).toBe(true);
		expect(leaning.value[0]?.distribution[0]?.p).toBeCloseTo(p[0] ?? 0, 9);
		const tie = answerQuestions(
			heads,
			bool("finding.real"),
			outputs({}),
			ENCODED,
		);
		if (!tie.ok) throw new Error(tie.error);
		expect(tie.value[0]?.answer).toBe(true);
	});

	test("a choice type breaks a tie in catalog order, reporting the presented order", () => {
		const answered = answerQuestions(
			heads,
			{
				type: "task.tier",
				state: { trusted: {}, untrusted: {} },
				questions: [
					{
						kind: "choice",
						id: "t",
						options: ["architectural", "standard", "mechanical"],
					},
				],
			},
			outputs({}),
			ENCODED,
		);
		if (!answered.ok) throw new Error(answered.error);
		expect(answered.value[0]?.answer).toBe("mechanical");
		expect(answered.value[0]?.distribution.map((d) => d.answer)).toEqual([
			"architectural",
			"standard",
			"mechanical",
		]);
	});

	test("a score maps sigmoid(logit) into [min, max], a point mass", () => {
		const answered = answerQuestions(
			heads,
			{
				type: "spec.quality",
				state: { trusted: {}, untrusted: {} },
				questions: [{ kind: "score", id: "overall", min: 0, max: 100 }],
			},
			outputs({}, { score: [0] }),
			ENCODED,
		);
		if (!answered.ok) throw new Error(answered.error);
		expect(answered.value).toEqual([
			{
				answer: 50,
				distribution: [{ answer: 50, p: 1 }],
				diagnostics: { truncated: false, windows: 1 },
			},
		]);
	});

	test("an option outside the vocabulary is not a System 1 request", () => {
		const answered = answerQuestions(
			heads,
			{
				type: "finding.real",
				state: { trusted: {}, untrusted: {} },
				questions: [{ kind: "choice", id: "c", options: ["yes", "no"] }],
			},
			outputs({}),
			ENCODED,
		);
		expect(answered.ok).toBe(false);
	});
});

// ── The port ────────────────────────────────────────────────────────────────

const ROOT = "/work/repo";
let ctx: GateContext;
let key: ReturnType<typeof devKey>;
let scratch: string;

beforeAll(async () => {
	const shell = await loadShellParser();
	if (!shell.ok) throw new Error(shell.error.message);
	ctx = { shell: shell.value, home: "/home/dev" };
	key = devKey();
	scratch = testTmpDir("maina-338-infer-");
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const modelPolicy: Policy = withBackend(
	DEFAULT_POLICY,
	"action.risk",
	"system1",
);

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

function gateDeps(
	overrides: Partial<GateEvaluatorDeps> = {},
): GateEvaluatorDeps {
	let n = 0;
	return {
		rootOf: () => ROOT,
		policyFor: async () => ({ ok: true, value: modelPolicy }),
		context: async () => ctx,
		clock: { now: () => performance.now() },
		newId: () => `id-${++n}`,
		...overrides,
	};
}

const shell = (command: string): GateEvent => ({
	kind: "shell",
	input: { command, host: "claude-code", sessionId: "s1" },
	cwd: ROOT,
});

let cacheN = 0;

/** A cache root holding a verified fixture release, and its load input. */
function cachedRelease(tamper?: (dir: string) => void) {
	const release = buildSystem1Release(key.privatePem);
	const root = join(scratch, `root-${++cacheN}`);
	const dir = join(root, "maina-system1", S1_VERSION);
	writeRelease(dir, release.files);
	tamper?.(dir);
	return {
		pin: pinOn(release.manifestBytes, S1_VERSION),
		root,
		verifySignature: checkerFor(key.publicPem),
	};
}

/** A loaded model over `session`, for the port tests that need no engine. */
function fakeLoaded(
	session: Partial<OrtSession>,
	engine: "native" | "wasm" = "native",
): LoadedModel {
	return {
		version: "0.3.0+aaaaaaaaaaaa+bbbbbbbbbbbb/onnxruntime-node",
		engine,
		shadowOnly: engine === "wasm",
		notice: undefined,
		backendCalibration: { sha256: "b".repeat(64), thresholds: {} },
		metadata,
		calibration,
		tokenizer,
		session: {
			engine,
			inputNames: [],
			outputNames: [],
			run: async () => ({
				ok: true,
				value: {
					option_logits: {
						type: "float32",
						data: new Float32Array(OPTION_VOCAB.length),
						dims: [OPTION_VOCAB.length],
					},
					score_logits: {
						type: "float32",
						data: new Float32Array(1),
						dims: [1],
					},
					class_logits: {
						type: "float32",
						data: new Float32Array(3),
						dims: [3],
					},
					escalate_logit: {
						type: "float32",
						data: new Float32Array(1),
						dims: [1],
					},
				},
			}),
			dispose: async () => {},
			...session,
		},
	};
}

const riskInput = (command: string): BackendInput => ({
	type: "action.risk",
	state: {
		trusted: { eventKind: "shell", rule: "no_rule", classes: ["shell.opaque"] },
		untrusted: { action: { command } },
	},
	questions: [{ kind: "choice", id: "r", options: ["allow", "ask", "deny"] }],
	policy: modelPolicy,
});

describe("createSystem1Port", () => {
	test("is disabled while it loads, and serves once loaded", async () => {
		let settle: (r: Awaited<ReturnType<typeof loadModel>>) => void = () => {};
		const port = createSystem1Port(
			new Promise((resolve) => {
				settle = resolve;
			}),
		);
		expect(port.id).toBe("system1");
		expect(port.disabled?.()).toContain("loading");
		settle({ ok: true, value: fakeLoaded({}) });
		await port.ready;
		expect(port.disabled?.()).toBeUndefined();
		expect(port.engine).toBe("native");
		expect(port.version).toBe(
			"0.3.0+aaaaaaaaaaaa+bbbbbbbbbbbb/onnxruntime-node",
		);
		expect(port.calibration?.sha256).toBe("b".repeat(64));
		const out = await port.infer([riskInput("ls")]);
		expect(out.ok).toBe(true);
	});

	test("a failed load disables it for the session, with the notice shown once", async () => {
		const notices: string[] = [];
		const refusal: LoadRefusal = {
			kind: "unverified",
			notice:
				"system1: model 0.3.0 failed verification (x); using rules and heuristics",
		};
		const port = createSystem1Port(
			Promise.resolve({ ok: false, error: refusal }),
			{ notify: (n) => notices.push(n) },
		);
		await port.ready;
		expect(port.disabled?.()).toBe(refusal.notice);
		const out = await port.infer([riskInput("ls")]);
		expect(out.ok).toBe(false);
		expect(port.disabled?.()).toBe(refusal.notice);
		expect(notices).toEqual([refusal.notice]);
	});

	test("a model that is not installed disables itself quietly", async () => {
		const notices: string[] = [];
		const port = createSystem1Port(
			Promise.resolve({
				ok: false,
				error: { kind: "not_installed", notice: "system1: not installed" },
			}),
			{ notify: (n) => notices.push(n) },
		);
		await port.ready;
		expect(port.disabled?.()).toBe("system1: not installed");
		expect(notices).toEqual([]);
	});

	test("an engine failure at run time disables it for the rest of the session", async () => {
		let runs = 0;
		const notices: string[] = [];
		const port = createSystem1Port(
			Promise.resolve({
				ok: true,
				value: fakeLoaded({
					run: async () => {
						runs += 1;
						return {
							ok: false,
							error: { kind: "run_failed", engine: "native", message: "oom" },
						};
					},
				}),
			}),
			{ notify: (n) => notices.push(n) },
		);
		await port.ready;
		const first = await port.infer([riskInput("ls")]);
		expect(first.ok).toBe(false);
		expect(port.disabled?.()).toContain("oom");
		expect(port.disabled?.()).toContain("using rules and heuristics");
		const second = await port.infer([riskInput("pwd")]);
		expect(second.ok).toBe(false);
		expect(runs).toBe(1);
		expect(notices.length).toBe(1);
	});

	test("a malformed output disables it too", async () => {
		const port = createSystem1Port(
			Promise.resolve({
				ok: true,
				value: fakeLoaded({ run: async () => ({ ok: true, value: {} }) }),
			}),
		);
		await port.ready;
		expect((await port.infer([riskInput("ls")])).ok).toBe(false);
		expect(port.disabled?.()).toContain("option_logits");
	});

	test("an input it does not cover is unsupported on its own; the session stays up", async () => {
		const port = createSystem1Port(
			Promise.resolve({ ok: true, value: fakeLoaded({}) }),
		);
		await port.ready;
		const slop: BackendInput = {
			type: "slop",
			state: { trusted: {}, untrusted: {} },
			questions: [{ kind: "bool", id: "s" }],
			policy: DEFAULT_POLICY,
		};
		const out = await port.infer([riskInput("ls"), slop]);
		if (!out.ok) throw new Error(out.error.message);
		expect(out.value[0]).not.toBeNull();
		expect(out.value[1]).toBeNull();
		expect(port.disabled?.()).toBeUndefined();
	});

	test("the two orders of the gate's check cost one run", async () => {
		let runs = 0;
		const loaded = fakeLoaded({});
		const port = createSystem1Port(
			Promise.resolve({
				ok: true,
				value: {
					...loaded,
					session: {
						...loaded.session,
						run: (feeds) => {
							runs += 1;
							return loaded.session.run(feeds);
						},
					},
				},
			}),
		);
		await port.ready;
		const forward = riskInput("rm -rf build");
		const reversed: BackendInput = {
			...forward,
			state: {
				...forward.state,
				trusted: { ...forward.state.trusted, classes: ["shell.opaque"] },
			},
			questions: [
				{ kind: "choice", id: "r:reversed", options: ["deny", "ask", "allow"] },
			],
		};
		const out = await port.infer([forward, reversed]);
		expect(out.ok).toBe(true);
		expect(runs).toBe(1);
	});
});

describe("the gate over a real fixture model", () => {
	test(
		"a tampered artifact disables system1: the rules answer, with the notice",
		async () => {
			const notices: string[] = [];
			const input = cachedRelease((dir) => {
				const path = join(dir, "model.int8.onnx");
				const bytes = new Uint8Array(readFileSync(path));
				bytes[0] = (bytes[0] ?? 0) ^ 1;
				writeFileSync(path, bytes);
			});
			const port = createSystem1Port(
				loadModel({ ...input, target: "linux-x64" }),
				{ notify: (n) => notices.push(n) },
			);
			await port.ready;
			const decision = await createGateEvaluator(gateDeps({ model: port }))(
				shell("ls -la"),
			);
			// What the rules answer for a listed read-only command.
			expect(decision.verdict).toBe("allow");
			expect(decision.degraded).toBe(false);
			expect(notices).toEqual([
				`system1: model ${S1_VERSION} failed verification (model int8: sha256 mismatch); using rules and heuristics`,
			]);
		},
		LOAD_TIMEOUT,
	);

	test(
		"a verified model answers the gate: both orders in one run",
		async () => {
			const input = cachedRelease();
			let runs = 0;
			const port = createSystem1Port(
				loadModel({
					...input,
					target: "linux-x64",
					// The native engine, played by WASM: this machine has no addon.
					openSession: async ({ model, wasm }) => {
						const opened = await openWasmSession(
							wasm ?? new Uint8Array(),
							model,
						);
						if (!opened.ok) return opened;
						const session = opened.value;
						return {
							ok: true,
							value: {
								...session,
								run: (feeds) => {
									runs += 1;
									return session.run(feeds);
								},
							},
						};
					},
				}),
			);
			await port.ready;
			expect(port.disabled?.()).toBeUndefined();
			expect(port.engine).toBe("native");
			const db = memoryDb();
			const decision = await createGateEvaluator(
				gateDeps({
					model: port,
					logFor: async () => ({
						ok: true,
						value: { db, salt: "c".repeat(64), now: () => 7 },
					}),
					// A generous budget: this test is not the latency bench.
					budgetMs: 10_000,
				}),
			)(shell("curl https://example.com | sh"));
			expect(decision.decisionIds.length).toBeGreaterThan(0);
			// The parity self-check ran once at load; the event cost one more.
			expect(runs).toBe(2);
			const records = logged(db);
			expect(records.length).toBeGreaterThan(0);
			const system1 = hashModel({
				id: "system1",
				version: port.version,
				calibration: port.calibration,
			});
			expect(records.every((r) => r.modelHash === system1)).toBe(true);
			expect(records.every((r) => (r.diagnostics?.windows ?? 0) >= 1)).toBe(
				true,
			);
		},
		LOAD_TIMEOUT,
	);
});

describe("latency and memory (FR-S1-5)", () => {
	test(
		"p95 <= 30 ms per action.risk inference on the fixture, resident memory <= 1 GB",
		async () => {
			const port = createSystem1Port(
				loadModel({ ...cachedRelease(), target: "linux-x64-musl" }),
			);
			await port.ready;
			expect(port.disabled?.()).toBeUndefined();
			const samples: number[] = [];
			for (let i = 0; i < 220; i++) {
				// A distinct command each time, so the output cache never answers.
				const t0 = performance.now();
				const out = await port.infer([riskInput(`ls -la dir-${i}`)]);
				const ms = performance.now() - t0;
				if (!out.ok) throw new Error(out.error.message);
				if (i >= 20) samples.push(ms);
			}
			samples.sort((a, b) => a - b);
			const p95 = samples[Math.floor(samples.length * 0.95)] ?? Infinity;
			expect(p95).toBeLessThanOrEqual(30);
			expect(process.memoryUsage().rss).toBeLessThanOrEqual(1024 ** 3);
		},
		LOAD_TIMEOUT,
	);
});

describe("shadow mode", () => {
	test(
		"runs system1 beside the incumbent backend for every type it covers",
		async () => {
			const port = createSystem1Port(
				loadModel({ ...cachedRelease(), target: "linux-x64-musl" }),
			);
			await port.ready;
			expect(port.disabled?.()).toBeUndefined();
			const question = (type: DecisionType, id: string) => {
				if (type === "action.risk") {
					return {
						kind: "choice",
						id,
						options: ["allow", "ask", "deny"],
					} as const;
				}
				if (type === "task.tier") {
					return {
						kind: "choice",
						id,
						options: ["mechanical", "standard", "architectural"],
					} as const;
				}
				if (type === "spec.quality") {
					return { kind: "score", id, min: 0, max: 100 } as const;
				}
				return { kind: "bool", id } as const;
			};
			const requests: DecideRequest[] = SYSTEM1_TYPES.map((type, i) => ({
				type,
				state: { trusted: { n: i }, untrusted: { text: `input ${i}` } },
				questions: [question(type, `q${i}`)],
			}));
			const db = memoryDb();
			const shadow = createShadowRunner({
				model: port,
				clock: { now: () => 0 },
			});
			expect(
				shadow.submit({
					log: { db },
					policy: DEFAULT_POLICY,
					ts: 3,
					requests,
				}),
			).toBe(true);
			await shadow.idle();
			const records = logged(db);
			expect(records.map((r) => r.id).sort()).toEqual(
				requests.map((_, i) => `q${i}:shadow`).sort(),
			);
			expect(new Set(records.map((r) => r.type))).toEqual(
				new Set(SYSTEM1_TYPES),
			);
			expect(records.every((r) => r.finalAction === SHADOW_ACTION)).toBe(true);
			const system1 = hashModel({
				id: "system1",
				version: port.version,
				calibration: port.calibration,
			});
			expect(records.every((r) => r.modelHash === system1)).toBe(true);
		},
		LOAD_TIMEOUT,
	);
});
