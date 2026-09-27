/**
 * Builds signed System 1 model releases in memory for the verifier and
 * parity tests (#575), laid out as maina-model's `python -m export release`
 * writes one (system1-artifact.md §1): the files, `manifest.json` and
 * `manifest.json.sig`. The release key (#574, #424) is not provisioned, so a
 * dev key made once per test run signs everything and reaches the verifier
 * through its injected signature port.
 */

import {
	createHash,
	generateKeyPairSync,
	sign,
	verify as verifyRsa,
} from "node:crypto";

type Json = Record<string, unknown>;

/** A 2048-bit RSA dev key, the kind maina-model's `generate_dev_key` makes. */
export function devKey(): Readonly<{ privatePem: string; publicPem: string }> {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
		publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
	};
}

/** Base64 RSA-SHA256 (PKCS#1 v1.5), the monorepo release scheme. */
export const signWith = (privatePem: string, bytes: Uint8Array): string =>
	sign("sha256", bytes, privatePem).toString("base64");

/** The signature port the verifier takes, over `publicPem`. */
export const checkerFor =
	(publicPem: string) =>
	(bytes: Uint8Array, signature: string): boolean => {
		try {
			return verifyRsa(
				"sha256",
				bytes,
				publicPem,
				Buffer.from(signature, "base64"),
			);
		} catch {
			return false;
		}
	};

export const sha256 = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

export const utf8 = (text: string): Uint8Array =>
	new TextEncoder().encode(text);

export const VERSION = "0.2.0";

/** The files of the example release (maina-model `EXAMPLE_SPECS`). */
export const FILES: readonly Readonly<{
	kind: string;
	id: string;
	file: string;
}>[] = [
	{ kind: "model", id: "int8", file: "model.int8.onnx" },
	{ kind: "tokenizer", id: "tokenizer", file: "tokenizer.json" },
	{ kind: "metadata", id: "metadata", file: "metadata.json" },
	{ kind: "calibration", id: "calibration", file: "calibration.json" },
	{ kind: "provenance", id: "provenance", file: "provenance.json" },
	{ kind: "parity", id: "parity", file: "parity-fixtures.json" },
	{ kind: "license", id: "model-licence", file: "LICENSE-MODEL.md" },
	{ kind: "license", id: "notice", file: "NOTICE" },
	{
		kind: "runtime-lib",
		id: "darwin-arm64/onnxruntime_binding.node",
		file: "ort/darwin-arm64/onnxruntime_binding.node",
	},
	{
		kind: "runtime-lib",
		id: "darwin-arm64/libonnxruntime.1.30.0.dylib",
		file: "ort/darwin-arm64/libonnxruntime.1.30.0.dylib",
	},
	{
		kind: "runtime-lib",
		id: "linux-x64/onnxruntime_binding.node",
		file: "ort/linux-x64/onnxruntime_binding.node",
	},
	{
		kind: "runtime-lib",
		id: "linux-x64/libonnxruntime.so.1",
		file: "ort/linux-x64/libonnxruntime.so.1",
	},
	{
		kind: "runtime-lib",
		id: "wasm/ort-wasm-simd-threaded.wasm",
		file: "wasm/ort-wasm-simd-threaded.wasm",
	},
];

/** Stub bytes for every file but the parity fixtures. */
const stub = (file: string): Uint8Array => utf8(`stub: ${file}\n`);

/**
 * `parity-fixtures.json` for a release whose model, tokenizer and
 * calibration are the stub files (parity.md "File"). The first fixture is a
 * short `action.risk` request, the second a score-only `spec.quality` one.
 */
export function parityFixtures(version: string = VERSION): Json {
	return {
		schema: "maina-model/parity-fixtures@1",
		model: {
			file: "model.int8.onnx",
			version,
			sha256: sha256(stub("model.int8.onnx")),
		},
		calibration_sha256: sha256(stub("calibration.json")),
		tokenizer_sha256: sha256(stub("tokenizer.json")),
		encoding_version: 1,
		reference:
			"python: model.encoding + onnxruntime 1.30.0 (CPU, 1 thread) + calibrate.runtime",
		tolerances: {
			token_ids: "exact",
			logit_abs: 0.01,
			probability_abs: 0.005,
			answer: "exact unless near_threshold (within 0.005)",
		},
		fixtures: [
			{
				name: "short:action.risk:5c4e4d19bb31",
				kind: "short",
				variant_of: null,
				request: {
					id: "5c4e4d19bb31",
					type: "action.risk",
					trusted: "tool: Bash",
					untrusted: "rm -rf build",
					questions: [
						{ id: "risk", kind: "choice", options: ["allow", "ask", "deny"] },
					],
				},
				canonical: { trusted: "tool: Bash", untrusted: "rm -rf build" },
				encoding: {
					windows: [
						{
							input_ids: [1, 7, 42, 43, 2, 99, 100, 2],
							segment_ids: [0, 0, 0, 0, 0, 1, 1, 1],
						},
					],
					truncated: false,
					n_trusted: 3,
					n_untrusted: 2,
				},
				bucket: "le128",
				approx_tokens: 8,
				questions: {
					risk: {
						kind: "choice",
						logits: { allow: 1.93, ask: -0.41, deny: -2.2 },
						temperature: 1.37,
						calibrated: { allow: 0.8, ask: 0.15, deny: 0.05 },
						answer: "ask",
						distribution: { allow: 0, ask: 1, deny: 0 },
						confidence: 1,
						acted: false,
						near_threshold: false,
					},
				},
				escalate: { logit: -2.1, p: 0.109, threshold: 0.31, escalate: false },
				classes: {
					"fs.read": { logit: 3.2, p: 0.96 },
					"fs.write": { logit: -1.4, p: 0.198 },
				},
			},
			{
				name: "score:spec.quality:0a1b2c3d4e5f",
				kind: "score",
				variant_of: null,
				request: {
					id: "0a1b2c3d4e5f",
					type: "spec.quality",
					trusted: "",
					untrusted: "a spec",
					questions: [{ id: "overall", kind: "score", min: 0, max: 100 }],
				},
				canonical: { trusted: "", untrusted: "a spec" },
				encoding: {
					windows: [
						{ input_ids: [1, 9, 2, 55, 2], segment_ids: [0, 0, 0, 1, 1] },
					],
					truncated: false,
					n_trusted: 0,
					n_untrusted: 1,
				},
				bucket: "le128",
				approx_tokens: 5,
				questions: {
					overall: {
						kind: "score",
						score_head: ["spec.quality", "*"],
						logit: 0.3,
						score: 57.4,
					},
				},
				escalate: null,
			},
		],
	};
}

/** The manifest fields around the artifact list (ADR 0017). */
export const manifestHeader = (version: string = VERSION): Json => ({
	schema: 1,
	name: "maina-system1",
	version,
	dryRun: false,
	encodingVersion: "1",
	maina: {
		repo: "mainahq/maina",
		commit: "4b1b06c7873f4402d69f44c76685ea410cea4b7d",
	},
	dataset: {
		version: "v0.1",
		manifestHash:
			"7cc17189bc7ac6fcb6b29370d7ab4d3dcc82d50f827ae6d806b0dbafa12092f7",
	},
	base: {
		id: "jhu-clsp/ettin-encoder-17m",
		revision: "987607455c61e7a5bbc85f7758e0512ea6d0ae4c",
		license: "MIT",
	},
	runtime: {
		format: "onnx",
		opset: 17,
		quantisation: "int8-dynamic",
		minRuntime: "1.30.0",
		engines: ["onnxruntime-node", "onnxruntime-web"],
	},
});

export type BuiltRelease = Readonly<{
	/** Every file of the release by path, `manifest.json(.sig)` included. */
	files: Map<string, Uint8Array>;
	manifest: Json;
	manifestBytes: Uint8Array;
}>;

type BuildOptions = Readonly<{
	version?: string;
	/** Edits the manifest after it is built and before it is signed. */
	edit?: (manifest: Json) => Json;
	/** Replaces the parity fixtures before they are hashed and signed. */
	parity?: Json;
}>;

/**
 * A release signed with `privatePem`: every file hashed and signed, then
 * `manifest.json` (two-space JSON and a newline) and `manifest.json.sig`.
 */
export function buildRelease(
	privatePem: string,
	options: BuildOptions = {},
): BuiltRelease {
	const version = options.version ?? VERSION;
	const files = new Map<string, Uint8Array>();
	const parity = options.parity ?? parityFixtures(version);
	const artifacts = FILES.map((f) => {
		const bytes =
			f.kind === "parity" ? utf8(JSON.stringify(parity)) : stub(f.file);
		files.set(f.file, bytes);
		const signature = signWith(privatePem, bytes);
		files.set(`${f.file}.sig`, utf8(`${signature}\n`));
		return { ...f, version, sha256: sha256(bytes), signature };
	});
	const calibration = artifacts.find((a) => a.kind === "calibration");
	const built = {
		...manifestHeader(version),
		calibration: { file: calibration?.file, sha256: calibration?.sha256 },
		artifacts,
	};
	const manifest = options.edit ? options.edit(built) : built;
	const manifestBytes = utf8(`${JSON.stringify(manifest, null, 2)}\n`);
	files.set("manifest.json", manifestBytes);
	files.set(
		"manifest.json.sig",
		utf8(`${signWith(privatePem, manifestBytes)}\n`),
	);
	return { files, manifest, manifestBytes };
}

/** A pin on exactly these manifest bytes. */
export const pinOn = (
	manifestBytes: Uint8Array,
	version: string = VERSION,
): Readonly<{
	name: string;
	version: string;
	manifestSha256: string;
	baseUrl: string;
}> => ({
	name: "maina-system1",
	version,
	manifestSha256: sha256(manifestBytes),
	baseUrl: "https://github.com/mainahq/maina/releases/download",
});
