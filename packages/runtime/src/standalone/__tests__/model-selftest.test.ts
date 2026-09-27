/**
 * The standalone entry's `model-selftest` mode (#587), run from source.
 * CI's runtime-artifacts build job runs the same mode inside the compiled
 * executable on each target (ADR 0050).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageSelftest } from "../../model/__tests__/fixtures/tiny-model";

const MAIN = join(import.meta.dir, "..", "main.ts");

let dir = "";

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-587-mode-"));
	stageSelftest(dir);
});

afterAll(() => {
	if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function run(args: readonly string[]) {
	const proc = Bun.spawn([process.execPath, MAIN, "model-selftest", ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

describe("maina model-selftest", () => {
	test("prints the report as one JSON line and exits 0", async () => {
		const { stdout, stderr, code } = await run([
			dir,
			"--target",
			"linux-x64-musl",
		]);
		expect(code).toBe(0);
		const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
		expect(report).toMatchObject({
			engine: "wasm",
			shadowOnly: true,
			output: [1, 2, 3, 4, 5, 0],
			ok: true,
		});
		// The shadow-only notice goes to stderr too, as the runtime shows it.
		expect(stderr).toContain("shadow");
	}, 30_000);

	test("a failure is reported on stderr with exit 1", async () => {
		const { stdout, stderr, code } = await run([
			join(dir, "missing"),
			"--target",
			"linux-x64",
			"--engine",
			"wasm",
		]);
		expect(code).toBe(1);
		expect(stdout).toBe("");
		expect(stderr).toContain("missing_file");
	}, 30_000);

	test("bad arguments print the usage with exit 64", async () => {
		for (const args of [
			[],
			[dir],
			[dir, "--target", "linux-x64", "--engine", "gpu"],
		]) {
			const { stderr, code } = await run(args);
			expect(code).toBe(64);
			expect(stderr).toContain("usage: maina model-selftest");
		}
	}, 30_000);
});
