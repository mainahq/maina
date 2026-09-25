/**
 * One Claude Code hook run: raw stdin → `fromClaude` → the gate (or the
 * session summary) → `toClaude`. The ports are fakes here, except in the
 * last block, which runs the real rules-only gate over the fixtures.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClaudeHookPorts, runClaudeHook } from "../claude-hook";
import type { GateDecision, GateEvent } from "../gate";
import { systemGates } from "../gate-system";

const DIR = join(
	import.meta.dir,
	"..",
	"adapters",
	"__fixtures__",
	"claude-code",
);
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

describe("runClaudeHook", () => {
	test("gates a PreToolUse event and renders the decision", async () => {
		const p = ports({
			evaluate: async () => ({ verdict: "ask", reason: "confirm it" }),
		});
		const run = await runClaudeHook(raw("pre-tool-use.bash.input.json"), p);
		expect(run.decision).toEqual({ verdict: "ask", reason: "confirm it" });
		expect(run.output.exitCode).toBe(0);
		expect(parsed(run.output.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: "confirm it",
			},
		});
	});

	test("passes the normalised event to the gate", async () => {
		const p = ports();
		await runClaudeHook(raw("pre-tool-use.write.input.json"), p);
		expect(p.seen).toHaveLength(1);
		expect(p.seen[0]?.kind).toBe("file.write");
		expect(p.seen[0]?.cwd).toBe("/home/user/project");
	});

	test("a deny exits 2 with the reason on stderr", async () => {
		const p = ports({
			evaluate: async () => ({ verdict: "deny", reason: "denied by rule" }),
		});
		const run = await runClaudeHook(raw("pre-tool-use.bash.input.json"), p);
		expect(run.output.exitCode).toBe(2);
		expect(run.output.stderr).toBe("denied by rule\n");
	});

	test("input that is not JSON asks without calling the gate", async () => {
		const p = ports();
		const run = await runClaudeHook("{not json", p, "PreToolUse");
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(parsed(run.output.stdout)).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
			},
		});
	});

	test("a malformed tool call asks", async () => {
		const p = ports();
		const run = await runClaudeHook(
			raw("invalid/pre-tool-use.bash-without-command.input.json"),
			p,
		);
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.output.exitCode).toBe(0);
		expect(parsed(run.output.stdout)).toMatchObject({
			hookSpecificOutput: { permissionDecision: "ask" },
		});
	});

	test("with no event anywhere, malformed input still asks", async () => {
		const run = await runClaudeHook("[]", ports());
		expect(parsed(run.output.stdout)).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
			},
		});
	});

	test("a gate that throws or allows on an error path never allows", async () => {
		const run = await runClaudeHook(
			raw("pre-tool-use.bash.input.json"),
			ports({
				evaluate: async () => {
					throw new Error("boom");
				},
			}),
		);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.decision?.reason).toContain("boom");
	});

	test("a gate answer of the wrong shape asks", async () => {
		const run = await runClaudeHook(
			raw("pre-tool-use.bash.input.json"),
			ports({
				evaluate: async () => ({ verdict: "yes" }) as unknown as GateDecision,
			}),
		);
		expect(run.decision?.verdict).toBe("ask");
	});

	test("SessionStart adds the guardrails notice, with the summary on resume", async () => {
		const fresh = await runClaudeHook(
			raw("session-start.startup.input.json"),
			ports(),
		);
		expect(parsed(fresh.output.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: "maina guardrails active for this repository.",
			},
		});
		const resumed = await runClaudeHook(
			raw("session-start.startup.input.json"),
			ports({
				sessionSummary: async () =>
					"maina session: 1 blocked, 0 asked, 2 allowed",
			}),
		);
		expect(parsed(resumed.output.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext:
					"maina guardrails active for this repository. maina session: 1 blocked, 0 asked, 2 allowed",
			},
		});
	});

	test("Stop shows the session summary, and stays silent without one", async () => {
		const asked: string[] = [];
		const run = await runClaudeHook(
			raw("stop.input.json"),
			ports({
				sessionSummary: async (event) => {
					asked.push(event.sessionId);
					return "maina session: 0 blocked, 1 asked, 4 allowed";
				},
			}),
		);
		expect(asked).toEqual(["68888356-74b4-4638-9a07-3ca70c36e753"]);
		expect(parsed(run.output.stdout)).toEqual({
			systemMessage: "maina session: 0 blocked, 1 asked, 4 allowed",
		});
		const silent = await runClaudeHook(raw("stop.input.json"), ports());
		expect(silent.output.stdout).toBe("{}\n");
	});

	test("a failing summary never blocks a stop", async () => {
		const run = await runClaudeHook(
			raw("stop.input.json"),
			ports({
				sessionSummary: async () => {
					throw new Error("db locked");
				},
			}),
		);
		expect(run.output).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
	});

	test("PostToolUse and ungated tools print {}", async () => {
		const p = ports();
		const run = await runClaudeHook(raw("post-tool-use.bash.input.json"), p);
		expect(run.output.stdout).toBe("{}\n");
		expect(p.seen).toHaveLength(0);
	});
});

describe("runClaudeHook over the real rules-only gate", () => {
	let repo: string;
	const gate = systemGates().fallback;
	const real: ClaudeHookPorts = {
		evaluate: async (event) => gate(event),
		sessionSummary: async () => undefined,
	};

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-claude-hook-"));
		Bun.spawnSync(["git", "init", "-q", repo]);
	});
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	const bash = (command: string): string =>
		JSON.stringify({
			session_id: "s1",
			transcript_path: "/dev/null",
			cwd: repo,
			permission_mode: "default",
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command },
			tool_use_id: "t1",
		});

	const read = (file_path: string): string =>
		JSON.stringify({
			session_id: "s1",
			cwd: repo,
			permission_mode: "default",
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path },
		});

	test("a plain command is allowed", async () => {
		const run = await runClaudeHook(bash("echo hello"), real);
		expect(run.decision?.verdict).toBe("allow");
	});

	test("a destructive command is not allowed", async () => {
		const run = await runClaudeHook(bash("rm -rf /"), real);
		expect(run.decision?.verdict).not.toBe("allow");
	});

	test("reading a workspace file is allowed; secrets and outside files are not", async () => {
		expect(
			(await runClaudeHook(read(join(repo, "src/index.ts")), real)).decision
				?.verdict,
		).toBe("allow");
		expect(
			(await runClaudeHook(read(join(repo, ".env")), real)).decision?.verdict,
		).not.toBe("allow");
		expect(
			(await runClaudeHook(read("/etc/hosts"), real)).decision?.verdict,
		).not.toBe("allow");
	});

	test("a Grep whose glob names a secret file is not allowed", async () => {
		const grep = (toolInput: Record<string, unknown>): string =>
			JSON.stringify({
				session_id: "s1",
				cwd: repo,
				permission_mode: "default",
				hook_event_name: "PreToolUse",
				tool_name: "Grep",
				tool_input: { pattern: "KEY", ...toolInput },
			});
		for (const glob of [".env", ".env*", "**/*.pem"]) {
			expect(
				(await runClaudeHook(grep({ glob }), real)).decision?.verdict,
				glob,
			).not.toBe("allow");
		}
		expect(
			(await runClaudeHook(grep({ glob: "*.ts" }), real)).decision?.verdict,
		).toBe("allow");
	});
});
