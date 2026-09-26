/**
 * The escape-suite evidence (spec §9.6): the sandboxed run of every case on
 * each OS, per worker, as `ci/escape/runner.ts --json` records it.
 */

import { describe, expect, test } from "bun:test";
import { escapeEvidence } from "../escape";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

describe("escapeEvidence", () => {
	test("one run per sandboxed report", () => {
		const reports = [
			{
				os: "linux",
				worker: "claude",
				mode: "sandboxed",
				cases: 64,
				blocked: 64,
			},
			{
				os: "macos",
				worker: "claude",
				mode: "sandboxed",
				cases: 64,
				blocked: 63,
				escaped: ["net.dns-bypass"],
			},
		];
		expect(escapeEvidence(reports, LINK)).toEqual({
			ok: true,
			value: {
				link: LINK,
				runs: [
					{ os: "linux", worker: "claude", cases: 64, blocked: 64 },
					{
						os: "macos",
						worker: "claude",
						cases: 64,
						blocked: 63,
						escaped: ["net.dns-bypass"],
					},
				],
			},
		});
	});

	test("unsandboxed control runs and malformed reports are not evidence", () => {
		const r = escapeEvidence(
			[
				{
					os: "linux",
					worker: "claude",
					mode: "unsandboxed",
					cases: 64,
					blocked: 0,
				},
				{ os: "linux", mode: "sandboxed" },
				"junk",
			],
			LINK,
		);
		expect(r.ok).toBe(false);
	});
});
