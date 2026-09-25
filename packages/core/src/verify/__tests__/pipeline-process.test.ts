/**
 * Issue #433: `runPipeline` threads the caller's `ProcessPort`
 * (`CorePorts.process`) into every tool it starts: the syntax guard, tool
 * detection, the external runners, the type checker and wiki lint. Git
 * reads use the git module's `GitPort` and are out of scope here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { runPipeline } from "../pipeline";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("runPipeline over an injected ProcessPort", () => {
	test("every tool process goes through the injected port", async () => {
		const root = mkdtempSync(join(tmpdir(), "maina-pipeline-proc-"));
		dirs.push(root);
		writeFileSync(join(root, "tsconfig.json"), "{}\n");
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		const wikiDir = join(root, ".maina", "wiki");
		mkdirSync(wikiDir, { recursive: true });
		writeFileSync(
			join(wikiDir, ".state.json"),
			JSON.stringify({
				fileHashes: { "a.ts": "h" },
				articleHashes: {},
				lastFullCompile: "",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			}),
		);

		const proc = createFakeProcess((argv) => ({
			ok: true,
			value: {
				exitCode: 0,
				stdout:
					argv[0] === "semgrep" && argv[1] === "--version" ? "1.0.0\n" : "",
				stderr: "",
			},
		}));

		await runPipeline({
			cwd: root,
			files: ["a.ts"],
			diffOnly: false,
			languages: ["typescript"],
			process: proc,
		});

		const argvs = proc.calls().map((c) => c.argv);
		const spawned = (match: (argv: readonly string[]) => boolean): boolean =>
			argvs.some(match);
		expect(spawned((a) => a.includes("--reporter=json"))).toBe(true);
		expect(spawned((a) => a[0] === "semgrep" && a[1] === "--version")).toBe(
			true,
		);
		expect(spawned((a) => a[0] === "semgrep" && a[1] !== "--version")).toBe(
			true,
		);
		expect(spawned((a) => a.includes("--noEmit"))).toBe(true);
		expect(spawned((a) => a[0] === "git" && a.includes("--follow"))).toBe(true);
	});
});
