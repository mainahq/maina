/**
 * Normalised harness events (FR-HAR-1). Pure: no I/O.
 *
 * An ACP agent reports what it does as `session/update` notifications and
 * asks before acting with `session/request_permission`. This module folds
 * those into the events a `Run` streams, and turns every tool call into the
 * core gate's `GateEvent`s so the gate judges an ACP agent's actions exactly
 * as it judges a hooked host's. It normalises; it never decides.
 *
 *   execute              `shell`, from `rawInput.command` (+ `cwd`)
 *   edit, delete, move   one `file.write` per path it touches (diffs,
 *                        locations, `rawInput` paths); a move writes both ends
 *   read                 `file.read.outside` per path outside the root
 *   fetch                `network`, from `rawInput.url`
 *   `mcp__<server>__<tool>` names
 *                        `mcp`, whatever the kind
 *   search, think, switch_mode, other
 *                        not gated
 *
 * A call that acts but whose target cannot be read is `opaque`: it carries
 * no gate events, and later stages must treat it as unknown (fail closed),
 * never as allowed.
 *
 * ACP sends a tool call once and then partial `tool_call_update`s; the
 * reducer merges each update into the call it updates, so every event
 * carries the whole call as known so far.
 */

import { isAbsolute, relative, resolve } from "node:path";
import type {
	ContentBlock,
	PermissionOption,
	PermissionOptionKind,
	RequestPermissionRequest,
	SessionUpdate,
	StopReason,
	ToolCallContent,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
} from "@agentclientprotocol/sdk";
import type { GateEvent, Verdict } from "@mainahq/core";

export type DiffContent = Readonly<{
	path: string;
	oldText?: string;
	newText: string;
}>;

/** A tool call as known so far: the first report merged with every update. */
export type ToolCallState = Readonly<{
	toolCallId: string;
	title: string;
	/** The agent's tool name, when it sends one (`mcp__github__create_issue`). */
	name?: string;
	kind: ToolKind;
	status: ToolCallStatus;
	/** Paths the call touches, as the agent reported them. */
	locations: readonly string[];
	/** The latest diffs the agent reported for the call. */
	diffs: readonly DiffContent[];
	rawInput?: unknown;
}>;

/** A permission request, normalised: what the policy is asked to judge. */
export type PermissionRequest = Readonly<{
	toolCallId: string;
	call: ToolCallState;
	gate: readonly GateEvent[];
	opaque: boolean;
	options: readonly PermissionOption[];
}>;

export type HarnessErrorCode =
	| "spawn_failed"
	| "handshake_failed"
	| "protocol_mismatch"
	| "agent_exited";

export type HarnessError = Readonly<{
	code: HarnessErrorCode;
	message: string;
}>;

export type BudgetKind = "wall_clock" | "tool_calls";

/**
 * How a run ended. `stopped` is a turn the agent ended short of its goal
 * (`max_tokens`, `max_turn_requests`, `refusal`); `stopReason` says which.
 */
export type EndEvent = Readonly<
	| { type: "end"; state: "completed" | "stopped"; stopReason: StopReason }
	| { type: "end"; state: "cancelled"; stopReason?: StopReason }
	| {
			type: "end";
			state: "budget_exceeded";
			budget: BudgetKind;
			stopReason?: StopReason;
	  }
	| { type: "end"; state: "failed"; error: HarnessError }
>;

/** Everything a `Run` streams. `end` is always the last event. */
export type HarnessEvent =
	| Readonly<{
			type: "session";
			sessionId: string;
			agent: string;
			protocolVersion: number;
	  }>
	| Readonly<{
			type: "message";
			role: "agent" | "thought" | "user";
			text: string;
	  }>
	| Readonly<{
			type: "tool";
			/** `call` for the first report, `update` for every later one. */
			update: "call" | "update";
			call: ToolCallState;
			gate: readonly GateEvent[];
			opaque: boolean;
	  }>
	| Readonly<{
			type: "diff";
			toolCallId: string;
			path: string;
			oldText?: string;
			newText: string;
	  }>
	| Readonly<{
			type: "permission";
			request: PermissionRequest;
			verdict: Verdict;
			/** The option the agent was answered with; absent when cancelled. */
			optionId?: string;
	  }>
	| EndEvent;

/** What every gate event of a run shares. */
export type NormaliseContext = Readonly<{
	/** `acp:<agent name>`. */
	host: string;
	sessionId: string;
	/** Absolute workspace root. */
	root: string;
}>;

export type NormaliseState = Readonly<{
	tools: ReadonlyMap<string, ToolCallState>;
	/** Diffs already reported, so a repeated one is not reported twice. */
	diffs: ReadonlySet<string>;
}>;

export const INITIAL_STATE: NormaliseState = {
	tools: new Map(),
	diffs: new Set(),
};

type Normalised = Readonly<{
	state: NormaliseState;
	events: readonly HarnessEvent[];
}>;

type Gated = Readonly<{ gate: readonly GateEvent[]; opaque: boolean }>;

type Payload = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Payload =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

// ── merging ─────────────────────────────────────────────────────────────────

function diffsOf(content: readonly ToolCallContent[]): readonly DiffContent[] {
	return content.flatMap((item): DiffContent[] => {
		if (item.type !== "diff") return [];
		return typeof item.oldText === "string"
			? [{ path: item.path, oldText: item.oldText, newText: item.newText }]
			: [{ path: item.path, newText: item.newText }];
	});
}

/** Folds one report of a call into what is known of it; absent fields keep. */
function mergeToolCall(
	previous: ToolCallState | undefined,
	update: ToolCallUpdate,
): ToolCallState {
	const name = update.name ?? previous?.name;
	const rawInput =
		update.rawInput !== undefined ? update.rawInput : previous?.rawInput;
	return {
		toolCallId: update.toolCallId,
		title: update.title ?? previous?.title ?? "",
		...(name === undefined || name === null ? {} : { name }),
		kind: update.kind ?? previous?.kind ?? "other",
		status: update.status ?? previous?.status ?? "pending",
		locations:
			update.locations?.map((l) => l.path) ?? previous?.locations ?? [],
		diffs:
			update.content === undefined || update.content === null
				? (previous?.diffs ?? [])
				: diffsOf(update.content),
		...(rawInput === undefined ? {} : { rawInput }),
	};
}

// ── gate events ─────────────────────────────────────────────────────────────

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One argv word as a shell reads it back. */
const shellQuote = (word: string): string =>
	SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

const isWords = (value: unknown): value is readonly string[] =>
	Array.isArray(value) && value.every((w) => typeof w === "string");

/** The command line of an execute call: a string, or argv quoted back. */
function commandOf(input: Payload): string | undefined {
	const { command, args } = input;
	const extra = isWords(args) ? args.map(shellQuote) : [];
	if (typeof command === "string") {
		return text([command, ...extra].join(" ").trim());
	}
	if (isWords(command) && command.length > 0) {
		return text([...command.map(shellQuote), ...extra].join(" "));
	}
	return undefined;
}

const PATH_KEYS = ["path", "file_path", "filePath", "destination"] as const;

/** Every distinct path a call reports, in the order first seen. */
function pathsOf(call: ToolCallState, input: Payload): readonly string[] {
	const fromInput = PATH_KEYS.flatMap((key) => {
		const value = text(input[key]);
		return value === undefined ? [] : [value];
	});
	const all = [
		...call.diffs.map((d) => d.path),
		...call.locations,
		...fromInput,
	];
	return [...new Set(all)];
}

function isInside(root: string, path: string): boolean {
	const rel = relative(root, resolve(root, path));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const MCP_NAME = /^mcp__(.+?)__(.+)$/;

function gateOf(call: ToolCallState, ctx: NormaliseContext): Gated {
	const base = {
		host: ctx.host,
		sessionId: ctx.sessionId,
		root: ctx.root,
		permissionMode: "unknown",
		untrusted: [],
	} as const;
	const input = isRecord(call.rawInput) ? call.rawInput : {};

	const mcp = call.name === undefined ? null : MCP_NAME.exec(call.name);
	if (mcp !== null) {
		const action = {
			server: mcp[1] as string,
			tool: mcp[2] as string,
			...(isRecord(call.rawInput) ? { input: call.rawInput } : {}),
		};
		return { gate: [{ ...base, kind: "mcp", action }], opaque: false };
	}

	switch (call.kind) {
		case "execute": {
			const command = commandOf(input);
			if (command === undefined) return { gate: [], opaque: true };
			const cwd = text(input.cwd);
			const action = cwd === undefined ? { command } : { command, cwd };
			return { gate: [{ ...base, kind: "shell", action }], opaque: false };
		}
		case "edit":
		case "delete":
		case "move": {
			const paths = pathsOf(call, input);
			const gate = paths.map((path): GateEvent => {
				const diff = call.diffs.findLast((d) => d.path === path);
				const action =
					diff === undefined ? { path } : { path, content: diff.newText };
				return { ...base, kind: "file.write", action };
			});
			return { gate, opaque: gate.length === 0 };
		}
		case "read": {
			const paths = pathsOf(call, input);
			const gate = paths
				.filter((path) => !isInside(ctx.root, path))
				.map(
					(path): GateEvent => ({
						...base,
						kind: "file.read.outside",
						action: { path },
					}),
				);
			return { gate, opaque: paths.length === 0 };
		}
		case "fetch": {
			const url = text(input.url);
			if (url === undefined) return { gate: [], opaque: true };
			return {
				gate: [{ ...base, kind: "network", action: { url } }],
				opaque: false,
			};
		}
		case "search":
		case "think":
		case "switch_mode":
		case "other":
			return { gate: [], opaque: false };
		default: {
			// A kind from a newer protocol: unknown, so opaque (fail closed).
			const _unknown: never = call.kind;
			return { gate: [], opaque: true };
		}
	}
}

// ── reducers ────────────────────────────────────────────────────────────────

function messageOf(
	role: "agent" | "thought" | "user",
	content: ContentBlock,
): readonly HarnessEvent[] {
	return content.type === "text"
		? [{ type: "message", role, text: content.text }]
		: [];
}

function toolEvents(
	state: NormaliseState,
	update: ToolCallUpdate,
	first: boolean,
	ctx: NormaliseContext,
): Normalised {
	const call = mergeToolCall(state.tools.get(update.toolCallId), update);
	const tools = new Map(state.tools).set(call.toolCallId, call);
	const tool: HarnessEvent = {
		type: "tool",
		update: first ? "call" : "update",
		call,
		...gateOf(call, ctx),
	};

	const reported =
		update.content === undefined || update.content === null
			? []
			: diffsOf(update.content);
	const diffs = new Set(state.diffs);
	const fresh = reported.filter((d) => {
		const key = `${call.toolCallId}\0${d.path}\0${d.oldText ?? ""}\0${d.newText}`;
		if (diffs.has(key)) return false;
		diffs.add(key);
		return true;
	});
	const diffEvents = fresh.map(
		(d): HarnessEvent => ({ type: "diff", toolCallId: call.toolCallId, ...d }),
	);
	return { state: { tools, diffs }, events: [tool, ...diffEvents] };
}

/**
 * Folds one `session/update` into the run: tool calls (with their gate
 * events and new diffs) and text messages. Plans, usage, mode and other
 * session bookkeeping yield no event.
 */
export function normaliseUpdate(
	state: NormaliseState,
	update: SessionUpdate,
	ctx: NormaliseContext,
): Normalised {
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
			return { state, events: messageOf("agent", update.content) };
		case "agent_thought_chunk":
			return { state, events: messageOf("thought", update.content) };
		case "user_message_chunk":
			return { state, events: messageOf("user", update.content) };
		case "tool_call":
			return toolEvents(state, update, true, ctx);
		case "tool_call_update":
			return toolEvents(state, update, false, ctx);
		default:
			return { state, events: [] };
	}
}

/** Normalises a permission request against the call it is about. */
export function normalisePermission(
	state: NormaliseState,
	params: RequestPermissionRequest,
	ctx: NormaliseContext,
): Readonly<{ state: NormaliseState; request: PermissionRequest }> {
	const call = mergeToolCall(
		state.tools.get(params.toolCall.toolCallId),
		params.toolCall,
	);
	const tools = new Map(state.tools).set(call.toolCallId, call);
	return {
		state: { ...state, tools },
		request: {
			toolCallId: call.toolCallId,
			call,
			...gateOf(call, ctx),
			options: params.options,
		},
	};
}

const PREFERENCE: Readonly<Record<Verdict, readonly PermissionOptionKind[]>> = {
	// Only a one-off allow: a standing one would outlive this verdict and let
	// the agent skip the policy for later calls, so none offered → cancelled.
	allow: ["allow_once"],
	// Headless: nobody is there to ask, so `ask` rejects (fail closed).
	ask: ["reject_once", "reject_always"],
	deny: ["reject_once", "reject_always"],
};

/** A known verdict: the keys of the (exhaustive) preference table. */
export const isVerdict = (value: unknown): value is Verdict =>
	typeof value === "string" && Object.hasOwn(PREFERENCE, value);

/**
 * The option that answers a verdict, or undefined (answer `cancelled`) when
 * the agent offers none that fits. Never an allow for a deny, and never a
 * standing allow; a reject may fall back to a standing reject.
 */
export function chooseOption(
	options: readonly PermissionOption[],
	verdict: Verdict,
): string | undefined {
	for (const kind of PREFERENCE[verdict]) {
		const option = options.find((o) => o.kind === kind);
		if (option !== undefined) return option.optionId;
	}
	return undefined;
}
