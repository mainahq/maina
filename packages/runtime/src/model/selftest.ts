/**
 * The packaging self-test (#587, ADR 0050), the standalone executable's
 * `model-selftest` mode:
 *
 *   maina model-selftest <dir> --target <target> [--engine native|wasm]
 *
 * It loads the tokenizer and onnxruntime from `<dir>`, laid out like a
 * model release (`tokenizer.json`, `model.onnx`, `ort/<target>/`,
 * `wasm/`), tokenizes a fixed probe text, runs the model once with the
 * last token masked out and prints a JSON report. CI runs it inside the
 * compiled executable with a tiny `Mul` model, which proves the engines
 * and the tokenizer survive `bun build --compile` on each target.
 *
 * It is a packaging check, not the model loader: nothing here verifies a
 * signature, so it must never read a directory the runtime would trust. The
 * System 1 loader (#338) verifies a release (`verify.ts`) before it opens
 * the same engines.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "@mainahq/core";
import {
	type Engine,
	type EngineError,
	engineSupport,
	openNativeSession,
	openWasmSession,
	runtimeLibDir,
	WASM_FILE,
} from "./engine";
import { loadTokenizer } from "./tokenizer";

export const SELFTEST_TEXT = "git push --force origin main";

type SelftestInput = Readonly<{
	dir: string;
	target: string;
	/** Absent: the target's own engine. */
	engine: Engine | undefined;
}>;

type SelftestReport = Readonly<{
	target: string;
	engine: Engine;
	shadowOnly: boolean;
	notice: string | undefined;
	ids: readonly number[];
	/** The model's output: the ids with the last one masked to 0. */
	output: readonly number[];
	ok: boolean;
	ms: number;
}>;

type SelftestError = Readonly<{
	kind:
		| "unsupported_target"
		| "missing_file"
		| "tokenizer_invalid"
		| "encode_failed"
		| "wrong_output"
		| EngineError["kind"];
	message: string;
}>;

const fail = (
	kind: SelftestError["kind"],
	message: string,
): Result<never, SelftestError> => ({ ok: false, error: { kind, message } });

function read(dir: string, file: string): Result<Uint8Array, SelftestError> {
	try {
		return { ok: true, value: new Uint8Array(readFileSync(join(dir, file))) };
	} catch {
		return fail("missing_file", `cannot read ${file} in ${dir}`);
	}
}

/** Runs the self-test over `input.dir`. Never throws. */
export async function runModelSelftest(
	input: SelftestInput,
): Promise<Result<SelftestReport, SelftestError>> {
	const started = performance.now();
	const support = engineSupport(input.target);
	const engine = input.engine ?? support?.engine;
	if (engine === undefined) {
		return fail("unsupported_target", `no engine for target ${input.target}`);
	}
	const tokenizerBytes = read(input.dir, "tokenizer.json");
	if (!tokenizerBytes.ok) return tokenizerBytes;
	const tokenizer = loadTokenizer(
		new TextDecoder().decode(tokenizerBytes.value),
	);
	if (!tokenizer.ok) return tokenizer;
	// Before a session opens, so a bad tokenizer leaves nothing to dispose.
	const encoded = tokenizer.value.encode(SELFTEST_TEXT);
	if (!encoded.ok) return encoded;
	const ids = encoded.value;
	const model = read(input.dir, "model.onnx");
	if (!model.ok) return model;

	let opened: Awaited<ReturnType<typeof openWasmSession>>;
	if (engine === "native") {
		opened = await openNativeSession(
			runtimeLibDir(input.dir, input.target),
			model.value,
		);
	} else {
		const wasm = read(input.dir, WASM_FILE);
		if (!wasm.ok) return wasm;
		opened = await openWasmSession(wasm.value, model.value);
	}
	if (!opened.ok) return fail(opened.error.kind, opened.error.message);
	const session = opened.value;

	const dims = [1, ids.length];
	const out = await session.run({
		input_ids: { type: "int64", data: BigInt64Array.from(ids, BigInt), dims },
		attention_mask: {
			type: "int64",
			data: BigInt64Array.from(ids, (_, i) => (i < ids.length - 1 ? 1n : 0n)),
			dims,
		},
	});
	await session.dispose();
	if (!out.ok) return fail(out.error.kind, out.error.message);
	const masked = out.value.masked;
	if (masked === undefined) {
		return fail("wrong_output", "the model returned no `masked` output");
	}
	const output = Array.from(masked.data, Number);
	const expected = ids.map((id, i) => (i < ids.length - 1 ? id : 0));
	return {
		ok: true,
		value: {
			target: input.target,
			engine,
			// The WASM engine is shadow only wherever it runs.
			shadowOnly: engine === "wasm",
			notice: support?.engine === engine ? support.notice : undefined,
			ids,
			output,
			ok:
				output.length === expected.length &&
				output.every((v, i) => v === expected[i]),
			ms: Math.round(performance.now() - started),
		},
	};
}

const USAGE =
	"usage: maina model-selftest <dir> --target <target> [--engine native|wasm]\n";

function parse(args: readonly string[]): SelftestInput | undefined {
	try {
		const { values, positionals } = parseArgs({
			args: [...args],
			allowPositionals: true,
			strict: true,
			options: { target: { type: "string" }, engine: { type: "string" } },
		});
		const [dir, ...extra] = positionals;
		const { target, engine } = values;
		if (dir === undefined || extra.length > 0 || target === undefined) {
			return undefined;
		}
		if (engine !== undefined && engine !== "native" && engine !== "wasm") {
			return undefined;
		}
		return { dir, target, engine };
	} catch {
		return undefined;
	}
}

/**
 * The `model-selftest` mode: the report on stdout as one JSON line, the
 * target's notice or the failure on stderr. Returns the exit code: 0 when
 * the model's output is right, 1 when not, 64 on bad arguments.
 */
export async function runSelftestProcess(
	args: readonly string[],
): Promise<number> {
	const input = parse(args);
	if (input === undefined) {
		process.stderr.write(USAGE);
		return 64;
	}
	const report = await runModelSelftest(input);
	if (!report.ok) {
		process.stderr.write(
			`model-selftest: ${report.error.kind}: ${report.error.message}\n`,
		);
		return 1;
	}
	if (report.value.notice !== undefined) {
		process.stderr.write(`${report.value.notice}\n`);
	}
	process.stdout.write(`${JSON.stringify(report.value)}\n`);
	return report.value.ok ? 0 : 1;
}
