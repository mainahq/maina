import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { testTmpDir } from "./test-tmp";

/** Runtime test files whose fixtures used to land straight in TMPDIR (#639). */
const MOVED = ["gate.test.ts", "hook-route.test.ts"];

/** Polls until `dir` is empty (a reaper runs after its process is gone). */
async function emptied(dir: string, ms = 10_000): Promise<string[]> {
	const until = Date.now() + ms;
	let left = readdirSync(dir);
	while (left.length > 0 && Date.now() < until) {
		await Bun.sleep(100);
		left = readdirSync(dir);
	}
	return left;
}

describe("testTmpDir (runtime): one marked per-process root (#639)", () => {
	test("the dir lives under a root marked with this process's pid", () => {
		const dir = testTmpDir("maina-gate-");
		const root = dirname(dir);
		expect(existsSync(dir)).toBe(true);
		expect(basename(root).startsWith("maina-test-")).toBe(true);
		expect(readFileSync(join(root, ".maina-tmp"), "utf8").trim()).toBe(
			String(process.pid),
		);
	});
});

describe("runtime gate/hook fixtures: none left in TMPDIR (#639)", () => {
	test("the moved files make their dirs with testTmpDir, not tmpdir()", async () => {
		const offenders: string[] = [];
		for (const file of MOVED) {
			const text = await Bun.file(join(import.meta.dir, file)).text();
			if (/\btmpdir\(\)/.test(text) || !text.includes('from "./test-tmp"')) {
				offenders.push(file);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("one `bun test` run over the moved files leaves nothing in TMPDIR", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const proc = Bun.spawn(
			["bun", "test", ...MOVED.map((file) => join(import.meta.dir, file))],
			{
				cwd: join(import.meta.dir, "..", ".."),
				env: { ...process.env, TMPDIR: parent },
				stdout: "ignore",
				stderr: "pipe",
			},
		);
		const [err, code] = await Promise.all([
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		// Only a passing run proves the fixtures were made and then cleaned.
		expect({ code, err: code === 0 ? "" : err }).toEqual({ code: 0, err: "" });
		expect(await emptied(parent)).toEqual([]);
	}, 120_000);
});
