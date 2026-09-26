/**
 * Weekly digest metrics (#350, FR-RET-5, FR-DOG-4): the numbers the digest
 * shows, computed from the gate log fixture and from a decision log slice.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogSlice } from "../../decide/evidence";
import type { DecisionRecord } from "../../decide/log/schema";
import type { OutcomeRecord } from "../../decide/outcomes/types";
import {
	buildDigest,
	decisionLogEvents,
	gateLogEvents,
	isoWeek,
	isWeekKey,
	parseGateLog,
	weekBounds,
} from "../build";

const LOG = readFileSync(
	join(import.meta.dir, "fixtures/gate-log.jsonl"),
	"utf-8",
);

describe("isoWeek", () => {
	test("computes ISO-8601 week keys from ISO strings and epoch ms", () => {
		expect(isoWeek("2026-09-25T10:00:00.000Z")).toBe("2026-39");
		expect(isoWeek("2026-01-01T00:00:00.000Z")).toBe("2026-01");
		expect(isoWeek("2025-12-29T00:00:00.000Z")).toBe("2026-01");
		expect(isoWeek("2027-01-01T00:00:00.000Z")).toBe("2026-53");
		expect(isoWeek(Date.parse("2026-09-21T00:00:00.000Z"))).toBe("2026-39");
	});
});

describe("isWeekKey", () => {
	test("accepts yyyy-ww and nothing else", () => {
		expect(isWeekKey("2026-39")).toBe(true);
		expect(isWeekKey("2026-W39")).toBe(false);
		expect(isWeekKey("2026-39x")).toBe(false);
		expect(isWeekKey("2026-00")).toBe(false);
		expect(isWeekKey("2026-54")).toBe(false);
		// 2026 has 53 ISO weeks, 2025 only 52.
		expect(isWeekKey("2026-53")).toBe(true);
		expect(isWeekKey("2025-53")).toBe(false);
	});
});

describe("weekBounds", () => {
	test("spans Monday 00:00 UTC to the next Monday", () => {
		const bounds = weekBounds("2026-39");
		expect(bounds).toEqual({
			since: Date.parse("2026-09-21T00:00:00.000Z"),
			until: Date.parse("2026-09-28T00:00:00.000Z"),
		});
	});

	test("every instant inside the bounds has that week key", () => {
		for (const week of ["2026-01", "2026-39", "2026-53", "2027-01"]) {
			const { since, until } = weekBounds(week);
			expect(isoWeek(since)).toBe(week);
			expect(isoWeek(until - 1)).toBe(week);
			expect(isoWeek(since - 1)).not.toBe(week);
			expect(isoWeek(until)).not.toBe(week);
		}
	});
});

describe("parseGateLog", () => {
	test("keeps valid records and counts malformed lines", () => {
		const { records, malformed } = parseGateLog(LOG);
		expect(records).toHaveLength(14);
		// An unparseable date, an unknown verdict and a non-JSON line.
		expect(malformed).toBe(3);
	});
});

describe("buildDigest over the gate log fixture", () => {
	test("week 2026-39 matches the fixture", () => {
		const events = gateLogEvents(parseGateLog(LOG).records);
		const d = buildDigest(events, "2026-39");
		expect(d.week).toBe("2026-39");
		expect(d.total).toBe(12);
		expect(d.verdicts).toEqual({ allow: 4, ask: 4, deny: 4 });
		expect(d.denyRate).toBeCloseTo(4 / 12);
		expect(d.askRate).toBeCloseTo(4 / 12);
		expect(d.overrides).toBe(2);
		// overrides / (denies + overrides): how often a deny was contested.
		expect(d.overrideRate).toBeCloseTo(2 / 6);
		expect(d.crashes).toBe(1);
		expect(d.byTool).toEqual({
			Bash: 6,
			Read: 1,
			Write: 1,
			Edit: 1,
			mcp__github__create_issue: 1,
			unknown: 1,
			WebFetch: 1,
		});
		expect(d.topDenyRules).toEqual([
			{ rule: "gate.self_override", count: 2 },
			{ rule: "fs.delete.outside is irreversible", count: 1 },
			{ rule: "fs.write.outside", count: 1 },
		]);
	});

	test("the Sunday before and the Monday after fall in other weeks", () => {
		const events = gateLogEvents(parseGateLog(LOG).records);
		expect(buildDigest(events, "2026-38").total).toBe(1);
		const next = buildDigest(events, "2026-40");
		expect(next.total).toBe(1);
		expect(next.verdicts).toEqual({ allow: 0, ask: 0, deny: 1 });
		expect(next.denyRate).toBe(1);
	});

	test("an empty week yields zeroed metrics, not NaN", () => {
		const d = buildDigest([], "2026-10");
		expect(d.total).toBe(0);
		expect(d.denyRate).toBe(0);
		expect(d.askRate).toBe(0);
		expect(d.overrideRate).toBe(0);
		expect(d.topDenyRules).toEqual([]);
	});

	test("keeps at most ten deny rules, most frequent first, ties by name", () => {
		const events = Array.from({ length: 12 }, (_, i) => ({
			ts: Date.parse("2026-09-22T10:00:00.000Z"),
			tool: "Bash",
			verdict: "deny" as const,
			rule: `rule-${String.fromCharCode(97 + i)}`,
			override: false,
			crash: false,
		}));
		const d = buildDigest(
			[...events, { ...events[5], rule: "rule-f" } as (typeof events)[0]],
			"2026-39",
		);
		expect(d.topDenyRules).toHaveLength(10);
		expect(d.topDenyRules[0]).toEqual({ rule: "rule-f", count: 2 });
		expect(d.topDenyRules[1]).toEqual({ rule: "rule-a", count: 1 });
	});
});

// ── Decision log source ─────────────────────────────────────────────────────

const HASH = "a".repeat(64);
const TS = Date.parse("2026-09-22T10:00:00.000Z");

function gateRecord(
	id: string,
	finalAction: string,
	ts = TS,
	type: DecisionRecord["type"] = "action.risk",
): DecisionRecord {
	return {
		id,
		ts,
		type,
		inputHash: HASH,
		schemaHash: HASH,
		optionOrder: ["allow", "ask", "deny"],
		policyHash: HASH,
		modelHash: HASH,
		distribution: [
			{ answer: "allow", p: 1 },
			{ answer: "ask", p: 0 },
			{ answer: "deny", p: 0 },
		],
		answer: "allow",
		finalAction,
		latencyMs: 3,
	};
}

function override(decisionId: string): OutcomeRecord {
	return {
		id: `o-${decisionId}`,
		decisionId,
		outcome: "override",
		source: "gate",
		ts: TS,
	};
}

describe("decisionLogEvents", () => {
	const slice: LogSlice = {
		decisions: [
			gateRecord("g1", "allow"),
			gateRecord("g2", "deny"),
			// The second half of g2's two-order check: one event, not two.
			gateRecord("g2:reversed", "deny"),
			gateRecord("g3", "ask"),
			gateRecord("g4", "deny"),
			// Shadow records did nothing; routing is not a gate event.
			gateRecord("g5:shadow", "shadow"),
			gateRecord("r1", "mechanical", TS, "task.tier"),
			// A gate record whose final action says nothing.
			gateRecord("g6", "flag"),
		],
		outcomes: [override("g3")],
	};
	const subjects = new Map([
		["g1", { kind: "shell" as const, classes: ["shell.exec"] }],
		[
			"g2",
			{
				kind: "shell" as const,
				classes: ["shell.exec", "fs.delete.recursive"],
			},
		],
		["g3", { kind: "shell" as const, classes: ["git.push.protected"] }],
	]);

	test("one event per served gate decision, with verdict, kind and class", () => {
		const events = decisionLogEvents(slice, subjects);
		expect(events).toEqual([
			{
				ts: TS,
				tool: "shell",
				verdict: "allow",
				rule: "shell.exec",
				override: false,
				crash: false,
			},
			{
				ts: TS,
				tool: "shell",
				verdict: "deny",
				rule: "fs.delete.recursive",
				override: false,
				crash: false,
			},
			{
				ts: TS,
				tool: "shell",
				verdict: "ask",
				rule: "git.push.protected",
				override: true,
				crash: false,
			},
			{
				ts: TS,
				tool: "unknown",
				verdict: "deny",
				rule: "unknown",
				override: false,
				crash: false,
			},
		]);
	});

	test("the digest over those events counts them", () => {
		const d = buildDigest(decisionLogEvents(slice, subjects), "2026-39");
		expect(d.total).toBe(4);
		expect(d.verdicts).toEqual({ allow: 1, ask: 1, deny: 2 });
		expect(d.overrides).toBe(1);
		expect(d.byTool).toEqual({ shell: 3, unknown: 1 });
		expect(d.topDenyRules).toEqual([
			{ rule: "fs.delete.recursive", count: 1 },
			{ rule: "unknown", count: 1 },
		]);
	});

	test("works without any subjects", () => {
		const events = decisionLogEvents(slice);
		expect(events.map((e) => e.tool)).toEqual([
			"unknown",
			"unknown",
			"unknown",
			"unknown",
		]);
	});
});
