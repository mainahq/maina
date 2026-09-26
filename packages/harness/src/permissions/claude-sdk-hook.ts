/**
 * Claude Code's `PreToolUse` hook for a Claude worker (FR-HAR-2): defence
 * in depth under the ACP bridge.
 *
 * `claude-agent-acp` asks (`session/request_permission`) only when the
 * Claude Agent SDK calls `canUseTool`, which it skips in `bypassPermissions`
 * mode and for anything the user's settings pre-approve. A `PreToolUse`
 * hook runs before every tool whatever the mode, and a hook's deny blocks
 * even in bypass mode, so the gate still sees every call.
 *
 * `installClaudePreToolUse` registers the hook for every tool in the
 * worktree's `.claude/settings.local.json`, which both the ACP adapter
 * (setting sources `user`, `project`, `local`) and headless `claude -p`
 * load, and sets `disableAllHooks: false` there so no project or user
 * setting switches it off. The hook reads a snapshot of the run's policy
 * written outside the worktree, so the agent cannot loosen it by editing
 * `.maina/`. The returned sandbox options deny writes to the worktree's
 * `.claude/` and to the snapshot: the agent cannot unhook itself, even with
 * an action it approved internally. Existing local settings are merged,
 * backed up before the first write, and restored by
 * `uninstallClaudePreToolUse`.
 *
 * `answerClaudePreToolUse` is the hook: a Claude tool call becomes the ACP
 * tool call `claude-agent-acp` would report, so the gate judges it through
 * the same normalisation (`../events`). A deny, or an `ask` (a run has
 * nobody to ask), blocks with exit 2 and the reason on stderr; an allow
 * prints `{}` so the host's own flow stands. `claude-hook-main.ts` is the
 * process that runs it.
 *
 * Limits: Claude Code treats a hook that fails to start (no `bun`) or
 * outlives its timeout as a non-blocking error and runs the tool; the
 * sandbox is what holds then. The hook runs inside the worker's sandbox, so
 * its log has to be writable there, and the agent can append to or rewrite
 * it: the log is the hook's account of what it judged, not tamper-proof
 * evidence. Uninstall before the worktree is committed or salvaged, or the
 * local settings (and their backup) go into the run's branch with it.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ToolCallUpdate, ToolKind } from "@agentclientprotocol/sdk";
import type { GateEvent, PermissionMode, Policy, Result } from "@mainahq/core";
import { gateEvents } from "../events";
import type { SandboxOptions } from "../sandbox/port";
import type { WorkerSpec } from "../workers/spec";
import { type GateBridge, judgeActions, logPermission } from "./judge";

// ── the hook ────────────────────────────────────────────────────────────────

export type ClaudeHookOutput = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

const HOST = "claude-code";

/** Claude Code's permission modes, in core's spelling. */
const PERMISSION_MODES: Readonly<Record<string, PermissionMode>> = {
	default: "default",
	plan: "plan",
	acceptEdits: "accept_edits",
	bypassPermissions: "bypass",
};

type Payload = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Payload =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/** The text an edit writes, as a diff the gate reads as the content. */
function written(path: unknown, content: string | undefined) {
	return typeof path === "string" && content !== undefined
		? { content: [{ type: "diff" as const, path, newText: content }] }
		: {};
}

function multiEditText(edits: unknown): string | undefined {
	if (!Array.isArray(edits)) return undefined;
	return edits
		.flatMap((e) =>
			isRecord(e) && typeof e.new_string === "string" ? [e.new_string] : [],
		)
		.join("\n");
}

/** Kinds as `claude-agent-acp` reports Claude Code's tools. */
const KINDS: Readonly<Record<string, ToolKind>> = {
	Bash: "execute",
	Write: "edit",
	Edit: "edit",
	MultiEdit: "edit",
	NotebookEdit: "edit",
	Read: "read",
	Glob: "search",
	Grep: "search",
	WebFetch: "fetch",
	WebSearch: "fetch",
	Agent: "think",
	Task: "think",
	TodoWrite: "think",
	ExitPlanMode: "switch_mode",
};

/** A Claude Code tool call as the ACP tool call the adapter would report. */
function toolCallOf(
	id: string,
	tool: string,
	input: Payload,
	cwd: string | undefined,
): ToolCallUpdate {
	const base = { toolCallId: id, title: tool, name: tool };
	const kind = KINDS[tool] ?? "other";
	switch (tool) {
		case "Bash":
			return {
				...base,
				kind,
				rawInput:
					cwd === undefined
						? { command: input.command }
						: { command: input.command, cwd },
			};
		case "Write":
			return {
				...base,
				kind,
				rawInput: input,
				...written(input.file_path, text(input.content)),
			};
		case "Edit":
			return {
				...base,
				kind,
				rawInput: input,
				...written(input.file_path, text(input.new_string)),
			};
		case "MultiEdit":
			return {
				...base,
				kind,
				rawInput: input,
				...written(input.file_path, multiEditText(input.edits)),
			};
		case "NotebookEdit":
			return {
				...base,
				kind,
				rawInput: { path: input.notebook_path },
				...written(input.notebook_path, text(input.new_source)),
			};
		default:
			return { ...base, kind, rawInput: input };
	}
}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

function blocked(reason: string): ClaudeHookOutput {
	return {
		exitCode: 2,
		stdout: line({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
		stderr: `${reason}\n`,
	};
}

const ALLOWED: ClaudeHookOutput = { exitCode: 0, stdout: "{}\n", stderr: "" };

/** What the hook reads from a payload, or why it cannot. */
type Read =
	| Readonly<{
			ok: true;
			sessionId: string;
			id: string;
			call: ToolCallUpdate;
			mode: PermissionMode;
	  }>
	| Readonly<{ ok: false; sessionId: string; reason: string }>;

function readPayload(payload: unknown): Read {
	if (!isRecord(payload)) {
		return {
			ok: false,
			sessionId: "",
			reason: "the hook input is not a JSON object",
		};
	}
	const sessionId = text(payload.session_id) ?? "";
	if (payload.hook_event_name !== "PreToolUse") {
		return { ok: false, sessionId, reason: "not a PreToolUse payload" };
	}
	const tool = text(payload.tool_name);
	if (tool === undefined)
		return { ok: false, sessionId, reason: "no tool_name" };
	if (!isRecord(payload.tool_input)) {
		return {
			ok: false,
			sessionId,
			reason: `${tool} without a tool_input object`,
		};
	}
	const id = text(payload.tool_use_id) ?? tool;
	const mode =
		typeof payload.permission_mode === "string" &&
		Object.hasOwn(PERMISSION_MODES, payload.permission_mode)
			? (PERMISSION_MODES[payload.permission_mode] as PermissionMode)
			: "unknown";
	return {
		ok: true,
		sessionId,
		id,
		call: toolCallOf(id, tool, payload.tool_input, text(payload.cwd)),
		mode,
	};
}

/**
 * Answers one `PreToolUse` payload for the worker in `root`. Never throws:
 * a payload it cannot read is denied, and every payload is logged.
 */
export function answerClaudePreToolUse(
	bridge: GateBridge,
	root: string,
	payload: unknown,
): ClaudeHookOutput {
	const read = readPayload(payload);
	if (!read.ok) {
		const reason = `maina could not read the hook input (${read.reason}); denied`;
		logPermission(bridge, {
			source: "claude-hook",
			host: HOST,
			sessionId: read.sessionId,
			toolCallId: "",
			gate: [],
			opaque: true,
			verdict: "deny",
			reason,
			degraded: true,
			decisionIds: [],
			answer: "deny",
		});
		return blocked(reason);
	}
	const normalised = gateEvents(read.call, {
		host: HOST,
		sessionId: read.sessionId,
		root,
	});
	// The mode is carried for the log; the gate's rules never read it.
	const gate = normalised.gate.map(
		(event): GateEvent => ({ ...event, permissionMode: read.mode }),
	);
	const judged = judgeActions(bridge, gate, normalised.opaque);
	const allow = judged.verdict === "allow";
	logPermission(bridge, {
		source: "claude-hook",
		host: HOST,
		sessionId: read.sessionId,
		toolCallId: read.id,
		gate,
		opaque: normalised.opaque,
		...judged,
		answer: allow ? "allow" : "deny",
	});
	if (allow) return ALLOWED;
	return blocked(
		judged.verdict === "ask"
			? `${judged.reason}; a maina run has nobody to ask, so it is denied`
			: judged.reason,
	);
}

// ── installing it ───────────────────────────────────────────────────────────

/** The process Claude Code runs for the hook. */
const HOOK_MAIN = join(import.meta.dir, "claude-hook-main.ts");

/** Longest Claude Code waits for the hook, in seconds. */
const HOOK_TIMEOUT_S = 30;

const CLAUDE_WORKERS: readonly string[] = ["claude", "headless:claude"];

export type ClaudeHookOptions = Readonly<{
	/** The worker's worktree: its cwd, where the local settings go. */
	worktree: string;
	/** A harness-owned directory outside the worktree: the policy snapshot and the log. */
	stateDir: string;
	/** The run's effective policy; the hook judges against this snapshot. */
	policy: Policy;
	/** The worker's sandbox, which the install tightens. */
	sandbox: SandboxOptions;
}>;

export type ClaudeHookInstall = Readonly<{
	settingsPath: string;
	policyPath: string;
	/** Where the hook appends one `PermissionRecord` per call (JSON lines). */
	logPath: string;
	/** The hook's shell command. */
	command: string;
	/** `sandbox` with the hook's files protected and its log writable. */
	sandbox: SandboxOptions;
}>;

export type PermissionSetupError = Readonly<{
	code: "unsupported_worker" | "invalid_options" | "invalid_settings" | "io";
	message: string;
}>;

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const shellQuote = (word: string): string =>
	SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

const fail = (
	code: PermissionSetupError["code"],
	message: string,
): Result<never, PermissionSetupError> => ({
	ok: false,
	error: { code, message },
});

const isOurs = (group: unknown): boolean =>
	isRecord(group) &&
	Array.isArray(group.hooks) &&
	group.hooks.some(
		(h) =>
			isRecord(h) &&
			typeof h.command === "string" &&
			h.command.includes(HOOK_MAIN),
	);

const hasOurGroup = (settings: Payload): boolean =>
	isRecord(settings.hooks) &&
	Array.isArray(settings.hooks.PreToolUse) &&
	settings.hooks.PreToolUse.some(isOurs);

/** Where the user's local settings are kept while maina's hook is in. */
const backupOf = (settingsPath: string): string =>
	`${settingsPath}.maina-backup`;

/** The local settings with maina's hook group replacing any earlier one. */
function mergeSettings(
	existing: Payload,
	command: string,
): Result<Payload, PermissionSetupError> {
	const hooks = existing.hooks ?? {};
	if (!isRecord(hooks))
		return fail("invalid_settings", "`hooks` is not an object");
	const groups = hooks.PreToolUse ?? [];
	if (!Array.isArray(groups)) {
		return fail("invalid_settings", "`hooks.PreToolUse` is not an array");
	}
	const group = {
		matcher: "*",
		hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }],
	};
	return {
		ok: true,
		value: {
			...existing,
			disableAllHooks: false,
			hooks: {
				...hooks,
				PreToolUse: [...groups.filter((g) => !isOurs(g)), group],
			},
		},
	};
}

function readSettings(path: string): Result<Payload, PermissionSetupError> {
	if (!existsSync(path)) return { ok: true, value: {} };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed)
			? { ok: true, value: parsed }
			: fail("invalid_settings", `${path} is not a JSON object`);
	} catch (e) {
		return fail(
			"invalid_settings",
			`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/**
 * Registers the gate's `PreToolUse` hook for a Claude worker in `worktree`
 * and returns the sandbox options that keep it in place.
 */
export function installClaudePreToolUse(
	worker: WorkerSpec,
	options: ClaudeHookOptions,
): Result<ClaudeHookInstall, PermissionSetupError> {
	if (!CLAUDE_WORKERS.includes(worker.name)) {
		return fail(
			"unsupported_worker",
			`the PreToolUse hook is Claude Code's; worker "${worker.name}" is not Claude Code`,
		);
	}
	const { worktree, stateDir, sandbox } = options;
	for (const [label, path] of [
		["worktree", worktree],
		["state directory", stateDir],
	] as const) {
		if (!isAbsolute(path))
			return fail("invalid_options", `${label} "${path}" is not absolute`);
	}
	const claudeDir = join(worktree, ".claude");
	const settingsPath = join(claudeDir, "settings.local.json");
	const policyPath = join(stateDir, "claude-hook-policy.json");
	const logPath = join(stateDir, "claude-hook-log.jsonl");
	const command = [process.execPath, HOOK_MAIN, worktree, policyPath, logPath]
		.map(shellQuote)
		.join(" ");

	const existing = readSettings(settingsPath);
	if (!existing.ok) return existing;
	const merged = mergeSettings(existing.value, command);
	if (!merged.ok) return merged;
	const backupPath = backupOf(settingsPath);
	try {
		mkdirSync(stateDir, { recursive: true, mode: 0o700 });
		writeFileSync(policyPath, JSON.stringify(options.policy), { mode: 0o600 });
		mkdirSync(claudeDir, { recursive: true });
		// The user's own settings, once, before maina first writes over them.
		if (existsSync(settingsPath) && !existsSync(backupPath)) {
			const hooked = readSettings(settingsPath);
			if (hooked.ok && !hasOurGroup(hooked.value)) {
				copyFileSync(settingsPath, backupPath);
			}
		}
		writeFileSync(settingsPath, `${JSON.stringify(merged.value, null, 2)}\n`);
	} catch (e) {
		return fail(
			"io",
			`could not install the hook: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	return {
		ok: true,
		value: {
			settingsPath,
			policyPath,
			logPath,
			command,
			sandbox: {
				...sandbox,
				// The hook runs in this sandbox: it must read its snapshot even
				// when the state directory sits under a read-denied root.
				readAllow: [...(sandbox.readAllow ?? []), policyPath],
				writeAllow: [...sandbox.writeAllow, logPath],
				writeDeny: [...(sandbox.writeDeny ?? []), claudeDir, policyPath],
			},
		},
	};
}

/**
 * Takes the hook out of `worktree`: the user's local settings come back
 * byte for byte from the backup, or, when maina created the file, it goes.
 * A worktree maina never hooked is left as it is.
 */
export function uninstallClaudePreToolUse(
	worktree: string,
): Result<void, PermissionSetupError> {
	const settingsPath = join(worktree, ".claude", "settings.local.json");
	const backupPath = backupOf(settingsPath);
	try {
		if (existsSync(backupPath)) {
			renameSync(backupPath, settingsPath);
			return { ok: true, value: undefined };
		}
		const current = readSettings(settingsPath);
		if (current.ok && hasOurGroup(current.value)) rmSync(settingsPath);
		return { ok: true, value: undefined };
	} catch (e) {
		return fail(
			"io",
			`could not remove the hook: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}
