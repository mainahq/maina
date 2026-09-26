/**
 * The harness-control evidence (spec §9.6): the unattended policy-matrix
 * tests and the bounded-revision tests, each a claim that holds only when
 * its suite ran and every case passed.
 */

import { describe, expect, test } from "bun:test";
import { harnessEvidence } from "../harness";
import { junit } from "./fixtures";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

const green = junit([
	["unattended runs never merge, release or publish (property)", "a", "passed"],
	["unattended: ask means deny", "b", "passed"],
]);

describe("harnessEvidence", () => {
	test("both suites green: both claims hold", () => {
		expect(
			harnessEvidence({ unattended: green, revision: green }, LINK),
		).toEqual({
			ok: true,
			value: {
				link: LINK,
				unattendedNeverShips: true,
				boundedRevision: true,
				tests: {
					unattended: { passed: 2, failed: 0, skipped: 0 },
					revision: { passed: 2, failed: 0, skipped: 0 },
				},
			},
		});
	});

	test("a failing case fails its claim", () => {
		const red = junit([
			["bounded revision", "a second failed review stops the run", "failed"],
			["bounded revision", "one revision is allowed", "passed"],
		]);
		const r = harnessEvidence({ unattended: green, revision: red }, LINK);
		expect(
			r.ok && [r.value.unattendedNeverShips, r.value.boundedRevision],
		).toEqual([true, false]);
	});

	test("a suite that ran nothing, or did not report, proves nothing", () => {
		const skipped = junit([["bounded revision", "a", "skipped"]]);
		const r = harnessEvidence(
			{ unattended: undefined, revision: skipped },
			LINK,
		);
		expect(
			r.ok && [r.value.unattendedNeverShips, r.value.boundedRevision],
		).toEqual([false, false]);
	});

	test("no report at all is no evidence", () => {
		expect(
			harnessEvidence({ unattended: undefined, revision: undefined }, LINK).ok,
		).toBe(false);
	});
});
