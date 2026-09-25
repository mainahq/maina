import { describe, expect, test } from "bun:test";
import { linkDecisionCommit, queryOutcomes } from "../link";
import { linkTestFailure } from "../test-signal";
import { logDecision, outcomePorts, sha, unwrap } from "./fixtures";

describe("linkTestFailure", () => {
	test("a failing test run links test_failed_after_allow to the commit's allow decisions", () => {
		const ports = outcomePorts();
		logDecision(ports.db, {
			id: "allowed",
			type: "diff.needs_review",
			finalAction: "allow",
		});
		logDecision(ports.db, {
			id: "flagged",
			type: "diff.sensitive",
			finalAction: "flag",
		});
		logDecision(ports.db, {
			id: "elsewhere",
			type: "diff.needs_review",
			finalAction: "allow",
		});
		unwrap(linkDecisionCommit(ports, "allowed", sha("c1")));
		unwrap(linkDecisionCommit(ports, "flagged", sha("c1")));
		unwrap(linkDecisionCommit(ports, "elsewhere", sha("c2")));

		const linked = unwrap(linkTestFailure(ports, sha("c1"), "ci-run-42"));
		expect(linked.map((o) => o.decisionId)).toEqual(["allowed"]);
		expect(unwrap(queryOutcomes(ports, {}))).toMatchObject([
			{
				decisionId: "allowed",
				outcome: "test_failed_after_allow",
				source: "test",
				ref: "ci-run-42",
			},
		]);

		// Reporting the same failure again adds nothing.
		expect(unwrap(linkTestFailure(ports, sha("c1"), "ci-run-42"))).toEqual([]);
		expect(unwrap(queryOutcomes(ports, {}))).toHaveLength(1);
	});
});
