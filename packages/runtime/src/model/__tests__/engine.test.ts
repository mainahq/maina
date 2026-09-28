/**
 * The onnxruntime engines for System 1 (#587, ADR 0050): which engine each
 * runtime target gets, the WASM engine (onnxruntime-web, from the verified
 * `.wasm` bytes) and the native engine (the verified onnxruntime-node addon,
 * loaded by path through a `process.dlopen` shim and driven through
 * onnxruntime-common).
 *
 * The native engine needs the onnxruntime-node files for this platform,
 * which are not a dependency (they ship in the model release). CI stages
 * them and sets `MAINA_ORT_NATIVE_DIR` to the directory holding
 * `onnxruntime_binding.node`; without it the native run is skipped.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS } from "../../../build/standalone";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	BINDING_FILE,
	engineSupport,
	type Feeds,
	ORT_VERSION,
	openNativeSession,
	openWasmSession,
	ortNodeDir,
	runtimeLibDir,
	type TensorValue,
	WASM_FILE,
} from "../engine";
import { ORT_WEB_WASM, tinyModelBytes } from "./fixtures/tiny-model";

const NATIVE = ["darwin-arm64", "linux-x64", "linux-arm64", "windows-x64"];
const WASM_ONLY = ["darwin-x64", "linux-x64-musl", "linux-arm64-musl"];

const ids = BigInt64Array.from([1n, 2n, 3n, 4n]);
const mask = BigInt64Array.from([1n, 1n, 0n, 1n]);
const inputIds: TensorValue = { type: "int64", data: ids, dims: [1, 4] };
const feeds: Feeds = {
	input_ids: inputIds,
	attention_mask: { type: "int64", data: mask, dims: [1, 4] },
};

describe("engine support by target", () => {
	test("every runtime target has an entry", () => {
		for (const target of TARGETS) {
			expect(engineSupport(target)?.target).toBe(target);
		}
	});

	test("targets with an onnxruntime-node build run natively and decide", () => {
		for (const target of [...NATIVE, "windows-arm64"]) {
			expect(engineSupport(target)).toMatchObject({
				engine: "native",
				shadowOnly: false,
				notice: undefined,
			});
		}
	});

	test("darwin-x64 and musl run the WASM engine in shadow only, with a notice", () => {
		for (const target of WASM_ONLY) {
			const support = engineSupport(target);
			expect(support).toMatchObject({ engine: "wasm", shadowOnly: true });
			expect(support?.ortNode).toBeUndefined();
			expect(support?.notice).toContain(target);
			expect(support?.notice).toContain("shadow");
			expect(support?.notice).toContain("rules");
		}
	});

	test("an unknown target has no engine", () => {
		expect(engineSupport("freebsd-x64")).toBeUndefined();
		expect(engineSupport("toString")).toBeUndefined();
	});

	test("native targets map to the onnxruntime-node package layout", () => {
		expect(ortNodeDir("darwin-arm64")).toBe("bin/napi-v6/darwin/arm64");
		expect(ortNodeDir("linux-x64")).toBe("bin/napi-v6/linux/x64");
		expect(ortNodeDir("linux-arm64")).toBe("bin/napi-v6/linux/arm64");
		expect(ortNodeDir("windows-x64")).toBe("bin/napi-v6/win32/x64");
		expect(ortNodeDir("windows-arm64")).toBe("bin/napi-v6/win32/arm64");
		expect(ortNodeDir("darwin-x64")).toBeUndefined();
	});

	test("a model release keeps the engine files where the verifier checks them", () => {
		expect(runtimeLibDir("/r", "linux-x64")).toBe(
			join("/r", "ort", "linux-x64"),
		);
		expect(BINDING_FILE).toBe("onnxruntime_binding.node");
		expect(WASM_FILE).toBe("wasm/ort-wasm-simd-threaded.wasm");
	});
});

describe("pinned onnxruntime", () => {
	const pkg = JSON.parse(
		readFileSync(
			join(import.meta.dir, "..", "..", "..", "package.json"),
			"utf-8",
		),
	) as { dependencies: Record<string, string> };

	test("onnxruntime-web and -common are pinned exactly to ORT_VERSION", () => {
		// The `.wasm` must match the JS glue bundled into the runtime, and the
		// native addon's init call the onnxruntime-common Tensor it is handed.
		expect(pkg.dependencies["onnxruntime-web"]).toBe(ORT_VERSION);
		expect(pkg.dependencies["onnxruntime-common"]).toBe(ORT_VERSION);
	});

	test("the model contract's minimum runtime is met", () => {
		const [major, minor] = ORT_VERSION.split(".").map(Number);
		expect(major).toBe(1);
		expect(minor).toBeGreaterThanOrEqual(30);
	});
});

describe("WASM engine", () => {
	const wasm = new Uint8Array(readFileSync(ORT_WEB_WASM));

	test("runs a model from the verified .wasm bytes", async () => {
		const opened = await openWasmSession(wasm, tinyModelBytes());
		if (!opened.ok) throw new Error(opened.error.message);
		const session = opened.value;
		expect(session.engine).toBe("wasm");
		expect(session.inputNames).toEqual(["input_ids", "attention_mask"]);
		expect(session.outputNames).toEqual(["masked"]);
		const out = await session.run(feeds);
		if (!out.ok) throw new Error(out.error.message);
		expect(out.value.masked?.type).toBe("int64");
		expect(out.value.masked?.dims).toEqual([1, 4]);
		expect([...(out.value.masked?.data ?? [])]).toEqual([1n, 2n, 0n, 4n]);
		await session.dispose();
	});

	test("a model it cannot load is an error, not a throw", async () => {
		const opened = await openWasmSession(wasm, new Uint8Array([1, 2, 3]));
		expect(opened.ok).toBe(false);
		if (!opened.ok) {
			expect(opened.error).toMatchObject({
				kind: "session_failed",
				engine: "wasm",
			});
		}
	});

	test("a run with the wrong inputs is an error, not a throw", async () => {
		const opened = await openWasmSession(wasm, tinyModelBytes());
		if (!opened.ok) throw new Error(opened.error.message);
		const out = await opened.value.run({ input_ids: inputIds });
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.error.kind).toBe("run_failed");
	});
});

describe("native engine", () => {
	test("a missing addon is an error, not a throw", async () => {
		const opened = await openNativeSession(
			join(testTmpDir("maina-587-"), "no-such-dir"),
			tinyModelBytes(),
		);
		expect(opened.ok).toBe(false);
		if (!opened.ok) {
			expect(opened.error).toMatchObject({
				kind: "engine_load_failed",
				engine: "native",
			});
		}
	});

	const dir = process.env.MAINA_ORT_NATIVE_DIR;

	test.skipIf(dir === undefined)(
		"runs a model through the verified addon, loaded by path",
		async () => {
			const opened = await openNativeSession(dir ?? "", tinyModelBytes(), {
				threads: 2,
			});
			if (!opened.ok) throw new Error(opened.error.message);
			const session = opened.value;
			expect(session.engine).toBe("native");
			expect(session.inputNames).toEqual(["input_ids", "attention_mask"]);
			expect(session.outputNames).toEqual(["masked"]);
			const out = await session.run(feeds);
			if (!out.ok) throw new Error(out.error.message);
			expect(out.value.masked?.dims).toEqual([1, 4]);
			expect([...(out.value.masked?.data ?? [])]).toEqual([1n, 2n, 0n, 4n]);
			const bad = await session.run({ input_ids: inputIds });
			expect(bad.ok).toBe(false);
			await session.dispose();
		},
	);

	test.skipIf(dir === undefined)(
		"one process loads one addon: a second directory is refused",
		async () => {
			const first = await openNativeSession(dir ?? "", tinyModelBytes());
			expect(first.ok).toBe(true);
			const other = await openNativeSession(
				join(testTmpDir("maina-587-"), "other"),
				tinyModelBytes(),
			);
			expect(other.ok).toBe(false);
			if (!other.ok) expect(other.error.message).toContain("already loaded");
		},
	);
});
