/**
 * `confidenceThreshold`: the one place the gate and `maina decide` read a
 * decision type's confidence threshold from (#544). With no threshold in
 * the policy, the default depends on the backend that answered (#576).
 */

import { describe, expect, test } from "bun:test";
import type { BackendCalibration, BackendRef } from "../../decide/types";
import { confidenceThreshold, DEFAULT_POLICY } from "../defaults";
import type { DecisionType, Policy } from "../schema";

const CALIBRATION: BackendCalibration = {
	sha256: "a".repeat(64),
	thresholds: {
		"action.risk": {},
		"finding.real": { confidence: 0.81 },
		slop: { confidence: null },
	},
};

const system1 = {
	id: "system1",
	version: "0.1.0",
	calibration: CALIBRATION,
} as const;

function withThreshold(type: DecisionType, confidence: number): Policy {
	return {
		...DEFAULT_POLICY,
		decisions: {
			...DEFAULT_POLICY.decisions,
			[type]: { ...DEFAULT_POLICY.decisions[type], thresholds: { confidence } },
		},
	};
}

describe("confidenceThreshold", () => {
	test("the built-in thresholds: 0.9 for safety-critical types, 0.8 otherwise", () => {
		expect(confidenceThreshold(DEFAULT_POLICY, "action.risk")).toBe(0.9);
		expect(confidenceThreshold(DEFAULT_POLICY, "finding.real")).toBe(0.8);
	});

	test("the default policy sets no threshold, so the backend's default applies", () => {
		for (const spec of Object.values(DEFAULT_POLICY.decisions)) {
			expect(spec.thresholds.confidence).toBeUndefined();
		}
	});

	test("a policy's own threshold wins", () => {
		const policy = withThreshold("finding.real", 0.55);
		expect(confidenceThreshold(policy, "finding.real")).toBe(0.55);
	});

	test("rules and heuristic keep the built-in thresholds", () => {
		for (const id of ["rules", "heuristic"] as const) {
			const backend = { id, version: "1" };
			expect(confidenceThreshold(DEFAULT_POLICY, "action.risk", backend)).toBe(
				0.9,
			);
			expect(
				confidenceThreshold(DEFAULT_POLICY, "diff.sensitive", backend),
			).toBe(0.9);
			expect(confidenceThreshold(DEFAULT_POLICY, "slop", backend)).toBe(0.8);
		}
	});

	test("system1 defaults to 0 for action.risk: its calibrated thresholds are already applied", () => {
		expect(confidenceThreshold(DEFAULT_POLICY, "action.risk", system1)).toBe(0);
		expect(
			confidenceThreshold(DEFAULT_POLICY, "action.risk", {
				id: "system1",
				version: "0.1.0",
			}),
		).toBe(0);
	});

	test("a policy's action.risk threshold stays a floor on top of system1", () => {
		const policy = withThreshold("action.risk", 0.7);
		expect(confidenceThreshold(policy, "action.risk", system1)).toBe(0.7);
	});

	test("system1 shadow types default to the calibrated threshold", () => {
		expect(confidenceThreshold(DEFAULT_POLICY, "finding.real", system1)).toBe(
			0.81,
		);
	});

	test("a null calibrated threshold means never act on that type", () => {
		const threshold = confidenceThreshold(DEFAULT_POLICY, "slop", system1);
		expect(1 >= threshold).toBe(false);
	});

	test("a shadow type the calibration does not cover keeps the built-in threshold", () => {
		expect(confidenceThreshold(DEFAULT_POLICY, "task.tier", system1)).toBe(0.8);
		expect(
			confidenceThreshold(DEFAULT_POLICY, "finding.real", {
				id: "system1",
				version: "0.1.0",
			}),
		).toBe(0.8);
	});

	test("a policy's own threshold wins over the calibrated one", () => {
		const policy = withThreshold("finding.real", 0.6);
		expect(confidenceThreshold(policy, "finding.real", system1)).toBe(0.6);
	});

	test("with no backend given, the built-in threshold applies (fail closed)", () => {
		// The configured backend is not proof of who answers: the registry
		// falls back to the heuristic when system1 is not installed, so an
		// unknown answerer never gets system1's 0 for action.risk.
		const policy: Policy = {
			...DEFAULT_POLICY,
			decisions: {
				...DEFAULT_POLICY.decisions,
				"action.risk": {
					...DEFAULT_POLICY.decisions["action.risk"],
					backend: "system1",
				},
			},
		};
		expect(confidenceThreshold(policy, "action.risk")).toBe(0.9);
		expect(confidenceThreshold(DEFAULT_POLICY, "slop")).toBe(0.8);
	});

	test("a malformed calibrated threshold means never act (fail closed)", () => {
		for (const confidence of [-0.1, 1.5, Number.NaN, "0.5"]) {
			const backend = {
				id: "system1",
				version: "0.1.0",
				calibration: {
					sha256: "a".repeat(64),
					thresholds: { slop: { confidence } },
				},
			} as unknown as BackendRef;
			const threshold = confidenceThreshold(DEFAULT_POLICY, "slop", backend);
			expect(1 >= threshold).toBe(false);
		}
	});
});
