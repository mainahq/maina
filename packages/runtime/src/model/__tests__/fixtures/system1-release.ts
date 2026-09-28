/**
 * A loadable System 1 release for the loader, inference and bench tests
 * (#338). No real model artifact exists yet, so this is the contract of
 * system1-artifact.md at toy scale: every file a release carries, signed
 * with a dev key (the release key, #574, signs only in CI), with a graph that has
 * the real inputs and outputs:
 *
 *   inputs   input_ids, attention_mask, segment_ids  int64 [W, L]
 *            truncated                               int64 [1]
 *   outputs  option_logits [V], score_logits [S], class_logits [C],
 *            escalate_logit [1], h [2]               float32
 *
 * The graph is a few affine maps of three means, written byte by byte as
 * ONNX protobuf so nothing binary is committed:
 *
 *   s   = mean(input_ids * attention_mask)   over the padded batch
 *   seg = mean(segment_ids)
 *   tr  = mean(truncated)
 *   option_logits = s * W_opt + B_opt        (and the same for the others)
 *
 * `referenceOutputs` computes the same in JavaScript, which the parity
 * fixtures are built from. The tokenizer is character level (every
 * printable ASCII character is a token, anything else is `[UNK]`), and the
 * encoding parameters are small so a short request takes several windows.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type DecideRequest,
	type DecisionState,
	lengthBucket,
	SYSTEM1_TYPES,
} from "@mainahq/core";
import { encodeState } from "../../infer";
import { releaseUrl } from "../../pin";
import { loadTokenizer } from "../../tokenizer";
import { manifestHeader, sha256, signWith, utf8 } from "./model-release";
import { ORT_WEB_WASM } from "./tiny-model";

export const S1_VERSION = "0.3.0";

// ── ONNX protobuf ───────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function varint(value: number): number[] {
	const out: number[] = [];
	let v = value;
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v);
	return out;
}

const int = (field: number, value: number): number[] => [
	...varint(field << 3),
	...varint(value),
];

function bytes(field: number, value: readonly number[] | string): number[] {
	const body = typeof value === "string" ? [...encoder.encode(value)] : value;
	return [...varint((field << 3) | 2), ...varint(body.length), ...body];
}

const FLOAT = 1;
const INT64 = 7;

/** A ValueInfoProto; a string dim is symbolic. */
function valueInfo(
	name: string,
	elem: number,
	dims: readonly (string | number)[],
): number[] {
	const dim = (d: string | number) =>
		bytes(1, typeof d === "string" ? bytes(2, d) : int(1, d));
	const shape = dims.flatMap(dim);
	const tensorType = [...int(1, elem), ...bytes(2, shape)];
	return [...bytes(1, name), ...bytes(2, bytes(1, tensorType))];
}

/** A float32 initializer of shape [n]. */
function initializer(name: string, values: readonly number[]): number[] {
	const raw = new Uint8Array(new Float32Array(values).buffer);
	return [
		...int(1, values.length),
		...int(2, FLOAT),
		...bytes(8, name),
		...bytes(9, [...raw]),
	];
}

/** An INT attribute. */
const intAttr = (name: string, value: number): number[] =>
	bytes(5, [...bytes(1, name), ...int(3, value), ...int(20, 2)]);

function node(
	op: string,
	inputs: readonly string[],
	output: string,
	attrs: readonly number[][] = [],
): number[] {
	return bytes(1, [
		...inputs.flatMap((i) => bytes(1, i)),
		...bytes(2, output),
		...bytes(3, output),
		...bytes(4, op),
		...attrs.flat(),
	]);
}

// ── The toy System 1 ────────────────────────────────────────────────────────

/** The model types in encoding.md order: it fixes the marker ids. */
export const MODEL_TYPES = [
	"action.risk",
	"diff.sensitive",
	"diff.needs_review",
	"task.tier",
	"finding.real",
	"spec.coverage",
	"spec.orphan",
	"spec.contradiction",
	"spec.impl_leak",
	"spec.quality",
] as const;

const TIERS = ["mechanical", "standard", "architectural"];

/** Every fixed option of every type, as `metadata.option_vocab` lists them. */
export const OPTION_VOCAB: readonly (readonly [string, string])[] =
	MODEL_TYPES.flatMap((type): (readonly [string, string])[] => {
		if (type === "spec.quality") return [];
		const options =
			type === "action.risk"
				? ["allow", "ask", "deny"]
				: type === "task.tier"
					? TIERS
					: ["true", "false"];
		return options.map((o) => [type, o] as const);
	});

export const SCORE_VOCAB: readonly (readonly [string, string])[] = [
	["spec.quality", "*"],
];

export const ACTION_CLASSES = ["fs.read", "fs.write", "shell.opaque"];

const weights = (n: number, seed: number): number[] =>
	Array.from({ length: n }, (_, i) =>
		Math.fround(0.004 * (((i * 7 + seed) % 11) - 5)),
	);
const biases = (n: number, seed: number): number[] =>
	Array.from({ length: n }, (_, i) =>
		Math.fround(0.25 * (((i * 5 + seed) % 9) - 4)),
	);

const W = {
	opt: weights(OPTION_VOCAB.length, 1),
	bOpt: biases(OPTION_VOCAB.length, 2),
	score: weights(SCORE_VOCAB.length, 3),
	bScore: biases(SCORE_VOCAB.length, 4),
	cls: weights(ACTION_CLASSES.length, 5).map((w) => Math.fround(w * 50)),
	bCls: biases(ACTION_CLASSES.length, 6),
	tr: [Math.fround(1.5)],
	esc: [Math.fround(-0.01)],
	bEsc: [Math.fround(-0.5)],
	h: [Math.fround(0.5), Math.fround(-0.5)],
} as const;

/** The toy graph's ONNX bytes (IR 8, opset 17). */
export function system1ModelBytes(): Uint8Array {
	const nodes = [
		node("Mul", ["input_ids", "attention_mask"], "masked_ids"),
		node("Cast", ["masked_ids"], "masked_f", [intAttr("to", FLOAT)]),
		node("ReduceMean", ["masked_f"], "s", [intAttr("keepdims", 0)]),
		node("Mul", ["s", "W_opt"], "opt_scaled"),
		node("Add", ["opt_scaled", "B_opt"], "option_logits"),
		node("Mul", ["s", "W_score"], "score_scaled"),
		node("Add", ["score_scaled", "B_score"], "score_logits"),
		node("Cast", ["segment_ids"], "seg_f", [intAttr("to", FLOAT)]),
		node("ReduceMean", ["seg_f"], "seg", [intAttr("keepdims", 0)]),
		node("Mul", ["seg", "W_cls"], "cls_scaled"),
		node("Add", ["cls_scaled", "B_cls"], "class_logits"),
		node("Cast", ["truncated"], "tr_f", [intAttr("to", FLOAT)]),
		node("ReduceMean", ["tr_f"], "tr", [intAttr("keepdims", 0)]),
		node("Mul", ["tr", "W_tr"], "esc_a"),
		node("Mul", ["s", "W_esc"], "esc_b"),
		node("Add", ["esc_a", "esc_b"], "esc_c"),
		node("Add", ["esc_c", "B_esc"], "escalate_logit"),
		node("Mul", ["s", "W_h"], "h"),
	].flat();
	const inits = [
		initializer("W_opt", W.opt),
		initializer("B_opt", W.bOpt),
		initializer("W_score", W.score),
		initializer("B_score", W.bScore),
		initializer("W_cls", W.cls),
		initializer("B_cls", W.bCls),
		initializer("W_tr", W.tr),
		initializer("W_esc", W.esc),
		initializer("B_esc", W.bEsc),
		initializer("W_h", W.h),
	].flatMap((t) => bytes(5, t));
	const graph = [
		...nodes,
		...bytes(2, "maina-system1-fixture"),
		...inits,
		...bytes(11, valueInfo("input_ids", INT64, ["W", "L"])),
		...bytes(11, valueInfo("attention_mask", INT64, ["W", "L"])),
		...bytes(11, valueInfo("segment_ids", INT64, ["W", "L"])),
		...bytes(11, valueInfo("truncated", INT64, [1])),
		...bytes(12, valueInfo("option_logits", FLOAT, [OPTION_VOCAB.length])),
		...bytes(12, valueInfo("score_logits", FLOAT, [SCORE_VOCAB.length])),
		...bytes(12, valueInfo("class_logits", FLOAT, [ACTION_CLASSES.length])),
		...bytes(12, valueInfo("escalate_logit", FLOAT, [1])),
		...bytes(12, valueInfo("h", FLOAT, [2])),
	];
	const opset = [...bytes(1, ""), ...int(2, 17)];
	return new Uint8Array([
		...int(1, 8),
		...bytes(2, "maina-fixture"),
		...bytes(7, graph),
		...bytes(8, opset),
	]);
}

type Window = Readonly<{
	input_ids: readonly number[];
	segment_ids: readonly number[];
}>;

/** What the toy graph computes for `windows`, padded as the loader pads them. */
export function referenceOutputs(
	windows: readonly Window[],
	truncated: boolean,
): Readonly<{
	option: readonly number[];
	score: readonly number[];
	classes: readonly number[];
	escalate: number;
}> {
	const length = Math.max(...windows.map((w) => w.input_ids.length));
	const cells = windows.length * length;
	const sum = (f: (w: Window) => readonly number[]) =>
		windows.reduce((acc, w) => acc + f(w).reduce((a, b) => a + b, 0), 0);
	const s = sum((w) => w.input_ids) / cells;
	const seg = sum((w) => w.segment_ids) / cells;
	const tr = truncated ? 1 : 0;
	const affine = (x: number, ws: readonly number[], bs: readonly number[]) =>
		ws.map((w, i) => x * w + (bs[i] ?? 0));
	return {
		option: affine(s, W.opt, W.bOpt),
		score: affine(s, W.score, W.bScore),
		classes: affine(seg, W.cls, W.bCls),
		escalate: tr * (W.tr[0] ?? 0) + s * (W.esc[0] ?? 0) + (W.bEsc[0] ?? 0),
	};
}

// ── Tokenizer, metadata, calibration ────────────────────────────────────────

const special = (id: number, content: string) => ({
	id,
	content,
	single_word: false,
	lstrip: false,
	rstrip: false,
	normalized: false,
	special: true,
});

const CLS = 95;
const SEP = 96;
const PAD = 97;
const BASE_VOCAB = 98;

/** Character-level WordPiece: `!`..`~` are ids 1..94, anything else `[UNK]`. */
export function system1Tokenizer(): Record<string, unknown> {
	const vocab: Record<string, number> = { "[UNK]": 0 };
	for (let c = 0x21; c <= 0x7e; c++) vocab[String.fromCharCode(c)] = c - 0x20;
	vocab["[CLS]"] = CLS;
	vocab["[SEP]"] = SEP;
	vocab["[PAD]"] = PAD;
	return {
		version: "1.0",
		truncation: null,
		padding: null,
		added_tokens: [
			special(0, "[UNK]"),
			special(CLS, "[CLS]"),
			special(SEP, "[SEP]"),
			special(PAD, "[PAD]"),
		],
		normalizer: null,
		pre_tokenizer: {
			type: "Sequence",
			pretokenizers: [
				{ type: "WhitespaceSplit" },
				{
					type: "Split",
					pattern: { Regex: "." },
					behavior: "Isolated",
					invert: false,
				},
			],
		},
		post_processor: null,
		decoder: null,
		model: {
			type: "WordPiece",
			vocab,
			unk_token: "[UNK]",
			continuing_subword_prefix: "##",
			max_input_chars_per_word: 100,
		},
	};
}

const MARKERS: Readonly<Record<string, number>> = Object.fromEntries([
	["[TRUSTED]", BASE_VOCAB],
	["[UNTRUSTED]", BASE_VOCAB + 1],
	...MODEL_TYPES.map((t, i) => [`[TYPE:${t}]`, BASE_VOCAB + 2 + i]),
]);

/** `metadata.encoding` (encoding.md "Parameters"), at toy scale. */
export const ENCODING = {
	version: 1,
	window: 64,
	overlap: 8,
	trusted_cap: 16,
	min_coverage: 256,
	max_windows: 8,
	base_vocab_size: BASE_VOCAB,
	markers: MARKERS,
	cls_id: CLS,
	sep_id: SEP,
	pad_id: PAD,
	special_ids: [CLS, SEP, PAD, ...Object.values(MARKERS)],
	forbidden_strings: [
		"[UNK]",
		"[CLS]",
		"[SEP]",
		"[PAD]",
		...Object.keys(MARKERS),
	],
	root_placeholder: "⟨root⟩",
	home_placeholder: "~",
	set_valued_trusted: ["classes"],
	dropped_untrusted: ["sessionId"],
} as const;

export function system1Metadata(
	version: string,
	edit: (m: Record<string, unknown>) => Record<string, unknown> = (m) => m,
): Record<string, unknown> {
	return edit({
		schema: "maina-model/system1-metadata@1",
		model: { version, stage: "fixture" },
		graph: {
			opset: 17,
			inputs: [
				{ name: "input_ids", dtype: "int64", shape: ["windows", "length"] },
				{
					name: "attention_mask",
					dtype: "int64",
					shape: ["windows", "length"],
				},
				{ name: "segment_ids", dtype: "int64", shape: ["windows", "length"] },
				{ name: "truncated", dtype: "int64", shape: [1] },
			],
			outputs: [
				{
					name: "option_logits",
					dtype: "float32",
					shape: [OPTION_VOCAB.length],
				},
				{ name: "score_logits", dtype: "float32", shape: [SCORE_VOCAB.length] },
				{
					name: "class_logits",
					dtype: "float32",
					shape: [ACTION_CLASSES.length],
				},
				{ name: "escalate_logit", dtype: "float32", shape: [1] },
				{ name: "h", dtype: "float32", shape: [2] },
			],
			one_request_per_run: true,
		},
		types: [...MODEL_TYPES],
		option_vocab: OPTION_VOCAB.map(([type, option], index) => ({
			index,
			type,
			option,
		})),
		score_vocab: SCORE_VOCAB.map(([type, question], index) => ({
			index,
			type,
			question,
		})),
		score_fallback_question: "*",
		action_classes: ACTION_CLASSES,
		escalate: {
			trained: true,
			features: ["h"],
			threshold: 0.5,
			costs: { c_false_allow: 10, c_miss: 3, c_unnecessary: 1 },
		},
		encoding: ENCODING,
		calibration: {
			file: "calibration.json",
			schema: "maina-model/calibration@1",
		},
	});
}

/** One temperature per bucket, the same for every type. */
export const TEMPERATURES = { le128: 1.5, le512: 1.2, le2048: 1, gt2048: 1 };

export function system1Calibration(
	version: string,
	modelSha: string,
): Record<string, unknown> {
	const shadow = SYSTEM1_TYPES.filter((t) => t !== "action.risk");
	return {
		schema: "maina-model/calibration@1",
		model: { name: null, version, sha256: modelSha },
		encoding: { version: 1 },
		temperatures: Object.fromEntries(
			MODEL_TYPES.map((t) => [t, { ...TEMPERATURES }]),
		),
		fallbacks: { min_count: 50, global: 1, global_source: "global" },
		thresholds: {
			"action.risk": {
				tau_allow: 0.6,
				tau_deny: 0.7,
				never_allow: false,
				never_deny: false,
				mondrian: false,
			},
			...Object.fromEntries(
				shadow.map((t) => [t, { confidence: 0.5, never_act: false }]),
			),
		},
	};
}

// ── Parity fixtures ─────────────────────────────────────────────────────────

const softmax = (z: readonly number[], t: number): number[] => {
	const scaled = z.map((x) => x / t);
	const max = Math.max(...scaled);
	const e = scaled.map((x) => Math.exp(x - max));
	const total = e.reduce((a, b) => a + b, 0);
	return e.map((x) => x / total);
};

export const PARITY_STATE: DecisionState = {
	trusted: {
		classes: ["shell.opaque", "fs.read"],
		eventKind: "shell",
		rule: "ask",
	},
	untrusted: {
		action: { command: "rm -rf build", cwd: "/work/repo" },
		host: "claude-code",
		root: "/work/repo",
		sessionId: "s-1",
	},
};

const PARITY_QUESTIONS = [
	{ id: "risk", kind: "choice", options: ["allow", "ask", "deny"] },
] as const;

/** `parity-fixtures.json` for this release: the first fixture is checked at load. */
export function system1Parity(
	version: string,
	shas: Readonly<{ model: string; calibration: string; tokenizer: string }>,
): Record<string, unknown> {
	const tokenizer = loadTokenizer(JSON.stringify(system1Tokenizer()));
	if (!tokenizer.ok) throw new Error(tokenizer.error.message);
	const encoded = encodeState(
		ENCODING_PARAMS,
		tokenizer.value,
		"action.risk",
		PARITY_STATE,
	);
	if (!encoded.ok) throw new Error(encoded.error);
	const { windows, truncated } = encoded.value;
	const request: DecideRequest = {
		type: "action.risk",
		state: PARITY_STATE,
		questions: PARITY_QUESTIONS,
	};
	const bucket = lengthBucket(request);
	const out = referenceOutputs(windows, truncated);
	const options = PARITY_QUESTIONS[0].options;
	const logits = options.map(
		(o) =>
			out.option[
				OPTION_VOCAB.findIndex(([t, k]) => t === "action.risk" && k === o)
			] ?? 0,
	);
	const calibrated = softmax(logits, TEMPERATURES[bucket]);
	return {
		schema: "maina-model/parity-fixtures@1",
		model: { file: "model.int8.onnx", version, sha256: shas.model },
		calibration_sha256: shas.calibration,
		tokenizer_sha256: shas.tokenizer,
		encoding_version: 1,
		fixtures: [
			{
				name: "short:action.risk:fixture",
				kind: "short",
				variant_of: null,
				request: {
					id: "fixture",
					type: "action.risk",
					...PARITY_STATE,
					questions: PARITY_QUESTIONS,
				},
				encoding: { windows, truncated },
				bucket,
				questions: {
					risk: {
						kind: "choice",
						logits: Object.fromEntries(options.map((o, i) => [o, logits[i]])),
						calibrated: Object.fromEntries(
							options.map((o, i) => [o, calibrated[i]]),
						),
					},
				},
				escalate: { logit: out.escalate },
				classes: Object.fromEntries(
					ACTION_CLASSES.map((c, i) => [c, { logit: out.classes[i] }]),
				),
			},
		],
	};
}

/** The encoder parameters `load.ts` reads out of `ENCODING`. */
export const ENCODING_PARAMS = {
	window: ENCODING.window,
	overlap: ENCODING.overlap,
	trustedCap: ENCODING.trusted_cap,
	maxWindows: ENCODING.max_windows,
	markers: ENCODING.markers,
	clsId: ENCODING.cls_id,
	sepId: ENCODING.sep_id,
	padId: ENCODING.pad_id,
	specialIds: ENCODING.special_ids,
	forbidden: ENCODING.forbidden_strings,
};

// ── The release ─────────────────────────────────────────────────────────────

type ReleaseOptions = Readonly<{
	version?: string;
	/** Edits `metadata.json` before it is signed. */
	metadata?: (m: Record<string, unknown>) => Record<string, unknown>;
	/** Edits the parity fixtures before they are signed. */
	parity?: (p: Record<string, unknown>) => Record<string, unknown>;
	/** Leaves the WASM engine out (a release for a native target only). */
	noWasm?: boolean;
}>;

let wasmBytes: Uint8Array | undefined;
const wasm = (): Uint8Array => {
	wasmBytes ??= new Uint8Array(readFileSync(ORT_WEB_WASM));
	return wasmBytes;
};

/**
 * Every file of a signed release, `manifest.json(.sig)` included, and the
 * manifest bytes to pin.
 */
export function buildSystem1Release(
	privatePem: string,
	options: ReleaseOptions = {},
): Readonly<{ files: Map<string, Uint8Array>; manifestBytes: Uint8Array }> {
	const version = options.version ?? S1_VERSION;
	const model = system1ModelBytes();
	const tokenizer = utf8(JSON.stringify(system1Tokenizer()));
	const calibration = utf8(
		JSON.stringify(system1Calibration(version, sha256(model))),
	);
	const parity = system1Parity(version, {
		model: sha256(model),
		calibration: sha256(calibration),
		tokenizer: sha256(tokenizer),
	});
	const contents: readonly (readonly [string, string, string, Uint8Array])[] = [
		["model", "int8", "model.int8.onnx", model],
		["tokenizer", "tokenizer", "tokenizer.json", tokenizer],
		[
			"metadata",
			"metadata",
			"metadata.json",
			utf8(JSON.stringify(system1Metadata(version, options.metadata))),
		],
		["calibration", "calibration", "calibration.json", calibration],
		["provenance", "provenance", "provenance.json", utf8("{}\n")],
		[
			"parity",
			"parity",
			"parity-fixtures.json",
			utf8(JSON.stringify(options.parity ? options.parity(parity) : parity)),
		],
		["license", "model-licence", "LICENSE-MODEL.md", utf8("fixture\n")],
		...(options.noWasm
			? []
			: [
					[
						"runtime-lib",
						"wasm/ort-wasm-simd-threaded.wasm",
						"wasm/ort-wasm-simd-threaded.wasm",
						wasm(),
					] as const,
				]),
	];
	const files = new Map<string, Uint8Array>();
	const artifacts = contents.map(([kind, id, file, body]) => {
		files.set(file, body);
		return {
			kind,
			id,
			file,
			version,
			sha256: sha256(body),
			signature: signWith(privatePem, body),
		};
	});
	const manifest = {
		...manifestHeader(version),
		calibration: { file: "calibration.json", sha256: sha256(calibration) },
		artifacts,
	};
	const manifestBytes = utf8(`${JSON.stringify(manifest, null, 2)}\n`);
	files.set("manifest.json", manifestBytes);
	files.set(
		"manifest.json.sig",
		utf8(`${signWith(privatePem, manifestBytes)}\n`),
	);
	return { files, manifestBytes };
}

/** Writes `files` under `dir`, as a verified cache directory holds them. */
export function writeRelease(
	dir: string,
	files: ReadonlyMap<string, Uint8Array>,
): void {
	for (const [file, body] of files) {
		const path = join(dir, ...file.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body);
	}
}

type Pin = Parameters<typeof releaseUrl>[0];

/**
 * A release host serving `files` at their `model-v<version>` asset URLs,
 * recording every URL asked for.
 */
export function releaseHost(
	pin: Pin,
	files: ReadonlyMap<string, Uint8Array>,
): Readonly<{
	fetchUrl: (url: string) => Promise<Response>;
	requests: string[];
}> {
	const byUrl = new Map<string, Uint8Array>();
	for (const [file, body] of files) {
		const url = releaseUrl(pin, file);
		if (url.ok) byUrl.set(url.value, body);
	}
	const requests: string[] = [];
	return {
		requests,
		fetchUrl: async (url) => {
			requests.push(url);
			const body = byUrl.get(url);
			return body === undefined
				? new Response("not found", { status: 404 })
				: new Response(new Blob([new Uint8Array(body)]));
		},
	};
}
