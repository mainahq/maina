import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { testTmpDir } from "./test-tmp";

/**
 * Runs a bun process that makes a test temp dir under `parent` (its TMPDIR),
 * then runs `then`; returns the dir it made and how it ended.
 */
async function child(parent: string, then: string) {
	const script = `
		import { testTmpDir } from ${JSON.stringify(join(import.meta.dir, "test-tmp.ts"))};
		const dir = testTmpDir("maina-scope-");
		await Bun.write(dir + "/file", "x");
		process.stdout.write(dir + "\\n");
		${then}
	`;
	const proc = Bun.spawn(["bun", "-e", script], {
		env: { ...process.env, TMPDIR: parent },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	return { dir: out.trim(), code, signal: proc.signalCode };
}

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

describe("testTmpDir (core): one marked per-process root, reaped (#637)", () => {
	test("the dir lives under a root marked with this process's pid", () => {
		const dir = testTmpDir("maina-scope-");
		const root = dirname(dir);
		expect(existsSync(dir)).toBe(true);
		expect(basename(root).startsWith("maina-test-")).toBe(true);
		expect(readFileSync(join(root, ".maina-tmp"), "utf8").trim()).toBe(
			String(process.pid),
		);
	});

	test("a normal exit leaves nothing in TMPDIR", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const ran = await child(parent, "");
		expect(ran.code).toBe(0);
		expect(ran.dir.startsWith(parent)).toBe(true);
		expect(await emptied(parent)).toEqual([]);
	}, 20_000);

	test("SIGKILL leaves nothing in TMPDIR", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const ran = await child(parent, "process.kill(process.pid, 'SIGKILL');");
		expect(ran.signal).toBe("SIGKILL");
		expect(ran.dir.startsWith(parent)).toBe(true);
		expect(await emptied(parent)).toEqual([]);
	}, 20_000);
});

describe("core verify fixtures: none left in TMPDIR (#637)", () => {
	test("scope.test's repos live under the test root, not the system temp dir", async () => {
		const scope = join(import.meta.dir, "..", "verify", "__tests__");
		const text = await Bun.file(join(scope, "scope.test.ts")).text();
		expect(text).not.toMatch(/\btmpdir\(\)/);
		expect(text).toContain('testTmpDir("maina-scope-")');
	});
});
