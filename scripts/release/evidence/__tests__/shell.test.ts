/**
 * What every producer shares: the evidence link to the CI run it ran in.
 */

import { describe, expect, test } from "bun:test";
import { runLink } from "../shell";

describe("runLink", () => {
	test("the Actions run URL from the CI environment", () => {
		expect(
			runLink({
				GITHUB_SERVER_URL: "https://github.com",
				GITHUB_REPOSITORY: "mainahq/maina",
				GITHUB_RUN_ID: "42",
			}),
		).toBe("https://github.com/mainahq/maina/actions/runs/42");
	});

	test("outside CI there is no http(s) link to give", () => {
		expect(runLink({})).toBe("local run (no CI link)");
	});
});
