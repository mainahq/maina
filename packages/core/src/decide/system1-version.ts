/**
 * The `Backend.version` of a System 1 model (#577):
 * `<manifest version>+<model sha12>+<calibration sha12>/<engine>`.
 *
 * `hashModel` keys the decision log on the backend id, this version and the
 * calibration sha, so each part here keeps something apart in the log: a
 * release, a model build within it, the calibration it answers under and
 * the engine that ran it (native and WASM builds can round differently).
 */

import type { Result } from "../db/index";

/** The onnxruntime engines a System 1 release runs on. */
export const SYSTEM1_ENGINES = ["onnxruntime-node", "onnxruntime-web"] as const;

export type System1Engine = (typeof SYSTEM1_ENGINES)[number];

export type System1VersionParts = Readonly<{
	/** The release manifest's `version` (semver, no build metadata). */
	manifestVersion: string;
	/** sha256 of the model graph, hex, optionally `sha256:`-prefixed. */
	modelSha256: string;
	/** sha256 of `calibration.json`, in the same form. */
	calibrationSha256: string;
	engine: System1Engine;
}>;

/** Semver without build metadata, so `+` and `/` only ever separate parts. */
const MANIFEST_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const SHA256 = /^(?:sha256:)?([0-9a-f]{64})$/;

/** The first 12 hex digits of a sha256, or `undefined` if it is not one. */
function sha12(hash: string): string | undefined {
	return SHA256.exec(hash)?.[1]?.slice(0, 12);
}

/** The version string for `parts`, or which part is malformed. */
export function system1Version(
	parts: System1VersionParts,
): Result<string, string> {
	if (!MANIFEST_VERSION.test(parts.manifestVersion)) {
		return {
			ok: false,
			error: "manifestVersion must be a semver version without build metadata",
		};
	}
	const model = sha12(parts.modelSha256);
	if (model === undefined) {
		return { ok: false, error: "modelSha256 must be a sha256 in hex" };
	}
	const calibration = sha12(parts.calibrationSha256);
	if (calibration === undefined) {
		return { ok: false, error: "calibrationSha256 must be a sha256 in hex" };
	}
	if (!(SYSTEM1_ENGINES as readonly string[]).includes(parts.engine)) {
		return {
			ok: false,
			error: `engine must be one of ${SYSTEM1_ENGINES.join(", ")}`,
		};
	}
	return {
		ok: true,
		value: `${parts.manifestVersion}+${model}+${calibration}/${parts.engine}`,
	};
}
