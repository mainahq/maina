import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	acknowledgeFinding,
	dismissFinding,
	getNoisyRules,
	loadPreferences,
	type Preferences,
	ruleOutcomes,
	savePreferences,
} from "../preferences";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("loadPreferences", () => {
	test("returns defaults when no file exists", () => {
		const prefs = loadPreferences(tmpDir);

		expect(prefs.rules).toEqual({});
		expect(prefs.updatedAt).toBeTruthy();
	});
});

describe("dismissFinding", () => {
	test("increments dismiss count", () => {
		dismissFinding(tmpDir, "no-console-log");
		dismissFinding(tmpDir, "no-console-log");

		const prefs = loadPreferences(tmpDir);
		const rule = prefs.rules["no-console-log"];

		expect(rule).toBeDefined();
		expect(rule?.dismissCount).toBe(2);
		expect(rule?.totalCount).toBe(2);
		expect(rule?.falsePositiveRate).toBeCloseTo(1.0, 5);
	});
});

describe("acknowledgeFinding", () => {
	test("increments total count without incrementing dismiss count", () => {
		acknowledgeFinding(tmpDir, "no-unused-vars");
		acknowledgeFinding(tmpDir, "no-unused-vars");

		const prefs = loadPreferences(tmpDir);
		const rule = prefs.rules["no-unused-vars"];

		expect(rule).toBeDefined();
		expect(rule?.dismissCount).toBe(0);
		expect(rule?.totalCount).toBe(2);
		expect(rule?.falsePositiveRate).toBe(0);
	});
});

describe("getNoisyRules", () => {
	test("returns rules with >50% false positive rate and >= 5 samples", () => {
		// noisy rule: 5 dismissed out of 6 total (83%) — meets MIN_RULE_SAMPLES
		dismissFinding(tmpDir, "noisy-rule");
		dismissFinding(tmpDir, "noisy-rule");
		dismissFinding(tmpDir, "noisy-rule");
		dismissFinding(tmpDir, "noisy-rule");
		dismissFinding(tmpDir, "noisy-rule");
		acknowledgeFinding(tmpDir, "noisy-rule");

		// good rule: 1 dismissed out of 6 total (17%) — not noisy
		dismissFinding(tmpDir, "good-rule");
		acknowledgeFinding(tmpDir, "good-rule");
		acknowledgeFinding(tmpDir, "good-rule");
		acknowledgeFinding(tmpDir, "good-rule");
		acknowledgeFinding(tmpDir, "good-rule");
		acknowledgeFinding(tmpDir, "good-rule");

		// borderline rule: exactly 50% — should NOT be included (>50% required)
		dismissFinding(tmpDir, "borderline-rule");
		acknowledgeFinding(tmpDir, "borderline-rule");
		dismissFinding(tmpDir, "borderline-rule");
		acknowledgeFinding(tmpDir, "borderline-rule");
		dismissFinding(tmpDir, "borderline-rule");
		acknowledgeFinding(tmpDir, "borderline-rule");

		const noisy = getNoisyRules(tmpDir);

		expect(noisy.length).toBe(1);
		expect(noisy[0]?.ruleId).toBe("noisy-rule");
		expect(noisy[0]?.falsePositiveRate).toBeCloseTo(5 / 6, 5);
	});

	test("excludes rules with fewer than 5 samples even if false positive rate is 100%", () => {
		// Only 1 sample — 100% false positive rate but below MIN_RULE_SAMPLES
		dismissFinding(tmpDir, "low-sample-rule");

		const noisy = getNoisyRules(tmpDir);

		expect(noisy.length).toBe(0);
	});
});

describe("savePreferences", () => {
	test("writes JSON file", () => {
		const prefs: Preferences = {
			rules: {
				"test-rule": {
					ruleId: "test-rule",
					dismissCount: 5,
					totalCount: 10,
					falsePositiveRate: 0.5,
				},
			},
			updatedAt: new Date().toISOString(),
		};

		savePreferences(tmpDir, prefs);

		const filePath = join(tmpDir, "preferences.json");
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);

		expect(parsed.rules["test-rule"].dismissCount).toBe(5);
		expect(parsed.rules["test-rule"].totalCount).toBe(10);
	});
});

describe("round-trip", () => {
	test("preferences survive save then load", () => {
		const prefs: Preferences = {
			rules: {
				"rule-a": {
					ruleId: "rule-a",
					dismissCount: 3,
					totalCount: 7,
					falsePositiveRate: 3 / 7,
				},
				"rule-b": {
					ruleId: "rule-b",
					dismissCount: 0,
					totalCount: 5,
					falsePositiveRate: 0,
				},
			},
			updatedAt: "2026-04-03T00:00:00.000Z",
		};

		savePreferences(tmpDir, prefs);
		const loaded = loadPreferences(tmpDir);

		expect(loaded.rules["rule-a"]?.dismissCount).toBe(3);
		expect(loaded.rules["rule-a"]?.totalCount).toBe(7);
		expect(loaded.rules["rule-a"]?.falsePositiveRate).toBeCloseTo(3 / 7, 5);
		expect(loaded.rules["rule-b"]?.dismissCount).toBe(0);
		expect(loaded.rules["rule-b"]?.totalCount).toBe(5);
		expect(loaded.updatedAt).toBe("2026-04-03T00:00:00.000Z");
	});
});

describe("preferences for the verify triage (#329)", () => {
	test("a file that is not a preferences object loads as none", () => {
		for (const content of ["null", "[]", '{"rules":null}', '{"rules":[]}']) {
			writeFileSync(join(tmpDir, "preferences.json"), content);
			expect(loadPreferences(tmpDir).rules).toEqual({});
		}
	});

	test("ruleOutcomes reads a rule's outcomes, or none", () => {
		dismissFinding(tmpDir, "rule-a");
		acknowledgeFinding(tmpDir, "rule-a");
		const prefs = loadPreferences(tmpDir);
		expect(ruleOutcomes(prefs, "rule-a")).toEqual({
			falsePositiveRate: 0.5,
			totalCount: 2,
		});
		const none = { falsePositiveRate: 0, totalCount: 0 };
		expect(ruleOutcomes(prefs, "unknown")).toEqual(none);
		expect(ruleOutcomes(prefs, undefined)).toEqual(none);
		expect(ruleOutcomes(prefs, "constructor")).toEqual(none);
	});
});
