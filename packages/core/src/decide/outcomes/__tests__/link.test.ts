import { describe, expect, test } from "bun:test";
import {
	decisionsForCommit,
	linkDecisionCommit,
	linkOutcome,
	queryOutcomes,
} from "../link";
import { OUTCOMES, type OutcomeInput } from "../types";
import { logDecision, outcomePorts, sha, unwrap } from "./fixtures";

describe("linkOutcome", () => {
	test("an override recorded from a gate prompt links to the right decision", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "gate-1", type: "action.risk" });
		logDecision(ports.db, { id: "gate-2", type: "action.risk" });

		const linked = unwrap(
			linkOutcome(ports, "gate-2", { kind: "override", source: "gate" }),
		);
		expect(linked.created).toBe(true);
		expect(linked.record).toMatchObject({
			decisionId: "gate-2",
			outcome: "override",
			source: "gate",
			ts: 5_000,
		});

		expect(unwrap(queryOutcomes(ports, { decisionId: "gate-2" }))).toEqual([
			linked.record,
		]);
		expect(unwrap(queryOutcomes(ports, { decisionId: "gate-1" }))).toEqual([]);
	});

	test("the outcome list is the FR-DEC-4 set", () => {
		expect([...OUTCOMES]).toEqual([
			"override",
			"dismissed",
			"accepted",
			"rejected",
			"reverted",
			"hotfixed",
			"test_failed_after_allow",
		]);
	});

	test("linking the same outcome twice is idempotent", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "finding.real" });
		const first = unwrap(
			linkOutcome(ports, "d1", { kind: "dismissed", source: "verify" }),
		);
		const again = unwrap(
			linkOutcome(ports, "d1", { kind: "dismissed", source: "verify" }),
		);
		expect(again.created).toBe(false);
		expect(again.record).toEqual(first.record);
		expect(unwrap(queryOutcomes(ports, {}))).toHaveLength(1);
	});

	test("different refs are different outcomes", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "diff.needs_review" });
		unwrap(
			linkOutcome(ports, "d1", {
				kind: "hotfixed",
				source: "git",
				ref: sha("a"),
			}),
		);
		unwrap(
			linkOutcome(ports, "d1", {
				kind: "hotfixed",
				source: "git",
				ref: sha("b"),
			}),
		);
		const refs = unwrap(queryOutcomes(ports, { outcome: "hotfixed" })).map(
			(o) => o.ref,
		);
		expect(refs).toEqual([sha("a"), sha("b")]);
	});

	test("an unknown decision is an error, not a dangling outcome", () => {
		const ports = outcomePorts();
		const result = linkOutcome(ports, "missing", {
			kind: "accepted",
			source: "review",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("unknown_decision");
		expect(unwrap(queryOutcomes(ports, {}))).toEqual([]);
	});

	test("an unknown kind, a non-label source or a raw ref is rejected", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "slop" });
		const bad = [
			{ kind: "liked", source: "gate" },
			{ kind: "accepted", source: "Some Tool" },
			{ kind: "accepted", source: "gate", ref: "src/secret path.ts" },
		] as const;
		for (const outcome of bad) {
			const result = linkOutcome(
				ports,
				"d1",
				outcome as unknown as OutcomeInput,
			);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.kind).toBe("invalid_outcome");
		}
	});

	test("outcomes are append-only in the database", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "slop" });
		unwrap(linkOutcome(ports, "d1", { kind: "accepted", source: "review" }));
		expect(ports.db.run("UPDATE decision_outcome SET outcome = 'x'").ok).toBe(
			false,
		);
		expect(ports.db.run("DELETE FROM decision_outcome").ok).toBe(false);
		expect(unwrap(queryOutcomes(ports, {}))).toHaveLength(1);
	});
});

describe("linkDecisionCommit", () => {
	test("links decisions to the commit they were made for, idempotently", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "diff.sensitive" });
		logDecision(ports.db, { id: "d2", type: "slop", finalAction: "allow" });
		unwrap(linkDecisionCommit(ports, "d1", sha("c1")));
		unwrap(linkDecisionCommit(ports, "d1", sha("c1")));
		unwrap(linkDecisionCommit(ports, "d2", sha("c1")));
		unwrap(linkDecisionCommit(ports, "d2", sha("c2")));

		expect(unwrap(decisionsForCommit(ports, sha("c1")))).toEqual([
			{ decisionId: "d1", type: "diff.sensitive", finalAction: "flag" },
			{ decisionId: "d2", type: "slop", finalAction: "allow" },
		]);
		expect(unwrap(decisionsForCommit(ports, sha("c2")))).toEqual([
			{ decisionId: "d2", type: "slop", finalAction: "allow" },
		]);
	});

	test("rejects an unknown decision or a non-sha commit", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d1", type: "diff.sensitive" });
		const unknown = linkDecisionCommit(ports, "nope", sha("c1"));
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.error.kind).toBe("unknown_decision");
		const badSha = linkDecisionCommit(ports, "d1", "HEAD~1");
		expect(badSha.ok).toBe(false);
		if (!badSha.ok) expect(badSha.error.kind).toBe("invalid_outcome");
	});
});
