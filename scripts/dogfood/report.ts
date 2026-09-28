#!/usr/bin/env bun
/**
 * Weekly dogfood report (#286, FR-DOG-4; #570).
 *
 * Reads one ISO week of gate decisions from the repository's decision log
 * (`.maina/decisions.db`, appended to by the runtime the dogfood hook runs)
 * and writes `docs/dogfood/<yyyy-ww>.md`: decision counts, deny/ask rates,
 * overrides, crashes, per-kind volume and the top deny classes. It writes
 * exactly what `maina digest --dogfood` writes (the same renderer), from
 * source, which is what the weekly workflow runs.
 *
 * The decision log is local and gitignored, so a report only records
 * decisions where the gate ran: a maintainer commits the week with
 * `maina digest --dogfood --commit`, and the weekly workflow keeps a
 * committed report rather than overwriting it.
 *
 * It also prints an outcomes line to stdout, not into the committed report
 * (which must stay what `maina digest --dogfood` writes from the decision
 * log): of the week's asks in the dogfood hook log (`MAINA_DOGFOOD_LOG`, or
 * `.maina/dogfood/log.jsonl`) that carry a tool use id, how many ran, that
 * is the user approved them, and how many did not (refused or abandoned).
 * An ask ran when the hook's post mode logged a `ran` record with its tool
 * use id in the same session. A log without ids prints nothing more.
 *
 * Usage:
 *   bun run dogfood:report                 # the week that just ended
 *   bun run dogfood:report --week 2026-39  # a specific week
 */

import {
	readDecisionEvents,
	renderDogfoodReport,
} from "../../packages/cli/src/commands/digest";
import {
	buildDigest,
	type DigestEvent,
	isoWeek,
	isWeekKey,
	parseGateLog,
	RAN_KIND,
	type WeekBounds,
	weekBounds,
} from "../../packages/core/src/digest/build";
import type { Result } from "./receipt-check";

export { isoWeek };

export interface ReportDeps {
	readonly root: string;
	/** The gate events inside `bounds`, from the decision log. */
	readonly readEvents: (
		bounds: WeekBounds,
	) => Result<readonly DigestEvent[], string>;
	readonly writeFile: (path: string, content: string) => void;
}

export function report(week: string, deps: ReportDeps): Result<string, string> {
	if (!isWeekKey(week)) {
		return { ok: false, error: `Invalid week "${week}"; expected yyyy-ww.` };
	}
	const events = deps.readEvents(weekBounds(week));
	if (!events.ok) {
		return {
			ok: false,
			error: `cannot read the decision log: ${events.error}`,
		};
	}
	const path = `${deps.root}/docs/dogfood/${week}.md`;
	deps.writeFile(path, renderDogfoodReport(buildDigest(events.value, week)));
	return { ok: true, value: path };
}

/** The decision log of the repository at `root`, for `report`. */
export function decisionLog(root: string): ReportDeps["readEvents"] {
	return (bounds) => readDecisionEvents(`${root}/.maina`, bounds);
}

/** What became of a week's asks that carry a tool use id. */
export interface AskOutcomes {
	readonly asked: number;
	/** A `ran` record followed: the user approved the call. */
	readonly ran: number;
	/** No `ran` record: the user refused or abandoned the call. */
	readonly notRan: number;
}

const pairKey = (toolUseId: string, sessionId: unknown): string =>
	`${typeof sessionId === "string" ? sessionId : ""}\u0000${toolUseId}`;

/** The `ran` records' pairing keys; malformed lines are skipped. */
function ranKeys(logText: string): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const line of logText.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const r = JSON.parse(line) as Record<string, unknown> | null;
			if (r?.kind === RAN_KIND && typeof r.toolUseId === "string") {
				keys.add(pairKey(r.toolUseId, r.sessionId));
			}
		} catch {
			// Not a record.
		}
	}
	return keys;
}

/**
 * Pairs `week`'s asks in the dogfood hook log with the post hook's `ran`
 * records by tool use id, within a session. Asks without an id (older
 * lines) cannot be paired and are left out. A `ran` record may fall after
 * the week. Pure.
 */
export function askOutcomes(logText: string, week: string): AskOutcomes {
	const ran = ranKeys(logText);
	let asked = 0;
	let approved = 0;
	for (const r of parseGateLog(logText).records) {
		if (r.verdict !== "ask" || r.toolUseId === undefined) continue;
		if (isoWeek(r.ts) !== week) continue;
		asked++;
		if (ran.has(pairKey(r.toolUseId, r.sessionId))) approved++;
	}
	return { asked, ran: approved, notRan: asked - approved };
}

/** The outcomes line the CLI prints, or undefined when no ask has an id. */
export function outcomesLine(
	logText: string,
	week: string,
): string | undefined {
	const o = askOutcomes(logText, week);
	if (o.asked === 0) return undefined;
	return `outcomes: of ${o.asked} asks with a tool use id, ${o.ran} ran (approved), ${o.notRan} did not (refused or abandoned)`;
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import(
		"node:fs"
	);
	const { dirname, resolve } = await import("node:path");
	const root = resolve(import.meta.dir, "../..");
	const argv = process.argv.slice(2);
	const i = argv.indexOf("--week");
	const week =
		(i >= 0 ? argv[i + 1] : undefined) ??
		isoWeek(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const r = report(week, {
		root,
		readEvents: decisionLog(root),
		writeFile: (path, content) => {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content, "utf-8");
		},
	});
	if (r.ok) {
		process.stdout.write(`Wrote ${r.value}\n`);
		const logPath =
			process.env.MAINA_DOGFOOD_LOG ??
			resolve(root, ".maina/dogfood/log.jsonl");
		try {
			const line = existsSync(logPath)
				? outcomesLine(readFileSync(logPath, "utf-8"), week)
				: undefined;
			if (line !== undefined) process.stdout.write(`${line}\n`);
		} catch {
			// The hook log is a local extra; the report stands without it.
		}
	} else {
		process.stderr.write(`dogfood report: ${r.error}\n`);
		process.exitCode = 1;
	}
}
