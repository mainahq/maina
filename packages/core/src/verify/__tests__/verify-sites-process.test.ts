/**
 * Issue #433: the remaining verify spawn sites (tool detection, syntax
 * guard, visual screenshots, proof test run) go through an injected
 * `ProcessPort` instead of `Bun.spawn`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile } from "../../language/profile";
import { createFakeProcess } from "../../ports/testing";
import { detectTool, detectTools } from "../detect";
import type { PipelineResult } from "../pipeline";
import { gatherVerificationProof } from "../proof";
import { syntaxGuard } from "../syntax-guard";
import { captureScreenshot } from "../visual";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "maina-verify-proc-"));
	dirs.push(dir);
	return dir;
}

describe("tool detection over a ProcessPort", () => {
	test("detectTool parses the version reported through the port, in the root", async () => {
		const proc = createFakeProcess({
			"semgrep --version": { stdout: "1.2.3\n" },
		});
		expect(await detectTool("semgrep", "/repo", proc)).toEqual({
			name: "semgrep",
			command: "semgrep",
			version: "1.2.3",
			available: true,
		});
		expect(proc.calls()[0]?.options.cwd).toBe("/repo");
	});

	test("detectTools passes the port to every probe", async () => {
		const proc = createFakeProcess();
		const tools = await detectTools("/repo", ["typescript"], proc);
		expect(tools.every((t) => !t.available)).toBe(true);
		expect(proc.calls().length).toBeGreaterThan(0);
	});
});

describe("syntaxGuard over a ProcessPort", () => {
	test("rejects on biome errors read from the port's stdout", async () => {
		const root = scratch();
		const report = JSON.stringify({
			diagnostics: [
				{
					severity: "error",
					message: "Unexpected token",
					location: { path: "a.ts", start: { line: 2, column: 5 } },
				},
			],
		});
		const proc = createFakeProcess(() => ({
			ok: true,
			value: { exitCode: 1, stdout: report, stderr: "" },
		}));
		const result = await syntaxGuard(["a.ts"], root, undefined, proc);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]?.message).toBe("Unexpected token");
		const [call] = proc.calls();
		expect(call?.argv).toContain("--reporter=json");
		expect(call?.options.cwd).toBe(root);
	});

	test("a biome that cannot start is reported as a syntax error", async () => {
		const result = await syntaxGuard(
			["a.ts"],
			scratch(),
			undefined,
			createFakeProcess(),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]?.message).toStartWith("Failed to run biome:");
	});

	test("language linters also run through the port", async () => {
		const proc = createFakeProcess(() => ({
			ok: true,
			value: { exitCode: 0, stdout: "[]", stderr: "" },
		}));
		const result = await syntaxGuard(
			["a.py"],
			"/repo",
			getProfile("python"),
			proc,
		);
		expect(result.ok).toBe(true);
		expect(proc.calls()[0]?.options.cwd).toBe("/repo");
	});
});

describe("captureScreenshot over a ProcessPort", () => {
	test("runs playwright in the root and reports the capture", async () => {
		const root = scratch();
		const out = join(root, "shots", "home.png");
		const proc = createFakeProcess(() => ({
			ok: true,
			value: { exitCode: 0, stdout: "", stderr: "" },
		}));
		expect(
			await captureScreenshot("http://localhost:3000", out, {
				root,
				available: true,
				process: proc,
			}),
		).toEqual({ captured: true, skipped: false, path: out });
		const [call] = proc.calls();
		expect(call?.argv.slice(0, 3)).toEqual(["npx", "playwright", "screenshot"]);
		expect(call?.options.cwd).toBe(root);
	});

	test("a playwright that cannot start is skipped", async () => {
		const root = scratch();
		const result = await captureScreenshot(
			"http://localhost:3000",
			join(root, "home.png"),
			{ root, available: true, process: createFakeProcess() },
		);
		expect(result.captured).toBe(false);
		expect(result.skipped).toBe(true);
	});
});

describe("gatherVerificationProof over a ProcessPort", () => {
	test("reads the test counts from `bun test` run through the port", async () => {
		const root = scratch();
		const pipelineResult: PipelineResult = {
			status: "passed",
			passed: true,
			scope: { kind: "working-tree", files: ["a.ts"] },
			syntaxPassed: true,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: 0,
			cacheHits: 0,
			cacheMisses: 0,
		};
		const proc = createFakeProcess({
			"bun test": { stdout: "12 pass, 1 fail across 3 files." },
		});
		const proof = await gatherVerificationProof({
			cwd: root,
			pipelineResult,
			skipVisual: true,
			process: proc,
		});
		expect(proof.tests).toEqual({ passed: 12, failed: 1, files: 3 });
		expect(proc.calls()[0]?.options.cwd).toBe(root);
	});
});
