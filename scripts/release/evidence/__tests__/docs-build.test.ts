/**
 * The docs-build evidence (spec §9.4): the docs site build exited 0 and
 * logged no warning or error.
 */

import { describe, expect, test } from "bun:test";
import { docsBuildEvidence } from "../docs-build";

const LINK = "https://github.com/mainahq/maina/actions/runs/42";

describe("docsBuildEvidence", () => {
	test("exit 0 with no warning is clean", () => {
		const log =
			"12:00:01 [build] 84 page(s) built in 9.1s\n12:00:01 [build] Complete!\n";
		expect(docsBuildEvidence(0, log, LINK)).toEqual({
			link: LINK,
			clean: true,
			exitCode: 0,
			warnings: [],
		});
	});

	test("a warning in the log is not clean, and is quoted", () => {
		const log =
			'12:00:01 [WARN] [content] Duplicate id "cli" found\n12:00:02 [build] Complete!\n';
		expect(docsBuildEvidence(0, log, LINK)).toEqual({
			link: LINK,
			clean: false,
			exitCode: 0,
			warnings: ['12:00:01 [WARN] [content] Duplicate id "cli" found'],
		});
	});

	test("a failed build is not clean", () => {
		const r = docsBuildEvidence(1, "[ERROR] boom\n", LINK);
		expect([r.clean, r.exitCode, r.warnings]).toEqual([
			false,
			1,
			["[ERROR] boom"],
		]);
	});

	test("route names that merely contain the word are not warnings", () => {
		const log = "  ├─ /reference/warnings/index.html (+2ms)\n";
		expect(docsBuildEvidence(0, log, LINK).clean).toBe(true);
	});

	test("at most 20 warnings are quoted", () => {
		const log = Array.from({ length: 30 }, (_, i) => `[WARN] w${i}`).join("\n");
		expect(docsBuildEvidence(0, log, LINK).warnings).toHaveLength(20);
	});
});
