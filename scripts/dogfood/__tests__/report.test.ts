/**
 * Tests for the weekly dogfood report (#286, FR-DOG-4).
 *
 * The report reads the dogfood hook's log.jsonl, keeps one ISO week and
 * computes the gate metrics: decision counts, deny/ask rates, overrides and
 * crashes (fail-closed asks).
 */

import { describe, expect, test } from "bun:test";
import {
	computeMetrics,
	isoWeek,
	parseLog,
	renderReport,
	report,
} from "../report";

const line = (o: Record<string, unknown>): string => JSON.stringify(o);

const SAMPLE_LOG = [
	line({
		ts: "2026-09-21T09:00:00.000Z",
		tool: "Bash",
		action: "bun test",
		verdict: "allow",
		reason: "no rule matched",
	}),
	line({
		ts: "2026-09-22T09:00:00.000Z",
		tool: "Bash",
		action: "git status",
		verdict: "allow",
		reason: "no rule matched",
	}),
	line({
		ts: "2026-09-22T10:00:00.000Z",
		tool: "Bash",
		action: "rm -rf /",
		verdict: "deny",
		reason: "destructive-shell: recursive rm of /",
	}),
	line({
		ts: "2026-09-23T10:00:00.000Z",
		tool: "Write",
		action: "/etc/hosts",
		verdict: "deny",
		reason: "write-outside-repo: /etc/hosts",
	}),
	line({
		ts: "2026-09-24T10:00:00.000Z",
		tool: "Bash",
		action: "git push origin master",
		verdict: "ask",
		reason: "[override] protected-push: master",
		override: true,
	}),
	line({
		ts: "2026-09-25T10:00:00.000Z",
		tool: "Bash",
		action: "ls",
		verdict: "ask",
		reason: "hook crash: boom",
	}),
	// Different ISO week (2026-40) — excluded.
	line({
		ts: "2026-09-28T10:00:00.000Z",
		tool: "Bash",
		action: "rm -rf ~",
		verdict: "deny",
		reason: "destructive-shell: recursive rm of ~",
	}),
	"{garbage",
	"",
].join("\n");

describe("isoWeek", () => {
	test("computes ISO-8601 week keys", () => {
		expect(isoWeek("2026-09-25T10:00:00.000Z")).toBe("2026-39");
		expect(isoWeek("2026-01-01T00:00:00.000Z")).toBe("2026-01");
		expect(isoWeek("2025-12-29T00:00:00.000Z")).toBe("2026-01");
		expect(isoWeek("2027-01-01T00:00:00.000Z")).toBe("2026-53");
	});
});

describe("parseLog", () => {
	test("keeps valid records and counts malformed lines", () => {
		const { records, malformed } = parseLog(SAMPLE_LOG);
		expect(records).toHaveLength(7);
		expect(malformed).toBe(1);
	});
});

describe("computeMetrics", () => {
	test("computes FR-DOG-4 metrics for one week", () => {
		const { records } = parseLog(SAMPLE_LOG);
		const m = computeMetrics(records, "2026-39");
		expect(m.week).toBe("2026-39");
		expect(m.total).toBe(6);
		expect(m.verdicts).toEqual({ allow: 2, ask: 2, deny: 2 });
		expect(m.denyRate).toBeCloseTo(2 / 6);
		expect(m.askRate).toBeCloseTo(2 / 6);
		expect(m.overrides).toBe(1);
		// overrides / (denies + overrides): how often a deny was contested.
		expect(m.overrideRate).toBeCloseTo(1 / 3);
		expect(m.crashes).toBe(1);
		expect(m.byTool).toEqual({ Bash: 5, Write: 1 });
		expect(m.topDenyRules).toEqual([
			{ rule: "destructive-shell", count: 1 },
			{ rule: "write-outside-repo", count: 1 },
		]);
	});

	test("an empty week yields zeroed metrics, not NaN", () => {
		const m = computeMetrics([], "2026-10");
		expect(m.total).toBe(0);
		expect(m.denyRate).toBe(0);
		expect(m.overrideRate).toBe(0);
	});
});

describe("renderReport", () => {
	test("renders a markdown report with the headline numbers", () => {
		const { records } = parseLog(SAMPLE_LOG);
		const md = renderReport(computeMetrics(records, "2026-39"));
		expect(md).toContain("# Dogfood report 2026-39");
		expect(md).toContain("| deny | 2 |");
		expect(md).toContain("Overrides");
		expect(md).toContain("Crashes");
		expect(md).toContain("destructive-shell");
	});
});

describe("report", () => {
	test("writes docs/dogfood/<yyyy-ww>.md from the log", () => {
		const writes: Array<{ path: string; content: string }> = [];
		const r = report("2026-39", {
			root: "/repo",
			readLog: () => SAMPLE_LOG,
			writeFile: (path, content) => {
				writes.push({ path, content });
			},
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe("/repo/docs/dogfood/2026-39.md");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.content).toContain("# Dogfood report 2026-39");
	});

	test("rejects a malformed week key", () => {
		const r = report("2026-W39x", {
			root: "/repo",
			readLog: () => "",
			writeFile: () => {},
		});
		expect(r.ok).toBe(false);
	});

	test("a missing log yields an empty report, not a failure", () => {
		const r = report("2026-39", {
			root: "/repo",
			readLog: () => undefined,
			writeFile: () => {},
		});
		expect(r.ok).toBe(true);
	});
});
