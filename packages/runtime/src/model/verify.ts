/**
 * The System 1 model release verifier (#575): steps 1 and 2 of
 * maina-model's `docs/handoff/system1-artifact.md` §3, run on every
 * download and every cache check before anything in a release is loaded.
 *
 * 1. **The manifest.** `manifest.json` must be exactly the bytes the pin in
 *    `model.json` names (#573), its detached `manifest.json.sig` must verify
 *    against the release key, and it must be a model manifest in every field
 *    the loader relies on: `schema: 1`, `name: "maina-system1"`,
 *    `dryRun: false`, `encodingVersion: "1"`, the provenance fields and an
 *    artifact list. The runtime's own `runtime/manifest.json` is signed with
 *    the same key and also carries `schema: 1`, so a valid signature proves
 *    nothing about which manifest this is; the strict shape check refuses it.
 * 2. **Each file this target needs, in manifest order:** every artifact that
 *    is not a `runtime-lib`, plus `ort/<target>/*` and `wasm/*`. The path is
 *    relative with no `..`; the sha256 of the bytes must match, and only
 *    then is the signature checked; the artifact carries the manifest's
 *    version. Every required kind appears once, and the `calibration`
 *    pointer agrees with the calibration artifact. An artifact of a kind
 *    this loader does not know is verified like any other and returned for
 *    the loader to skip.
 *
 * Nothing stops at the first problem: every problem is reported, except
 * that no file is read while the manifest itself is not trusted.
 *
 * The lockstep `verifyReleaseDir` (`scripts/release/sign.ts`) cannot be
 * reused: it is tied to the lockstep `ArtifactKind`s. The signature check
 * is a port: the runtime passes one over the release key pinned in its
 * binary (`release-key.ts`, #574), and tests pass one over a dev key.
 */

import { createHash } from "node:crypto";
import type { Result } from "@mainahq/core";
import { checkPinnedManifest, type ModelPinFile } from "./pin";

/** One file of a model release (maina-model ADR 0017). */
type ModelArtifact = Readonly<{
	kind: string;
	id: string;
	/** Path from the release directory, `/`-separated. */
	file: string;
	version: string;
	/** Lowercase hex sha256 of the file. */
	sha256: string;
	/** Base64 RSA-SHA256 signature of the file. */
	signature: string;
}>;

/** A verified model manifest: only what this loader accepts. */
type ModelManifest = Readonly<{
	schema: 1;
	name: string;
	version: string;
	dryRun: false;
	encodingVersion: string;
	maina: Readonly<{ repo: string; commit: string }>;
	dataset: Readonly<{ version: string; manifestHash: string }>;
	base: Readonly<{ id: string; revision: string; license: string }>;
	runtime: Readonly<{
		format: string;
		opset: number;
		quantisation: string;
		minRuntime: string;
		engines: readonly string[];
	}>;
	calibration: Readonly<{ file: string; sha256: string }>;
	artifacts: readonly ModelArtifact[];
}>;

/** A file whose hash and signature checked out. */
type VerifiedFile = Readonly<{
	kind: string;
	id: string;
	file: string;
	sha256: string;
}>;

export type VerifiedModelRelease = Readonly<{
	manifest: ModelManifest;
	/** The files this target needs, in manifest order. */
	files: readonly VerifiedFile[];
}>;

type At = Readonly<{ artifact: string; id: string }>;

export type ModelProblem =
	| Readonly<{ kind: "manifest_missing" }>
	| Readonly<{ kind: "manifest_signature" }>
	| Readonly<{ kind: "unpinned" }>
	| Readonly<{ kind: "pin_mismatch"; detail: string }>
	| Readonly<{ kind: "not_a_model_manifest"; field: string }>
	| Readonly<{ kind: "schema"; found: string }>
	| Readonly<{ kind: "name"; found: string }>
	| Readonly<{ kind: "dry_run" }>
	| Readonly<{ kind: "encoding_version"; found: string }>
	| Readonly<{ kind: "missing"; artifact: string }>
	| (At & Readonly<{ kind: "duplicate" }>)
	| (At & Readonly<{ kind: "unsafe_path"; file: string }>)
	| (At &
			Readonly<{ kind: "version_mismatch"; version: string; expected: string }>)
	| (At & Readonly<{ kind: "missing_file"; file: string }>)
	| (At & Readonly<{ kind: "sha256_mismatch" }>)
	| (At & Readonly<{ kind: "unsigned" }>)
	| (At & Readonly<{ kind: "bad_signature" }>)
	| Readonly<{ kind: "calibration_pointer" }>;

type ModelRefusal = Readonly<{
	kind: "unverified";
	problems: readonly ModelProblem[];
	/** One line for the runtime's notice. */
	message: string;
}>;

/** Whether `signature` (base64) is `bytes` signed with the release key. */
export type SignatureCheck = (bytes: Uint8Array, signature: string) => boolean;

type VerifyInput = Readonly<{
	/** The pin the runtime was built with (`model.json`). */
	pin: ModelPinFile;
	/** Reads a release file by manifest path; undefined when it is missing. */
	read: (file: string) => Uint8Array | undefined;
	verifySignature: SignatureCheck;
	/** The runtime target, e.g. `linux-x64` (`hostTarget`). */
	target: string;
}>;

const MANIFEST = "manifest.json";
const MODEL_NAME = "maina-system1";
const ENCODING_VERSION = "1";
const MAINA_REPO = "mainahq/maina";
const RUNTIME_LIB = "runtime-lib";
const WASM_DIR = "wasm/";
const REQUIRED_KINDS = [
	"model",
	"tokenizer",
	"metadata",
	"calibration",
	"provenance",
	"parity",
] as const;
/** semver 2.0, as maina-model's manifest builder and `isSemver` accept it. */
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

const shown = (v: unknown): string =>
	v === undefined ? "missing" : JSON.stringify(v);

const sha256Hex = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

const isArtifact = (v: unknown): v is ModelArtifact =>
	isRecord(v) &&
	isText(v.kind) &&
	isText(v.id) &&
	typeof v.file === "string" &&
	typeof v.version === "string" &&
	typeof v.sha256 === "string" &&
	typeof v.signature === "string";

/** The fields besides the strict four, each either valid or not. */
function shapeProblems(m: Record<string, unknown>): readonly ModelProblem[] {
	const { version, dryRun, maina, dataset, base, runtime, calibration } = m;
	const fields: readonly (readonly [string, boolean])[] = [
		["version", typeof version === "string" && SEMVER.test(version)],
		["dryRun", typeof dryRun === "boolean"],
		[
			"maina",
			isRecord(maina) &&
				maina.repo === MAINA_REPO &&
				typeof maina.commit === "string" &&
				GIT_SHA.test(maina.commit),
		],
		[
			"dataset",
			isRecord(dataset) &&
				isText(dataset.version) &&
				typeof dataset.manifestHash === "string" &&
				SHA256.test(dataset.manifestHash),
		],
		[
			"base",
			isRecord(base) &&
				isText(base.id) &&
				isText(base.revision) &&
				isText(base.license),
		],
		[
			"runtime",
			isRecord(runtime) &&
				runtime.format === "onnx" &&
				Number.isInteger(runtime.opset) &&
				isText(runtime.quantisation) &&
				isText(runtime.minRuntime) &&
				Array.isArray(runtime.engines) &&
				runtime.engines.every(isText),
		],
		[
			"calibration",
			isRecord(calibration) &&
				typeof calibration.file === "string" &&
				typeof calibration.sha256 === "string",
		],
		["artifacts", Array.isArray(m.artifacts) && m.artifacts.every(isArtifact)],
	];
	return fields.flatMap(([field, ok]): readonly ModelProblem[] =>
		ok ? [] : [{ kind: "not_a_model_manifest", field }],
	);
}

/** `bytes` as a model manifest, or every way they are not one. */
function parseModelManifest(
	bytes: Uint8Array,
): Result<ModelManifest, readonly ModelProblem[]> {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return {
			ok: false,
			error: [{ kind: "not_a_model_manifest", field: "(not JSON)" }],
		};
	}
	if (!isRecord(value)) {
		return {
			ok: false,
			error: [{ kind: "not_a_model_manifest", field: "(not an object)" }],
		};
	}
	const { schema, name, dryRun, encodingVersion } = value;
	const problems: ModelProblem[] = [
		...(schema === 1
			? []
			: [{ kind: "schema", found: shown(schema) } as const]),
		...(name === MODEL_NAME
			? []
			: [{ kind: "name", found: shown(name) } as const]),
		...(dryRun === true ? [{ kind: "dry_run" } as const] : []),
		...(encodingVersion === ENCODING_VERSION
			? []
			: [{ kind: "encoding_version", found: shown(encodingVersion) } as const]),
		...shapeProblems(value),
	];
	return problems.length === 0
		? { ok: true, value: value as ModelManifest }
		: { ok: false, error: problems };
}

/** Relative, `/`-separated, with no `..`, `.`, empty segment or drive. */
const isSafePath = (file: string): boolean =>
	file !== "" &&
	!/[\\:\0]/.test(file) &&
	file.split("/").every((s) => s !== "" && s !== "." && s !== "..");

/** Step 1: every reason the manifest bytes cannot be trusted. */
function manifestProblems(
	input: VerifyInput,
): Result<ModelManifest, readonly ModelProblem[]> {
	const bytes = input.read(MANIFEST);
	if (bytes === undefined) {
		return { ok: false, error: [{ kind: "manifest_missing" }] };
	}
	const pinned = checkPinnedManifest(input.pin, bytes);
	if (!pinned.ok && pinned.error.kind === "unpinned") {
		return { ok: false, error: [{ kind: "unpinned" }] };
	}
	const sig = input.read(`${MANIFEST}.sig`);
	const signed =
		sig !== undefined &&
		input.verifySignature(bytes, new TextDecoder().decode(sig).trim());
	const parsed = parseModelManifest(bytes);
	const problems: readonly ModelProblem[] = [
		...(signed ? [] : [{ kind: "manifest_signature" } as const]),
		...(pinned.ok || pinned.error.kind !== "mismatch"
			? []
			: pinned.error.problems.map(
					(detail) => ({ kind: "pin_mismatch", detail }) as const,
				)),
		...(parsed.ok ? [] : parsed.error),
	];
	return problems.length === 0 && parsed.ok
		? parsed
		: { ok: false, error: problems };
}

/** Whether this target loads `a`: every non-runtime file, its own engines. */
function isNeeded(a: ModelArtifact, target: string): boolean {
	if (a.kind !== RUNTIME_LIB) return true;
	if (a.file.startsWith(WASM_DIR)) return true;
	return TARGET.test(target) && a.file.startsWith(`ort/${target}/`);
}

/**
 * The files of the manifest `bytes` that `target` needs, in manifest order,
 * for the downloader to fetch before `verifyModelRelease` checks them. It
 * trusts nothing: an entry it cannot read is left out, and the verifier
 * then reports it missing.
 */
export function neededFiles(
	bytes: Uint8Array,
	target: string,
): readonly string[] {
	let manifest: unknown;
	try {
		manifest = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return [];
	}
	const artifacts =
		isRecord(manifest) && Array.isArray(manifest.artifacts)
			? manifest.artifacts
			: [];
	return artifacts
		.filter(isArtifact)
		.filter((a) => isSafePath(a.file) && isNeeded(a, target))
		.map((a) => a.file);
}

/** A required kind listed twice, or a (kind, id) pair listed twice. */
function coverageProblems(
	artifacts: readonly ModelArtifact[],
): readonly ModelProblem[] {
	const missing = REQUIRED_KINDS.filter(
		(kind) => !artifacts.some((a) => a.kind === kind),
	).map((artifact): ModelProblem => ({ kind: "missing", artifact }));
	const required: readonly string[] = REQUIRED_KINDS;
	const duplicates = artifacts.flatMap((a, i): readonly ModelProblem[] =>
		artifacts
			.slice(0, i)
			.some(
				(b) =>
					b.kind === a.kind && (b.id === a.id || required.includes(a.kind)),
			)
			? [{ kind: "duplicate", artifact: a.kind, id: a.id }]
			: [],
	);
	return [...missing, ...duplicates];
}

/** Step 2 for one artifact: path, then version, then hash, then signature. */
function artifactProblems(
	a: ModelArtifact,
	input: VerifyInput,
	version: string,
): readonly ModelProblem[] {
	const at = { artifact: a.kind, id: a.id };
	const versionProblem: readonly ModelProblem[] =
		a.version === version
			? []
			: [
					{
						kind: "version_mismatch",
						...at,
						version: a.version,
						expected: version,
					},
				];
	if (!isSafePath(a.file)) {
		return [...versionProblem, { kind: "unsafe_path", ...at, file: a.file }];
	}
	if (!isNeeded(a, input.target)) return versionProblem;
	const bytes = input.read(a.file);
	if (bytes === undefined) {
		return [...versionProblem, { kind: "missing_file", ...at, file: a.file }];
	}
	const fileProblem: readonly ModelProblem[] =
		sha256Hex(bytes) !== a.sha256
			? [{ kind: "sha256_mismatch", ...at }]
			: a.signature === ""
				? [{ kind: "unsigned", ...at }]
				: input.verifySignature(bytes, a.signature)
					? []
					: [{ kind: "bad_signature", ...at }];
	return [...versionProblem, ...fileProblem];
}

export function describeModelProblem(p: ModelProblem): string {
	switch (p.kind) {
		case "manifest_missing":
			return `${MANIFEST} is missing`;
		case "manifest_signature":
			return `${MANIFEST}: bad or missing signature`;
		case "unpinned":
			return "no release is pinned in model.json";
		case "pin_mismatch":
			return p.detail;
		case "not_a_model_manifest":
			return `${MANIFEST} is not a model manifest (${p.field})`;
		case "schema":
			return `${MANIFEST}: schema ${p.found}, expected 1`;
		case "name":
			return `${MANIFEST}: name ${p.found}, expected ${MODEL_NAME}`;
		case "dry_run":
			return `${MANIFEST}: a dry-run release is never loaded`;
		case "encoding_version":
			return `${MANIFEST}: encoding version ${p.found}, expected "${ENCODING_VERSION}"`;
		case "missing":
			return `missing ${p.artifact}`;
		case "duplicate":
			return `duplicate ${p.artifact} ${p.id}`;
		case "unsafe_path":
			return `${p.artifact} ${p.id}: unsafe path ${JSON.stringify(p.file)}`;
		case "version_mismatch":
			return `${p.artifact} ${p.id}: version ${p.version}, expected ${p.expected}`;
		case "missing_file":
			return `${p.artifact} ${p.id}: file ${p.file} is missing`;
		case "sha256_mismatch":
			return `${p.artifact} ${p.id}: sha256 mismatch`;
		case "unsigned":
			return `${p.artifact} ${p.id}: unsigned`;
		case "bad_signature":
			return `${p.artifact} ${p.id}: bad signature`;
		case "calibration_pointer":
			return "calibration: sha256 does not match the calibration artifact";
		default: {
			const never: never = p;
			return String(never);
		}
	}
}

function refuse(
	version: string | null,
	problems: readonly ModelProblem[],
): Result<never, ModelRefusal> {
	return {
		ok: false,
		error: {
			kind: "unverified",
			problems,
			message: `model ${version ?? "(unpinned)"} failed verification (${problems.map(describeModelProblem).join("; ")})`,
		},
	};
}

/**
 * The ports, failing closed: a read that throws is a missing file, and a
 * signature check that throws is a bad signature. The verifier never throws.
 */
function closedPorts(input: VerifyInput): VerifyInput {
	return {
		...input,
		read: (file) => {
			try {
				return input.read(file);
			} catch {
				return undefined;
			}
		},
		verifySignature: (bytes, signature) => {
			try {
				return input.verifySignature(bytes, signature) === true;
			} catch {
				return false;
			}
		},
	};
}

/**
 * The release `read` serves, if it is the pinned release, signed, and
 * complete for `target`; otherwise every problem found. Pure: bytes come
 * in through `read` and the signature check through `verifySignature`.
 * Never throws: a port that throws counts against the release.
 */
export function verifyModelRelease(
	raw: VerifyInput,
): Result<VerifiedModelRelease, ModelRefusal> {
	const input = closedPorts(raw);
	const trusted = manifestProblems(input);
	if (!trusted.ok) return refuse(input.pin.version, trusted.error);
	const manifest = trusted.value;
	const { artifacts, version } = manifest;
	const calibration = artifacts.find((a) => a.kind === "calibration");
	const pointerProblem: readonly ModelProblem[] =
		calibration === undefined ||
		(calibration.file === manifest.calibration.file &&
			calibration.sha256 === manifest.calibration.sha256)
			? []
			: [{ kind: "calibration_pointer" }];
	const problems = [
		...coverageProblems(artifacts),
		...artifacts.flatMap((a) => artifactProblems(a, input, version)),
		...pointerProblem,
	];
	if (problems.length > 0) return refuse(version, problems);
	return {
		ok: true,
		value: {
			manifest,
			files: artifacts
				.filter((a) => isNeeded(a, input.target))
				.map(({ kind, id, file, sha256 }) => ({ kind, id, file, sha256 })),
		},
	};
}
