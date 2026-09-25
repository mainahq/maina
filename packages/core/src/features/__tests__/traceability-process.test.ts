/** Issue #433: the default git log of `traceFeature` runs through a `ProcessPort`. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { traceFeature } from "../traceability";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("traceFeature over an injected ProcessPort", () => {
	test("finds the commit from `git log` run in the repo root", async () => {
		const root = mkdtempSync(join(tmpdir(), "maina-trace-proc-"));
		dirs.push(root);
		const featureDir = join(root, ".maina", "features", "001-x");
		mkdirSync(featureDir, { recursive: true });
		writeFileSync(join(featureDir, "plan.md"), "## Tasks\n\n- T001: Do it\n");

		const proc = createFakeProcess({
			"git log --oneline --all": { stdout: "abc1234 feat: T001 do it\n" },
		});
		const result = await traceFeature(featureDir, root, { process: proc });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.tasks[0]?.commitHash).toBe("abc1234");
		expect(proc.calls()[0]?.options.cwd).toBe(root);
	});
});
