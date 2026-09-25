/**
 * The repo's dogfood PreToolUse hook (#286, #309): the real Claude Code
 * adapter and fail-closed hook client, run from source, tightening only,
 * with every decision logged for the weekly report.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ClaudeHookPorts } from "../../../packages/runtime/src/claude-hook";
import { type LogRecord, runDogfoodHook } from "../hook";
import { parseLog } from "../report";

const ROOT = resolve(import.meta.dir, "../../..");
const NOW = "2026-09-25T10:00:00.000Z";

const bash = (command: string, cwd = "/work/maina"): string =>
	JSON.stringify({
		session_id: "s1",
		transcript_path: "/dev/null",
		cwd,
		permission_mode: "default",
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
		tool_use_id: "t1",
	});

function gate(
	verdict: "allow" | "ask" | "deny",
	reason = "why",
): ClaudeHookPorts {
	return {
		evaluate: async () => ({
			verdict,
			reason,
			decisionIds: [],
			degraded: false,
		}),
		sessionSummary: async () => undefined,
	};
}

async function run(
	raw: string,
	ports: ClaudeHookPorts,
	override = false,
): Promise<{
	out: Awaited<ReturnType<typeof runDogfoodHook>>;
	logged: LogRecord[];
}> {
	const logged: LogRecord[] = [];
	const out = await runDogfoodHook(raw, {
		ports,
		override,
		now: () => NOW,
		log: (record) => logged.push(record),
	});
	return { out, logged };
}

describe("runDogfoodHook", () => {
	test("an allow prints nothing, so Claude Code's own permission flow stands", async () => {
		const { out, logged } = await run(bash("bun test"), gate("allow", "ok"));
		expect(out).toEqual({ exitCode: 0, stdout: "", stderr: "" });
		expect(logged).toEqual([
			{
				ts: NOW,
				tool: "Bash",
				action: "bun test",
				verdict: "allow",
				reason: "ok",
			},
		]);
	});

	test("an ask is passed to Claude Code", async () => {
		const { out, logged } = await run(
			bash("rm -rf /"),
			gate("ask", "irreversible"),
		);
		expect(JSON.parse(out.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: "irreversible",
			},
		});
		expect(logged[0]?.verdict).toBe("ask");
	});

	test("a deny exits 2 with the reason on stderr", async () => {
		const { out, logged } = await run(bash("npm publish"), gate("deny", "no"));
		expect(out.exitCode).toBe(2);
		expect(out.stderr).toBe("no\n");
		expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe(
			"deny",
		);
		expect(logged[0]?.verdict).toBe("deny");
	});

	test("the override turns a deny into an ask and records it", async () => {
		const { out, logged } = await run(
			bash("npm publish"),
			gate("deny", "no"),
			true,
		);
		expect(out.exitCode).toBe(0);
		expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({
			permissionDecision: "ask",
			permissionDecisionReason: "[override] no",
		});
		expect(logged[0]).toMatchObject({
			verdict: "ask",
			reason: "[override] no",
			override: true,
		});
	});

	test("malformed stdin asks and is logged as a hook crash", async () => {
		const { out, logged } = await run("{nope", gate("allow"));
		expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe(
			"ask",
		);
		expect(logged[0]?.verdict).toBe("ask");
		expect(logged[0]?.reason.startsWith("hook crash")).toBe(true);
		expect(logged[0]?.tool).toBe("unknown");
	});

	test("a gate that throws asks", async () => {
		const { out } = await run(bash("ls"), {
			evaluate: async () => {
				throw new Error("boom");
			},
			sessionSummary: async () => undefined,
		});
		expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe(
			"ask",
		);
	});

	test("long actions are truncated in the log", async () => {
		const { logged } = await run(
			bash(`echo ${"x".repeat(300)}`),
			gate("allow"),
		);
		expect(logged[0]?.action.length).toBe(200);
		expect(logged[0]?.action.endsWith("...")).toBe(true);
	});

	test("records are what the weekly report reads", async () => {
		const { logged } = await run(bash("ls"), gate("ask"));
		const text = logged.map((r) => JSON.stringify(r)).join("\n");
		expect(parseLog(text)).toEqual({ records: logged, malformed: 0 });
	});

	test("a tool maina does not gate is left alone and not logged", async () => {
		const { out, logged } = await run(
			JSON.stringify({
				session_id: "s1",
				cwd: "/work/maina",
				hook_event_name: "PreToolUse",
				tool_name: "TodoWrite",
				tool_input: { todos: [] },
			}),
			gate("deny"),
		);
		expect(out).toEqual({ exitCode: 0, stdout: "", stderr: "" });
		expect(logged).toEqual([]);
	});
});

// ── The settings.json wiring, end to end ──────────────────────────────────

function hookCommand(): string {
	const settings = JSON.parse(
		readFileSync(join(ROOT, ".claude/settings.json"), "utf-8"),
	);
	const cmd = settings.hooks.PreToolUse[0]?.hooks[0]?.command;
	expect(typeof cmd).toBe("string");
	return cmd as string;
}

async function runShell(
	stdin: string,
	env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["sh", "-c", hookCommand()], {
		stdin: new Blob([stdin]),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

describe("repo wiring", () => {
	const scratch = mkdtempSync(join(tmpdir(), "maina-dogfood-"));
	const runtimeDir = join(scratch, "rt");

	afterAll(() => {
		// Stop the runtime the end-to-end test spawned.
		const dir = join(runtimeDir, "maina");
		const pidFiles = existsSync(dir)
			? readdirSync(dir).filter((name) => name.endsWith(".pid"))
			: [];
		for (const name of pidFiles) {
			try {
				process.kill(JSON.parse(readFileSync(join(dir, name), "utf8")).pid);
			} catch {
				// Already gone.
			}
		}
		rmSync(scratch, { recursive: true, force: true });
	});

	test("the hook runs the real gate: a destructive command asks, and is logged", async () => {
		const log = join(scratch, "log.jsonl");
		const out = await runShell(bash("rm -rf /", ROOT), {
			CLAUDE_PROJECT_DIR: ROOT,
			MAINA_DOGFOOD_LOG: log,
			XDG_RUNTIME_DIR: runtimeDir,
		});
		expect(out.code).toBe(0);
		expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({
			hookEventName: "PreToolUse",
			permissionDecision: "ask",
		});
		const record = JSON.parse(readFileSync(log, "utf-8").trim());
		expect(record).toMatchObject({
			tool: "Bash",
			action: "rm -rf /",
			verdict: "ask",
		});
	}, 20_000);

	test("fails closed to ask when the hook cannot run", async () => {
		const empty = join(scratch, "empty");
		mkdirSync(empty);
		const out = await runShell(bash("ls"), { CLAUDE_PROJECT_DIR: empty });
		expect(out.code).toBe(0);
		expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe(
			"ask",
		);
	});

	test("keeps a deny's exit 2 and stderr", async () => {
		const fake = join(scratch, "fake");
		mkdirSync(join(fake, "scripts", "dogfood"), { recursive: true });
		writeFileSync(
			join(fake, "scripts", "dogfood", "hook.ts"),
			'process.stderr.write("denied by maina\\n"); process.exit(2);\n',
		);
		const out = await runShell(bash("ls"), { CLAUDE_PROJECT_DIR: fake });
		expect(out.code).toBe(2);
		expect(out.stderr).toBe("denied by maina\n");
		expect(out.stdout).toBe("");
	});
});
