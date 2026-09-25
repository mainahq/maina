/**
 * Issue #433: retrieval spawns zoekt / rg / grep through an injected
 * `ProcessPort`, never `Bun.spawn` directly.
 */

import { describe, expect, test } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import { isToolAvailable, search } from "../retrieval";

const RG_MATCH = JSON.stringify({
	type: "match",
	data: {
		path: { text: "src/a.ts" },
		line_number: 3,
		lines: { text: "export function needle() {}\n" },
		submatches: [{ match: { text: "needle" } }],
	},
});

describe("retrieval over an injected ProcessPort", () => {
	test("isToolAvailable probes `<tool> --version` in the given cwd", async () => {
		const proc = createFakeProcess({ "rg --version": { stdout: "rg 14" } });
		expect(await isToolAvailable("rg", "/repo", proc)).toBe(true);
		expect(await isToolAvailable("zoekt", "/repo", proc)).toBe(false);
		expect(proc.calls().map((c) => c.options.cwd)).toEqual(["/repo", "/repo"]);
	});

	test("search falls back to ripgrep through the port when zoekt is missing", async () => {
		const proc = createFakeProcess((argv) =>
			argv[0] === "rg"
				? {
						ok: true,
						value: {
							exitCode: 0,
							stdout: argv[1] === "--version" ? "rg 14" : RG_MATCH,
							stderr: "",
						},
					}
				: { ok: false, error: { kind: "spawn_failed", message: "missing" } },
		);
		const results = await search("needle", { cwd: "/repo", process: proc });
		expect(results).toEqual([
			{
				filePath: "src/a.ts",
				line: 3,
				content: "export function needle() {}",
				matchLength: 6,
			},
		]);
		const rgSearch = proc.calls().find((c) => c.argv.includes("--json"));
		expect(rgSearch?.options.cwd).toBe("/repo");
	});

	test("search uses grep through the port when rg is unavailable", async () => {
		const proc = createFakeProcess((argv) =>
			argv[0] === "grep"
				? {
						ok: true,
						value: {
							exitCode: 0,
							stdout: "./src/b.ts:7:const needle = 1;\n",
							stderr: "",
						},
					}
				: { ok: false, error: { kind: "spawn_failed", message: "missing" } },
		);
		const results = await search("needle", { cwd: "/repo", process: proc });
		expect(results.map((r) => [r.filePath, r.line])).toEqual([
			["./src/b.ts", 7],
		]);
	});
});
