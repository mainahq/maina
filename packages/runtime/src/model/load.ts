/**
 * The System 1 loader (#338, system1-artifact.md §3 steps 1–5), run once
 * per runtime process:
 *
 * 1–2. the cached release is verified again (`fetch.ts`
 *      `verifyCachedModel`): the manifest against the pin and its
 *      signature, every file this target needs by hash and signature. The
 *      loader then uses exactly the bytes that were checked;
 * 4.   `tokenizer.json`, `metadata.json` (schema
 *      `maina-model/system1-metadata@1`, encoding version 1, vocabularies
 *      that match the graph's outputs) and `calibration.json` (schema
 *      `maina-model/calibration@1`, naming this model) are read, and the
 *      engine is opened from the verified files: the native addon on a
 *      native target, else (or when it will not load) the WASM engine,
 *      which runs in shadow only (ADR 0050);
 * 5.   the first parity fixture runs through the loader's own path
 *      (`parity.ts`).
 *
 * Any failure refuses the model with the notice the runtime shows (§8);
 * `infer.ts` then keeps `system1` disabled for the session and the gate and
 * `decide` use the built-in backends.
 */

import {
	type BackendCalibration,
	type DecisionType,
	type LengthBucket,
	type Result,
	SYSTEM1_TYPES,
	system1Version,
} from "@mainahq/core";
import {
	type Engine,
	type EngineError,
	engineSupport,
	type OrtSession,
	openNativeSession,
	openWasmSession,
	runtimeLibDir,
	WASM_FILE,
} from "./engine";
import { verifyCachedModel } from "./fetch";
import {
	type EncodingParams,
	type LoadedModel,
	parityEngine,
	type System1Calibration,
	type System1Metadata,
	system1Notice,
	vocabKey,
} from "./infer";
import { paritySelfCheck } from "./parity";
import type { ModelPinFile } from "./pin";
import { loadTokenizer } from "./tokenizer";
import type { SignatureCheck } from "./verify";

export type LoadRefusal = Readonly<{
	kind:
		| "unpinned"
		| "not_installed"
		| "unverified"
		| "invalid_artifact"
		| "engine_failed"
		| "parity_failed";
	/** The notice the runtime shows, ending in what it falls back to. */
	notice: string;
}>;

/** Opens the model on one engine, from the verified release in `dir`. */
type SessionOpener = (
	request: Readonly<{
		engine: Engine;
		dir: string;
		target: string;
		model: Uint8Array;
		/** The release's verified WASM engine, when it ships one. */
		wasm: Uint8Array | undefined;
	}>,
) => Promise<Result<OrtSession, EngineError>>;

type LoadInput = Readonly<{
	pin: ModelPinFile;
	root: string;
	target: string;
	verifySignature: SignatureCheck;
	/** Absent: onnxruntime-node from `ort/<target>/`, or onnxruntime-web. */
	openSession?: SessionOpener;
}>;

const METADATA_SCHEMA = "maina-model/system1-metadata@1";
const CALIBRATION_SCHEMA = "maina-model/calibration@1";
const ENCODING_VERSION = 1;
const HEADER = 4;
const BUCKETS: readonly LengthBucket[] = ["le128", "le512", "le2048", "gt2048"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isCount = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= 0;

const isPositive = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v) && v > 0;

const isStrings = (v: unknown): v is readonly string[] =>
	Array.isArray(v) && v.every((s) => typeof s === "string");

const isCounts = (v: unknown): v is readonly number[] =>
	Array.isArray(v) && v.every(isCount);

// ── metadata.json ───────────────────────────────────────────────────────────

function parseEncoding(v: unknown): Result<EncodingParams, readonly string[]> {
	if (!isRecord(v)) return { ok: false, error: ["encoding is missing"] };
	if (v.version !== ENCODING_VERSION) {
		return {
			ok: false,
			error: [
				`encoding version ${JSON.stringify(v.version)}, expected ${ENCODING_VERSION}`,
			],
		};
	}
	const { window, overlap, trusted_cap, max_windows, markers } = v;
	const problems: string[] = [];
	if (![window, trusted_cap, max_windows].every((n) => isCount(n) && n > 0)) {
		problems.push(
			"encoding window, trusted_cap and max_windows must be positive",
		);
	}
	if (!isCount(overlap)) problems.push("encoding overlap must be a count");
	if (
		isCount(window) &&
		isCount(trusted_cap) &&
		isCount(overlap) &&
		window - HEADER - 1 - trusted_cap <= overlap
	) {
		problems.push("encoding window leaves no room past the overlap");
	}
	const markerIds = isRecord(markers) ? Object.values(markers) : [];
	if (!isRecord(markers) || !markerIds.every(isCount)) {
		problems.push("encoding markers must map names to ids");
	}
	if (![v.cls_id, v.sep_id, v.pad_id].every(isCount)) {
		problems.push("encoding cls_id, sep_id and pad_id must be ids");
	}
	if (!isCounts(v.special_ids))
		problems.push("encoding special_ids must be ids");
	if (!isStrings(v.forbidden_strings)) {
		problems.push("encoding forbidden_strings must be strings");
	}
	if (problems.length > 0) return { ok: false, error: problems };
	return {
		ok: true,
		value: {
			window: window as number,
			overlap: overlap as number,
			trustedCap: trusted_cap as number,
			maxWindows: max_windows as number,
			markers: markers as Record<string, number>,
			clsId: v.cls_id as number,
			sepId: v.sep_id as number,
			padId: v.pad_id as number,
			specialIds: v.special_ids as number[],
			forbidden: v.forbidden_strings as string[],
		},
	};
}

/** The declared length of graph output `name`, a 1-D shape. */
function outputLength(graph: unknown, name: string): number | undefined {
	const outputs =
		isRecord(graph) && Array.isArray(graph.outputs) ? graph.outputs : [];
	const found = outputs.find((o) => isRecord(o) && o.name === name);
	const shape =
		isRecord(found) && Array.isArray(found.shape) ? found.shape : [];
	return shape.length === 1 && isCount(shape[0]) ? shape[0] : undefined;
}

/**
 * A vocabulary (`option_vocab`, `score_vocab`) as a map to output indices,
 * if it names every index of an output of `length` exactly once.
 */
function parseVocab(
	v: unknown,
	field: "option" | "question",
	length: number | undefined,
): ReadonlyMap<string, number> | undefined {
	if (!Array.isArray(v) || length === undefined || v.length !== length) {
		return undefined;
	}
	const map = new Map<string, number>();
	const seen = new Set<number>();
	for (const entry of v) {
		if (!isRecord(entry) || !isCount(entry.index) || entry.index >= length) {
			return undefined;
		}
		const key = entry[field];
		if (typeof entry.type !== "string" || typeof key !== "string")
			return undefined;
		if (seen.has(entry.index)) return undefined;
		seen.add(entry.index);
		map.set(vocabKey(entry.type, key), entry.index);
	}
	return map;
}

/** `metadata.json` as the loader reads it, or every problem found. */
export function parseMetadata(
	value: unknown,
): Result<System1Metadata, readonly string[]> {
	const refuse = (problems: readonly string[]) => ({
		ok: false as const,
		error: problems.map((p) => `metadata.json: ${p}`),
	});
	if (!isRecord(value)) return refuse(["not an object"]);
	if (value.schema !== METADATA_SCHEMA) {
		return refuse([
			`schema ${JSON.stringify(value.schema)}, expected ${METADATA_SCHEMA}`,
		]);
	}
	const encoding = parseEncoding(value.encoding);
	if (!encoding.ok) return refuse(encoding.error);
	const optionCount = outputLength(value.graph, "option_logits");
	const scoreCount = outputLength(value.graph, "score_logits");
	const classCount = outputLength(value.graph, "class_logits");
	const options = parseVocab(value.option_vocab, "option", optionCount);
	const scores = parseVocab(value.score_vocab, "question", scoreCount);
	const { types, action_classes: classes, escalate } = value;
	const costs =
		isRecord(escalate) && isRecord(escalate.costs) ? escalate.costs : {};
	const cost = (c: unknown) => (typeof c === "number" && c >= 1 ? c : 1);
	const problems = [
		...(options === undefined
			? ["option_vocab does not match option_logits"]
			: []),
		...(scores === undefined
			? ["score_vocab does not match score_logits"]
			: []),
		...(isStrings(classes) && classes.length === classCount
			? []
			: ["action_classes does not match class_logits"]),
		...(isStrings(types) ? [] : ["types must be strings"]),
		...(isStrings(types)
			? types
					.filter((t) => encoding.value.markers[`[TYPE:${t}]`] === undefined)
					.map((t) => `no marker for type ${t}`)
			: []),
		...(["[TRUSTED]", "[UNTRUSTED]"].every(
			(m) => encoding.value.markers[m] !== undefined,
		)
			? []
			: ["the [TRUSTED] and [UNTRUSTED] markers are missing"]),
	];
	if (problems.length > 0 || options === undefined || scores === undefined) {
		return refuse(problems);
	}
	return {
		ok: true,
		value: {
			types: types as string[],
			options,
			optionCount: optionCount ?? 0,
			scores,
			scoreCount: scoreCount ?? 0,
			classes: classes as string[],
			escalate: {
				trained: isRecord(escalate) && escalate.trained === true,
				cFalseAllow: cost(costs.c_false_allow),
				cMiss: cost(costs.c_miss),
			},
			encoding: encoding.value,
		},
	};
}

// ── calibration.json ────────────────────────────────────────────────────────

const threshold = (v: unknown): number | null | undefined =>
	v === null
		? null
		: typeof v === "number" && Number.isFinite(v)
			? v
			: undefined;

function riskThresholds(v: unknown) {
	if (!isRecord(v)) return undefined;
	const tauAllow = threshold(v.tau_allow);
	const tauDeny = threshold(v.tau_deny);
	return tauAllow === undefined || tauDeny === undefined
		? undefined
		: {
				tauAllow: v.never_allow === true ? null : tauAllow,
				tauDeny: v.never_deny === true ? null : tauDeny,
			};
}

/** `calibration.json` (bytes hashing to `sha256`), or every problem found. */
export function parseCalibration(
	value: unknown,
	sha256: string,
): Result<System1Calibration, readonly string[]> {
	const refuse = (problems: readonly string[]) => ({
		ok: false as const,
		error: problems.map((p) => `calibration.json: ${p}`),
	});
	if (!isRecord(value)) return refuse(["not an object"]);
	if (value.schema !== CALIBRATION_SCHEMA) {
		return refuse([
			`schema ${JSON.stringify(value.schema)}, expected ${CALIBRATION_SCHEMA}`,
		]);
	}
	const temperatures: Record<
		string,
		Partial<Record<LengthBucket, number>>
	> = {};
	const problems: string[] = [];
	for (const [type, byBucket] of Object.entries(
		isRecord(value.temperatures) ? value.temperatures : {},
	)) {
		const entry: Partial<Record<LengthBucket, number>> = {};
		for (const bucket of BUCKETS) {
			const t = isRecord(byBucket) ? byBucket[bucket] : undefined;
			if (t === undefined) continue;
			if (isPositive(t)) entry[bucket] = t;
			else problems.push(`temperature ${type} ${bucket} must be positive`);
		}
		temperatures[type] = entry;
	}
	const fallbacks = isRecord(value.fallbacks) ? value.fallbacks : {};
	if (!isPositive(fallbacks.global)) {
		problems.push("fallbacks.global must be a positive temperature");
	}
	const thresholds = isRecord(value.thresholds) ? value.thresholds : {};
	const riskEntry = thresholds["action.risk"];
	const risk = riskThresholds(riskEntry);
	if (riskEntry !== undefined && risk === undefined) {
		problems.push(
			"thresholds action.risk: tau_allow and tau_deny must be numbers or null",
		);
	}
	const riskByBucket: Partial<
		Record<LengthBucket, ReturnType<typeof riskThresholds>>
	> = {};
	if (
		isRecord(riskEntry) &&
		riskEntry.mondrian === true &&
		isRecord(riskEntry.per_bucket)
	) {
		for (const bucket of BUCKETS) {
			const entry = riskThresholds(riskEntry.per_bucket[bucket]);
			if (entry !== undefined) riskByBucket[bucket] = entry;
		}
	}
	const confidence: Partial<Record<DecisionType, number | null>> = {};
	for (const type of SYSTEM1_TYPES) {
		const entry = thresholds[type];
		if (type === "action.risk" || !isRecord(entry)) continue;
		const c = entry.never_act === true ? null : threshold(entry.confidence);
		if (c === undefined)
			problems.push(`thresholds ${type}: confidence must be a number or null`);
		else confidence[type] = c;
	}
	if (problems.length > 0) return refuse(problems);
	const model = isRecord(value.model) ? value.model : {};
	return {
		ok: true,
		value: {
			sha256,
			modelSha256: typeof model.sha256 === "string" ? model.sha256 : undefined,
			temperatures,
			globalTemperature: fallbacks.global as number,
			risk,
			riskByBucket: riskByBucket as System1Calibration["riskByBucket"],
			confidence,
		},
	};
}

/** What `decide` records and thresholds the shadow types by (#576, #577). */
function backendCalibration(c: System1Calibration): BackendCalibration {
	return {
		sha256: c.sha256,
		thresholds: Object.fromEntries(
			Object.entries(c.confidence).map(([type, confidence]) => [
				type,
				{ confidence },
			]),
		),
	};
}

// ── Engines ─────────────────────────────────────────────────────────────────

const defaultOpener: SessionOpener = async ({
	engine,
	dir,
	target,
	model,
	wasm,
}) =>
	engine === "native"
		? openNativeSession(runtimeLibDir(dir, target), model)
		: wasm === undefined
			? {
					ok: false,
					error: {
						kind: "engine_load_failed",
						engine: "wasm",
						message: `the release has no ${WASM_FILE}`,
					},
				}
			: openWasmSession(wasm, model);

type Opened = Readonly<{
	session: OrtSession;
	engine: Engine;
	notice: string | undefined;
}>;

/** The target's own engine, else WASM (shadow only), or why neither opens. */
async function openEngine(
	input: LoadInput,
	dir: string,
	model: Uint8Array,
	wasm: Uint8Array | undefined,
): Promise<Result<Opened, string>> {
	const support = engineSupport(input.target);
	if (support === undefined) {
		return { ok: false, error: `no engine for target ${input.target}` };
	}
	const open = input.openSession ?? defaultOpener;
	const attempt = (engine: Engine) =>
		open({ engine, dir, target: input.target, model, wasm }).catch(
			(e: unknown): Result<never, EngineError> => ({
				ok: false,
				error: {
					kind: "engine_load_failed",
					engine,
					message: e instanceof Error ? e.message : String(e),
				},
			}),
		);
	const first = await attempt(support.engine);
	if (first.ok) {
		return {
			ok: true,
			value: {
				session: first.value,
				engine: support.engine,
				notice: support.notice,
			},
		};
	}
	if (support.engine === "wasm")
		return { ok: false, error: first.error.message };
	const fallback = await attempt("wasm");
	if (!fallback.ok) {
		return {
			ok: false,
			error: `native: ${first.error.message}; wasm: ${fallback.error.message}`,
		};
	}
	return {
		ok: true,
		value: {
			session: fallback.value,
			engine: "wasm",
			notice: `system1: the native engine did not load (${first.error.message}), so the model runs on the slower WASM engine in shadow only; the rules keep deciding`,
		},
	};
}

// ── Loading ─────────────────────────────────────────────────────────────────

const refuse = (
	kind: LoadRefusal["kind"],
	why: string,
): Result<never, LoadRefusal> => ({
	ok: false,
	error: { kind, notice: system1Notice(why) },
});

function json(bytes: Uint8Array | undefined): unknown {
	if (bytes === undefined) return undefined;
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return undefined;
	}
}

/**
 * The cached release, verified, loaded and self-checked; otherwise the
 * notice to show. Never rejects.
 */
export async function loadModel(
	input: LoadInput,
): Promise<Result<LoadedModel, LoadRefusal>> {
	const cached = verifyCachedModel(input);
	if (!cached.ok) {
		const { kind, message } = cached.error;
		return refuse(
			kind === "unpinned" || kind === "not_installed" ? kind : "unverified",
			message,
		);
	}
	const { dir, release, read } = cached.value;
	const version = release.manifest.version;
	const fileOf = (kind: string) => release.files.find((f) => f.kind === kind);
	const bytesOf = (kind: string) => {
		const file = fileOf(kind);
		return file === undefined ? undefined : read(file.file);
	};
	const invalid = (problems: readonly string[]) =>
		refuse(
			"invalid_artifact",
			`model ${version} is not loadable (${problems.join("; ")})`,
		);

	const tokenizer = loadTokenizer(
		new TextDecoder().decode(bytesOf("tokenizer")),
	);
	if (!tokenizer.ok) return invalid([tokenizer.error.message]);
	const metadata = parseMetadata(json(bytesOf("metadata")));
	if (!metadata.ok) return invalid(metadata.error);
	const calibrationFile = fileOf("calibration");
	const calibration = parseCalibration(
		json(bytesOf("calibration")),
		calibrationFile?.sha256 ?? "",
	);
	if (!calibration.ok) return invalid(calibration.error);
	const modelFile = fileOf("model");
	const modelBytes = bytesOf("model");
	if (modelFile === undefined || modelBytes === undefined) {
		return invalid(["the model file is missing"]);
	}
	if (
		calibration.value.modelSha256 !== undefined &&
		calibration.value.modelSha256 !== modelFile.sha256
	) {
		return invalid(["calibration.json names another model"]);
	}

	const wasm = release.files.some((f) => f.file === WASM_FILE)
		? read(WASM_FILE)
		: undefined;
	const opened = await openEngine(input, dir, modelBytes, wasm);
	if (!opened.ok) {
		return refuse(
			"engine_failed",
			`model ${version} could not open an engine (${opened.error})`,
		);
	}
	const { session, engine, notice } = opened.value;
	const loaded = {
		metadata: metadata.value,
		calibration: calibration.value,
		tokenizer: tokenizer.value,
		session,
	};
	const parity = await paritySelfCheck({
		release,
		fixtures: bytesOf("parity") ?? new Uint8Array(),
		engine: parityEngine(loaded),
	});
	if (!parity.ok) {
		await session.dispose();
		return refuse("parity_failed", parity.error.message);
	}
	const backendVersion = system1Version({
		manifestVersion: version,
		modelSha256: modelFile.sha256,
		calibrationSha256: calibration.value.sha256,
		engine: engine === "native" ? "onnxruntime-node" : "onnxruntime-web",
	});
	if (!backendVersion.ok) {
		await session.dispose();
		return invalid([backendVersion.error]);
	}
	return {
		ok: true,
		value: {
			...loaded,
			version: backendVersion.value,
			engine,
			shadowOnly: engine === "wasm",
			notice,
			backendCalibration: backendCalibration(calibration.value),
		},
	};
}
