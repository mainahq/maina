/**
 * A tiny ONNX model and tokenizer for the engine and packaging tests
 * (mainahq/maina#587): enough to prove that onnxruntime and the tokenizer
 * load and run, natively and in WASM, from source and inside the compiled
 * standalone executable. It is not the System 1 graph.
 *
 * The model is written here, byte by byte, as ONNX protobuf, so the fixture
 * is reviewable and nothing binary is committed. One `Mul` node:
 *
 *   masked[W, L] = input_ids[W, L] * attention_mask[W, L]   (int64, opset 17)
 *
 * Run as a script, it stages a self-test directory for the standalone
 * executable's `model-selftest` mode (CI's runtime-artifacts build job):
 *
 *   bun tiny-model.ts <out-dir> [--target <target> --native <ort-node-bin-dir>]
 *
 * `<out-dir>` gets `model.onnx`, `tokenizer.json` and
 * `wasm/ort-wasm-simd-threaded.wasm` (from the installed onnxruntime-web).
 * With `--native`, the onnxruntime-node files for the target are copied
 * into `ort/<target>/`, the layout of a model release (system1-artifact.md
 * §1).
 */

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

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

/** A varint field (wire type 0). */
const int = (field: number, value: number): number[] => [
	...varint(field << 3),
	...varint(value),
];

/** A length-delimited field (wire type 2): bytes, a string or a message. */
function bytes(field: number, value: readonly number[] | string): number[] {
	const body = typeof value === "string" ? [...encoder.encode(value)] : value;
	return [...varint((field << 3) | 2), ...varint(body.length), ...body];
}

/** `TensorProto.DataType.INT64`. */
const INT64 = 7;

/** A ValueInfoProto for an int64 tensor of symbolic shape [W, L]. */
function int64Value(name: string): number[] {
	const dim = (param: string) => bytes(1, bytes(2, param));
	const shape = [...dim("W"), ...dim("L")];
	const tensorType = [...int(1, INT64), ...bytes(2, shape)];
	return [...bytes(1, name), ...bytes(2, bytes(1, tensorType))];
}

/** The model's ONNX protobuf bytes (IR version 8, opset 17). */
export function tinyModelBytes(): Uint8Array {
	const node = [
		...bytes(1, "input_ids"),
		...bytes(1, "attention_mask"),
		...bytes(2, "masked"),
		...bytes(3, "mask"),
		...bytes(4, "Mul"),
	];
	const graph = [
		...bytes(1, node),
		...bytes(2, "maina-tiny"),
		...bytes(11, int64Value("input_ids")),
		...bytes(11, int64Value("attention_mask")),
		...bytes(12, int64Value("masked")),
	];
	const opset = [...bytes(1, ""), ...int(2, 17)];
	return new Uint8Array([
		...int(1, 8),
		...bytes(2, "maina-fixture"),
		...bytes(7, graph),
		...bytes(8, opset),
	]);
}

/**
 * A WordPiece Hugging Face tokenizer over a handful of shell words:
 * `--force` splits into `--` and `##force`, and anything else is `[UNK]`.
 */
export const TINY_TOKENIZER = {
	version: "1.0",
	truncation: null,
	padding: null,
	added_tokens: [
		{
			id: 0,
			content: "[UNK]",
			single_word: false,
			lstrip: false,
			rstrip: false,
			normalized: false,
			special: true,
		},
	],
	normalizer: null,
	pre_tokenizer: { type: "WhitespaceSplit" },
	post_processor: null,
	decoder: null,
	model: {
		type: "WordPiece",
		unk_token: "[UNK]",
		continuing_subword_prefix: "##",
		max_input_chars_per_word: 100,
		vocab: {
			"[UNK]": 0,
			git: 1,
			push: 2,
			"--": 3,
			"##force": 4,
			origin: 5,
			main: 6,
		},
	},
} as const;

const require = createRequire(import.meta.url);

/** The installed onnxruntime-web's WASM engine. */
export const ORT_WEB_WASM: string = require.resolve(
	"onnxruntime-web/ort-wasm-simd-threaded.wasm",
);

/** Writes a self-test directory; see the module comment. */
export function stageSelftest(
	out: string,
	native?: Readonly<{ target: string; dir: string }>,
): void {
	mkdirSync(join(out, "wasm"), { recursive: true });
	writeFileSync(join(out, "model.onnx"), tinyModelBytes());
	writeFileSync(join(out, "tokenizer.json"), JSON.stringify(TINY_TOKENIZER));
	copyFileSync(ORT_WEB_WASM, join(out, "wasm", "ort-wasm-simd-threaded.wasm"));
	if (native !== undefined) {
		const dest = join(out, "ort", native.target);
		mkdirSync(dest, { recursive: true });
		for (const file of readdirSync(native.dir)) {
			copyFileSync(join(native.dir, file), join(dest, file));
		}
	}
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: { target: { type: "string" }, native: { type: "string" } },
	});
	const [out] = positionals;
	if (out === undefined) {
		process.stderr.write(
			"usage: tiny-model.ts <out-dir> [--target <target> --native <dir>]\n",
		);
		process.exit(64);
	}
	const { target, native } = values;
	stageSelftest(
		out,
		target !== undefined && native !== undefined
			? { target, dir: native }
			: undefined,
	);
}
