import { describe, expect, test } from "bun:test";
import { createMemoryFs } from "../../ports/testing";
import {
	isFeatureName,
	loadAcceptanceCriteria,
	mapEvidence,
	parseAcceptanceCriteria,
} from "../acceptance";

const SPEC = `# Feature: Export CSV

## User stories

- As a user I can export.

## Acceptance Criteria

- [ ] Export writes a header row
- AC-7: Empty tables export a header only
- [x] Dates are ISO 8601

## Notes

- not a criterion
`;

describe("parseAcceptanceCriteria", () => {
	test("gives each criterion a stable id and keeps its text verbatim", () => {
		expect(parseAcceptanceCriteria(SPEC)).toEqual([
			{ id: "AC-1", text: "Export writes a header row" },
			{ id: "AC-7", text: "Empty tables export a header only" },
			{ id: "AC-3", text: "Dates are ISO 8601" },
		]);
	});

	test("a spec without the section has no criteria", () => {
		expect(parseAcceptanceCriteria("# Spec\n\nNothing here\n")).toEqual([]);
	});
});

describe("isFeatureName", () => {
	test("accepts feature folder names and rejects paths", () => {
		expect(isFeatureName("054-posthog-send-wiring")).toBe(true);
		for (const name of ["", "..", "../x", "a/b", ".hidden", "a\\b"]) {
			expect(isFeatureName(name)).toBe(false);
		}
	});
});

describe("loadAcceptanceCriteria: the contract lives in the feature folder (FR-FAC-2)", () => {
	test("reads the criteria from the feature's spec.md", async () => {
		const fs = createMemoryFs({
			"/repo/.maina/features/012-export/spec.md": SPEC,
		});
		const loaded = await loadAcceptanceCriteria(fs, "/repo", "012-export");
		expect(loaded.ok).toBe(true);
		if (loaded.ok)
			expect(loaded.value.map((c) => c.id)).toEqual(["AC-1", "AC-7", "AC-3"]);
	});

	test("no spec, no criteria, or a bad feature name are errors", async () => {
		const fs = createMemoryFs({
			"/repo/.maina/features/013-empty/spec.md": "# Spec\n",
		});
		const missing = await loadAcceptanceCriteria(fs, "/repo", "999-none");
		expect(missing.ok ? undefined : missing.error.kind).toBe("not_found");
		const empty = await loadAcceptanceCriteria(fs, "/repo", "013-empty");
		expect(empty.ok ? undefined : empty.error.kind).toBe("no_criteria");
		const bad = await loadAcceptanceCriteria(fs, "/repo", "../../etc");
		expect(bad.ok ? undefined : bad.error.kind).toBe("invalid_feature");
	});
});

describe("mapEvidence: every criterion maps to evidence", () => {
	const criteria = parseAcceptanceCriteria(SPEC);

	test("joins verdicts to criteria in criteria order", () => {
		const mapped = mapEvidence(criteria, [
			{ criterionId: "AC-3", verdict: "met", evidence: "dates.test.ts:12" },
			{ criterionId: "AC-1", verdict: "met", evidence: "csv.test.ts:4" },
			{
				criterionId: "AC-7",
				verdict: "not_met",
				evidence: "no empty-table test",
			},
		]);
		expect(mapped).toEqual({
			ok: true,
			value: [
				{
					criterionId: "AC-1",
					text: "Export writes a header row",
					verdict: "met",
					evidence: "csv.test.ts:4",
				},
				{
					criterionId: "AC-7",
					text: "Empty tables export a header only",
					verdict: "not_met",
					evidence: "no empty-table test",
				},
				{
					criterionId: "AC-3",
					text: "Dates are ISO 8601",
					verdict: "met",
					evidence: "dates.test.ts:12",
				},
			],
		});
	});

	test("a criterion without evidence (missing or blank) is an error naming it", () => {
		const mapped = mapEvidence(criteria, [
			{ criterionId: "AC-1", verdict: "met", evidence: "csv.test.ts:4" },
			{ criterionId: "AC-3", verdict: "met", evidence: "   " },
		]);
		expect(mapped).toEqual({
			ok: false,
			error: { kind: "missing_evidence", criterionIds: ["AC-7", "AC-3"] },
		});
	});

	test("evidence for a criterion that is not in the contract is an error", () => {
		const mapped = mapEvidence(criteria, [
			{ criterionId: "AC-1", verdict: "met", evidence: "a" },
			{ criterionId: "AC-7", verdict: "met", evidence: "b" },
			{ criterionId: "AC-3", verdict: "met", evidence: "c" },
			{ criterionId: "AC-99", verdict: "met", evidence: "made up" },
		]);
		expect(mapped).toEqual({
			ok: false,
			error: { kind: "unknown_criterion", criterionIds: ["AC-99"] },
		});
	});

	test("two verdicts for one criterion are an error, so a later one can't override a not_met", () => {
		const mapped = mapEvidence(criteria, [
			{ criterionId: "AC-1", verdict: "not_met", evidence: "no header" },
			{ criterionId: "AC-1", verdict: "met", evidence: "csv.test.ts:4" },
			{ criterionId: "AC-7", verdict: "met", evidence: "b" },
			{ criterionId: "AC-3", verdict: "met", evidence: "c" },
		]);
		expect(mapped).toEqual({
			ok: false,
			error: { kind: "duplicate_criterion", criterionIds: ["AC-1"] },
		});
	});
});
