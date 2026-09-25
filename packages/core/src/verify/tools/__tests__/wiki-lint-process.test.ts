/**
 * Issue #433: the missing-rationale check counts commits with `git log`
 * through an injected `ProcessPort` (it used `Bun.spawnSync`).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../../ports/testing";
import { runWikiLint } from "../wiki-lint";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("runWikiLint over an injected ProcessPort", () => {
	test("flags a busy file without an ADR from `git log` run in the repo root", async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), "maina-wikilint-proc-"));
		dirs.push(repoRoot);
		const wikiDir = join(repoRoot, ".maina", "wiki");
		mkdirSync(wikiDir, { recursive: true });
		writeFileSync(
			join(wikiDir, ".state.json"),
			JSON.stringify({
				fileHashes: { "src/busy.ts": "h" },
				articleHashes: {},
				lastFullCompile: "",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			}),
		);
		const proc = createFakeProcess({
			"git log --oneline --follow -- src/busy.ts": {
				stdout: "a1 one\nb2 two\nc3 three\nd4 four\ne5 five\n",
			},
		});

		const result = await runWikiLint({ wikiDir, repoRoot, process: proc });

		expect(result.missingRationale.map((f) => f.message)).toEqual([
			'Missing rationale: "src/busy.ts" changed in 5 commits, no architecture decision recorded',
		]);
		expect(proc.calls()[0]?.options.cwd).toBe(repoRoot);
	});
});
