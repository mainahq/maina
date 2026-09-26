/**
 * `confidenceThreshold`: the one place the gate and `maina decide` read a
 * decision type's confidence threshold from (#544).
 */

import { describe, expect, test } from "bun:test";
import { confidenceThreshold, DEFAULT_POLICY } from "../defaults";
import type { Policy } from "../schema";

describe("confidenceThreshold", () => {
	test("the built-in thresholds: 0.9 for safety-critical types, 0.8 otherwise", () => {
		expect(confidenceThreshold(DEFAULT_POLICY, "action.risk")).toBe(0.9);
		expect(confidenceThreshold(DEFAULT_POLICY, "finding.real")).toBe(0.8);
	});

	test("a policy's own threshold wins", () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			decisions: {
				...DEFAULT_POLICY.decisions,
				"finding.real": {
					...DEFAULT_POLICY.decisions["finding.real"],
					thresholds: { confidence: 0.55 },
				},
			},
		};
		expect(confidenceThreshold(policy, "finding.real")).toBe(0.55);
	});
});
