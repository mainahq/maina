/**
 * Issue #420: the built-in type checker spawns through an injected
 * `ProcessPort`, so it can be exercised without a real `tsc` binary.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { runTypecheck } from "../typecheck";

describe("runTypecheck over an injected ProcessPort", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-typecheck-port-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("per-project tsc runs through the port with NO_COLOR on the env", async () => {
		mkdirSync(join(root, "packages", "a"), { recursive: true });
		writeFileSync(join(root, "packages", "a", "tsconfig.json"), "{}");
		const proc = createFakeProcess({
			"tsc -p . --noEmit --pretty false": {
				exitCode: 2,
				stdout: "src/x.ts(3,5): error TS2322: bad type",
			},
		});

		const result = await runTypecheck(["packages/a/src/x.ts"], root, {
			env: { PATH: "/bin" },
			process: proc,
		});

		expect(result.skipped).toBe(false);
		expect(result.findings).toEqual([
			{
				tool: "tsc",
				file: "packages/a/src/x.ts",
				line: 3,
				column: 5,
				message: "TS2322: bad type",
				severity: "error",
				ruleId: "TS2322",
			},
		]);
		expect(proc.calls()).toEqual([
			{
				argv: ["tsc", "-p", ".", "--noEmit", "--pretty", "false"],
				options: {
					cwd: join(root, "packages", "a"),
					env: { PATH: "/bin", NO_COLOR: "1" },
				},
			},
		]);
	});

	test("a checker that cannot spawn marks the run skipped", async () => {
		writeFileSync(join(root, "tsconfig.json"), "{}");
		const result = await runTypecheck(["src/a.ts"], root, {
			process: createFakeProcess(),
		});
		expect(result.skipped).toBe(true);
		expect(result.findings).toEqual([]);
	});

	test("non-TypeScript checkers turn a non-zero exit into one finding", async () => {
		const proc = createFakeProcess({
			"mypy --no-color-output --no-error-summary": {
				exitCode: 1,
				stderr: "app.py:1: error: nope\nmore",
			},
		});
		const result = await runTypecheck(["app.py"], root, {
			language: "python",
			process: proc,
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toEqual([
			{
				tool: "mypy",
				file: "app.py",
				line: 1,
				message: "app.py:1: error: nope",
				severity: "error",
			},
		]);
		expect(proc.calls()[0]?.options).toEqual({ cwd: root });
	});
});
