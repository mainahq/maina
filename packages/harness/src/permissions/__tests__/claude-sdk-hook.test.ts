/**
 * The Claude Code `PreToolUse` hook (FR-HAR-2): defence in depth for a
 * Claude worker. In `bypassPermissions` mode the agent never sends
 * `session/request_permission`, so the ACP bridge never sees the call; the
 * hook, registered in the worktree's local settings, still runs before
 * every tool and its deny still blocks.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxOptions } from "../../sandbox/port";
import { resolveWorker } from "../../workers/registry";
import type { WorkerSpec } from "../../workers/spec";
import {
	answerClaudePreToolUse,
	installClaudePreToolUse,
	uninstallClaudePreToolUse,
} from "../claude-sdk-hook";
import { DENY_PUBLISH, type TestBridge, testBridge } from "./gate-fixture";

const ROOT = "/work/repo";

const probe = {
	which: (binary: string) => `/usr/local/bin/${binary}`,
	version: () => null,
};

function worker(name: string): WorkerSpec {
	const resolved = resolveWorker(name, probe);
	if (!resolved.ok) throw new Error(resolved.error.message);
	return resolved.value;
}

const payload = (
	tool: string,
	input: Record<string, unknown>,
	mode = "bypassPermissions",
) => ({
	session_id: "claude-session",
	transcript_path: "/tmp/t.jsonl",
	cwd: ROOT,
	permission_mode: mode,
	hook_event_name: "PreToolUse",
	tool_name: tool,
	tool_input: input,
});

let bridge: TestBridge;
beforeAll(async () => {
	bridge = await testBridge();
});

describe("answerClaudePreToolUse", () => {
	test("a denied Bash call is blocked in bypassPermissions mode: exit 2 and a deny", () => {
		bridge.records.length = 0;
		const out = answerClaudePreToolUse(
			bridge,
			ROOT,
			payload("Bash", { command: "npm publish" }),
		);
		expect(out.exitCode).toBe(2);
		expect(JSON.parse(out.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: expect.stringContaining("npm publish"),
			},
		});
		expect(out.stderr).toContain("npm publish");
		expect(bridge.records).toEqual([
			expect.objectContaining({
				source: "claude-hook",
				host: "claude-code",
				sessionId: "claude-session",
				toolCallId: "Bash",
				verdict: "deny",
				answer: "deny",
				gate: [
					expect.objectContaining({
						kind: "shell",
						permissionMode: "bypass",
					}),
				],
			}),
		]);
	});

	test("the permission mode never loosens a deny", () => {
		for (const mode of ["default", "acceptEdits", "plan", "dontAsk"]) {
			const out = answerClaudePreToolUse(
				bridge,
				ROOT,
				payload("Bash", { command: "npm publish" }, mode),
			);
			expect(out.exitCode).toBe(2);
		}
	});

	test("an allowed call prints {} so the host's own flow stands", () => {
		const out = answerClaudePreToolUse(
			bridge,
			ROOT,
			payload("Bash", { command: "ls -la" }),
		);
		expect(out).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
	});

	test("ask is a deny: a harness run has nobody to ask", () => {
		const out = answerClaudePreToolUse(
			bridge,
			ROOT,
			payload("Write", { file_path: "/etc/hosts", content: "0.0.0.0 x" }),
		);
		expect(out.exitCode).toBe(2);
		expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe(
			"deny",
		);
	});

	test("an Edit's new text reaches the gate as the write's content", () => {
		bridge.records.length = 0;
		answerClaudePreToolUse(
			bridge,
			ROOT,
			payload("Edit", {
				file_path: `${ROOT}/src/a.ts`,
				old_string: "a",
				new_string: "b",
			}),
		);
		expect(bridge.records[0]?.gate).toEqual([
			expect.objectContaining({
				kind: "file.write",
				action: { path: `${ROOT}/src/a.ts`, content: "b" },
			}),
		]);
	});

	test("MCP tools are gated by server and tool", () => {
		bridge.records.length = 0;
		const out = answerClaudePreToolUse(
			bridge,
			ROOT,
			payload("mcp__github__create_issue", { title: "x" }),
		);
		expect(out.exitCode).toBe(0);
		expect(bridge.records[0]?.gate).toEqual([
			expect.objectContaining({
				kind: "mcp",
				action: expect.objectContaining({
					server: "github",
					tool: "create_issue",
				}),
			}),
		]);
	});

	test("a Bash call without a command is opaque and denied", () => {
		const out = answerClaudePreToolUse(bridge, ROOT, payload("Bash", {}));
		expect(out.exitCode).toBe(2);
	});

	test("an unreadable payload is denied (fail closed) and still logged", () => {
		bridge.records.length = 0;
		for (const bad of [null, "x", { hook_event_name: "PreToolUse" }]) {
			expect(answerClaudePreToolUse(bridge, ROOT, bad).exitCode).toBe(2);
		}
		expect(bridge.records).toHaveLength(3);
		expect(bridge.records.every((r) => r.answer === "deny")).toBe(true);
	});
});

describe("installClaudePreToolUse", () => {
	function setup(): {
		worktree: string;
		stateDir: string;
		sandbox: SandboxOptions;
	} {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "maina-hook-")));
		const worktree = join(base, "worktrees", "run-1");
		const stateDir = join(base, "state");
		mkdirSync(worktree, { recursive: true });
		return {
			worktree,
			stateDir,
			sandbox: {
				writeAllow: [worktree],
				writeDeny: [join(base, "holdout")],
				readDeny: [],
				netAllow: [],
				credentials: [],
			},
		};
	}

	test("refuses a worker that is not Claude Code", () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installClaudePreToolUse(worker("codex"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(false);
		if (!installed.ok) expect(installed.error.code).toBe("unsupported_worker");
	});

	test("registers the hook for every tool in the worktree's local settings, keeping what is there", () => {
		const { worktree, stateDir, sandbox } = setup();
		mkdirSync(join(worktree, ".claude"));
		writeFileSync(
			join(worktree, ".claude", "settings.local.json"),
			JSON.stringify({
				permissions: { allow: ["Bash(ls:*)"] },
				disableAllHooks: true,
				hooks: {
					PreToolUse: [
						{ matcher: "Bash", hooks: [{ type: "command", command: "g.sh" }] },
					],
				},
			}),
		);
		const options = { worktree, stateDir, policy: DENY_PUBLISH, sandbox };
		const first = installClaudePreToolUse(worker("claude"), options);
		if (!first.ok) throw new Error(first.error.message);
		// Installing twice leaves one maina group, not two.
		const installed = installClaudePreToolUse(worker("claude"), options);
		if (!installed.ok) throw new Error(installed.error.message);

		const { settingsPath, command } = installed.value;
		expect(settingsPath).toBe(join(worktree, ".claude", "settings.local.json"));
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		expect(settings.permissions).toEqual({ allow: ["Bash(ls:*)"] });
		// A repo or user setting cannot switch the hook off: local wins.
		expect(settings.disableAllHooks).toBe(false);
		expect(settings.hooks.PreToolUse).toEqual([
			{ matcher: "Bash", hooks: [{ type: "command", command: "g.sh" }] },
			{
				matcher: "*",
				hooks: [{ type: "command", command, timeout: expect.any(Number) }],
			},
		]);
		expect(existsSync(installed.value.policyPath)).toBe(true);
	});

	test("the headless claude fallback gets the hook too", () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installClaudePreToolUse(worker("headless:claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(true);
	});

	test("the sandbox keeps the agent from unhooking itself or loosening the policy", () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installClaudePreToolUse(worker("claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		if (!installed.ok) throw new Error(installed.error.message);
		const { sandbox: guarded, policyPath, logPath } = installed.value;
		expect(guarded.writeDeny).toEqual([
			...(sandbox.writeDeny ?? []),
			join(worktree, ".claude"),
			policyPath,
		]);
		expect(guarded.writeAllow).toEqual([worktree, logPath]);
	});

	test("existing local settings are backed up before the first write; uninstall restores them byte for byte", () => {
		const { worktree, stateDir, sandbox } = setup();
		mkdirSync(join(worktree, ".claude"));
		const settingsPath = join(worktree, ".claude", "settings.local.json");
		const original = '{ "permissions": { "allow": ["Bash(ls:*)"] } }\n';
		writeFileSync(settingsPath, original);
		const options = { worktree, stateDir, policy: DENY_PUBLISH, sandbox };
		for (let i = 0; i < 2; i++) {
			const installed = installClaudePreToolUse(worker("claude"), options);
			if (!installed.ok) throw new Error(installed.error.message);
		}
		expect(readFileSync(settingsPath, "utf8")).not.toBe(original);

		expect(uninstallClaudePreToolUse(worktree).ok).toBe(true);
		expect(readFileSync(settingsPath, "utf8")).toBe(original);
		expect(readdirSync(join(worktree, ".claude"))).toEqual([
			"settings.local.json",
		]);
	});

	test("uninstall deletes local settings maina created, and is a no-op when nothing was installed", () => {
		const { worktree, stateDir, sandbox } = setup();
		expect(uninstallClaudePreToolUse(worktree).ok).toBe(true);
		const installed = installClaudePreToolUse(worker("claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		if (!installed.ok) throw new Error(installed.error.message);
		expect(uninstallClaudePreToolUse(worktree).ok).toBe(true);
		expect(existsSync(installed.value.settingsPath)).toBe(false);
	});

	test("unreadable local settings are an error, never overwritten", () => {
		const { worktree, stateDir, sandbox } = setup();
		mkdirSync(join(worktree, ".claude"));
		writeFileSync(join(worktree, ".claude", "settings.local.json"), "{nope");
		const installed = installClaudePreToolUse(worker("claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(false);
		if (!installed.ok) expect(installed.error.code).toBe("invalid_settings");
		expect(
			readFileSync(join(worktree, ".claude", "settings.local.json"), "utf8"),
		).toBe("{nope");
	});

	test("the installed command denies a bypass-mode call end to end, and logs it", async () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installClaudePreToolUse(worker("claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		if (!installed.ok) throw new Error(installed.error.message);
		const settings = JSON.parse(
			readFileSync(installed.value.settingsPath, "utf8"),
		);
		const command: string = settings.hooks.PreToolUse.at(-1).hooks[0].command;

		const runHook = async (input: unknown) => {
			// Claude Code runs a command hook through the shell, JSON on stdin.
			const child = Bun.spawn(["/bin/sh", "-c", command], {
				cwd: worktree,
				stdin: new Blob([JSON.stringify(input)]),
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				child.exited,
			]);
			return { stdout, exitCode };
		};

		const denied = await runHook({
			...payload("Bash", { command: "npm publish" }),
			cwd: worktree,
		});
		expect(denied.exitCode).toBe(2);
		expect(
			JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision,
		).toBe("deny");
		const allowed = await runHook({
			...payload("Bash", { command: "ls" }),
			cwd: worktree,
		});
		expect(allowed).toEqual({ exitCode: 0, stdout: "{}\n" });

		const log = readFileSync(installed.value.logPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(log.map((r) => [r.source, r.verdict])).toEqual([
			["claude-hook", "deny"],
			["claude-hook", "allow"],
		]);
	}, 30_000);
});
