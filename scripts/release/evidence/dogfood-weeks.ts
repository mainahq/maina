#!/usr/bin/env bun
/**
 * The dogfood-weeks evidence for spec §9.5 (FR-DOG-4/6, v1 task 12.1,
 * #558): one entry per weekly report in `docs/dogfood/<yyyy-ww>.md`.
 *
 *   onV1Runtime  the report records gate decisions: the week's work ran
 *                through the v1 gate (the dogfood hook runs the v1 runtime's
 *                hook path and logs every decision it makes). A week with no
 *                decisions proves nothing, so it does not count.
 *   openP0       P0 `dogfood` issues open when the week ended (as of now for
 *                the week in progress).
 *
 *   bun scripts/release/evidence/dogfood-weeks.ts --reports docs/dogfood --out <file>
 *   bun scripts/release/evidence/dogfood-weeks.ts --previous-week   # prints yyyy-ww
 */

import {
	isoWeek,
	isWeekKey,
	weekBounds,
} from "../../../packages/core/src/digest/build";
import type { Result } from "./shell";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ISO week before the one `now` falls in: the week a Monday cron reports. */
export function previousWeek(now: Date): string {
	return isoWeek(now.getTime() - 7 * DAY_MS);
}

export type ParsedReport = Readonly<{ week: string; decisions: number }>;

const TITLE = /^# Dogfood report (\d{4}-\d{2})\s*$/m;
const TOTAL = /^\| \*\*total\*\* \| (\d+) \|\s*$/m;

/** The week and decision total of a report `bun run dogfood:report` wrote. */
export function parseDogfoodReport(md: string): Result<ParsedReport, string> {
	const week = TITLE.exec(md)?.[1];
	if (week === undefined || !isWeekKey(week)) {
		return { ok: false, error: "no `# Dogfood report <yyyy-ww>` title" };
	}
	const total = TOTAL.exec(md)?.[1];
	if (total === undefined) {
		return { ok: false, error: "no `| **total** | n |` row" };
	}
	return { ok: true, value: { week, decisions: Number(total) } };
}

export type P0Issue = Readonly<{
	number: number;
	createdAt: string;
	closedAt: string | null;
}>;

/** Issues opened before `at` and not closed by then, by number. */
export function openP0At(issues: readonly P0Issue[], at: number): number[] {
	return issues
		.filter((i) => {
			const opened = Date.parse(i.createdAt);
			const closed = i.closedAt === null ? Number.NaN : Date.parse(i.closedAt);
			return opened < at && (Number.isNaN(closed) || closed >= at);
		})
		.map((i) => i.number)
		.sort((a, b) => a - b);
}

export type DogfoodWeek = Readonly<{
	week: string;
	onV1Runtime: boolean;
	openP0: number;
	decisions: number;
	p0Issues: readonly number[];
}>;

export type DogfoodWeeksEvidence = Readonly<{
	link: string;
	weeks: readonly DogfoodWeek[];
	openP0Now: readonly number[];
}>;

export function dogfoodWeeksEvidence(
	reports: readonly Readonly<{ path: string; text: string }>[],
	issues: readonly P0Issue[],
	link: string,
	now: Date,
): Result<DogfoodWeeksEvidence, string> {
	const weeks: DogfoodWeek[] = [];
	for (const r of reports) {
		const parsed = parseDogfoodReport(r.text);
		if (!parsed.ok) return { ok: false, error: `${r.path}: ${parsed.error}` };
		const { week, decisions } = parsed.value;
		const at = Math.min(weekBounds(week).until, now.getTime());
		const p0Issues = openP0At(issues, at);
		weeks.push({
			week,
			onV1Runtime: decisions > 0,
			openP0: p0Issues.length,
			decisions,
			p0Issues,
		});
	}
	weeks.sort((a, b) => a.week.localeCompare(b.week));
	return {
		ok: true,
		value: { link, weeks, openP0Now: openP0At(issues, now.getTime() + 1) },
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const argv = process.argv.slice(2);
	if (argv.includes("--previous-week")) {
		process.stdout.write(`${previousWeek(new Date())}\n`);
	} else {
		const { basename, join } = await import("node:path");
		const { existsSync, readdirSync, readFileSync } = await import("node:fs");
		const { emit, flag, runLink } = await import("./shell");
		const dir = flag(argv, "--reports") ?? "docs/dogfood";
		const repo = flag(argv, "--repo");
		const label = flag(argv, "--p0-label") ?? "p0";
		const reports = existsSync(dir)
			? readdirSync(dir)
					.filter((f) => /^\d{4}-\d{2}\.md$/.test(basename(f)))
					.sort()
					.map((f) => ({
						path: join(dir, f),
						text: readFileSync(join(dir, f), "utf-8"),
					}))
			: [];
		const proc = Bun.spawn(
			[
				"gh",
				"issue",
				"list",
				...(repo ? ["--repo", repo] : []),
				"--label",
				"dogfood",
				"--label",
				label,
				"--state",
				"all",
				"--limit",
				"1000",
				"--json",
				"number,createdAt,closedAt",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		emit(
			"dogfood-weeks",
			flag(argv, "--out"),
			code === 0
				? dogfoodWeeksEvidence(
						reports,
						JSON.parse(out) as P0Issue[],
						flag(argv, "--link") ?? runLink(process.env),
						new Date(),
					)
				: { ok: false, error: `gh issue list failed: ${err.trim()}` },
		);
	}
}
