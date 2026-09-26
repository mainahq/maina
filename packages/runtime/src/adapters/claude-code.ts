/**
 * Claude Code hook adapter (FR-GATE-7). Pure: no I/O.
 *
 * `fromClaude` turns one hook's stdin payload into what maina acts on:
 *
 *   PreToolUse, PermissionRequest   a gate event (`shell`, `file.write`,
 *                                   `file.read.outside`, `mcp`, `network`)
 *   SessionStart, Stop              a session event
 *   PostToolUse, other tools        ignored: maina has no opinion, so the
 *                                   host's own permission flow stands
 *   anything it cannot read         malformed, which the hook answers with
 *                                   `ask` (fail closed)
 *
 * `toClaude` renders a result in the host's wire format, pinned by
 * `__fixtures__/claude-code`:
 *
 *   PreToolUse         hookSpecificOutput.permissionDecision + reason
 *   PermissionRequest  allow/deny as decision.behavior; ask prints `{}` so
 *                      the host's dialog (which is asking) stays
 *   SessionStart       hookSpecificOutput.additionalContext
 *   PostToolUse        hookSpecificOutput.additionalContext
 *   Stop               the session summary as `systemMessage` (shown to the
 *                      user); a deny blocks with `decision: "block"`
 *
 * A deny on a tool event also exits 2 with the reason on stderr. Claude
 * Code blocks the tool on exit 2 whatever it makes of stdout (it reads JSON
 * only on exit 0), so a deny holds even where the JSON is not understood.
 * Adapters normalise; they never decide.
 */

import type { GateDecision, GateEvent } from "../gate";
import type { HostHookMap } from "./hook-map";

/** A session boundary, for the session summary. */
export type SessionEvent = Readonly<{
	kind: "session.start" | "session.stop";
	sessionId: string;
	cwd?: string;
	/** SessionStart's `source`: `startup`, `resume`, `clear` or `compact`. */
	source?: string;
}>;

type GateHookEvent = "PreToolUse" | "PermissionRequest";

/** What one Claude Code hook payload normalises to. */
export type ClaudeEvent =
	| Readonly<{
			type: "gate";
			hookEvent: GateHookEvent;
			/** Claude Code's tool name, for logs. */
			tool: string;
			event: GateEvent;
	  }>
	| Readonly<{
			type: "session";
			hookEvent: "SessionStart" | "Stop";
			event: SessionEvent;
	  }>
	| Readonly<{ type: "ignored"; hookEvent: string; reason: string }>
	| Readonly<{ type: "malformed"; hookEvent: string; reason: string }>;

/** What `toClaude` renders. */
export type ClaudeResult = Readonly<{
	/** The native hook event the output answers. */
	hookEvent: string;
	/** The gate's decision (tool events), or a Stop block when `deny`. */
	decision?: GateDecision;
	/** Context for the agent (SessionStart, PostToolUse) or the Stop summary. */
	context?: string;
}>;

export type ClaudeOutput = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

const HOST = "claude-code";

/**
 * The tools maina gates (see `mapTool`), as an anchored Claude Code matcher
 * regex. Every other tool is ignored, so the hook need not run for it.
 */
const GATED_TOOLS =
	"^(Bash|Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|WebFetch|mcp__.*)$";

/**
 * The hooks maina registers, by lifecycle point (the Claude Code plugin is
 * generated from it). PostToolUse is ignored, so file edits register nothing.
 */
export const CLAUDE_HOOK_MAP: HostHookMap = {
	"session.start": [{ event: "SessionStart" }],
	"tool.before": [{ event: "PreToolUse", matcher: GATED_TOOLS }],
	"permission.request": [{ event: "PermissionRequest", matcher: GATED_TOOLS }],
	"file.edited": [],
	"session.stop": [{ event: "Stop" }],
};

/** Every Claude Code hook event the adapter answers; the runtime routes on it. */
export const CLAUDE_HOOK_EVENTS: ReadonlySet<string> = new Set([
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"SessionStart",
	"Stop",
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/** Claude Code's permission modes, in core's spelling. */
const PERMISSION_MODES: Readonly<Record<string, string>> = {
	default: "default",
	plan: "plan",
	acceptEdits: "accept_edits",
	bypassPermissions: "bypass",
};

// ── fromClaude ──────────────────────────────────────────────────────────────

type ToolInput = Readonly<Record<string, unknown>>;

/** A tool's gate event kind and input, or a reason it is malformed. */
type Mapped =
	| Readonly<{ kind: string; input: Readonly<Record<string, unknown>> }>
	| Readonly<{ malformed: string }>
	| null;

const needs = (tool: string, field: string): Mapped => ({
	malformed: `${tool} without ${field}`,
});

const fileWrite = (
	tool: string,
	path: string | undefined,
	content: string | undefined,
): Mapped => {
	if (path === undefined) return needs(tool, "a path");
	return {
		kind: "file.write",
		input: content === undefined ? { path } : { path, content },
	};
};

/** The text a multi-edit writes: each replacement, one per line. */
function multiEditContent(edits: unknown): string | undefined {
	if (!Array.isArray(edits)) return undefined;
	const parts = edits.flatMap((e) =>
		isRecord(e) && typeof e.new_string === "string" ? [e.new_string] : [],
	);
	return parts.join("\n");
}

/** `mcp__<server>__<tool>`, named by `mcp_server.name` when the host sent it. */
function mcpCall(
	toolName: string,
	toolInput: ToolInput,
	mcpServer: unknown,
): Mapped {
	const named = isRecord(mcpServer) ? text(mcpServer.name) : undefined;
	const rest = toolName.slice("mcp__".length);
	const prefix = named === undefined ? undefined : `${named}__`;
	const [server, tool] =
		prefix !== undefined && rest.startsWith(prefix)
			? [named, rest.slice(prefix.length)]
			: splitOnce(rest, "__");
	if (text(server) === undefined || text(tool) === undefined) {
		return { malformed: `unreadable MCP tool name ${toolName}` };
	}
	return { kind: "mcp", input: { server, tool, arguments: toolInput } };
}

function splitOnce(value: string, sep: string): readonly [string, string] {
	const at = value.indexOf(sep);
	return at < 0
		? [value, ""]
		: [value.slice(0, at), value.slice(at + sep.length)];
}

/**
 * What a Grep over `dir` reads when its `glob` narrows the files: the glob
 * under `dir` with its wildcards dropped, so `.env*` reads as `.env` and
 * `**\/*.pem` as a `.pem` file, and core's secret-path rules see the target.
 * Without this a Grep with `glob: ".env"` reads as a plain workspace read.
 */
export function searchTarget(dir: string, glob: string | undefined): string {
	if (glob === undefined) return dir;
	const literal = glob
		.replace(/[*?]/g, "")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "");
	return literal === "" || literal === "/"
		? dir
		: `${dir.replace(/\/+$/, "")}/${literal}`;
}

function mapTool(
	tool: string,
	input: ToolInput,
	cwd: string | undefined,
	mcpServer: unknown,
): Mapped {
	switch (tool) {
		case "Bash": {
			const command = text(input.command);
			return command === undefined
				? needs(tool, "a command")
				: { kind: "shell", input: { command } };
		}
		case "Write":
			return fileWrite(tool, text(input.file_path), text(input.content));
		case "Edit":
			return fileWrite(tool, text(input.file_path), text(input.new_string));
		case "MultiEdit":
			return fileWrite(
				tool,
				text(input.file_path),
				multiEditContent(input.edits),
			);
		case "NotebookEdit":
			return fileWrite(tool, text(input.notebook_path), text(input.new_source));
		case "Read": {
			const path = text(input.file_path);
			return path === undefined
				? needs(tool, "a path")
				: { kind: "file.read.outside", input: { path } };
		}
		// Searches read what is under `path`, the working directory by default.
		// Glob only lists names; Grep reads contents, narrowed by its `glob`.
		case "Grep":
		case "Glob": {
			const dir = text(input.path) ?? cwd;
			if (dir === undefined) return needs(tool, "a path");
			const path = tool === "Grep" ? searchTarget(dir, text(input.glob)) : dir;
			return { kind: "file.read.outside", input: { path } };
		}
		case "WebFetch": {
			const url = text(input.url);
			return url === undefined
				? needs(tool, "a url")
				: { kind: "network", input: { url, method: "GET" } };
		}
		default:
			return tool.startsWith("mcp__") ? mcpCall(tool, input, mcpServer) : null;
	}
}

const malformed = (hookEvent: string, reason: string): ClaudeEvent => ({
	type: "malformed",
	hookEvent,
	reason,
});

function gateEvent(
	hookEvent: GateHookEvent,
	payload: Readonly<Record<string, unknown>>,
	cwd: string | undefined,
): ClaudeEvent {
	const tool = text(payload.tool_name);
	if (tool === undefined) return malformed(hookEvent, "no tool_name");
	if (!isRecord(payload.tool_input)) {
		return malformed(hookEvent, `${tool} without a tool_input object`);
	}
	const mapped = mapTool(tool, payload.tool_input, cwd, payload.mcp_server);
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
	const input = {
		host: HOST,
		sessionId: typeof payload.session_id === "string" ? payload.session_id : "",
		permissionMode: mode,
		...mapped.input,
	};
	const event: GateEvent =
		cwd === undefined
			? { kind: mapped.kind, input }
			: { kind: mapped.kind, input, cwd };
	return { type: "gate", hookEvent, tool, event };
}

function sessionEvent(
	hookEvent: "SessionStart" | "Stop",
	payload: Readonly<Record<string, unknown>>,
	cwd: string | undefined,
): ClaudeEvent {
	const sessionId = text(payload.session_id);
	if (sessionId === undefined) return malformed(hookEvent, "no session_id");
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
 * Normalises one hook payload. `configured` is the event the hook was
 * registered for (the launcher's `hook <event>` argument): it names the
 * output when the payload is unreadable, and a payload for another event
 * is malformed.
 */
export function fromClaude(
	hookInput: unknown,
	configured?: string,
): ClaudeEvent {
	const fallbackEvent = configured ?? "PreToolUse";
	if (!isRecord(hookInput)) {
		return malformed(fallbackEvent, "the hook input is not a JSON object");
	}
	const hookEvent = text(hookInput.hook_event_name);
	if (hookEvent === undefined)
		return malformed(fallbackEvent, "no hook_event_name");
	if (configured !== undefined && hookEvent !== configured) {
		return malformed(
			configured,
			`a ${hookEvent} payload for a ${configured} hook`,
		);
	}
	if (!CLAUDE_HOOK_EVENTS.has(hookEvent)) {
		return malformed(hookEvent, `unknown hook event ${hookEvent}`);
	}
	const cwd = text(hookInput.cwd);
	switch (hookEvent) {
		case "PreToolUse":
		case "PermissionRequest":
			return gateEvent(hookEvent, hookInput, cwd);
		case "SessionStart":
		case "Stop":
			return sessionEvent(hookEvent, hookInput, cwd);
		default:
			return {
				type: "ignored",
				hookEvent,
				reason: `maina does not gate ${hookEvent}`,
			};
	}
}

// ── toClaude ────────────────────────────────────────────────────────────────

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const ok = (value: unknown): ClaudeOutput => ({
	exitCode: 0,
	stdout: line(value),
	stderr: "",
});

/** A deny: the JSON for hosts that read it, exit 2 and stderr for the rest. */
const denied = (value: unknown, reason: string): ClaudeOutput => ({
	exitCode: 2,
	stdout: line(value),
	stderr: `${reason}\n`,
});

function preToolUse(decision: GateDecision): ClaudeOutput {
	const out = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: decision.verdict,
			permissionDecisionReason: decision.reason,
		},
	};
	return decision.verdict === "deny" ? denied(out, decision.reason) : ok(out);
}

function permissionRequest(decision: GateDecision): ClaudeOutput {
	if (decision.verdict === "ask") return ok({});
	const behavior =
		decision.verdict === "deny"
			? { behavior: "deny", message: decision.reason }
			: { behavior: "allow" };
	const out = {
		hookSpecificOutput: {
			hookEventName: "PermissionRequest",
			decision: behavior,
		},
	};
	return decision.verdict === "deny" ? denied(out, decision.reason) : ok(out);
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

function stop(result: ClaudeResult): ClaudeOutput {
	if (result.decision?.verdict === "deny") {
		return ok({ decision: "block", reason: result.decision.reason });
	}
	return ok(
		result.context === undefined ? {} : { systemMessage: result.context },
	);
}

/**
 * Renders `result` for Claude Code. An event with nothing to say, or one
 * maina does not handle, prints `{}`: the host's own flow stands.
 */
export function toClaude(result: ClaudeResult): ClaudeOutput {
	const { hookEvent, decision, context } = result;
	switch (hookEvent) {
		case "PreToolUse":
			return decision === undefined ? ok({}) : preToolUse(decision);
		case "PermissionRequest":
			return decision === undefined ? ok({}) : permissionRequest(decision);
		case "SessionStart":
		case "PostToolUse":
			return withContext(hookEvent, context);
		case "Stop":
			return stop(result);
		default:
			return ok({});
	}
}
