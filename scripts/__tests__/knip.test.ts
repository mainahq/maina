/**
 * Dead-code gate (#295).
 *
 * knip must report zero unused files, exports, types and dependencies,
 * and CI must run it as a failing check so the count cannot creep back.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

describe("knip gate", () => {
	test("CI runs knip as a failing step", () => {
		const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");
		expect(ci).toMatch(/^\s+run: bun run knip\s*$/m);
		expect(ci).not.toMatch(/knip[\s\S]{0,80}continue-on-error:\s*true/);
	});

	test("knip reports zero findings", () => {
		const proc = Bun.spawnSync(["bun", "run", "knip"], {
			cwd: ROOT,
			stdout: "pipe",
			stderr: "pipe",
		});
		const report = `${proc.stdout.toString()}${proc.stderr.toString()}`;
		expect({ exitCode: proc.exitCode, report }).toEqual({
			exitCode: 0,
			report: expect.not.stringMatching(/Unused|Unlisted|Unresolved/),
		});
	}, 180_000);
});
