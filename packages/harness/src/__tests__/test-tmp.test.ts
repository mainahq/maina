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
