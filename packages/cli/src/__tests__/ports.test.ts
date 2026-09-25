/**
 * The crash path reads the working directory for the repo policy. It must
 * never throw there: a throw inside the `uncaughtException` handler would
 * replace the user's error and its exit code.
 */

import { describe, expect, test } from "bun:test";
import { safeCwd } from "../ports";

describe("safeCwd", () => {
	test("returns the working directory when it can be read", () => {
		expect(safeCwd(() => "/repo")).toBe("/repo");
	});

	test("returns undefined instead of throwing when the directory is gone", () => {
		const gone = (): string => {
			throw Object.assign(new Error("uv_cwd"), { code: "ENOENT" });
		};
		expect(safeCwd(gone)).toBeUndefined();
	});
});
