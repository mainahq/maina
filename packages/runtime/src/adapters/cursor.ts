/**
 * Cursor hook adapter (FR-GATE-7). Pure: no I/O.
 *
 * `fromCursor` turns one hook's stdin payload into what maina acts on:
 *
 *   beforeShellExecution   a `shell` gate event
 *   beforeMCPExecution     an `mcp` gate event (Cursor sends the arguments
 *                          as a JSON string)
 *   preToolUse             a gate event for the file tools (`Write`,
 *                          `Delete`, `Read`, `Grep`). Shell and MCP tools are
 *                          left to the two hooks above, where Cursor enforces
 *                          `ask`, so each action is gated once
 *   afterFileEdit          an `action.post` edit event, for the code graph
 *   sessionStart, stop     a session event, keyed by the conversation id
 *   postToolUse, others    ignored
 *   anything it cannot read  malformed, which the hook answers with `ask`
 *
 * `toCursor` renders a result in Cursor's flat wire format, pinned by
 * `__fixtures__/cursor`:
 *
 *   permission hooks   { permission, user_message, agent_message }; a deny
 *                      also exits 2, Cursor's block, whatever it makes of
 *                      stdout. An event maina ignores answers `allow`:
 *                      Cursor's own approval flow still applies, and `{}`
 *                      would fail the host's schema
 *   preToolUse ask     a deny (#469). Cursor accepts `ask` from preToolUse
 *                      but runs the tool anyway, so maina blocks it and the
 *                      user message names the `maina allow <id> --always`
 *                      command that allows it (CLAUDE.md: `deny` where the
 *                      host has no `ask`). Shell and MCP asks stay `ask`
 *   sessionStart       additional_context
 *   postToolUse        additional_context
 *   stop               a deny asks the agent to carry on (followup_message)
 *   afterFileEdit      `{}`: the hook only observes
 *
 * `cursorHooksConfig` generates the `hooks.json` entries, with `failClosed`
 * on every permission hook so a crash or timeout blocks instead of allowing.
 *
 * Known issue: Cursor's allow-list overrides a hook's `ask` (a command on it
 * runs unprompted; https://forum.cursor.com/t/144244). A deny still blocks.
 * Adapters normalise; they never decide, so an `ask` stands and the hook
 * logs `CURSOR_ALLOW_LIST_WARNING`.
 */

import type { GateDecision, GateEvent } from "../gate";
import { type SessionEvent, searchTarget } from "./claude-code";

/** Written to the hook log on every `ask` from a shell or MCP hook. */
export const CURSOR_ALLOW_LIST_WARNING =
	"maina: Cursor's allow-list overrides a hook's ask, so a command or MCP tool on it runs without this confirmation. Keep risky commands off the allow-list; a maina deny still blocks.";

/** Shown to whoever installs the hooks: why a file-tool ask is a block (#469). */
export const CURSOR_PRE_TOOL_ASK_WARNING =
	"maina: Cursor does not enforce ask for preToolUse, so maina blocks a Write, Delete, Read or Grep it would ask about; the block message names the `maina allow <decision-id> --always` command that allows it. Shell and MCP asks still prompt.";

type GateHookEvent =
	| "preToolUse"
	| "beforeShellExecution"
	| "beforeMCPExecution";

/** What one Cursor hook payload normalises to. */
export type CursorEvent =
	| Readonly<{
			type: "gate";
			hookEvent: GateHookEvent;
			/** Cursor's tool name, for logs. */
			tool: string;
			event: GateEvent;
	  }>
	| Readonly<{
			type: "session";
			hookEvent: "sessionStart" | "stop";
			event: SessionEvent;
	  }>
	| Readonly<{ type: "edit"; hookEvent: "afterFileEdit"; event: GateEvent }>
	| Readonly<{ type: "ignored"; hookEvent: string; reason: string }>
	| Readonly<{ type: "malformed"; hookEvent: string; reason: string }>;

/** What `toCursor` renders. */
export type CursorResult = Readonly<{
	/** The native hook event the output answers. */
	hookEvent: string;
	/** The gate's decision (permission hooks), or a stop follow-up on `deny`. */
	decision?: GateDecision;
	/** Context for the agent (sessionStart, postToolUse) or the stop summary. */
	context?: string;
}>;

export type CursorOutput = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

type HookEntry = Readonly<{ command: string; failClosed?: true }>;

type CursorHooksConfig = Readonly<{
	version: 1;
	hooks: Readonly<Record<string, readonly HookEntry[]>>;
}>;

const HOST = "cursor";

const PERMISSION_HOOKS: ReadonlySet<string> = new Set([
	"preToolUse",
	"beforeShellExecution",
	"beforeMCPExecution",
]);

/** The hooks maina registers, in `hooks.json` order. */
const REGISTERED: readonly string[] = [
	"sessionStart",
	"preToolUse",
	"beforeShellExecution",
	"beforeMCPExecution",
	"afterFileEdit",
	"stop",
];

/** Every Cursor hook event the adapter answers; the runtime routes on it. */
export const CURSOR_HOOK_EVENTS: ReadonlySet<string> = new Set([
	...REGISTERED,
	"postToolUse",
]);

type Payload = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Payload =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

// ── fromCursor ──────────────────────────────────────────────────────────────

const malformed = (hookEvent: string, reason: string): CursorEvent => ({
	type: "malformed",
	hookEvent,
	reason,
});

/**
 * Cursor's session is its conversation. sessionStart also sends a
 * `session_id` (documented as the same value), but every other hook carries
 * only `conversation_id`, so it wins: the decision log and the summary must
 * key on the same id.
 */
const sessionIdOf = (payload: Payload): string | undefined =>
	text(payload.conversation_id) ?? text(payload.session_id);

/** The event's directory: its own `cwd`, else the first workspace root. */
function cwdOf(payload: Payload): string | undefined {
	const own = text(payload.cwd);
	if (own !== undefined) return own;
	const roots = payload.workspace_roots;
	return Array.isArray(roots) ? text(roots[0]) : undefined;
}

type Mapped =
	| Readonly<{ kind: string; input: Payload }>
	| Readonly<{ malformed: string }>
	| null;

/**
 * preToolUse's file tools. Cursor documents their names but not their
 * `tool_input` fields, so the path is read from `file_path` (as afterFileEdit
 * names it) or `path`. A tool without one is malformed, so it asks.
 */
function mapFileTool(
	tool: string,
	input: Payload,
	cwd: string | undefined,
): Mapped {
	const path = text(input.file_path) ?? text(input.path);
	switch (tool) {
		case "Write": {
			if (path === undefined) return { malformed: `${tool} without a path` };
			const content = text(input.content) ?? text(input.contents);
			return {
				kind: "file.write",
				input: content === undefined ? { path } : { path, content },
			};
		}
		case "Delete":
			return path === undefined
				? { malformed: `${tool} without a path` }
				: { kind: "file.write", input: { path } };
		case "Read":
			return path === undefined
				? { malformed: `${tool} without a path` }
				: { kind: "file.read.outside", input: { path } };
		case "Grep": {
			const dir = path ?? cwd;
			return dir === undefined
				? { malformed: `${tool} without a path` }
				: {
						kind: "file.read.outside",
						input: { path: searchTarget(dir, text(input.glob)) },
					};
		}
		default:
			return null;
	}
}

function gate(
	hookEvent: GateHookEvent,
	payload: Payload,
	tool: string,
	mapped: Readonly<{ kind: string; input: Payload }>,
): CursorEvent {
	const cwd = cwdOf(payload);
	const input = {
		host: HOST,
		sessionId: sessionIdOf(payload) ?? "",
		permissionMode: "unknown",
		...mapped.input,
	};
	const event: GateEvent =
		cwd === undefined
			? { kind: mapped.kind, input }
			: { kind: mapped.kind, input, cwd };
	return { type: "gate", hookEvent, tool, event };
}

function preToolUse(payload: Payload): CursorEvent {
	const hookEvent = "preToolUse";
	const tool = text(payload.tool_name);
	if (tool === undefined) return malformed(hookEvent, "no tool_name");
	if (tool === "Shell" || tool.startsWith("MCP:")) {
		return {
			type: "ignored",
			hookEvent,
			reason: `${tool} is gated by its own hook`,
		};
	}
	if (!isRecord(payload.tool_input)) {
		return malformed(hookEvent, `${tool} without a tool_input object`);
	}
	const mapped = mapFileTool(tool, payload.tool_input, cwdOf(payload));
	if (mapped === null) {
		return {
			type: "ignored",
			hookEvent,
			reason: `maina does not gate ${tool}`,
		};
	}
	if ("malformed" in mapped) return malformed(hookEvent, mapped.malformed);
	return gate(hookEvent, payload, tool, mapped);
}

function shell(payload: Payload): CursorEvent {
	const command = text(payload.command);
	if (command === undefined) {
		return malformed("beforeShellExecution", "no command");
	}
	return gate("beforeShellExecution", payload, "Shell", {
		kind: "shell",
		input: { command },
	});
}

function parseArguments(raw: unknown): Payload | undefined {
	if (isRecord(raw)) return raw;
	if (typeof raw !== "string") return undefined;
	try {
		const value: unknown = JSON.parse(raw === "" ? "{}" : raw);
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function mcp(payload: Payload): CursorEvent {
	const hookEvent = "beforeMCPExecution";
	const server = text(payload.mcp_server_name);
	const tool = text(payload.tool_name);
	if (server === undefined) return malformed(hookEvent, "no mcp_server_name");
	if (tool === undefined) return malformed(hookEvent, "no tool_name");
	const args = parseArguments(payload.tool_input);
	if (args === undefined) {
		return malformed(hookEvent, `${tool} arguments are not a JSON object`);
	}
	return gate(hookEvent, payload, tool, {
		kind: "mcp",
		input: { server, tool, arguments: args },
	});
}

function edit(payload: Payload): CursorEvent {
	const path = text(payload.file_path);
	if (path === undefined) return malformed("afterFileEdit", "no file_path");
	const cwd = cwdOf(payload);
	const input = {
		host: HOST,
		sessionId: sessionIdOf(payload) ?? "",
		action: { kind: "file.edit", path },
	};
	return {
		type: "edit",
		hookEvent: "afterFileEdit",
		event:
			cwd === undefined
				? { kind: "action.post", input }
				: { kind: "action.post", input, cwd },
	};
}

function session(
	hookEvent: "sessionStart" | "stop",
	payload: Payload,
): CursorEvent {
	const sessionId = sessionIdOf(payload);
	if (sessionId === undefined) return malformed(hookEvent, "no session id");
	const cwd = cwdOf(payload);
	const event: SessionEvent = {
		kind: hookEvent === "sessionStart" ? "session.start" : "session.stop",
		sessionId,
		...(cwd === undefined ? {} : { cwd }),
	};
	return { type: "session", hookEvent, event };
}

/**
 * Normalises one hook payload. `hookEvent` is the event the hook was
 * registered for (the launcher's `hook <event>` argument): a payload for
 * another event is malformed.
 */
export function fromCursor(hookEvent: string, hookInput: unknown): CursorEvent {
	if (!isRecord(hookInput)) {
		return malformed(hookEvent, "the hook input is not a JSON object");
	}
	const named = text(hookInput.hook_event_name);
	if (named === undefined) return malformed(hookEvent, "no hook_event_name");
	if (named !== hookEvent) {
		return malformed(hookEvent, `a ${named} payload for a ${hookEvent} hook`);
	}
	if (!CURSOR_HOOK_EVENTS.has(hookEvent)) {
		return malformed(hookEvent, `unknown hook event ${hookEvent}`);
	}
	switch (hookEvent) {
		case "preToolUse":
			return preToolUse(hookInput);
		case "beforeShellExecution":
			return shell(hookInput);
		case "beforeMCPExecution":
			return mcp(hookInput);
		case "afterFileEdit":
			return edit(hookInput);
		case "sessionStart":
		case "stop":
			return session(hookEvent, hookInput);
		default:
			return {
				type: "ignored",
				hookEvent,
				reason: `maina does not gate ${hookEvent}`,
			};
	}
}

// ── toCursor ────────────────────────────────────────────────────────────────

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const out = (value: unknown, exitCode = 0, stderr = ""): CursorOutput => ({
	exitCode,
	stdout: line(value),
	stderr: stderr === "" ? "" : `${stderr}\n`,
});

/** The gate's reason without core's trailing "; asking": maina blocks here. */
const withoutAsking = (reason: string): string =>
	reason.replace(/; asking$/, "");

/**
 * A decision id safe to paste into a terminal. Ids arrive over the wire, so
 * one with shell metacharacters is never offered as a command.
 */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A preToolUse `ask` as a deny (#469): Cursor would run the tool unasked.
 * The user message names the override; with no logged decision there is
 * none, so it says what is left.
 */
function askAsDeny(decision: GateDecision): CursorOutput {
	const reason = withoutAsking(decision.reason);
	const [id] = decision.decisionIds;
	const blocked = `maina: ${reason}. Cursor cannot ask for confirmation before this tool runs, so maina blocked it.`;
	const command =
		id !== undefined && PLAIN_ID.test(id)
			? `maina allow ${id} --always`
			: undefined;
	const user_message =
		command === undefined
			? `${blocked} maina logged no decision to override: add an allow rule to your maina policy, or make this change yourself.`
			: `${blocked} To allow it, run \`${command}\` in a terminal, then retry.`;
	const next =
		command === undefined
			? "Ask the user to allow it in their maina policy or make the change themselves"
			: `Ask the user to run \`${command}\` in a terminal, then retry`;
	return out(
		{
			permission: "deny",
			user_message,
			agent_message: `maina blocked this action because it needs the user's confirmation (${reason}) and Cursor cannot ask from preToolUse. ${next}; do not try another way.`,
		},
		2,
		user_message,
	);
}

function permission(
	hookEvent: string,
	decision: GateDecision | undefined,
): CursorOutput {
	if (decision === undefined || decision.verdict === "allow") {
		return out({ permission: "allow" });
	}
	const { verdict, reason } = decision;
	if (verdict === "deny") {
		return out(
			{
				permission: "deny",
				user_message: `maina: ${reason}`,
				agent_message: `maina blocked this action: ${reason}`,
			},
			2,
			reason,
		);
	}
	if (hookEvent === "preToolUse") return askAsDeny(decision);
	return out(
		{
			permission: "ask",
			user_message: `maina: ${reason}`,
			agent_message: `maina asked the user to confirm this action: ${reason}`,
		},
		0,
		CURSOR_ALLOW_LIST_WARNING,
	);
}

const withContext = (context: string | undefined): CursorOutput =>
	out(context === undefined ? {} : { additional_context: context });

/**
 * Renders `result` for Cursor. A session or edit event with nothing to say,
 * or an event maina does not handle, prints `{}`.
 */
export function toCursor(result: CursorResult): CursorOutput {
	const { hookEvent, decision, context } = result;
	if (PERMISSION_HOOKS.has(hookEvent)) return permission(hookEvent, decision);
	switch (hookEvent) {
		case "sessionStart":
		case "postToolUse":
			return withContext(context);
		case "stop":
			// Cursor's stop output has no field for a message to the user.
			return decision?.verdict === "deny"
				? out({ followup_message: decision.reason })
				: out({});
		default:
			return out({});
	}
}

// ── hooks.json ──────────────────────────────────────────────────────────────

/**
 * The `hooks.json` that registers maina's hooks, each running
 * `<command> --host cursor <event>`, and the known issues to show whoever
 * installs it. Permission hooks fail closed; a crash in a session or edit
 * hook does not hold up the session.
 */
export function cursorHooksConfig(command: string): Readonly<{
	config: CursorHooksConfig;
	warnings: readonly string[];
}> {
	const hooks = Object.fromEntries(
		REGISTERED.map((event): [string, readonly HookEntry[]] => {
			const run = `${command} --host ${HOST} ${event}`;
			return [
				event,
				[
					PERMISSION_HOOKS.has(event)
						? { command: run, failClosed: true }
						: { command: run },
				],
			];
		}),
	);
	return {
		config: { version: 1, hooks },
		warnings: [CURSOR_ALLOW_LIST_WARNING, CURSOR_PRE_TOOL_ASK_WARNING],
	};
}
