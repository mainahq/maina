/**
 * `system1Version` (#577): the `Backend.version` of a System 1 model is
 * `<manifest version>+<model sha12>+<calibration sha12>/<engine>`, so two
 * model builds, two calibrations or two engines never share a `modelHash`.
 */

import { describe, expect, test } from "bun:test";
import { hashModel } from "../log/hash";
import { SYSTEM1_ENGINES, system1Version } from "../system1-version";

const MODEL = "0123456789ab".padEnd(64, "c");
const CALIBRATION = "ba9876543210".padEnd(64, "d");

describe("system1Version", () => {
	test("joins the manifest version, both sha12s and the engine", () => {
		expect(
			system1Version({
				manifestVersion: "0.1.0",
				modelSha256: MODEL,
				calibrationSha256: CALIBRATION,
				engine: "onnxruntime-node",
			}),
		).toEqual({
			ok: true,
			value: "0.1.0+0123456789ab+ba9876543210/onnxruntime-node",
		});
	});

	test("accepts sha256:-prefixed hashes and prerelease versions", () => {
		expect(
			system1Version({
				manifestVersion: "0.2.0-rc.1",
				modelSha256: `sha256:${MODEL}`,
				calibrationSha256: `sha256:${CALIBRATION}`,
				engine: "onnxruntime-web",
			}),
		).toEqual({
			ok: true,
			value: "0.2.0-rc.1+0123456789ab+ba9876543210/onnxruntime-web",
		});
	});

	test("engines and builds stay apart in the model hash", () => {
		const [node, web] = SYSTEM1_ENGINES.map((engine) =>
			system1Version({
				manifestVersion: "0.1.0",
				modelSha256: MODEL,
				calibrationSha256: CALIBRATION,
				engine,
			}),
		);
		const other = system1Version({
			manifestVersion: "0.1.0",
			modelSha256: "f".repeat(64),
			calibrationSha256: CALIBRATION,
			engine: "onnxruntime-node",
		});
		const versions = [node, web, other].map((r) => (r?.ok ? r.value : ""));
		const hashes = versions.map((version) =>
			hashModel({ id: "system1", version }),
		);
		expect(new Set(hashes).size).toBe(3);
	});

	test("rejects parts that would make the version ambiguous", () => {
		const good = {
			manifestVersion: "0.1.0",
			modelSha256: MODEL,
			calibrationSha256: CALIBRATION,
			engine: "onnxruntime-node",
		} as const;
		const bad = [
			{ ...good, manifestVersion: "0.1.0+build" },
			{ ...good, manifestVersion: "0.1/0" },
			{ ...good, manifestVersion: "" },
			{ ...good, modelSha256: "abc" },
			{ ...good, calibrationSha256: "Z".repeat(64) },
			{ ...good, engine: "tensorflow" },
		];
		for (const parts of bad) {
			const result = system1Version(
				parts as Parameters<typeof system1Version>[0],
			);
			expect({ parts, ok: result.ok }).toEqual({ parts, ok: false });
		}
	});
});
