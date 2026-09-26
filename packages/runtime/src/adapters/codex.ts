/**
 * Codex hook adapter (FR-GATE-7). Pure: no I/O.
 *
 * `fromCodex` turns one hook's stdin payload into what maina acts on:
 *
 *   PreToolUse, PermissionRequest   gate events: `Bash` is `shell`,
 *                                   `apply_patch` is one `file.write` per
 *                                   file the patch touches, `mcp__*` is `mcp`
 *   SessionStart, Stop              a session event
 *   PostToolUse, local function tools (`update_plan`, ...)
 *                                   ignored: maina has no opinion, so
 *                                   Codex's own approval flow stands
 *   anything it cannot read         malformed, which the hook answers with
 *                                   `ask`, and so (below) with a deny
 *
 * `toCodex` renders a result in Codex's wire format, pinned by
 * `__fixtures__/codex` (the upstream generated schemas):
 *
 *   PreToolUse         a deny is `permissionDecision: "deny"` plus exit 2
 *                      with the reason on stderr. Codex fails a hook that
 *                      answers `ask` and runs the tool anyway, so an `ask`
 *                      is a deny that tells the agent the user must confirm.
 *                      An allow prints `{}`: Codex's own approval stands
 *   PermissionRequest  allow/deny as `decision.behavior`; ask prints `{}`,
 *                      which keeps Codex's approval prompt (the user is
 *                      asked). The hook only runs when Codex is about to
 *                      prompt, so that is where `ask` can defer
 *   SessionStart       hookSpecificOutput.additionalContext
 *   PostToolUse        hookSpecificOutput.additionalContext
 *   Stop               the summary as `systemMessage`; a deny blocks with
 *                      `decision: "block"`
 *
 * No output ever carries `ask`, and an `ask` never becomes an allow.
 *
 * Known issue (openai/codex#27833): Codex runs PreToolUse for `apply_patch`
 * but does not enforce its deny, so a file edit maina denies is still
 * written. `maina doctor` reports it. Adapters normalise; they never decide.
 */

import type { GateDecision, GateEvent } from "../gate";
import type { SessionEvent } from "./claude-code";
import type { HostHookMap } from "./hook-map";

type GateHookEvent = "PreToolUse" | "PermissionRequest";

/** What one Codex hook payload normalises to. */
export type CodexEvent =
	| Readonly<{
			type: "gate";
			hookEvent: GateHookEvent;
			/** Codex's tool name, for logs. */
			tool: string;
			/**
			 * One event per action, never empty: an `apply_patch` that touches
			 * several files is one per file. The strictest verdict wins.
			 */
			events: readonly GateEvent[];
	  }>
	| Readonly<{
			type: "session";
			hookEvent: "SessionStart" | "Stop";
			event: SessionEvent;
	  }>
	| Readonly<{ type: "ignored"; hookEvent: string; reason: string }>
	| Readonly<{ type: "malformed"; hookEvent: string; reason: string }>;

/** What `toCodex` renders. */
export type CodexResult = Readonly<{
	/** The native hook event the output answers. */
	hookEvent: string;
	/** The gate's decision (tool events), or a Stop block when `deny`. */
	decision?: GateDecision;
	/** Context for the agent (SessionStart, PostToolUse) or the Stop summary. */
	context?: string;
}>;

export type CodexOutput = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

type HookCommand = Readonly<{ type: "command"; command: string }>;

type HookGroup = Readonly<{ matcher?: string; hooks: readonly HookCommand[] }>;

type CodexHooksConfig = Readonly<{
	hooks: Readonly<Record<string, readonly HookGroup[]>>;
}>;

const HOST = "codex";

/** Shown to whoever installs the hooks: openai/codex#27833. */
export const CODEX_APPLY_PATCH_WARNING =
	"maina: Codex runs the PreToolUse hook for apply_patch but does not enforce its deny yet (openai/codex#27833), so a file edit maina blocks may still be written.";

/**
 * The tools maina gates (see `mapTool`), as a Codex matcher regex. Every
 * other tool is ignored by the adapter, so the hook need not run for it.
 */
const GATED_TOOLS = "^(Bash|apply_patch|mcp__.+)$";

/**
 * The hooks maina registers, by lifecycle point: the tool hooks match every
 * tool maina gates. PostToolUse is ignored, so file edits register nothing.
 */
export const CODEX_HOOK_MAP: HostHookMap = {
	"session.start": [{ event: "SessionStart" }],
	"tool.before": [{ event: "PreToolUse", matcher: GATED_TOOLS }],
	"permission.request": [{ event: "PermissionRequest", matcher: GATED_TOOLS }],
	"file.edited": [],
	"session.stop": [{ event: "Stop" }],
};

/** Every Codex hook event the adapter answers; the runtime routes on it. */
export const CODEX_HOOK_EVENTS: ReadonlySet<string> = new Set([
	"SessionStart",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"Stop",
]);

/** Codex's permission modes, in core's spelling. `dontAsk` has none. */
const PERMISSION_MODES: Readonly<Record<string, string>> = {
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

// ── fromCodex ───────────────────────────────────────────────────────────────

const malformed = (hookEvent: string, reason: string): CodexEvent => ({
	type: "malformed",
	hookEvent,
	reason,
});

type Action = Readonly<{ kind: string; input: Payload }>;

/** A tool's actions, a reason it is malformed, or null when not gated. */
type Mapped = readonly Action[] | Readonly<{ malformed: string }> | null;

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One argv word as a shell reads it back. */
const shellQuote = (word: string): string =>
	SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

/** Codex sends the command as a string; an argv array is quoted back. */
function commandOf(value: unknown): string | undefined {
	if (typeof value === "string") return text(value);
	if (!Array.isArray(value) || value.length === 0) return undefined;
	if (!value.every((word) => typeof word === "string")) return undefined;
	return text(value.map(shellQuote).join(" "));
}

type PatchFile = Readonly<{ path: string; content?: string }>;

type PatchBlock = {
	readonly op: string;
	readonly path: string;
	moveTo?: string;
	readonly added: string[];
};

// Leading whitespace is allowed: Codex's patch parser trims marker lines, so
// an indented header still writes a file and must still be gated.
const PATCH_FILE = /^\s*\*\*\* (Add|Update|Delete) File: (.+?)\s*$/;
const PATCH_MOVE = /^\s*\*\*\* Move to: (.+?)\s*$/;

const withContent = (path: string, added: readonly string[]): PatchFile =>
	added.length === 0 ? { path } : { path, content: added.join("\n") };

/**
 * The files an `apply_patch` writes, in patch order: each added, updated
 * (with its `+` lines as content), deleted or moved file. A move writes
 * both the file it removes and its destination.
 */
function patchFiles(patch: string): readonly PatchFile[] {
	const blocks: PatchBlock[] = [];
	for (const line of patch.split(/\r?\n/)) {
		const header = PATCH_FILE.exec(line);
		if (header !== null) {
			blocks.push({
				op: header[1] as string,
				path: header[2] as string,
				added: [],
			});
			continue;
		}
		const current = blocks.at(-1);
		if (current === undefined) continue;
		const move = PATCH_MOVE.exec(line);
		if (move !== null) current.moveTo = move[1] as string;
		else if (line.startsWith("+") && current.op !== "Delete") {
			current.added.push(line.slice(1));
		}
	}
	return blocks.flatMap((b): PatchFile[] => {
		if (b.op === "Delete") return [{ path: b.path }];
		if (b.moveTo === undefined) return [withContent(b.path, b.added)];
		return [{ path: b.path }, withContent(b.moveTo, b.added)];
	});
}

function mcpCall(toolName: string, args: Payload): Mapped {
	const rest = toolName.slice("mcp__".length);
	const at = rest.indexOf("__");
	const server = at < 0 ? "" : rest.slice(0, at);
	const tool = at < 0 ? "" : rest.slice(at + 2);
	if (server === "" || tool === "") {
		return { malformed: `unreadable MCP tool name ${toolName}` };
	}
	return [{ kind: "mcp", input: { server, tool, arguments: args } }];
}

function mapTool(tool: string, input: Payload): Mapped {
	switch (tool) {
		case "Bash": {
			const command = commandOf(input.command);
			return command === undefined
				? { malformed: `${tool} without a command` }
				: [{ kind: "shell", input: { command } }];
		}
		case "apply_patch": {
			const patch = text(input.command) ?? text(input.patch);
			const files = patch === undefined ? [] : patchFiles(patch);
			return files.length === 0
				? { malformed: `${tool} names no file` }
				: files.map((input) => ({ kind: "file.write", input }));
		}
		default:
			return tool.startsWith("mcp__") ? mcpCall(tool, input) : null;
	}
}

function gateEvent(hookEvent: GateHookEvent, payload: Payload): CodexEvent {
	const tool = text(payload.tool_name);
	if (tool === undefined) return malformed(hookEvent, "no tool_name");
	if (!isRecord(payload.tool_input)) {
		return malformed(hookEvent, `${tool} without a tool_input object`);
	}
	const mapped = mapTool(tool, payload.tool_input);
	if (mapped === null) {
		return {
			type: "ignored",
			hookEvent,
			reason: `maina does not gate ${tool}`,
		};
	}
	if ("malformed" in mapped) return malformed(hookEvent, mapped.malformed);
	const mode =
		typeof payload.permission_mode === "string" &&
		Object.hasOwn(PERMISSION_MODES, payload.permission_mode)
			? PERMISSION_MODES[payload.permission_mode]
			: "unknown";
	const meta = {
		host: HOST,
		sessionId: text(payload.session_id) ?? "",
		permissionMode: mode,
	};
	const cwd = text(payload.cwd);
	const events = mapped.map(
		(action): GateEvent =>
			cwd === undefined
				? { kind: action.kind, input: { ...meta, ...action.input } }
				: { kind: action.kind, input: { ...meta, ...action.input }, cwd },
	);
	return { type: "gate", hookEvent, tool, events };
}

function sessionEvent(
	hookEvent: "SessionStart" | "Stop",
	payload: Payload,
): CodexEvent {
	const sessionId = text(payload.session_id);
	if (sessionId === undefined) return malformed(hookEvent, "no session_id");
	const cwd = text(payload.cwd);
	const source =
		hookEvent === "SessionStart" ? text(payload.source) : undefined;
	const event: SessionEvent = {
		kind: hookEvent === "SessionStart" ? "session.start" : "session.stop",
		sessionId,
		...(cwd === undefined ? {} : { cwd }),
		...(source === undefined ? {} : { source }),
	};
	return { type: "session", hookEvent, event };
}

/**
 * Normalises one hook payload. `hookEvent` is the event the hook was
 * registered for (the launcher's `hook <event>` argument): a payload for
 * another event is malformed.
 */
export function fromCodex(hookEvent: string, hookInput: unknown): CodexEvent {
	if (!isRecord(hookInput)) {
		return malformed(hookEvent, "the hook input is not a JSON object");
	}
	const named = text(hookInput.hook_event_name);
	if (named === undefined) return malformed(hookEvent, "no hook_event_name");
	if (named !== hookEvent) {
		return malformed(hookEvent, `a ${named} payload for a ${hookEvent} hook`);
	}
	switch (hookEvent) {
		case "PreToolUse":
		case "PermissionRequest":
			return gateEvent(hookEvent, hookInput);
		case "SessionStart":
		case "Stop":
			return sessionEvent(hookEvent, hookInput);
		case "PostToolUse":
			return {
				type: "ignored",
				hookEvent,
				reason: `maina does not gate ${hookEvent}`,
			};
		default:
			return malformed(hookEvent, `unknown hook event ${hookEvent}`);
	}
}

// ── toCodex ─────────────────────────────────────────────────────────────────

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const ok = (value: unknown): CodexOutput => ({
	exitCode: 0,
	stdout: line(value),
	stderr: "",
});

/** A deny: the JSON Codex reads, plus exit 2 and stderr, its other block. */
const denied = (value: unknown, reason: string): CodexOutput => ({
	exitCode: 2,
	stdout: line(value),
	stderr: `${reason}\n`,
});

/** Why an `ask` is a deny on PreToolUse, for the agent to relay. */
const askAsDeny = (reason: string): string =>
	`maina needs the user to confirm this action (${reason}). Codex hooks cannot ask for confirmation, so maina blocked it; ask the user before trying another way.`;

function preToolUse(decision: GateDecision | undefined): CodexOutput {
	if (decision === undefined || decision.verdict === "allow") return ok({});
	const reason =
		decision.verdict === "ask" ? askAsDeny(decision.reason) : decision.reason;
	return denied(
		{
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		},
		reason,
	);
}

function permissionRequest(decision: GateDecision | undefined): CodexOutput {
	if (decision === undefined || decision.verdict === "ask") return ok({});
	if (decision.verdict === "allow") {
		return ok({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow" },
			},
		});
	}
	return denied(
		{
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny", message: decision.reason },
			},
		},
		decision.reason,
	);
}

const withContext = (hookEvent: string, context: string | undefined) =>
	ok(
		context === undefined
			? {}
			: {
					hookSpecificOutput: {
						hookEventName: hookEvent,
						additionalContext: context,
					},
				},
	);

function stop(result: CodexResult): CodexOutput {
	if (result.decision?.verdict === "deny") {
		return ok({ decision: "block", reason: result.decision.reason });
	}
	return ok(
		result.context === undefined ? {} : { systemMessage: result.context },
	);
}

/**
 * Renders `result` for Codex. An event with nothing to say, or one maina
 * does not handle, prints `{}`: Codex's own flow stands.
 */
export function toCodex(result: CodexResult): CodexOutput {
	const { hookEvent, decision, context } = result;
	switch (hookEvent) {
		case "PreToolUse":
			return preToolUse(decision);
		case "PermissionRequest":
			return permissionRequest(decision);
		case "SessionStart":
		case "PostToolUse":
			return withContext(hookEvent, context);
		case "Stop":
			return stop(result);
		default:
			return ok({});
	}
}

// ── codexHooksConfig ────────────────────────────────────────────────────────

/**
 * The Codex `hooks.json` that registers maina's hooks, each running
 * `<command> --host codex <event>` so the runtime answers the Codex way,
 * and the known issues to show whoever installs it. The tool hooks match
 * every tool maina gates, `apply_patch` included (#343 installs it).
 */
export function codexHooksConfig(command: string): Readonly<{
	config: CodexHooksConfig;
	warnings: readonly string[];
}> {
	const hooks = Object.fromEntries(
		Object.values(CODEX_HOOK_MAP)
			.flat()
			.map(({ event, matcher }): [string, readonly HookGroup[]] => {
				const hook: HookCommand = {
					type: "command",
					command: `${command} --host ${HOST} ${event}`,
				};
				return [
					event,
					[
						matcher === undefined
							? { hooks: [hook] }
							: { matcher, hooks: [hook] },
					],
				];
			}),
	);
	return { config: { hooks }, warnings: [CODEX_APPLY_PATCH_WARNING] };
}
