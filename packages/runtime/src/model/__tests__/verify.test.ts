/**
 * The System 1 model release verifier (#575), system1-artifact.md §3 steps
 * 1–2: the manifest's signature, the pin, the strict manifest checks, then
 * each file this target needs, in manifest order: a safe path, the sha256,
 * and only then the signature, at the manifest's version.
 *
 * The tests sign with a dev key and hand the verifier a signature check
 * over its public half; the release key itself only signs in CI (#574).
 */

import { describe, expect, test } from "bun:test";
import { renderManifest } from "../../../build/standalone";
import {
	describeModelProblem,
	type ModelProblem,
	verifyModelRelease,
} from "../verify";
import {
	buildRelease,
	checkerFor,
	devKey,
	pinOn,
	sha256,
	signWith,
	utf8,
	VERSION,
} from "./fixtures/model-release";

const KEY = devKey();
const OTHER = devKey();
const check = checkerFor(KEY.publicPem);

type Json = Record<string, unknown>;
type Built = ReturnType<typeof buildRelease>;

/** A read port over `files` that records every path asked for. */
function reader(files: ReadonlyMap<string, Uint8Array>) {
	const reads: string[] = [];
	return {
		reads,
		read: (file: string): Uint8Array | undefined => {
			reads.push(file);
			return files.get(file);
		},
	};
}

function run(
	built: Built,
	options: Readonly<{
		pin?: Parameters<typeof verifyModelRelease>[0]["pin"];
		target?: string;
	}> = {},
) {
	const port = reader(built.files);
	const result = verifyModelRelease({
		pin: options.pin ?? pinOn(built.manifestBytes),
		read: port.read,
		verifySignature: check,
		target: options.target ?? "linux-x64",
	});
	return { result, reads: port.reads };
}

const problemsOf = (
	r: ReturnType<typeof verifyModelRelease>,
): readonly ModelProblem[] => (r.ok ? [] : r.error.problems);

const kindsOf = (r: ReturnType<typeof verifyModelRelease>): string[] =>
	problemsOf(r).map((p) => p.kind);

const artifacts = (m: Json): Json[] => m.artifacts as Json[];

describe("verifyModelRelease: a good release", () => {
	test("accepts a release signed with the pinned key and matching the pin", () => {
		const { result } = run(buildRelease(KEY.privatePem));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.manifest.name).toBe("maina-system1");
		expect(result.value.manifest.version).toBe(VERSION);
		expect(result.value.manifest.dryRun).toBe(false);
	});

	test("returns only the files this target needs, in manifest order", () => {
		const { result } = run(buildRelease(KEY.privatePem));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files.map((f) => f.file)).toEqual([
			"model.int8.onnx",
			"tokenizer.json",
			"metadata.json",
			"calibration.json",
			"provenance.json",
			"parity-fixtures.json",
			"LICENSE-MODEL.md",
			"NOTICE",
			"ort/linux-x64/onnxruntime_binding.node",
			"ort/linux-x64/libonnxruntime.so.1",
			"wasm/ort-wasm-simd-threaded.wasm",
		]);
		const model = result.value.files[0];
		expect(model?.kind).toBe("model");
		expect(model?.sha256).toBe(sha256(utf8("stub: model.int8.onnx\n")));
	});

	test("never reads another target's native files, so their bytes do not matter", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.set(
			"ort/darwin-arm64/onnxruntime_binding.node",
			utf8("tampered"),
		);
		built.files.delete("ort/darwin-arm64/libonnxruntime.1.30.0.dylib");
		const { result, reads } = run(built);
		expect(result.ok).toBe(true);
		expect(reads.some((f) => f.startsWith("ort/darwin-arm64/"))).toBe(false);
	});

	test("a target without native files (musl, darwin-x64) verifies the WASM engine only", () => {
		const { result } = run(buildRelease(KEY.privatePem), {
			target: "linux-x64-musl",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(
			result.value.files
				.filter((f) => f.kind === "runtime-lib")
				.map((f) => f.file),
		).toEqual(["wasm/ort-wasm-simd-threaded.wasm"]);
	});

	test("verifies and keeps an artifact of a kind it does not know", () => {
		const extra = utf8("a future artifact\n");
		const built = buildRelease(KEY.privatePem, {
			edit: (m) => ({
				...m,
				artifacts: [
					...artifacts(m),
					{
						kind: "future-kind",
						id: "x",
						file: "future.bin",
						version: VERSION,
						sha256: sha256(extra),
						signature: signWith(KEY.privatePem, extra),
					},
				],
			}),
		});
		built.files.set("future.bin", extra);
		const { result } = run(built);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files.at(-1)?.kind).toBe("future-kind");

		built.files.set("future.bin", utf8("tampered"));
		expect(kindsOf(run(built).result)).toEqual(["sha256_mismatch"]);
	});
});

describe("verifyModelRelease: step 1, the manifest", () => {
	test("refuses a manifest with no signature, or signed with another key", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.delete("manifest.json.sig");
		expect(kindsOf(run(built).result)).toEqual(["manifest_signature"]);

		const other = buildRelease(OTHER.privatePem);
		expect(kindsOf(run(other).result)).toContain("manifest_signature");
	});

	test("refuses a missing manifest", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.delete("manifest.json");
		expect(kindsOf(run(built).result)).toEqual(["manifest_missing"]);
	});

	test("refuses every manifest while no release is pinned", () => {
		const built = buildRelease(KEY.privatePem);
		const { result, reads } = run(built, {
			pin: {
				name: "maina-system1",
				version: null,
				manifestSha256: null,
				baseUrl: "https://github.com/mainahq/maina/releases/download",
			},
		});
		expect(kindsOf(result)).toEqual(["unpinned"]);
		expect(reads).not.toContain("model.int8.onnx");
	});

	test("refuses a signed manifest whose sha256 is not the pinned one", () => {
		const built = buildRelease(KEY.privatePem);
		const older = buildRelease(KEY.privatePem, { version: "0.1.0" });
		const { result, reads } = run(built, {
			pin: pinOn(older.manifestBytes, VERSION),
		});
		expect(kindsOf(result)).toContain("pin_mismatch");
		expect(reads).not.toContain("model.int8.onnx");
	});

	test("never accepts runtime/manifest.json, signed with the same key, as a model manifest", () => {
		const runtimeManifest = utf8(
			renderManifest({
				schema: 1,
				version: VERSION,
				artifacts: {
					"linux-x64": {
						url: `https://github.com/mainahq/maina/releases/download/runtime-v${VERSION}/maina-${VERSION}-linux-x64`,
						sha256: sha256(utf8("runtime")),
						signature: signWith(KEY.privatePem, utf8("runtime")),
					},
				},
			}),
		);
		const built = buildRelease(KEY.privatePem);
		built.files.set("manifest.json", runtimeManifest);
		built.files.set(
			"manifest.json.sig",
			utf8(`${signWith(KEY.privatePem, runtimeManifest)}\n`),
		);
		// Even a pin on exactly those bytes, with the signature valid.
		const { result, reads } = run(built, { pin: pinOn(runtimeManifest) });
		expect(result.ok).toBe(false);
		expect(kindsOf(result)).toContain("not_a_model_manifest");
		expect(kindsOf(result)).not.toContain("manifest_signature");
		expect(reads).toEqual(["manifest.json", "manifest.json.sig"]);
	});

	test("refuses a manifest that is not JSON", () => {
		const bytes = utf8("not json");
		const built = buildRelease(KEY.privatePem);
		built.files.set("manifest.json", bytes);
		built.files.set(
			"manifest.json.sig",
			utf8(`${signWith(KEY.privatePem, bytes)}\n`),
		);
		expect(kindsOf(run(built, { pin: pinOn(bytes) }).result)).toContain(
			"not_a_model_manifest",
		);
	});

	test.each([
		["a dry run", { dryRun: true }, "dry_run"],
		["no dryRun", { dryRun: undefined }, "not_a_model_manifest"],
		["dryRun as a string", { dryRun: "false" }, "not_a_model_manifest"],
		["schema 2", { schema: 2 }, "schema"],
		["schema as a string", { schema: "1" }, "schema"],
		["encoding version 2", { encodingVersion: "2" }, "encoding_version"],
		[
			"encoding version as a number",
			{ encodingVersion: 1 },
			"encoding_version",
		],
		["another name", { name: "maina-system2" }, "name"],
		[
			"another repo",
			{ maina: { repo: "evil/maina", commit: "a".repeat(40) } },
			"not_a_model_manifest",
		],
		[
			"a short commit",
			{ maina: { repo: "mainahq/maina", commit: "abc123" } },
			"not_a_model_manifest",
		],
		[
			"no dataset hash",
			{ dataset: { version: "v0.1" } },
			"not_a_model_manifest",
		],
		[
			"a non-onnx runtime",
			{
				runtime: {
					format: "gguf",
					opset: 17,
					quantisation: "q4",
					minRuntime: "1.0.0",
					engines: [],
				},
			},
			"not_a_model_manifest",
		],
		["a non-semver version", { version: "latest" }, "not_a_model_manifest"],
		["artifacts as an object", { artifacts: {} }, "not_a_model_manifest"],
		[
			"no calibration pointer",
			{ calibration: undefined },
			"not_a_model_manifest",
		],
	] as const)("refuses %s", (_label, patch, expected) => {
		const built = buildRelease(KEY.privatePem, {
			edit: (m) => {
				const next: Json = { ...m, ...patch };
				for (const [k, v] of Object.entries(patch)) {
					if (v === undefined) delete next[k];
				}
				return next;
			},
		});
		const version =
			typeof built.manifest.version === "string"
				? built.manifest.version
				: VERSION;
		const pin = {
			...pinOn(built.manifestBytes, version),
			// Isolate the strict checks from the pin's own name check.
			name:
				typeof built.manifest.name === "string"
					? built.manifest.name
					: "maina-system1",
		};
		const { result, reads } = run(built, { pin });
		expect(result.ok).toBe(false);
		expect(kindsOf(result)).toContain(expected);
		expect(reads).not.toContain("model.int8.onnx");
	});
});

describe("verifyModelRelease: step 2, the files", () => {
	const edited = (edit: (a: Json[]) => Json[]) =>
		buildRelease(KEY.privatePem, {
			edit: (m) => ({ ...m, artifacts: edit(artifacts(m)) }),
		});

	test("refuses a release missing a required kind", () => {
		const built = edited((a) => a.filter((x) => x.kind !== "parity"));
		expect(problemsOf(run(built).result)).toContainEqual({
			kind: "missing",
			artifact: "parity",
		});
	});

	test("refuses a required kind listed twice, and a (kind, id) pair listed twice", () => {
		const built = edited((a) => [
			...a,
			{ ...a[0], id: "fp32" },
			{ ...(a[6] as Json) },
		]);
		const problems = problemsOf(run(built).result);
		expect(problems).toContainEqual({
			kind: "duplicate",
			artifact: "model",
			id: "fp32",
		});
		expect(problems).toContainEqual({
			kind: "duplicate",
			artifact: "license",
			id: "model-licence",
		});
	});

	test.each([
		"../model.int8.onnx",
		"/etc/passwd",
		"./model.int8.onnx",
		"ort\\linux-x64\\x.node",
		"",
		"ort//x",
		"ort/linux-x64/../../x",
	])("refuses the unsafe path %p without reading it", (file) => {
		const built = edited((a) => [{ ...(a[0] as Json), file }, ...a.slice(1)]);
		const { result, reads } = run(built);
		expect(problemsOf(result)).toContainEqual({
			kind: "unsafe_path",
			artifact: "model",
			id: "int8",
			file,
		});
		expect(reads).not.toContain(file);
	});

	test("refuses an artifact at another version", () => {
		const built = edited((a) => [
			{ ...(a[1] as Json), version: "0.1.0" },
			...a.filter((_, i) => i !== 1),
		]);
		expect(problemsOf(run(built).result)).toContainEqual({
			kind: "version_mismatch",
			artifact: "tokenizer",
			id: "tokenizer",
			version: "0.1.0",
			expected: VERSION,
		});
	});

	test("refuses a missing file", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.delete("metadata.json");
		expect(problemsOf(run(built).result)).toEqual([
			{
				kind: "missing_file",
				artifact: "metadata",
				id: "metadata",
				file: "metadata.json",
			},
		]);
	});

	test("refuses a tampered file on its hash, before its signature", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.set("model.int8.onnx", utf8("tampered"));
		expect(problemsOf(run(built).result)).toEqual([
			{ kind: "sha256_mismatch", artifact: "model", id: "int8" },
		]);
	});

	test("refuses a file whose signature is empty or made by another key", () => {
		const other = signWith(OTHER.privatePem, utf8("stub: tokenizer.json\n"));
		const built = edited((a) =>
			a.map((x) =>
				x.kind === "tokenizer"
					? { ...x, signature: other }
					: x.kind === "provenance"
						? { ...x, signature: "" }
						: x,
			),
		);
		const problems = problemsOf(run(built).result);
		expect(problems).toContainEqual({
			kind: "bad_signature",
			artifact: "tokenizer",
			id: "tokenizer",
		});
		expect(problems).toContainEqual({
			kind: "unsigned",
			artifact: "provenance",
			id: "provenance",
		});
	});

	test("refuses a calibration pointer that disagrees with the calibration artifact", () => {
		const built = buildRelease(KEY.privatePem, {
			edit: (m) => ({
				...m,
				calibration: { file: "calibration.json", sha256: "0".repeat(64) },
			}),
		});
		expect(kindsOf(run(built).result)).toEqual(["calibration_pointer"]);
	});

	test("reports every problem, not only the first", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.set("model.int8.onnx", utf8("tampered"));
		built.files.delete("NOTICE");
		expect(kindsOf(run(built).result)).toEqual([
			"sha256_mismatch",
			"missing_file",
		]);
	});
});

describe("verifyModelRelease: ports that throw", () => {
	const boom = (): never => {
		throw new Error("EACCES");
	};

	test("a read that throws on a file is that file missing, never a throw", () => {
		const built = buildRelease(KEY.privatePem);
		const result = verifyModelRelease({
			pin: pinOn(built.manifestBytes),
			read: (file) =>
				file === "metadata.json" ? boom() : built.files.get(file),
			verifySignature: check,
			target: "linux-x64",
		});
		expect(problemsOf(result)).toEqual([
			{
				kind: "missing_file",
				artifact: "metadata",
				id: "metadata",
				file: "metadata.json",
			},
		]);
	});

	test("a read that throws on the manifest is the manifest missing", () => {
		const built = buildRelease(KEY.privatePem);
		const result = verifyModelRelease({
			pin: pinOn(built.manifestBytes),
			read: (file) =>
				file === "manifest.json" ? boom() : built.files.get(file),
			verifySignature: check,
			target: "linux-x64",
		});
		expect(kindsOf(result)).toEqual(["manifest_missing"]);
	});

	test("a signature check that throws is a bad signature, never a throw", () => {
		const built = buildRelease(KEY.privatePem);
		const result = verifyModelRelease({
			pin: pinOn(built.manifestBytes),
			read: (file) => built.files.get(file),
			verifySignature: boom,
			target: "linux-x64",
		});
		expect(kindsOf(result)).toEqual(["manifest_signature"]);
	});

	test("a signature check that throws on one file refuses only that file", () => {
		const built = buildRelease(KEY.privatePem);
		const tokenizer = built.files.get("tokenizer.json");
		const result = verifyModelRelease({
			pin: pinOn(built.manifestBytes),
			read: (file) => built.files.get(file),
			verifySignature: (bytes, signature) =>
				bytes === tokenizer ? boom() : check(bytes, signature),
			target: "linux-x64",
		});
		expect(problemsOf(result)).toEqual([
			{ kind: "bad_signature", artifact: "tokenizer", id: "tokenizer" },
		]);
	});
});

describe("describeModelProblem", () => {
	test("names the artifact the way maina-model's verifier does", () => {
		expect(
			describeModelProblem({
				kind: "sha256_mismatch",
				artifact: "model",
				id: "int8",
			}),
		).toBe("model int8: sha256 mismatch");
	});

	test("the refusal message reads as a notice", () => {
		const built = buildRelease(KEY.privatePem);
		built.files.set("model.int8.onnx", utf8("tampered"));
		const { result } = run(built);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe(
			`model ${VERSION} failed verification (model int8: sha256 mismatch)`,
		);
	});
});
