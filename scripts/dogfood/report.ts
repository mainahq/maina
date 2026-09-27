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

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { mkdirSync, writeFileSync } = await import("node:fs");
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
	} else {
		process.stderr.write(`dogfood report: ${r.error}\n`);
		process.exitCode = 1;
	}
}
