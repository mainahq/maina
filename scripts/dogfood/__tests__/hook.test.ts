/**
 * The repo's dogfood PreToolUse hook (#286, #309): the real Claude Code
 * adapter and fail-closed hook client, run from source, tightening only,
 * with every decision logged for the weekly report; and the outcome hook
 * (`outcome.ts`), which logs which gated calls ran, so an ask's outcome can
 * be read off the log.
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
import { dirname, join, resolve } from "node:path";
import { parseGateLog } from "../../../packages/core/src/digest/build";
import { CLAUDE_HOOK_MAP } from "../../../packages/runtime/src/adapters/claude-code";
import type { ClaudeHookPorts } from "../../../packages/runtime/src/claude-hook";
import { systemGates } from "../../../packages/runtime/src/gate-system";
import { type LogRecord, runDogfoodHook } from "../hook";
import {
	CLAUDE_HOST,
	GATED_TOOLS,
	type OutcomeRecord,
	runDogfoodPostHook,
} from "../outcome";
import { askOutcomes } from "../report";

const ROOT = resolve(import.meta.dir, "../../..");
const NOW = "2026-09-25T10:00:00.000Z";

const bash = (
	command: string,
	cwd = "/work/maina",
	permissionMode = "default",
): string =>
	JSON.stringify({
		session_id: "s1",
		transcript_path: "/dev/null",
		cwd,
		permission_mode: permissionMode,
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
		tool_use_id: "t1",
	});

function gate(
	verdict: "allow" | "ask" | "deny",
	reason = "why",
	decisionIds: readonly string[] = [],
): ClaudeHookPorts {
	return {
		evaluate: async () => ({
			verdict,
			reason,
			decisionIds,
			degraded: false,
		}),
		sessionSummary: async () => undefined,
	};
}

/** The workspace root for any directory under /work/maina, as git would say. */
const workRoot = (cwd: string): string | null =>
	cwd === "/work/maina" || cwd.startsWith("/work/maina/")
		? "/work/maina"
		: null;

async function run(
	raw: string,
	ports: ClaudeHookPorts,
	override = false,
	rootOf: (cwd: string) => string | null = workRoot,
): Promise<{
	out: Awaited<ReturnType<typeof runDogfoodHook>>;
	logged: LogRecord[];
}> {
	const logged: LogRecord[] = [];
	const out = await runDogfoodHook(raw, {
		ports,
		override,
		now: () => NOW,
		rootOf,
		log: (record) => logged.push(record),
	});
	return { out, logged };
}

describe("runDogfoodHook", () => {
	test("an allow is passed to Claude Code (#459)", async () => {
		const { out, logged } = await run(bash("bun test"), gate("allow", "ok"));
		expect(out.exitCode).toBe(0);
		expect(out.stderr).toBe("");
		expect(JSON.parse(out.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
				permissionDecisionReason: "ok",
			},
		});
		expect(logged).toEqual([
			{
				ts: NOW,
				tool: "Bash",
				action: "bun test",
				verdict: "allow",
				reason: "ok",
				root: "/work/maina",
				host: "claude-code",
				permissionMode: "default",
				decisionIds: [],
				toolUseId: "t1",
				sessionId: "s1",
			},
		]);
	});

	// FR-S1-4, FR-DOG-3: the ids pair a pre record with the post hook's `ran`
	// record, which says whether an ask was approved.
	test("records carry the tool use and session ids from the payload", async () => {
		const { logged } = await run(bash("rm -rf dist"), gate("ask"));
		expect(logged[0]).toMatchObject({ toolUseId: "t1", sessionId: "s1" });
	});

	test("ids absent from the payload are left out of the record", async () => {
		const { logged } = await run(
			JSON.stringify({
				cwd: "/work/maina",
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command: "ls" },
				session_id: 7,
			}),
			gate("allow"),
		);
		expect(logged).toHaveLength(1);
		expect(logged[0]).not.toHaveProperty("toolUseId");
		expect(logged[0]).not.toHaveProperty("sessionId");
	});

	test("malformed stdin logs no ids", async () => {
		const { logged } = await run("{nope", gate("allow"));
		expect(logged[0]).not.toHaveProperty("toolUseId");
		expect(logged[0]).not.toHaveProperty("sessionId");
	});

	// #584: the exporter rebuilds the event under its workspace root (so
	// absolute paths are not relabelled as outside it) and joins the record
	// to `decision_outcome` by decision id.
	test("records carry the root, host, permission mode and decision ids (#584)", async () => {
		const { logged } = await run(
			bash("rm -rf dist", "/work/maina/packages/core", "acceptEdits"),
			gate("ask", "irreversible", ["d-1", "d-1:reversed"]),
		);
		expect(logged[0]).toMatchObject({
			root: "/work/maina",
			host: "claude-code",
			permissionMode: "accept_edits",
			decisionIds: ["d-1", "d-1:reversed"],
		});
	});

	// Outside a repository the gate has no root: it asks without evaluating.
	// The log claims none either; the host's directory would be a guess the
	// exporter then rebuilds the event under.
	test("the root is empty outside a repository (#584)", async () => {
		const { logged } = await run(bash("ls", "/tmp/scratch"), gate("allow"));
		expect(logged).toHaveLength(1);
		expect(logged[0]?.root).toBe("");
	});

	test("a root lookup that throws leaves the root empty (#584)", async () => {
		const { logged } = await run(
			bash("ls", "/work/maina/scripts"),
			gate("allow"),
			false,
			() => {
				throw new Error("git missing");
			},
		);
		expect(logged).toHaveLength(1);
		expect(logged[0]?.root).toBe("");
	});

	test("an unknown permission mode is logged as unknown (#584)", async () => {
		const { logged } = await run(
			bash("ls", "/work/maina", "yolo"),
			gate("allow"),
		);
		expect(logged[0]?.permissionMode).toBe("unknown");
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
				// The adapter's gate message (#497), as `maina hook` prints it.
				permissionDecisionReason:
					"maina ask: irreversible (confidence high) | override: approve it at the prompt",
			},
		});
		expect(logged[0]?.verdict).toBe("ask");
	});

	test("a deny exits 2 with the gate message on stderr (#497)", async () => {
		const { out, logged } = await run(bash("npm publish"), gate("deny", "no"));
		expect(out.exitCode).toBe(2);
		expect(out.stderr).toBe(
			"maina deny: no (confidence high) | override: change the deny rule or class in your maina policy\n",
		);
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
		// Nothing was read, so nothing is claimed about where or how (#584).
		expect(logged[0]).toMatchObject({
			root: "",
			host: "claude-code",
			permissionMode: "unknown",
			decisionIds: [],
		});
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

	test("records parse back as the gate log", async () => {
		const { logged } = await run(bash("ls"), gate("ask"));
		const text = logged.map((r) => JSON.stringify(r)).join("\n");
		expect(parseGateLog(text)).toEqual({ records: logged, malformed: 0 });
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

// ── Post mode: which gated calls ran ─────────────────────────────────────

const SECRET = "tool output: AKIA-secret-file-contents";

const post = (
	toolName: string,
	toolInput: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): string =>
	JSON.stringify({
		session_id: "s1",
		transcript_path: "/dev/null",
		cwd: "/work/maina",
		permission_mode: "default",
		hook_event_name: "PostToolUse",
		tool_name: toolName,
		tool_input: toolInput,
		tool_response: { stdout: SECRET, content: SECRET },
		tool_use_id: "t1",
		...extra,
	});

function runPost(raw: string): {
	out: ReturnType<typeof runDogfoodPostHook>;
	logged: OutcomeRecord[];
} {
	const logged: OutcomeRecord[] = [];
	const out = runDogfoodPostHook(raw, {
		now: () => NOW,
		log: (record) => logged.push(record),
	});
	return { out, logged };
}

const SILENT_OUT = { exitCode: 0, stdout: "", stderr: "" };

/**
 * A PostToolUseFailure payload (Claude Code 2.1.283+: `tool_name`,
 * `tool_input`, `tool_use_id`, `error`, `error_type`, `is_interrupt`,
 * `is_timeout`): the user approved the call and the tool then failed.
 */
const failure = (
	toolName: string,
	toolInput: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): string =>
	JSON.stringify({
		session_id: "s1",
		transcript_path: "/dev/null",
		cwd: "/work/maina",
		permission_mode: "default",
		hook_event_name: "PostToolUseFailure",
		tool_name: toolName,
		tool_input: toolInput,
		tool_use_id: "t1",
		error: `Exit code 1: ${SECRET}`,
		error_type: "tool_error",
		is_interrupt: false,
		is_timeout: false,
		...extra,
	});

/**
 * A PermissionDenied payload (`tool_name`, `tool_input`, `tool_use_id`,
 * `reason`): the auto-mode classifier denied the call, so it never ran.
 */
const denied = (
	toolName: string,
	toolInput: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): string =>
	JSON.stringify({
		session_id: "s1",
		transcript_path: "/dev/null",
		cwd: "/work/maina",
		permission_mode: "auto",
		hook_event_name: "PermissionDenied",
		tool_name: toolName,
		tool_input: toolInput,
		tool_use_id: "t1",
		reason: `classifier: ${SECRET}`,
		...extra,
	});

describe("runDogfoodPostHook", () => {
	test("a gated tool that ran is logged as ran, silently", () => {
		const { out, logged } = runPost(post("Bash", { command: "rm -rf dist" }));
		expect(out).toEqual(SILENT_OUT);
		expect(logged).toEqual([
			{
				ts: NOW,
				kind: "ran",
				tool: "Bash",
				toolUseId: "t1",
				sessionId: "s1",
				host: "claude-code",
			},
		]);
	});

	// #660: pairing uses only toolUseId and sessionId, so an outcome record
	// keeps no second copy of the command, path, URL or MCP tool (which can
	// hold secrets), nor the root, whose lookup would spawn git per call.
	test("records the pre record's tool, but no command, path, URL or root", async () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			["Write", { file_path: "/work/maina/a.ts", content: SECRET }],
			["Edit", { file_path: "/work/maina/b.ts", new_string: SECRET }],
			["Read", { file_path: "/etc/hosts" }],
			["WebFetch", { url: "https://example.com", prompt: "x" }],
			["mcp__github__create_issue", { title: "t" }],
		];
		for (const [tool, input] of cases) {
			const pre = await run(
				JSON.stringify({
					session_id: "s1",
					cwd: "/work/maina",
					hook_event_name: "PreToolUse",
					tool_name: tool,
					tool_input: input,
					tool_use_id: "t1",
				}),
				gate("allow"),
			);
			for (const raw of [post(tool, input), failure(tool, input)]) {
				const { logged } = runPost(raw);
				expect(logged).toHaveLength(1);
				expect(logged[0]?.tool).toBe(pre.logged[0]?.tool ?? "");
				expect(logged[0]).not.toHaveProperty("action");
				expect(logged[0]).not.toHaveProperty("root");
			}
		}
	});

	test("a Bearer token in the payload never reaches the log", () => {
		const command = 'curl -H "Authorization: Bearer ghp_abc123" x';
		for (const raw of [
			post("Bash", { command }),
			failure("Bash", { command }),
			denied("Bash", { command }),
			post("WebFetch", { url: "https://x.test/?token=ghp_abc123" }),
		]) {
			const { logged } = runPost(raw);
			expect(logged).toHaveLength(1);
			expect(JSON.stringify(logged)).not.toContain("ghp_abc123");
		}
	});

	test("never records the tool response or file contents", () => {
		const { logged } = runPost(
			post("Write", { file_path: "/work/maina/a.ts", content: SECRET }),
		);
		expect(logged).toHaveLength(1);
		expect(JSON.stringify(logged)).not.toContain("secret");
	});

	test("ids absent from the payload are left out", () => {
		const { logged } = runPost(
			post(
				"Bash",
				{ command: "ls" },
				{ session_id: undefined, tool_use_id: 3 },
			),
		);
		expect(logged).toHaveLength(1);
		expect(logged[0]).not.toHaveProperty("toolUseId");
		expect(logged[0]).not.toHaveProperty("sessionId");
	});

	test("a tool maina does not gate is not logged", () => {
		const { out, logged } = runPost(post("TodoWrite", { todos: [] }));
		expect(out).toEqual(SILENT_OUT);
		expect(logged).toEqual([]);
	});

	test("malformed input logs nothing and exits 0 silently", () => {
		for (const raw of [
			"{nope",
			"",
			"[]",
			JSON.stringify({ hook_event_name: "PostToolUse" }),
			JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash" }),
			JSON.stringify({ hook_event_name: "PostToolUse", tool_name: 3 }),
			post("Bash", { command: "ls" }, { hook_event_name: "PreToolUse" }),
			post("Bash", { command: "ls" }, { hook_event_name: "Stop" }),
		]) {
			const { out, logged } = runPost(raw);
			expect(out).toEqual(SILENT_OUT);
			expect(logged).toEqual([]);
		}
	});

	test("a log that throws never fails the tool", () => {
		const out = runDogfoodPostHook(post("Bash", { command: "ls" }), {
			now: () => NOW,
			log: () => {
				throw new Error("disk full");
			},
		});
		expect(out).toEqual(SILENT_OUT);
	});

	// #659: PostToolUse runs only after a tool succeeds. An ask the user
	// approved whose tool then failed (an Edit whose old_string does not
	// match, a Read of a missing path, a Bash exiting non-zero, an MCP error)
	// still ran: it must pair as approved, not count as refused.
	test("an approved call whose tool then failed is logged as ran, silently", () => {
		const { out, logged } = runPost(failure("Bash", { command: "false" }));
		expect(out).toEqual(SILENT_OUT);
		expect(logged).toEqual([
			{
				ts: NOW,
				kind: "ran",
				failed: true,
				tool: "Bash",
				toolUseId: "t1",
				sessionId: "s1",
				host: "claude-code",
			},
		]);
	});

	test("a failed call's error text is never recorded", () => {
		const { logged } = runPost(
			failure("Edit", { file_path: "/work/maina/a.ts", old_string: "x" }),
		);
		expect(logged).toHaveLength(1);
		expect(JSON.stringify(logged)).not.toContain("secret");
	});

	test("an ask whose tool then failed pairs as approved in the report", async () => {
		const pre = await run(bash("rm -rf dist"), gate("ask"));
		const after = runPost(failure("Bash", { command: "rm -rf dist" }));
		const log = [...pre.logged, ...after.logged]
			.map((r) => JSON.stringify(r))
			.join("\n");
		expect(askOutcomes(log, "2026-39")).toMatchObject({
			asked: 1,
			ran: 1,
			notRan: 0,
		});
	});

	// Claude Code's PermissionDenied fires when the auto-mode classifier
	// denies a call: a positive "did not run" label, kept apart from a user's
	// refusal. The classifier's reason is not recorded (it may quote the call).
	test("an auto-mode classifier denial is logged as denied, silently", () => {
		const { out, logged } = runPost(denied("Bash", { command: "rm -rf /" }));
		expect(out).toEqual(SILENT_OUT);
		expect(logged).toEqual([
			{
				ts: NOW,
				kind: "denied",
				tool: "Bash",
				toolUseId: "t1",
				sessionId: "s1",
				host: "claude-code",
			},
		]);
		expect(JSON.stringify(logged)).not.toContain("secret");
	});

	test("an ask the classifier denied pairs as denied in the report", async () => {
		const pre = await run(bash("rm -rf dist"), gate("ask"));
		const after = runPost(denied("Bash", { command: "rm -rf dist" }));
		const log = [...pre.logged, ...after.logged]
			.map((r) => JSON.stringify(r))
			.join("\n");
		expect(askOutcomes(log, "2026-39")).toEqual({
			asked: 1,
			ran: 0,
			denied: 1,
			notRan: 0,
		});
	});

	// The post hook does not import the adapter (it loads all of core), so
	// it keeps its own copy of the gated tools and the host name.
	test("gates the adapter's tools and stamps its host", () => {
		expect(CLAUDE_HOOK_MAP["tool.before"]).toEqual([
			{ event: "PreToolUse", matcher: GATED_TOOLS },
		]);
		expect(CLAUDE_HOST).toBe("claude-code");
	});

	test("failure and denial payloads for ungated tools are not logged", () => {
		for (const raw of [
			failure("TodoWrite", { todos: [] }),
			denied("TodoWrite", { todos: [] }),
		]) {
			const { out, logged } = runPost(raw);
			expect(out).toEqual(SILENT_OUT);
			expect(logged).toEqual([]);
		}
	});
});

// ── The settings.json wiring, end to end ──────────────────────────────────

const GATED_MATCHER =
	"Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|WebFetch|mcp__.*";

type WiredEvent =
	| "PreToolUse"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "PermissionDenied";

function settingsHooks(
	event: WiredEvent,
): Array<{ matcher: string; hooks: Array<Record<string, unknown>> }> {
	const settings = JSON.parse(
		readFileSync(join(ROOT, ".claude/settings.json"), "utf-8"),
	);
	return settings.hooks[event] ?? [];
}

function hookCommand(event: WiredEvent = "PreToolUse"): string {
	const cmd = settingsHooks(event)[0]?.hooks[0]?.command;
	expect(typeof cmd).toBe("string");
	return cmd as string;
}

async function runShell(
	stdin: string,
	env: Record<string, string>,
	event: WiredEvent = "PreToolUse",
): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["sh", "-c", hookCommand(event)], {
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

/**
 * Every module `entry` loads at run time, static and dynamic imports alike
 * (type-only imports are erased), as resolved paths; builtins as `node:*`.
 */
function importGraph(entry: string): ReadonlySet<string> {
	const transpiler = new Bun.Transpiler({ loader: "ts" });
	const seen = new Set<string>();
	const pending = [entry];
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		if (!file.startsWith("/") || !/\.[cm]?[jt]sx?$/.test(file)) continue;
		const source = readFileSync(file, "utf-8").replace(/^#!.*/, "");
		for (const { path } of transpiler.scanImports(source)) {
			const resolved = Bun.resolveSync(path, dirname(file));
			pending.push(
				resolved.startsWith("/") || resolved.includes(":")
					? resolved
					: `node:${resolved}`,
			);
		}
	}
	return seen;
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
			// The real git root lookup (#584).
			root: ROOT,
			host: "claude-code",
			permissionMode: "default",
		});
		expect(Array.isArray(record.decisionIds)).toBe(true);
	}, 20_000);

	test("PostToolUse runs the post mode for the gated tools, never failing the tool", () => {
		const pre = settingsHooks("PreToolUse");
		const entries = settingsHooks("PostToolUse");
		expect(entries).toHaveLength(1);
		expect(entries[0]?.matcher).toBe(GATED_MATCHER);
		expect(entries[0]?.matcher).toBe(pre[0]?.matcher);
		expect(entries[0]?.hooks).toEqual([
			{
				type: "command",
				command: 'bun "$CLAUDE_PROJECT_DIR/scripts/dogfood/outcome.ts"; exit 0',
				timeout: 10,
			},
		]);
	});

	// #659: a tool that fails after it was approved, and a call the auto-mode
	// classifier denies, reach the post mode too.
	test.each([
		"PostToolUseFailure",
		"PermissionDenied",
	] as const)("%s runs the post mode for the gated tools, never failing the tool", (event) => {
		expect(settingsHooks(event)).toEqual(settingsHooks("PostToolUse"));
	});

	test("the failure hook logs a ran record and prints nothing", async () => {
		const log = join(scratch, "failure-log.jsonl");
		const out = await runShell(
			failure("Bash", { command: "false" }, { cwd: ROOT }),
			{ CLAUDE_PROJECT_DIR: ROOT, MAINA_DOGFOOD_LOG: log },
			"PostToolUseFailure",
		);
		expect(out).toEqual({ code: 0, stdout: "", stderr: "" });
		const text = readFileSync(log, "utf-8");
		expect(text).not.toContain("secret");
		expect(JSON.parse(text.trim())).toEqual({
			ts: expect.any(String),
			kind: "ran",
			failed: true,
			tool: "Bash",
			toolUseId: "t1",
			sessionId: "s1",
			host: "claude-code",
		});
	});

	test("the post hook logs a ran record and prints nothing", async () => {
		const log = join(scratch, "post-log.jsonl");
		const out = await runShell(
			post(
				"Bash",
				{ command: 'curl -H "Authorization: Bearer ghp_abc123" x' },
				{ cwd: ROOT },
			),
			{ CLAUDE_PROJECT_DIR: ROOT, MAINA_DOGFOOD_LOG: log },
			"PostToolUse",
		);
		expect(out).toEqual({ code: 0, stdout: "", stderr: "" });
		const text = readFileSync(log, "utf-8");
		expect(text).not.toContain("ghp_abc123");
		expect(JSON.parse(text.trim())).toEqual({
			ts: expect.any(String),
			kind: "ran",
			tool: "Bash",
			toolUseId: "t1",
			sessionId: "s1",
			host: "claude-code",
		});
	});

	// #660: the post hook runs after every gated call (each Read, Grep and
	// Glob), so it must stay near bun's own startup: no runtime hook system,
	// no adapter (which loads all of core), no git spawn for the root.
	test("the post hook loads neither the runtime hook system nor git", () => {
		const script = hookCommand("PostToolUse").match(
			/\$CLAUDE_PROJECT_DIR\/(\S+\.ts)/,
		)?.[1];
		expect(script).toBeDefined();
		const graph = importGraph(join(ROOT, script as string));
		const loaded = [...graph].map((f) =>
			f.startsWith(`${ROOT}/`) ? f.slice(ROOT.length + 1) : f,
		);
		for (const heavy of [
			"packages/runtime/src/hook-system.ts",
			"packages/runtime/src/claude-hook.ts",
			"packages/runtime/src/root.ts",
			"packages/runtime/src/adapters/claude-code.ts",
			"packages/core/src/index.ts",
		]) {
			expect(loaded).not.toContain(heavy);
		}
		expect(graph.has("node:child_process")).toBe(false);
		for (const file of graph) {
			if (file.startsWith("node:")) continue;
			expect(readFileSync(file, "utf-8")).not.toMatch(/Bun\.spawn|\$`/);
		}
	});

	test("the post hook exits 0 when it cannot run", async () => {
		const empty = join(scratch, "empty-post");
		mkdirSync(empty);
		const out = await runShell(
			post("Bash", { command: "ls" }),
			{ CLAUDE_PROJECT_DIR: empty },
			"PostToolUse",
		);
		expect(out.code).toBe(0);
		expect(out.stdout).toBe("");
	});

	test("the repo policy protects master and v1/main (#459)", async () => {
		const gates = systemGates();
		for (const branch of ["master", "v1/main", "main"]) {
			const decided = await gates.runtime({
				kind: "shell",
				input: { command: `git push origin ${branch}` },
				cwd: ROOT,
			});
			expect(decided.verdict).toBe("ask");
			expect(decided.reason).toContain("git.push.protected");
		}
		const feature = await gates.runtime({
			kind: "shell",
			input: { command: "git push origin v1/459-some-feature" },
			cwd: ROOT,
		});
		expect(feature.verdict).toBe("allow");
	});

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
