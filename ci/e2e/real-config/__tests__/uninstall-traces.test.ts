/**
 * The shared "leaves no trace" helpers (#341, #342). `runtimePid` is polled
 * through `waitFor` while the runtime claims its pid file, which it creates
 * before it writes it: a torn read must mean "not yet", never a throw.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimePid, type Snapshot, traces } from "../uninstall-traces";

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

describe("traces", () => {
	const none = { dirs: new Set<string>(), files: new Set<string>() };
	const snap = (entries: Record<string, string>): Snapshot =>
		new Map(Object.entries(entries));

	test("names every added, changed and removed path", () => {
		const before = snap({ "home/a": "file:1", "home/b": "file:2" });
		const after = snap({ "home/a": "file:9", "home/c": "file:3" });
		expect(traces(before, after, none)).toEqual([
			"added home/c",
			"changed home/a",
			"removed home/b",
		]);
	});

	test("the user's retention history (#352) is user data, not install state", () => {
		const before = snap({ "home/.maina": "dir" });
		const added = snap({
			"home/.maina": "dir",
			"home/.maina/retention.jsonl": "file:1",
		});
		expect(traces(before, added, none)).toEqual([]);
		const grew = snap({
			"home/.maina": "dir",
			"home/.maina/retention.jsonl": "file:7",
		});
		expect(traces(added, grew, none)).toEqual([]);
		expect(traces(added, before, none)).toEqual([
			"removed home/.maina/retention.jsonl",
		]);
	});

	test("anything else maina leaves under ~/.maina is a trace", () => {
		const before = snap({ "home/.maina": "dir" });
		const after = snap({ "home/.maina": "dir", "home/.maina/runtime": "dir" });
		expect(traces(before, after, none)).toEqual(["added home/.maina/runtime"]);
	});
});
