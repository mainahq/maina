#!/usr/bin/env bun
/**
 * The harness-control evidence for spec §9.6 (v1 task 12.1, #558):
 *
 *   unattendedNeverShips  packages/harness/src/run/__tests__/context.test.ts,
 *                         the unattended policy matrix: every ship class
 *                         (merge, release, publish) denied however the
 *                         policy is set
 *   boundedRevision       packages/harness/src/run/__tests__/revision.test.ts:
 *                         a second failed review always stops the run
 *
 * Each claim holds only when its suite reported, ran at least one case and
 * every case passed.
 *
 *   bun scripts/release/evidence/harness.ts --unattended <junit> --revision <junit> --out <file>
 */

import { parseJunit, type Tally, tally } from "./junit";
import type { Result } from "./shell";

export type HarnessEvidence = Readonly<{
	link: string;
	unattendedNeverShips: boolean;
	boundedRevision: boolean;
	tests: Readonly<{ unattended?: Tally; revision?: Tally }>;
}>;

function suite(xml: string | undefined): Tally | undefined {
	if (xml === undefined) return undefined;
	const parsed = parseJunit(xml);
	return parsed.ok ? tally(parsed.value) : undefined;
}

const holds = (t: Tally | undefined): boolean =>
	t !== undefined && t.passed > 0 && t.failed === 0;

export function harnessEvidence(
	reports: Readonly<{
		unattended: string | undefined;
		revision: string | undefined;
	}>,
	link: string,
): Result<HarnessEvidence, string> {
	const unattended = suite(reports.unattended);
	const revision = suite(reports.revision);
	if (unattended === undefined && revision === undefined) {
		return { ok: false, error: "neither harness suite reported" };
	}
	return {
		ok: true,
		value: {
			link,
			unattendedNeverShips: holds(unattended),
			boundedRevision: holds(revision),
			tests: {
				...(unattended ? { unattended } : {}),
				...(revision ? { revision } : {}),
			},
		},
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, readText, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	emit(
		"harness-control",
		flag(argv, "--out"),
		harnessEvidence(
			{
				unattended: readText(flag(argv, "--unattended")),
				revision: readText(flag(argv, "--revision")),
			},
			flag(argv, "--link") ?? runLink(process.env),
		),
	);
}
