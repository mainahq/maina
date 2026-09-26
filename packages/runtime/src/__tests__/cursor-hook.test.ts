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
			return {
				verdict: "allow",
				reason: "no rule matched",
				decisionIds: [],
				degraded: false,
			};
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
				return {
					verdict: "ask",
					reason: "confirm it",
					decisionIds: [],
					degraded: false,
				};
			},
		});
		const run = await runCursorHook(
			raw("before-shell-execution.input.json"),
			p,
			"beforeShellExecution",
		);
		expect(p.seen[0]?.kind).toBe("shell");
		expect(run.decision).toEqual({
			verdict: "ask",
			reason: "confirm it",
			decisionIds: [],
			degraded: false,
		});
		expect(run.output.exitCode).toBe(0);
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "ask" });
		expect(run.output.stderr).toBe(`${CURSOR_ALLOW_LIST_WARNING}\n`);
	});

	test("a deny exits 2 with the reason on stderr", async () => {
		const run = await runCursorHook(
			raw("before-mcp-execution.stdio.input.json"),
			ports({
				evaluate: async () => ({
					verdict: "deny",
					reason: "denied by rule",
					decisionIds: [],
					degraded: false,
				}),
			}),
			"beforeMCPExecution",
		);
		expect(run.output.exitCode).toBe(2);
		expect(run.output.stderr).toBe("denied by rule\n");
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "deny" });
	});

	test("input that is not JSON asks without calling the gate", async () => {
		const p = ports();
		const run = await runCursorHook("", p, "beforeShellExecution");
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "ask" });
	});

	test("a preToolUse ask blocks (exit 2), since Cursor would run the tool anyway (#469)", async () => {
		const p = ports({
			evaluate: async (event) => {
				p.seen.push(event);
				return {
					verdict: "ask",
					reason: "file.write outside the workspace; asking",
					decisionIds: ["d-3"],
					degraded: false,
				};
			},
		});
		const write = JSON.stringify({
			...(parsed(raw("pre-tool-use.write.input.json")) as object),
			tool_input: { file_path: "/etc/hosts", content: "x" },
		});
		const run = await runCursorHook(write, p, "preToolUse");
		expect(p.seen[0]?.kind).toBe("file.write");
		// The gate's verdict is kept as it was; only the rendering changes.
		expect(run.decision?.verdict).toBe("ask");
		expect(run.output.exitCode).toBe(2);
		const body = parsed(run.output.stdout) as Record<string, string>;
		expect(body.permission).toBe("deny");
		expect(body.user_message).toContain("maina allow d-3 --always");
	});

	test("an unreadable preToolUse payload blocks without calling the gate", async () => {
		const p = ports();
		const run = await runCursorHook(
			raw("pre-tool-use.write.input.json"),
			p,
			"preToolUse",
		);
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.output.exitCode).toBe(2);
		expect(parsed(run.output.stdout)).toMatchObject({ permission: "deny" });
		// The gate never ran, so no policy rule can let a retry through.
		const body = parsed(run.output.stdout) as Record<string, string>;
		expect(body.user_message).not.toContain("policy");
		expect(body.user_message).not.toContain("confirm it yourself");
		expect(body.user_message).toContain("make this change yourself");
		const empty = await runCursorHook("", p, "preToolUse");
		expect(empty.output.exitCode).toBe(2);
		expect(parsed(empty.output.stdout)).toMatchObject({ permission: "deny" });
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

	test("stop does not read the session summary, which its output cannot carry", async () => {
		let summarised = 0;
		const run = await runCursorHook(
			raw("stop.input.json"),
			ports({
				sessionSummary: async () => {
					summarised += 1;
					return "maina session: 1 blocked";
				},
			}),
			"stop",
		);
		expect(summarised).toBe(0);
		expect(run.output.stdout).toBe("{}\n");
	});

	// #480: Cursor's stop runs verify too; a failed one is a follow-up.
	test("stop sends session.stop to verify and follows up on a failure", async () => {
		const sent: GateEvent[] = [];
		const reason =
			"maina verify failed on changed lines; fix before finishing.";
		const run = await runCursorHook(
			raw("stop.input.json"),
			ports({
				stopVerify: async (event) => {
					sent.push(event);
					return { verdict: "deny", reason, decisionIds: [], degraded: false };
				},
			}),
			"stop",
		);
		expect(sent).toEqual([
			{
				kind: "session.stop",
				input: {
					host: "cursor",
					sessionId: "668320d2-2fd8-4888-b33c-2a466fec86e7",
				},
				cwd: "/home/user/project",
			},
		]);
		expect(parsed(run.output.stdout)).toEqual({ followup_message: reason });
	});

	test("a stop verify notice goes to stderr, which Cursor's stop output cannot carry", async () => {
		const notice =
			"maina verify did not finish within 120 s, so this session's changes were not verified; run maina verify yourself.";
		const run = await runCursorHook(
			raw("stop.input.json"),
			ports({
				stopVerify: async () => ({
					verdict: "allow",
					reason: notice,
					decisionIds: [],
					degraded: true,
				}),
			}),
			"stop",
		);
		expect(run.output).toEqual({
			exitCode: 0,
			stdout: "{}\n",
			stderr: `${notice}\n`,
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
