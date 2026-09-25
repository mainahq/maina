/**
 * Issue #420: the external verify runners spawn through an injected
 * `ProcessPort`, so a runner can be exercised with the in-memory fake
 * instead of a real binary.
 */

import { describe, expect, test } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import { runSemgrep } from "../semgrep";
import { spawnTool } from "../tool-spawn";

const SARIF = JSON.stringify({
	runs: [
		{
			results: [
				{
					ruleId: "fake.rule",
					level: "error",
					message: { text: "fake semgrep finding" },
					locations: [
						{
							physicalLocation: {
								artifactLocation: { uri: "src/app.ts" },
								region: { startLine: 3 },
							},
						},
					],
				},
			],
		},
	],
});

describe("spawnTool over a ProcessPort", () => {
	test("returns the port's output and records the call in cwd", async () => {
		const proc = createFakeProcess({
			"semgrep --version": { exitCode: 1, stdout: "out", stderr: "err" },
		});
		const before = Date.now();
		const result = await spawnTool(["semgrep", "--version"], "/repo", proc);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			exitCode: 1,
			stdout: "out",
			stderr: "err",
		});
		expect(result.value.startedAt).toBeGreaterThanOrEqual(before);
		expect(proc.calls()).toEqual([
			{ argv: ["semgrep", "--version"], options: { cwd: "/repo" } },
		]);
	});

	test("a port spawn failure is a typed spawn-failed error", async () => {
		const result = await spawnTool(["trivy"], "/repo", createFakeProcess());
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "spawn-failed",
				command: "trivy",
				message: 'fake process: no response scripted for "trivy"',
			},
		});
	});

	test("a port timeout is a spawn-failed error naming the timeout", async () => {
		const result = await spawnTool(
			["stryker", "run"],
			"/repo",
			createFakeProcess(() => ({
				ok: false,
				error: { kind: "timeout", timeoutMs: 50 },
			})),
		);
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "spawn-failed",
				command: "stryker",
				message: "timed out after 50ms",
			},
		});
	});
});

describe("runners pass an injected ProcessPort to spawnTool", () => {
	test("runSemgrep parses findings from the fake process", async () => {
		const proc = createFakeProcess((argv) => ({
			ok: true,
			value: {
				exitCode: argv[0] === "/bin/semgrep" ? 1 : 127,
				stdout: SARIF,
				stderr: "",
			},
		}));
		const result = await runSemgrep({
			cwd: "/repo",
			available: true,
			command: "/bin/semgrep",
			process: proc,
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.message).toContain("fake semgrep finding");
		expect(proc.calls()[0]?.argv[0]).toBe("/bin/semgrep");
	});
});
