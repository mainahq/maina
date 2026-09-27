/**
 * The onnxruntime engines System 1 runs on (#587, ADR 0050).
 *
 * `bun build --compile` takes no plugins, so nothing here depends on
 * rewriting a module at build time:
 *
 * - **Native** (onnxruntime-node's addon). The addon is not a dependency
 *   and is never inside the runtime executable: it ships per target in the
 *   signed model release (`ort/<target>/`, system1-artifact.md §5), and is
 *   loaded only after `verify.ts` has checked it, by absolute path, through
 *   `process.dlopen`. A small shim registers it as onnxruntime-common's
 *   `cpu` backend, so the session API is onnxruntime-common's. The addon
 *   finds its shared library next to itself (`@loader_path`, `$ORIGIN`).
 * - **WASM** (onnxruntime-web). Its self-contained bundle (the JS glue
 *   embedded) is bundled into the executable; the `.wasm` engine comes from
 *   the verified release (`wasm/`) and is handed over as bytes. It runs
 *   single-threaded. It is too slow to answer inside the gate's budget, so a
 *   target that has only this engine runs System 1 in shadow only.
 *
 * Both packages are pinned exactly to `ORT_VERSION`: the release's `.wasm`
 * must match the bundled glue, and the addon's init takes onnxruntime-
 * common's `Tensor` class.
 *
 * This file is the imperative shell (dlopen, module state). Everything
 * returns a `Result`; nothing here throws.
 */

import { join, resolve } from "node:path";
import { isMainThread } from "node:worker_threads";
import type { Result } from "@mainahq/core";
import * as common from "onnxruntime-common";

/** The onnxruntime version the runtime bundles and the model release ships. */
export const ORT_VERSION = "1.30.0";

export type Engine = "native" | "wasm";

type OrtNodePlatform = Readonly<{
	platform: "darwin" | "linux" | "win32";
	arch: "x64" | "arm64";
}>;

type EngineSupport = Readonly<{
	target: string;
	engine: Engine;
	/** The engine cannot answer inside the gate's budget: shadow only. */
	shadowOnly: boolean;
	/** The notice the runtime shows when the model loads on this target. */
	notice: string | undefined;
	/** Where onnxruntime-node keeps this target's files; none on WASM. */
	ortNode: OrtNodePlatform | undefined;
}>;

const native = (
	target: string,
	platform: OrtNodePlatform["platform"],
	arch: OrtNodePlatform["arch"],
): EngineSupport => ({
	target,
	engine: "native",
	shadowOnly: false,
	notice: undefined,
	ortNode: { platform, arch },
});

const wasmOnly = (target: string): EngineSupport => ({
	target,
	engine: "wasm",
	shadowOnly: true,
	notice: `system1: onnxruntime has no native build for ${target}, so the model runs on the slower WASM engine in shadow only; the rules keep deciding`,
	ortNode: undefined,
});

/**
 * One entry per runtime target (`build/standalone.ts` `TARGETS`). Native
 * where onnxruntime-node ships a prebuilt addon; WASM, shadow only, where
 * it does not: Intel macOS and musl Linux.
 */
const SUPPORT: ReadonlyMap<string, EngineSupport> = new Map(
	[
		native("darwin-arm64", "darwin", "arm64"),
		wasmOnly("darwin-x64"),
		native("linux-x64", "linux", "x64"),
		native("linux-arm64", "linux", "arm64"),
		wasmOnly("linux-x64-musl"),
		wasmOnly("linux-arm64-musl"),
		native("windows-x64", "win32", "x64"),
		native("windows-arm64", "win32", "arm64"),
	].map((s) => [s.target, s]),
);

/** The engine `target` runs System 1 on; undefined for a target maina does not build. */
export function engineSupport(target: string): EngineSupport | undefined {
	return SUPPORT.get(target);
}

/**
 * The directory, inside the onnxruntime-node npm package, holding the
 * files a native target's release ships in `ort/<target>/`.
 */
export function ortNodeDir(target: string): string | undefined {
	const where = SUPPORT.get(target)?.ortNode;
	return where === undefined
		? undefined
		: `bin/napi-v6/${where.platform}/${where.arch}`;
}

/** The native addon's file name in `ort/<target>/`. */
export const BINDING_FILE = "onnxruntime_binding.node";

/** The WASM engine's path in a model release (manifest form, `/`). */
export const WASM_FILE = "wasm/ort-wasm-simd-threaded.wasm";

/** Where a model release keeps a target's native files. */
export const runtimeLibDir = (releaseDir: string, target: string): string =>
	join(releaseDir, "ort", target);

export type TensorValue =
	| Readonly<{ type: "int64"; data: BigInt64Array; dims: readonly number[] }>
	| Readonly<{ type: "float32"; data: Float32Array; dims: readonly number[] }>;

export type Feeds = Readonly<Record<string, TensorValue>>;

export type EngineError = Readonly<{
	kind: "engine_load_failed" | "session_failed" | "run_failed";
	engine: Engine;
	message: string;
}>;

/** One loaded model on one engine. */
type OrtSession = Readonly<{
	engine: Engine;
	inputNames: readonly string[];
	outputNames: readonly string[];
	run: (
		feeds: Feeds,
	) => Promise<Result<Readonly<Record<string, TensorValue>>, EngineError>>;
	dispose: () => Promise<void>;
}>;

type SessionOptions = Readonly<{
	/** Intra-op threads on the native engine (default 4); WASM uses one. */
	threads?: number;
}>;

const DEFAULT_THREADS = 4;

const failure = (
	kind: EngineError["kind"],
	engine: Engine,
	e: unknown,
): Result<never, EngineError> => ({
	ok: false,
	error: { kind, engine, message: e instanceof Error ? e.message : String(e) },
});

/** The part of an onnxruntime module (common or web) a session needs. */
type OrtApi = Readonly<{
	Tensor: typeof common.Tensor;
	InferenceSession: typeof common.InferenceSession;
}>;

function toTensor(api: OrtApi, value: TensorValue): common.Tensor {
	const dims = [...value.dims];
	return value.type === "int64"
		? new api.Tensor("int64", value.data, dims)
		: new api.Tensor("float32", value.data, dims);
}

function fromTensor(
	name: string,
	value: common.OnnxValue,
): Result<TensorValue, string> {
	const dims = [...value.dims];
	if (value.type === "int64" && value.data instanceof BigInt64Array) {
		return {
			ok: true,
			value: { type: "int64", data: value.data.slice(), dims },
		};
	}
	if (value.type === "float32" && value.data instanceof Float32Array) {
		return {
			ok: true,
			value: { type: "float32", data: value.data.slice(), dims },
		};
	}
	return {
		ok: false,
		error: `output ${name} is ${value.type}, not int64 or float32`,
	};
}

async function openSession(
	engine: Engine,
	api: OrtApi,
	model: Uint8Array,
	options: common.InferenceSession.SessionOptions,
): Promise<Result<OrtSession, EngineError>> {
	let session: common.InferenceSession;
	try {
		session = await api.InferenceSession.create(model, options);
	} catch (e) {
		return failure("session_failed", engine, e);
	}
	return {
		ok: true,
		value: {
			engine,
			inputNames: [...session.inputNames],
			outputNames: [...session.outputNames],
			run: async (feeds) => {
				try {
					const tensors = Object.fromEntries(
						Object.entries(feeds).map(([name, v]) => [name, toTensor(api, v)]),
					);
					const outputs = await session.run(tensors);
					const values: Record<string, TensorValue> = {};
					for (const [name, value] of Object.entries(outputs)) {
						const converted = fromTensor(name, value);
						if (!converted.ok)
							return failure("run_failed", engine, converted.error);
						values[name] = converted.value;
					}
					return { ok: true, value: values };
				} catch (e) {
					return failure("run_failed", engine, e);
				}
			},
			dispose: async () => {
				try {
					await session.release();
				} catch {
					// Already released, or the engine is gone: nothing to free.
				}
			},
		},
	};
}

// ── WASM ────────────────────────────────────────────────────────────────────

/**
 * Opens `model` on the WASM engine, from the release's verified `.wasm`
 * bytes. onnxruntime-web initialises its engine once per process, from the
 * first bytes it is given.
 */
export async function openWasmSession(
	wasm: Uint8Array,
	model: Uint8Array,
): Promise<Result<OrtSession, EngineError>> {
	let web: typeof import("onnxruntime-web/wasm");
	try {
		web = await import("onnxruntime-web/wasm");
		web.env.wasm.wasmBinary = wasm;
		web.env.wasm.numThreads = 1;
		web.env.wasm.proxy = false;
	} catch (e) {
		return failure("engine_load_failed", "wasm", e);
	}
	return openSession("wasm", web, model, { executionProviders: ["wasm"] });
}

// ── Native ──────────────────────────────────────────────────────────────────

type BindingValueMetadata = Readonly<{
	name: string;
	isTensor: boolean;
	symbolicDimensions: readonly string[];
	shape: readonly number[];
	type: number;
}>;

type BindingSession = {
	loadModel(
		buffer: ArrayBufferLike,
		byteOffset: number,
		byteLength: number,
		options: common.InferenceSession.SessionOptions,
	): void;
	readonly inputMetadata: readonly BindingValueMetadata[];
	readonly outputMetadata: readonly BindingValueMetadata[];
	run(
		feeds: common.SessionHandler.FeedsType,
		fetches: common.SessionHandler.FetchesType,
		options: common.InferenceSession.RunOptions,
	): common.SessionHandler.ReturnType;
	endProfiling(): void;
	dispose(): void;
};

/** What `onnxruntime_binding.node` exports (onnxruntime-node `lib/binding.ts`). */
type Binding = Readonly<{
	InferenceSession: new () => BindingSession;
	initOrtOnce: (
		logLevel: number,
		tensor: typeof common.Tensor,
		isMainThread: boolean,
	) => void;
}>;

const isBinding = (v: unknown): v is Binding =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as Record<string, unknown>).InferenceSession === "function" &&
	typeof (v as Record<string, unknown>).initOrtOnce === "function";

/** onnxruntime's tensor element types by enum value (`lib/backend.ts`). */
const DATA_TYPES: readonly (common.Tensor.Type | undefined)[] = [
	undefined,
	"float32",
	"uint8",
	"int8",
	"uint16",
	"int16",
	"int32",
	"int64",
	"string",
	"bool",
	"float16",
	"float64",
	"uint32",
	"uint64",
];

function metadata(
	raw: readonly BindingValueMetadata[],
): common.InferenceSession.ValueMetadata[] {
	return raw.map((m): common.InferenceSession.ValueMetadata => {
		const type = DATA_TYPES[m.type];
		if (!m.isTensor || type === undefined) {
			return { name: m.name, isTensor: false };
		}
		const shape = m.shape.map((dim, i) =>
			dim === -1 ? (m.symbolicDimensions[i] ?? "") : dim,
		);
		return { name: m.name, isTensor: true, type, shape };
	});
}

/** The loaded addon: a process loads one, and never unloads it. */
let loaded: Readonly<{ dir: string; binding: Binding }> | undefined;

/** onnxruntime-common's `cpu` backend over the loaded addon. */
const shim: common.Backend = {
	init: async () => {
		// The addon was initialised in `loadBinding`: nothing left to do.
	},
	createInferenceSessionHandler: async (pathOrBuffer, options) => {
		const binding = loaded?.binding;
		if (binding === undefined) throw new Error("onnxruntime is not loaded");
		if (typeof pathOrBuffer === "string") {
			throw new Error("the native engine loads a model from bytes only");
		}
		const session = new binding.InferenceSession();
		session.loadModel(
			pathOrBuffer.buffer,
			pathOrBuffer.byteOffset,
			pathOrBuffer.byteLength,
			options ?? {},
		);
		const inputMetadata = metadata(session.inputMetadata);
		const outputMetadata = metadata(session.outputMetadata);
		return {
			inputNames: inputMetadata.map((m) => m.name),
			outputNames: outputMetadata.map((m) => m.name),
			inputMetadata,
			outputMetadata,
			dispose: async () => session.dispose(),
			startProfiling: () => {
				// As in onnxruntime-node: profiling starts at load, from the options.
			},
			endProfiling: () => session.endProfiling(),
			run: async (feeds, fetches, runOptions) =>
				session.run(feeds, fetches, runOptions),
		};
	},
};

/** onnxruntime's `warning` log level. */
const LOG_WARNING = 2;

function loadBinding(libDir: string): Result<Binding, EngineError> {
	const dir = resolve(libDir);
	if (loaded !== undefined) {
		return loaded.dir === dir
			? { ok: true, value: loaded.binding }
			: failure(
					"engine_load_failed",
					"native",
					`onnxruntime is already loaded from ${loaded.dir}; a process loads one addon`,
				);
	}
	const addon = { exports: {} as unknown };
	try {
		process.dlopen(addon, join(dir, BINDING_FILE));
		if (!isBinding(addon.exports)) {
			return failure(
				"engine_load_failed",
				"native",
				`${BINDING_FILE} is not an onnxruntime-node addon`,
			);
		}
		addon.exports.initOrtOnce(LOG_WARNING, common.Tensor, isMainThread);
		// The shim reads `loaded` per session, so registering first is safe.
		common.registerBackend("cpu", shim, 100);
		loaded = { dir, binding: addon.exports };
	} catch (e) {
		return failure("engine_load_failed", "native", e);
	}
	return { ok: true, value: loaded.binding };
}

/**
 * Opens `model` on the native engine, loading the addon from `libDir`
 * (a verified release's `ort/<target>/`) on first use.
 */
export async function openNativeSession(
	libDir: string,
	model: Uint8Array,
	options: SessionOptions = {},
): Promise<Result<OrtSession, EngineError>> {
	const binding = loadBinding(libDir);
	if (!binding.ok) return binding;
	return openSession("native", common, model, {
		executionProviders: ["cpu"],
		intraOpNumThreads: options.threads ?? DEFAULT_THREADS,
	});
}
