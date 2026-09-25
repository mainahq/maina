/**
 * One Cursor hook run: raw stdin → `fromCursor` → the gate (or the session
 * summary) → `toCursor`. The ports are fakes here, except in the last block,
 * which runs the real rules-only gate.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURSOR_ALLOW_LIST_WARNING } from "../adapters/cursor";
import type { ClaudeHookPorts } from "../claude-hook";
import { runCursorHook } from "../cursor-hook";
import type { GateDecision, GateEvent } from "../gate";
import { systemGates } from "../gate-system";

const DIR = join(import.meta.dir, "..", "adapters", "__fixtures__", "cursor");
const raw = (name: string): string => readFileSync(join(DIR, name), "utf8");

function ports(overrides: Partial<ClaudeHookPorts> = {}): ClaudeHookPorts & {
	seen: GateEvent[];
} {
	const seen: GateEvent[] = [];
	return {
		seen,
		evaluate: async (event) => {
			seen.push(event);
			return { verdict: "allow", reason: "no rule matched" };
		},
		sessionSummary: async () => undefined,
		...overrides,
	};
}

const parsed = (stdout: string): unknown => JSON.parse(stdout);

describe("runCursorHook", () => {
	test("gates beforeShellExecution and renders the decision", async () => {
		const p = ports({
			evaluate: async (event) => {
				p.seen.push(event);
				return { verdict: "ask", reason: "confirm it" };
			},
		});
		const run = await runCursorHook(
			raw("before-shell-execution.input.json"),
			p,
			"beforeShellExecution",
		);
		expect(p.seen[0]?.kind).toBe("shell");
		expect(run.decision).toEqual({ verdict: "ask", reason: "confirm it" });
		expect(run.output.exitCode).toBe(0);
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "ask" });
		expect(run.output.stderr).toBe(`${CURSOR_ALLOW_LIST_WARNING}\n`);
	});

	test("a deny exits 2 with the reason on stderr", async () => {
		const run = await runCursorHook(
			raw("before-mcp-execution.stdio.input.json"),
			ports({
				evaluate: async () => ({ verdict: "deny", reason: "denied by rule" }),
			}),
			"beforeMCPExecution",
		);
		expect(run.output.exitCode).toBe(2);
		expect(run.output.stderr).toBe("denied by rule\n");
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "deny" });
	});

	test("input that is not JSON asks without calling the gate", async () => {
		const p = ports();
		const run = await runCursorHook("", p, "preToolUse");
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "ask" });
	});

	test("a gate that throws or answers the wrong shape never allows", async () => {
		const threw = await runCursorHook(
			raw("before-shell-execution.input.json"),
			ports({
				evaluate: async () => {
					throw new Error("boom");
				},
			}),
			"beforeShellExecution",
		);
		expect(threw.decision?.verdict).toBe("ask");
		expect(threw.decision?.reason).toContain("boom");
		const odd = await runCursorHook(
			raw("before-shell-execution.input.json"),
			ports({
				evaluate: async () => ({ verdict: "yes" }) as unknown as GateDecision,
			}),
			"beforeShellExecution",
		);
		expect(odd.decision?.verdict).toBe("ask");
	});

	test("a tool maina ignores is allowed without calling the gate", async () => {
		const p = ports();
		const run = await runCursorHook(
			raw("pre-tool-use.shell.input.json"),
			p,
			"preToolUse",
		);
		expect(p.seen).toHaveLength(0);
		expect(parsed(run.output.stdout)).toEqual({ permission: "allow" });
	});

	test("sessionStart adds the guardrails notice and the summary", async () => {
		const run = await runCursorHook(
			raw("session-start.input.json"),
			ports({ sessionSummary: async () => "maina session: 1 blocked" }),
			"sessionStart",
		);
		expect(parsed(run.output.stdout)).toEqual({
			additional_context:
				"maina guardrails active for this repository. maina session: 1 blocked",
		});
	});

	test("stop and afterFileEdit print {} and never fail", async () => {
		const stop = await runCursorHook(
			raw("stop.input.json"),
			ports({
				sessionSummary: async () => {
					throw new Error("db locked");
				},
			}),
			"stop",
		);
		expect(stop.output).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
		const p = ports();
		const edit = await runCursorHook(
			raw("after-file-edit.input.json"),
			p,
			"afterFileEdit",
		);
		expect(edit.output.stdout).toBe("{}\n");
		expect(p.seen).toHaveLength(0);
	});
});

describe("runCursorHook over the real rules-only gate", () => {
	let repo: string;
	const gate = systemGates().fallback;
	const real: ClaudeHookPorts = {
		evaluate: async (event) => gate(event),
		sessionSummary: async () => undefined,
	};

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-cursor-hook-"));
		Bun.spawnSync(["git", "init", "-q", repo]);
	});
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	const shell = (command: string): string =>
		JSON.stringify({
			...(parsed(raw("before-shell-execution.input.json")) as object),
			command,
			cwd: repo,
		});

	test("a plain command is allowed; a destructive one is not", async () => {
		const plain = await runCursorHook(
			shell("echo hello"),
			real,
			"beforeShellExecution",
		);
		expect(plain.decision?.verdict).toBe("allow");
		const destructive = await runCursorHook(
			shell("rm -rf /"),
			real,
			"beforeShellExecution",
		);
		expect(destructive.decision?.verdict).not.toBe("allow");
		expect(parsed(destructive.output.stdout)).not.toEqual({
			permission: "allow",
		});
	});
});
