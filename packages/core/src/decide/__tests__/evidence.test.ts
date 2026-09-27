import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../../ports/testing";
import { confidenceOf, readLogSlice, verdictOf } from "../evidence";
import {
	logDecision,
	outcomePorts,
	unwrap,
} from "../outcomes/__tests__/fixtures";
import { linkOutcome } from "../outcomes/link";
import { riskRecord, SYSTEM1 } from "./slice-fixtures";

describe("confidenceOf", () => {
	test("the largest logged probability without diagnostics", () => {
		const record = riskRecord({
			id: "a",
			model: SYSTEM1,
			answer: "deny",
			p: 0.7,
		});
		expect(confidenceOf(record)).toBe(0.7);
	});

	test("the calibrated probability of the answer when the log has one (#577)", () => {
		const calibrated = [0.55, 0.25, 0.2];
		const ask = {
			...riskRecord({ id: "a", model: SYSTEM1, answer: "ask", p: 1 }),
			diagnostics: { calibrated },
		};
		expect(confidenceOf(ask)).toBe(0.25);
		const allow = {
			...riskRecord({ id: "b", model: SYSTEM1, answer: "allow", p: 0.55 }),
			diagnostics: { calibrated },
		};
		expect(confidenceOf(allow)).toBe(0.55);
	});
});

describe("readLogSlice", () => {
	test("keeps only the outcomes of decisions in the slice", () => {
		const { db } = outcomePorts();
		const clock = createFixedClock(5_000);
		for (const id of ["a", "b", "c"]) {
			logDecision(db, { id, type: "slop" });
			unwrap(
				linkOutcome({ db, clock }, id, { kind: "accepted", source: "gate" }),
			);
		}
		logDecision(db, { id: "d", type: "finding.real" });
		unwrap(
			linkOutcome({ db, clock }, "d", { kind: "dismissed", source: "gate" }),
		);

		const slice = unwrap(readLogSlice({ db }, { type: "slop", limit: 2 }));
		expect(slice.decisions.map((r) => r.id)).toEqual(["a", "b"]);
		expect(slice.outcomes.map((o) => o.decisionId)).toEqual(["a", "b"]);
	});
});

describe("verdictOf", () => {
	test("reads a decision's outcomes as right, wrong or unlabelled", () => {
		expect(verdictOf(undefined)).toEqual({ kind: "unlabelled" });
		expect(verdictOf([])).toEqual({ kind: "unlabelled" });
		expect(verdictOf(["accepted"])).toEqual({ kind: "right" });
		expect(verdictOf(["override", "dismissed", "rejected"])).toEqual({
			kind: "wrong",
			errors: ["false_positive", "false_positive", "false_positive"],
		});
		expect(
			verdictOf([
				"accepted",
				"reverted",
				"hotfixed",
				"test_failed_after_allow",
			]),
		).toEqual({
			kind: "wrong",
			errors: ["false_negative", "false_negative", "false_negative"],
		});
	});
});
