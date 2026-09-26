/**
 * The shared "leaves no trace" helpers (#341, #342). `runtimePid` is polled
 * through `waitFor` while the runtime claims its pid file, which it creates
 * before it writes it: a torn read must mean "not yet", never a throw.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimePid } from "../uninstall-traces";

const dirs: string[] = [];
const runDir = (pidFile?: string): string => {
	const dir = mkdtempSync(join(tmpdir(), "maina-traces-"));
	dirs.push(dir);
	if (pidFile !== undefined) writeFileSync(join(dir, "maina.pid"), pidFile);
	return dir;
};

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("runtimePid", () => {
	test("reads the pid the runtime's claim names", () => {
		expect(runtimePid(runDir('{"pid":4242,"at":1}'))).toBe(4242);
	});

	test("is null with no run dir or no pid file", () => {
		expect(runtimePid(join(runDir(), "missing"))).toBeNull();
		expect(runtimePid(runDir())).toBeNull();
	});

	test("is null while the pid file is empty or half-written", () => {
		for (const torn of ["", '{"pid":42', "null"]) {
			expect(runtimePid(runDir(torn))).toBeNull();
		}
	});
});
