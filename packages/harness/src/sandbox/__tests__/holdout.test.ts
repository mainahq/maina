/**
 * Holdout scenarios (FR-FAC-4) are hidden from workers by the sandbox
 * (FR-SBX-2, Task 4B.3): the directory core's `runHoldout` reads is the one
 * the worker's sandbox denies.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { DEFAULT_POLICY, holdoutDir, holdoutFeatureDir } from "@mainahq/core";
import { policyToSandbox } from "../policy-to-sandbox";
import { createSandboxRuntime } from "../runtime-adapter";
import { integrationTitle, run, SKIP_REASON, shell } from "./sandbox-fixture";

const covers = (dir: string, path: string): boolean =>
	path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);

describe("holdout scenarios can't be read from inside a worker sandbox", () => {
	const ROOT = "/work";
	const WORKTREE = "/work/.maina/worktrees/run-1";
	const scenario = join(holdoutFeatureDir(ROOT, "012-export"), "checkout.md");

	const sandbox = () => {
		const result = policyToSandbox(DEFAULT_POLICY, WORKTREE, holdoutDir(ROOT), {
			home: "/home/dev",
		});
		if (!result.ok) throw new Error(result.error.message);
		return result.value;
	};

	test("the scenario file sits under a read deny and under no read allow", () => {
		const options = sandbox();
		expect(options.readDeny.some((dir) => covers(dir, scenario))).toBe(true);
		expect((options.readAllow ?? []).some((dir) => covers(dir, scenario))).toBe(
			false,
		);
	});

	test("the worker can't write scenarios either", () => {
		const options = sandbox();
		expect(options.writeAllow.some((dir) => covers(dir, scenario))).toBe(false);
		expect((options.writeDeny ?? []).some((dir) => covers(dir, scenario))).toBe(
			true,
		);
	});
});

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("holdout under a real srt (integration)"),
	() => {
		test("a sandboxed worker reading a holdout scenario gets nothing", async () => {
			const root = realpathSync(mkdtempSync(join(tmpdir(), "maina-holdout-")));
			const home = join(root, "home");
			const worktree = join(root, ".maina", "worktrees", "run-1");
			const featureDir = holdoutFeatureDir(root, "012-export");
			for (const dir of [home, worktree, featureDir]) {
				mkdirSync(dir, { recursive: true });
			}
			const scenario = join(featureDir, "checkout.md");
			writeFileSync(scenario, "HOLDOUT-SCENARIO-321\n");
			writeFileSync(join(worktree, "README.md"), "own worktree\n");

			const options = policyToSandbox(
				DEFAULT_POLICY,
				worktree,
				holdoutDir(root),
				{ home },
			);
			if (!options.ok) throw new Error(options.error.message);
			const wrapped = createSandboxRuntime().wrap(
				shell(`cat '${join(worktree, "README.md")}'; cat '${scenario}'`),
				{ ...options.value, credentials: [] },
			);
			if (!wrapped.ok) throw new Error(wrapped.error.message);
			const ran = await run(wrapped.value, worktree);
			expect(ran.stdout).toContain("own worktree");
			expect(ran.stdout).not.toContain("HOLDOUT-SCENARIO-321");
		}, 30_000);
	},
);
