/**
 * Running System 1 (#338): the encoder, the output mapping and the
 * `InferencePort` the gate's pre-inference and the shadow runner call.
 *
 * - **Encode** (encoding.md steps 5–6): core's `canonicalTexts` gives the
 *   canonical, scrubbed trusted and untrusted texts; they are tokenized
 *   with no special tokens and laid out in windows of
 *   `[CLS] [TYPE:t] [TRUSTED] T [UNTRUSTED] U [SEP]`, the trusted header
 *   repeated whole in every window. Every parameter comes from the
 *   release's `metadata.json`.
 * - **Run**: all of a request's windows in one batch, right-padded.
 * - **Answer** (system1-artifact.md §4, calibration.md): each option's own
 *   logit, softmax at the length bucket's temperature, then `action.risk`'s
 *   conformal thresholds (deny, else allow, else ask) or, for the shadow
 *   types, the mode. The escalate head is reported as P(wrong) and the
 *   action classes as probabilities; `decide` acts on them.
 *
 * **Session-level disable** (§8, decided here): a model that fails to load,
 * or whose engine fails at run time (an error, a malformed output), turns
 * itself off for the rest of the process: `disabled()` returns the notice,
 * shown once through `notify`, and the gate and `decide` fall back to the
 * built-in backends. A request the model does not cover (a type or option
 * outside `metadata.json`, text that encodes to a special id) is not a
 * model fault: that input alone is answered `null`, and the built-in
 * backend answers it. A slow run is not a fault either: the caller's
 * budget (`preInfer`) abandons it and the rules answer.
 */

import { createHash } from "node:crypto";
import {
	type Answer,
	type BackendAnswer,
	type BackendCalibration,
	type BackendError,
	type BackendInput,
	canonicalTexts,
	DECISION_CATALOG,
	type DecideRequest,
	type DecisionDiagnostics,
	type DecisionState,
	type DecisionType,
	type LengthBucket,
	lengthBucket,
	type Question,
	type Result,
} from "@mainahq/core";
import type { InferencePort } from "../system1";
import type { Engine, Feeds, OrtSession, TensorValue } from "./engine";
import type { ParityEngine, ParityObservation } from "./parity";
import type { TokenizerPort } from "./tokenizer";

// ── Artifact types (parsed by `load.ts`) ────────────────────────────────────

/** `metadata.encoding` (encoding.md "Parameters"). */
export type EncodingParams = Readonly<{
	window: number;
	overlap: number;
	trustedCap: number;
	maxWindows: number;
	markers: Readonly<Record<string, number>>;
	clsId: number;
	sepId: number;
	padId: number;
	specialIds: readonly number[];
	forbidden: readonly string[];
}>;

export type System1Metadata = Readonly<{
	types: readonly string[];
	/** `option_logits` index by `vocabKey(type, option)`. */
	options: ReadonlyMap<string, number>;
	optionCount: number;
	/** `score_logits` index by `vocabKey(type, question)`. */
	scores: ReadonlyMap<string, number>;
	scoreCount: number;
	classes: readonly string[];
	escalate: Readonly<{ trained: boolean; cFalseAllow: number; cMiss: number }>;
	encoding: EncodingParams;
}>;

/** `null` is +∞: never. */
type RiskThresholds = Readonly<{
	tauAllow: number | null;
	tauDeny: number | null;
}>;

export type System1Calibration = Readonly<{
	/** sha256 of `calibration.json`. */
	sha256: string;
	/** The model sha256 the file names, when it names one. */
	modelSha256: string | undefined;
	temperatures: Readonly<
		Record<string, Readonly<Partial<Record<LengthBucket, number>>>>
	>;
	globalTemperature: number;
	/** Absent: always ask. */
	risk: RiskThresholds | undefined;
	/** Mondrian thresholds by bucket, when the file has them. */
	riskByBucket: Readonly<Partial<Record<LengthBucket, RiskThresholds>>>;
	/** Per shadow type, the confidence to act at (`null`: never). */
	confidence: Readonly<Partial<Record<DecisionType, number | null>>>;
}>;

/** A verified, loaded model that passed its parity self-check. */
export type LoadedModel = Readonly<{
	/** `Backend.version` (core `system1Version`). */
	version: string;
	engine: Engine;
	/** The engine cannot answer inside the gate's budget: shadow only. */
	shadowOnly: boolean;
	/** Shown once the model serves (a WASM-only target, say). */
	notice: string | undefined;
	backendCalibration: BackendCalibration;
	metadata: System1Metadata;
	calibration: System1Calibration;
	tokenizer: TokenizerPort;
	session: OrtSession;
}>;

type Heads = Pick<LoadedModel, "metadata" | "calibration">;

/** The graph's outputs for one request. */
export type GraphOutputs = Readonly<{
	option: ArrayLike<number>;
	score: ArrayLike<number>;
	classes: ArrayLike<number>;
	escalate: number;
}>;

type Window = Readonly<{
	input_ids: readonly number[];
	segment_ids: readonly number[];
}>;

type Encoded = Readonly<{ windows: readonly Window[]; truncated: boolean }>;

export const vocabKey = (type: string, key: string): string =>
	`${type}\u0000${key}`;

/** The runtime's notice for a model that is off, and why. */
export const system1Notice = (why: string): string =>
	`system1: ${why}; using rules and heuristics`;

const fail = <T = never>(error: string): Result<T, string> => ({
	ok: false,
	error,
});

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// ── Encode ──────────────────────────────────────────────────────────────────

/** `[CLS]`, `[TYPE:t]`, `[TRUSTED]`, `[UNTRUSTED]`. */
const HEADER = 4;

/**
 * The windows of a `type` request over `state` (encoding.md steps 2–6).
 * `maxWindows` can only lower the model's own limit. An error means the
 * model cannot take the request.
 */
export function encodeState(
	params: EncodingParams,
	tokenizer: TokenizerPort,
	type: string,
	state: DecisionState,
	maxWindows?: number,
): Result<Encoded, string> {
	const typeMarker = params.markers[`[TYPE:${type}]`];
	const trusted = params.markers["[TRUSTED]"];
	const untrusted = params.markers["[UNTRUSTED]"];
	if (typeMarker === undefined) return fail(`${type} is not a System 1 type`);
	if (trusted === undefined || untrusted === undefined) {
		return fail("the encoding has no [TRUSTED]/[UNTRUSTED] markers");
	}
	const texts = canonicalTexts(state, params.forbidden);
	if (!texts.ok) return fail(texts.error.message);
	const t = tokenizer.encode(texts.value.trusted);
	if (!t.ok) return fail(t.error.message);
	const u = tokenizer.encode(texts.value.untrusted);
	if (!u.ok) return fail(u.error.message);
	const special = new Set(params.specialIds);
	if (
		t.value.some((id) => special.has(id)) ||
		u.value.some((id) => special.has(id))
	) {
		return fail("the text encodes to a special token id");
	}
	const kept = t.value.slice(0, params.trustedCap);
	const header = [params.clsId, typeMarker, trusted, ...kept, untrusted];
	const room = params.window - HEADER - 1 - kept.length;
	const stride = room - params.overlap;
	const cap = Math.max(
		1,
		Math.min(
			Number.isInteger(maxWindows) ? (maxWindows as number) : params.maxWindows,
			params.maxWindows,
		),
	);
	const ids = u.value;
	const starts = [0];
	let last = 0;
	while (last + room < ids.length && starts.length < cap) {
		last += stride;
		starts.push(last);
	}
	const headerSegments = header.map(() => 0);
	return {
		ok: true,
		value: {
			windows: starts.map((s) => {
				const part = ids.slice(s, s + room);
				return {
					input_ids: [...header, ...part, params.sepId],
					segment_ids: [...headerSegments, ...part.map(() => 1), 0],
				};
			}),
			truncated: t.value.length > params.trustedCap || last + room < ids.length,
		},
	};
}

// ── Run ─────────────────────────────────────────────────────────────────────

/** The windows as one batch, right-padded with `padId`, mask 0, segment 0. */
function toFeeds(
	windows: readonly Window[],
	truncated: boolean,
	padId: number,
): Feeds {
	const w = windows.length;
	const l = Math.max(...windows.map((x) => x.input_ids.length));
	const ids = new BigInt64Array(w * l).fill(BigInt(padId));
	const mask = new BigInt64Array(w * l);
	const segments = new BigInt64Array(w * l);
	windows.forEach((window, i) => {
		window.input_ids.forEach((id, j) => {
			ids[i * l + j] = BigInt(id);
			mask[i * l + j] = 1n;
			segments[i * l + j] = BigInt(window.segment_ids[j] ?? 0);
		});
	});
	const dims = [w, l];
	return {
		input_ids: { type: "int64", data: ids, dims },
		attention_mask: { type: "int64", data: mask, dims },
		segment_ids: { type: "int64", data: segments, dims },
		truncated: {
			type: "int64",
			data: BigInt64Array.of(truncated ? 1n : 0n),
			dims: [1],
		},
	};
}

/** The graph outputs `metadata` promises, or which one is not. */
function readOutputs(
	values: Readonly<Record<string, TensorValue>>,
	metadata: System1Metadata,
): Result<GraphOutputs, string> {
	const floats = (name: string, n: number): Result<Float32Array, string> => {
		const v = values[name];
		return v?.type === "float32" &&
			v.data.length === n &&
			v.data.every(Number.isFinite)
			? { ok: true, value: v.data }
			: fail(`the graph returned no usable ${name}`);
	};
	const option = floats("option_logits", metadata.optionCount);
	if (!option.ok) return option;
	const score = floats("score_logits", metadata.scoreCount);
	if (!score.ok) return score;
	const classes = floats("class_logits", metadata.classes.length);
	if (!classes.ok) return classes;
	const escalate = floats("escalate_logit", 1);
	if (!escalate.ok) return escalate;
	return {
		ok: true,
		value: {
			option: option.value,
			score: score.value,
			classes: classes.value,
			escalate: escalate.value[0] ?? 0,
		},
	};
}

/** One run of the graph over `encoded`. An error is the engine's fault. */
async function runGraph(
	session: OrtSession,
	metadata: System1Metadata,
	windows: readonly Window[],
	truncated: boolean,
): Promise<Result<GraphOutputs, string>> {
	let ran: Awaited<ReturnType<OrtSession["run"]>>;
	try {
		ran = await session.run(
			toFeeds(windows, truncated, metadata.encoding.padId),
		);
	} catch (e) {
		return fail(`inference failed: ${errorText(e)}`);
	}
	if (!ran.ok) return fail(`inference failed: ${ran.error.message}`);
	return readOutputs(ran.value, metadata);
}

// ── Answer ──────────────────────────────────────────────────────────────────

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function softmax(z: readonly number[], t: number): number[] {
	const scaled = z.map((x) => x / t);
	const max = Math.max(...scaled);
	const e = scaled.map((x) => Math.exp(x - max));
	const total = e.reduce((a, b) => a + b, 0);
	return e.map((x) => x / total);
}

function temperature(
	calibration: System1Calibration,
	type: string,
	bucket: LengthBucket,
): number {
	return (
		calibration.temperatures[type]?.[bucket] ?? calibration.globalTemperature
	);
}

/** Each option key's logit, presented order, or the first key not in the vocabulary. */
function optionLogits(
	metadata: System1Metadata,
	outputs: GraphOutputs,
	type: string,
	keys: readonly string[],
): Result<number[], string> {
	const logits: number[] = [];
	for (const key of keys) {
		const index = metadata.options.get(vocabKey(type, key));
		const z = index === undefined ? undefined : outputs.option[index];
		if (z === undefined) return fail(`${type} has no option ${key}`);
		logits.push(z);
	}
	return { ok: true, value: logits };
}

function scoreLogit(
	metadata: System1Metadata,
	outputs: GraphOutputs,
	type: string,
	questionId: string,
): number | undefined {
	const index =
		metadata.scores.get(vocabKey(type, questionId)) ??
		metadata.scores.get(vocabKey(type, "*"));
	return index === undefined ? undefined : outputs.score[index];
}

type Choice = Readonly<{ keys: readonly string[]; answers: readonly Answer[] }>;

function choiceOf(question: Exclude<Question, { kind: "score" }>): Choice {
	return question.kind === "bool"
		? { keys: ["true", "false"], answers: [true, false] }
		: { keys: question.options, answers: question.options };
}

/** action.risk: deny, else allow, else ask (calibration.md step 4a). */
function riskAnswer(
	calibration: System1Calibration,
	bucket: LengthBucket,
	keys: readonly string[],
	p: readonly number[],
): Result<Readonly<{ answer: string; isMode: boolean }>, string> {
	const at = (k: string) => keys.indexOf(k);
	if (keys.length !== 3 || [at("allow"), at("ask"), at("deny")].includes(-1)) {
		return fail("action.risk needs the options allow, ask and deny");
	}
	const thresholds = calibration.riskByBucket[bucket] ?? calibration.risk;
	const tauAllow = thresholds?.tauAllow ?? Number.POSITIVE_INFINITY;
	const tauDeny = thresholds?.tauDeny ?? Number.POSITIVE_INFINITY;
	const pOf = (k: string) => p[at(k)] ?? 0;
	const answer =
		pOf("deny") >= tauDeny
			? "deny"
			: pOf("allow") >= tauAllow
				? "allow"
				: "ask";
	return {
		ok: true,
		value: { answer, isMode: pOf(answer) === Math.max(...p) },
	};
}

/** The mode of `p`, a tie going to the earliest answer in `canonical` order. */
function modeOf(
	answers: readonly Answer[],
	p: readonly number[],
	canonical: readonly Answer[],
): Answer {
	const max = Math.max(...p);
	const modes = answers.filter((_, i) => p[i] === max);
	return (
		canonical.find((c) => modes.includes(c)) ?? modes[0] ?? answers[0] ?? ""
	);
}

/** P(wrong) from the escalate head (ADR 0013): e / (c − (c − 1)·e). */
function escalateProbability(
	metadata: System1Metadata,
	outputs: GraphOutputs,
	answer: Answer,
): number {
	const e = sigmoid(outputs.escalate);
	const c =
		answer === "allow"
			? metadata.escalate.cFalseAllow
			: metadata.escalate.cMiss;
	return e / (c - (c - 1) * e);
}

function choiceAnswer(
	heads: Heads,
	request: DecideRequest,
	question: Exclude<Question, { kind: "score" }>,
	outputs: GraphOutputs,
	bucket: LengthBucket,
	base: DecisionDiagnostics,
): Result<BackendAnswer, string> {
	const { metadata, calibration } = heads;
	const { type } = request;
	const { keys, answers } = choiceOf(question);
	const z = optionLogits(metadata, outputs, type, keys);
	if (!z.ok) return z;
	const p = softmax(z.value, temperature(calibration, type, bucket));
	const distribution = answers.map((answer, i) => ({ answer, p: p[i] ?? 0 }));
	let answer: Answer;
	let thresholded = distribution;
	if (type === "action.risk") {
		const risk = riskAnswer(calibration, bucket, keys, p);
		if (!risk.ok) return risk;
		answer = risk.value.answer;
		if (!risk.value.isMode) {
			thresholded = answers.map((a) => ({
				answer: a,
				p: a === answer ? 1 : 0,
			}));
		}
	} else {
		const canonical =
			question.kind === "bool"
				? [true, false]
				: (DECISION_CATALOG[type].options ?? question.options);
		answer = modeOf(answers, p, canonical);
	}
	const diagnostics: DecisionDiagnostics = {
		...base,
		calibrated: p,
		...(metadata.escalate.trained
			? { escalate: escalateProbability(metadata, outputs, answer) }
			: {}),
		...(type === "action.risk"
			? {
					actionClassProbs: Object.fromEntries(
						metadata.classes.map((c, i) => [
							c,
							sigmoid(outputs.classes[i] ?? 0),
						]),
					),
				}
			: {}),
	};
	return {
		ok: true,
		value: { answer, distribution: thresholded, diagnostics },
	};
}

function scoreAnswer(
	heads: Heads,
	request: DecideRequest,
	question: Extract<Question, { kind: "score" }>,
	outputs: GraphOutputs,
	base: DecisionDiagnostics,
): Result<BackendAnswer, string> {
	const z = scoreLogit(heads.metadata, outputs, request.type, question.id);
	if (z === undefined) {
		return fail(`${request.type} has no score head for ${question.id}`);
	}
	const { min, max } = question;
	const score = Math.min(max, Math.max(min, min + (max - min) * sigmoid(z)));
	return {
		ok: true,
		value: {
			answer: score,
			distribution: [{ answer: score, p: 1 }],
			diagnostics: base,
		},
	};
}

/**
 * Every question of `request` answered from `outputs`, already thresholded
 * (calibration.md), in question order; an error when the model does not
 * cover one of them.
 */
export function answerQuestions(
	heads: Heads,
	request: DecideRequest,
	outputs: GraphOutputs,
	encoded: Readonly<{ windows: number; truncated: boolean }>,
): Result<readonly BackendAnswer[], string> {
	const bucket = lengthBucket(request);
	const base: DecisionDiagnostics = {
		truncated: encoded.truncated,
		windows: encoded.windows,
	};
	const answers: BackendAnswer[] = [];
	for (const question of request.questions) {
		const answered =
			question.kind === "score"
				? scoreAnswer(heads, request, question, outputs, base)
				: choiceAnswer(heads, request, question, outputs, bucket, base);
		if (!answered.ok) return answered;
		answers.push(answered.value);
	}
	return { ok: true, value: answers };
}

// ── Parity ──────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** A parity fixture's `request` as `decide` sends it, if it is one. */
function fixtureRequest(value: unknown): DecideRequest | undefined {
	if (!isRecord(value)) return undefined;
	const { type, trusted, untrusted, questions } = value;
	if (typeof type !== "string" || !(type in DECISION_CATALOG)) return undefined;
	if (!isRecord(trusted) || !isRecord(untrusted) || !Array.isArray(questions)) {
		return undefined;
	}
	return {
		type: type as DecisionType,
		state: { trusted, untrusted },
		questions: questions as Question[],
	};
}

/**
 * The loader's own path for the parity self-check (`parity.ts`): encode
 * the fixture's request (level 2), measure its bucket (level 3), run the
 * graph on the fixture's own windows (level 4) and calibrate (level 5).
 * A step that cannot run rejects, which the self-check reports.
 */
export function parityEngine(
	model: Pick<
		LoadedModel,
		"metadata" | "calibration" | "tokenizer" | "session"
	>,
): ParityEngine {
	return async ({ request: raw, windows, truncated }) => {
		const request = fixtureRequest(raw);
		if (request === undefined) {
			return Promise.reject(new Error("the fixture request is malformed"));
		}
		const encoded = encodeState(
			model.metadata.encoding,
			model.tokenizer,
			request.type,
			request.state,
		);
		if (!encoded.ok) return Promise.reject(new Error(encoded.error));
		const ran = await runGraph(
			model.session,
			model.metadata,
			windows,
			truncated,
		);
		if (!ran.ok) return Promise.reject(new Error(ran.error));
		const outputs = ran.value;
		const bucket = lengthBucket(request);
		const t = temperature(model.calibration, request.type, bucket);
		const questions: Record<string, ParityObservation["questions"][string]> =
			{};
		for (const q of request.questions) {
			if (q.kind === "score") {
				const logit = scoreLogit(model.metadata, outputs, request.type, q.id);
				if (logit !== undefined) questions[q.id] = { kind: "score", logit };
				continue;
			}
			const { keys } = choiceOf(q);
			const z = optionLogits(model.metadata, outputs, request.type, keys);
			if (!z.ok) continue;
			const p = softmax(z.value, t);
			questions[q.id] = {
				kind: q.kind,
				logits: Object.fromEntries(keys.map((k, i) => [k, z.value[i] ?? 0])),
				calibrated: Object.fromEntries(keys.map((k, i) => [k, p[i] ?? 0])),
			};
		}
		return {
			encoding: encoded.value,
			bucket,
			questions,
			escalateLogit: outputs.escalate,
			classLogits: Object.fromEntries(
				model.metadata.classes.map((c, i) => [c, outputs.classes[i] ?? 0]),
			),
		};
	};
}

// ── The port ────────────────────────────────────────────────────────────────

/** Why a model did not load; `load.ts` `LoadRefusal`. */
type Refusal = Readonly<{ kind: string; notice: string }>;

/** Refusals that are the normal state of a machine, not a fault: no notice. */
const QUIET: readonly string[] = ["unpinned", "not_installed"];

const LOADING = system1Notice("the model is still loading");

/** Outputs remembered, by encoded ids: the gate's reversed call is free. */
const OUTPUT_CACHE_SIZE = 64;

type PortState =
	| Readonly<{ kind: "loading" }>
	| Readonly<{ kind: "serving"; model: LoadedModel }>
	| Readonly<{ kind: "disabled"; notice: string }>;

type System1Port = InferencePort &
	Readonly<{
		/** Settles once loading has succeeded or failed. Never rejects. */
		ready: Promise<void>;
	}>;

type PortOptions = Readonly<{
	/** Shows a notice (the daemon writes it to stderr). */
	notify?: (notice: string) => void;
}>;

const unsupported = (message: string): Result<never, BackendError> => ({
	ok: false,
	error: { kind: "unsupported", questionId: undefined, message },
});

const encodedKey = (encoded: Encoded): string =>
	createHash("sha256").update(JSON.stringify(encoded)).digest("hex");

/**
 * The `system1` port over a model that is loading (`load.ts` `loadModel`).
 * It is disabled until the model loads, and for the rest of the session if
 * it does not or its engine fails; see the module comment.
 */
export function createSystem1Port(
	loading: Promise<Result<LoadedModel, Refusal>>,
	options: PortOptions = {},
): System1Port {
	let state: PortState = { kind: "loading" };
	const cache = new Map<string, GraphOutputs>();
	// The WASM engine runs one inference at a time; native runs concurrently.
	let queue: Promise<unknown> = Promise.resolve();

	// The session is dropped, not released: another inference may still be
	// running on it, and releasing a native session mid-run is unsafe.
	const disable = (notice: string, quiet = false) => {
		state = { kind: "disabled", notice };
		cache.clear();
		if (!quiet) options.notify?.(notice);
	};

	const ready = loading.then(
		(loaded) => {
			if (loaded.ok) {
				state = { kind: "serving", model: loaded.value };
				if (loaded.value.notice !== undefined) {
					options.notify?.(loaded.value.notice);
				}
			} else {
				disable(loaded.error.notice, QUIET.includes(loaded.error.kind));
			}
		},
		(e: unknown) =>
			disable(system1Notice(`the model failed to load (${errorText(e)})`)),
	);

	const run = (model: LoadedModel, encoded: Encoded) => {
		const go = () =>
			runGraph(
				model.session,
				model.metadata,
				encoded.windows,
				encoded.truncated,
			);
		if (model.engine !== "wasm") return go();
		const next = queue.then(go, go);
		queue = next;
		return next;
	};

	/** One input's answers, `null` when not covered; an error disables. */
	const inferOne = async (
		model: LoadedModel,
		input: BackendInput,
		maxWindows: number | undefined,
	): Promise<Result<readonly BackendAnswer[] | null, string>> => {
		const encoded = encodeState(
			model.metadata.encoding,
			model.tokenizer,
			input.type,
			input.state,
			maxWindows,
		);
		if (!encoded.ok) return { ok: true, value: null };
		const key = encodedKey(encoded.value);
		let outputs = cache.get(key);
		if (outputs === undefined) {
			const ran = await run(model, encoded.value);
			if (!ran.ok) return ran;
			outputs = ran.value;
			if (cache.size >= OUTPUT_CACHE_SIZE) {
				const oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
			cache.set(key, outputs);
		}
		const answered = answerQuestions(
			model,
			{ type: input.type, state: input.state, questions: input.questions },
			outputs,
			{
				windows: encoded.value.windows.length,
				truncated: encoded.value.truncated,
			},
		);
		return { ok: true, value: answered.ok ? answered.value : null };
	};

	return {
		id: "system1",
		get version() {
			return state.kind === "serving" ? state.model.version : "unloaded";
		},
		get engine() {
			return state.kind === "serving" ? state.model.engine : undefined;
		},
		get calibration() {
			return state.kind === "serving"
				? state.model.backendCalibration
				: undefined;
		},
		disabled: () =>
			state.kind === "serving"
				? undefined
				: state.kind === "loading"
					? LOADING
					: state.notice,
		ready,
		infer: async (inputs, inferOptions) => {
			if (state.kind !== "serving") {
				return unsupported(state.kind === "loading" ? LOADING : state.notice);
			}
			const model = state.model;
			const answers: (readonly BackendAnswer[] | null)[] = [];
			for (const input of inputs) {
				const one = await inferOne(model, input, inferOptions?.maxWindows);
				if (!one.ok) {
					const notice = system1Notice(
						`model ${model.version} failed at run time (${one.error})`,
					);
					if (state.kind === "serving" && state.model === model) {
						disable(notice);
					}
					return unsupported(notice);
				}
				answers.push(one.value);
			}
			return { ok: true, value: answers };
		},
	};
}
