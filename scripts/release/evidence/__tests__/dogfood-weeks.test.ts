/**
 * The dogfood-weeks evidence (spec §9.5, FR-DOG-4/6): one entry per weekly
 * dogfood report in `docs/dogfood/`, with whether the week ran on the v1
 * runtime (the report records gate decisions) and how many P0 `dogfood`
 * issues were open when the week ended.
 */

import { describe, expect, test } from "bun:test";
import type { LogRecord } from "../../../dogfood/hook";
import { computeMetrics, renderReport } from "../../../dogfood/report";
import {
	dogfoodWeeksEvidence,
	openP0At,
	parseDogfoodReport,
	previousWeek,
} from "../dogfood-weeks";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";
const NOW = new Date("2026-09-27T12:00:00Z"); // a Sunday in ISO week 2026-39

const record = (ts: string, verdict: LogRecord["verdict"]): LogRecord => ({
	ts,
	tool: "Bash",
	action: "bun test",
	verdict,
	reason: "no rule matched",
});

/** A report exactly as `bun run dogfood:report` writes it. */
const report = (week: string, records: readonly LogRecord[]): string =>
	renderReport(computeMetrics(records, week));

const W38 = report("2026-38", [
	record("2026-09-15T09:00:00.000Z", "allow"),
	record("2026-09-16T09:00:00.000Z", "deny"),
	record("2026-09-17T09:00:00.000Z", "ask"),
]);
const W39_EMPTY = report("2026-39", []);

describe("parseDogfoodReport", () => {
	test("reads the week and the decision total", () => {
		expect(parseDogfoodReport(W38)).toEqual({
			ok: true,
			value: { week: "2026-38", decisions: 3 },
		});
		expect(parseDogfoodReport(W39_EMPTY)).toEqual({
			ok: true,
			value: { week: "2026-39", decisions: 0 },
		});
	});

	test("anything else is an error", () => {
		expect(parseDogfoodReport("# Notes\n\nhello\n").ok).toBe(false);
		expect(
			parseDogfoodReport("# Dogfood report 2026-99\n\n| **total** | 3 |\n").ok,
		).toBe(false);
	});
});

const ISSUES = [
	// Still open.
	{ number: 533, createdAt: "2026-09-20T08:00:00Z", closedAt: null },
	// Open through week 38, closed during week 39.
	{
		number: 480,
		createdAt: "2026-09-10T08:00:00Z",
		closedAt: "2026-09-22T08:00:00Z",
	},
	// Opened and closed inside week 37.
	{
		number: 400,
		createdAt: "2026-09-08T08:00:00Z",
		closedAt: "2026-09-09T08:00:00Z",
	},
];

describe("openP0At", () => {
	test("issues opened before the instant and not closed by it", () => {
		expect(openP0At(ISSUES, Date.parse("2026-09-21T00:00:00Z"))).toEqual([
			480, 533,
		]);
		expect(openP0At(ISSUES, Date.parse("2026-09-28T00:00:00Z"))).toEqual([533]);
		expect(openP0At(ISSUES, Date.parse("2026-09-01T00:00:00Z"))).toEqual([]);
	});
});

describe("dogfoodWeeksEvidence", () => {
	test("one entry per report, P0s counted at the end of each week", () => {
		const r = dogfoodWeeksEvidence(
			[
				{ path: "docs/dogfood/2026-39.md", text: W39_EMPTY },
				{ path: "docs/dogfood/2026-38.md", text: W38 },
			],
			ISSUES,
			LINK,
			NOW,
		);
		expect(r).toEqual({
			ok: true,
			value: {
				link: LINK,
				weeks: [
					{
						week: "2026-38",
						onV1Runtime: true,
						openP0: 2,
						decisions: 3,
						p0Issues: [480, 533],
					},
					// The week in progress is judged as of now.
					{
						week: "2026-39",
						onV1Runtime: false,
						openP0: 1,
						decisions: 0,
						p0Issues: [533],
					},
				],
				openP0Now: [533],
			},
		});
	});

	test("a report that does not parse is an error naming the file", () => {
		const r = dogfoodWeeksEvidence(
			[{ path: "docs/dogfood/2026-38.md", text: "garbage" }],
			[],
			LINK,
			NOW,
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("docs/dogfood/2026-38.md");
	});

	test("no report yet: no weeks, and the open P0s still listed", () => {
		expect(dogfoodWeeksEvidence([], ISSUES, LINK, NOW)).toEqual({
			ok: true,
			value: { link: LINK, weeks: [], openP0Now: [533] },
		});
	});
});

describe("previousWeek", () => {
	test("the ISO week before the one `now` falls in", () => {
		expect(previousWeek(NOW)).toBe("2026-38");
		expect(previousWeek(new Date("2026-01-01T12:00:00Z"))).toBe("2025-52");
		expect(previousWeek(new Date("2026-09-28T00:30:00Z"))).toBe("2026-39");
	});
});
