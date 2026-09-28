import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { shallowTmpDir, testTmpDir } from "./test-tmp";

/**
 * Runs a bun process that makes a test temp dir under `parent` (its TMPDIR),
 * then runs `then`; returns the dir it made and how it ended.
 */
async function child(parent: string, then: string) {
	const script = `
		import { testTmpDir } from ${JSON.stringify(join(import.meta.dir, "test-tmp.ts"))};
		const dir = testTmpDir("maina-sessions-");
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

describe("testTmpDir: one per-process parent, removed when the process ends", () => {
	test("the dir lives under a marked per-process root", () => {
		const dir = testTmpDir("maina-sessions-");
		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dirname(dir), ".maina-tmp"))).toBe(true);
	});

	test("a normal exit leaves nothing in TMPDIR", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const ran = await child(parent, "");
		expect(ran.code).toBe(0);
		expect(ran.dir.startsWith(parent)).toBe(true);
		expect(readdirSync(parent)).toEqual([]);
	});

	test("a bun test file that wraps and never disposes leaves nothing in TMPDIR", async () => {
		const parent = shallowTmpDir();
		const before = readdirSync(parent);
		const files = testTmpDir("maina-tt-files-");
		const leaky = join(files, "leaky.test.ts");
		const here = import.meta.dir;
		await Bun.write(
			leaky,
			`
			import { expect, test } from "bun:test";
			import { testTmpDir } from ${JSON.stringify(join(here, "test-tmp.ts"))};
			import { createSandboxRuntime } from ${JSON.stringify(join(here, "..", "sandbox", "runtime-adapter.ts"))};
			test("leaks unless cleaned", async () => {
				await Bun.write(testTmpDir("maina-sbx-") + "/f", "x");
				const port = createSandboxRuntime({
					probe: { which: (b) => "/opt/bin/" + b, version: () => "0.0.77" },
					platform: "darwin",
					env: {},
				});
				const wrapped = port.wrap(
					{ name: "sh", command: "/bin/sh" },
					{ writeAllow: [], readDeny: [], netAllow: [], credentials: [] },
				);
				if (!wrapped.ok) throw new Error(wrapped.error.message);
				const srtTmp = wrapped.value.env?.TMPDIR;
				expect(srtTmp?.startsWith(${JSON.stringify(parent)})).toBe(true);
				await Bun.write(srtTmp + "/srt-ca-x/ca.key", "k");
			});
			`,
		);
		const proc = Bun.spawn(["bun", "test", leaky], {
			cwd: files,
			env: { ...process.env, TMPDIR: parent },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [err, code] = await Promise.all([
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect({ code, err: code === 0 ? "" : err }).toEqual({ code: 0, err: "" });
		expect(readdirSync(parent)).toEqual(before);
	});

	test("SIGTERM leaves nothing in TMPDIR, and still ends the process", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const ran = await child(
			parent,
			"process.kill(process.pid, 'SIGTERM'); await Bun.sleep(5000);",
		);
		expect(ran.dir.startsWith(parent)).toBe(true);
		expect(ran.signal).toBe("SIGTERM");
		expect(readdirSync(parent)).toEqual([]);
	});
});

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

describe("testTmpDir: what afterAll and exit hooks cannot reach", () => {
	test("one `bun test` run over several files leaves nothing in TMPDIR", async () => {
		// bun shares one module registry across the files of a run, so the
		// helper's afterAll fires after the first file only, and bun test
		// emits no `exit`: the second file's root needs another way out.
		const parent = testTmpDir("maina-tt-parent-");
		const files = testTmpDir("maina-tt-files-");
		const helper = JSON.stringify(join(import.meta.dir, "test-tmp.ts"));
		for (const name of ["a", "b"]) {
			await Bun.write(
				join(files, `${name}.test.ts`),
				`
				import { test } from "bun:test";
				import { testTmpDir } from ${helper};
				test("${name}", async () => {
					await Bun.write(testTmpDir("maina-sessions-") + "/f", "x");
				});
				`,
			);
		}
		const proc = Bun.spawn(["bun", "test", "./a.test.ts", "./b.test.ts"], {
			cwd: files,
			env: { ...process.env, TMPDIR: parent },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [err, code] = await Promise.all([
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect({ code, err: code === 0 ? "" : err }).toEqual({ code: 0, err: "" });
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

/** Harness test files whose fixtures used to land straight in TMPDIR (#637). */
const MOVED = [
	"__tests__/orchestrator.test.ts",
	"permissions/__tests__/acp-bridge.test.ts",
	"permissions/__tests__/claude-sdk-hook.test.ts",
	"permissions/__tests__/worker-gate.test.ts",
	"proxy/__tests__/proxy.test.ts",
	"run/__tests__/budget.test.ts",
];

describe("harness test fixtures: none left in TMPDIR (#637)", () => {
	const src = join(import.meta.dir, "..");

	test("no harness test makes a dir straight in the system temp dir", async () => {
		const offenders: string[] = [];
		for await (const file of new Bun.Glob("**/__tests__/**/*.ts").scan(src)) {
			if (file === join("__tests__", "test-tmp.ts")) continue;
			const text = await Bun.file(join(src, file)).text();
			if (/\btmpdir\(\)/.test(text)) offenders.push(file);
		}
		expect(offenders.sort()).toEqual([]);
	});

	test("one `bun test` run over the moved files leaves nothing in TMPDIR", async () => {
		const parent = testTmpDir("maina-tt-parent-");
		const proc = Bun.spawn(
			["bun", "test", ...MOVED.map((file) => join(src, file))],
			{
				cwd: join(src, ".."),
				env: { ...process.env, TMPDIR: parent },
				stdout: "ignore",
				stderr: "ignore",
			},
		);
		await proc.exited;
		expect(await emptied(parent)).toEqual([]);
	}, 60_000);
});
