/**
 * The ACP proxy's router (FR-HAR-3). Pure: the gate and its log are
 * injected through the bridge; no I/O.
 *
 * In proxy mode an editor talks ACP to maina as if maina were the agent,
 * and maina talks ACP to the real agent. Each ndjson line either side
 * sends is handed to `fromEditor` / `fromAgent`, which returns the lines to
 * send on and the updated state. Every line is forwarded as the same bytes,
 * except one: an agent's `session/request_permission` goes through the gate
 * first.
 *
 *   allow   answered `allow_once` by the proxy; the editor is not asked
 *           (no allow-once option on offer: the editor is asked instead)
 *   deny    answered `reject_once` (or a standing reject, or `cancelled`)
 *           by the proxy; the editor never sees it
 *   ask     forwarded to the editor, with any standing allow removed so a
 *           later call cannot skip the gate; the editor's answer goes back
 *           to the agent as it is and is logged
 *
 * Along the way the router keeps what a receipt needs: the sessions, their
 * prompt turns and stop reasons, the tool calls and files each touched
 * (normalised as `../events` does for a run), and every permission answer.
 */

import type {
	PermissionOption,
	RequestPermissionRequest,
	SessionUpdate,
	StopReason,
} from "@agentclientprotocol/sdk";
import type { Verdict } from "@mainahq/core";
import {
	chooseOption,
	INITIAL_STATE,
	type NormaliseContext,
	type NormaliseState,
	normalisePermission,
	normaliseUpdate,
	type PermissionRequest,
} from "../events";
import {
	type GateBridge,
	judgeActions,
	logPermission,
} from "../permissions/judge";

export type Side = "editor" | "agent";

/** One line to send, without its newline. */
export type Outgoing = Readonly<{ to: Side; line: string }>;

/** How one permission request was answered, and by whom. */
export type PermissionEntry = Readonly<{
	sessionId: string;
	toolCallId: string;
	verdict: Verdict;
	reason: string;
	/** `gate` when the proxy answered, `editor` when the person did. */
	answeredBy: "gate" | "editor";
	/** The kind of option picked (`allow_once`, `reject_once`), or `cancelled`. */
	answer: string;
}>;

type SessionLog = Readonly<{
	sessionId: string;
	cwd: string;
	prompts: number;
	stopReasons: readonly StopReason[];
	normalise: NormaliseState;
	files: readonly string[];
}>;

/** An editor request whose answer the receipt needs. */
type Pending =
	| Readonly<{ method: "session/new"; cwd: string }>
	| Readonly<{ method: "session/load"; cwd: string; sessionId: string }>
	| Readonly<{ method: "session/prompt"; sessionId: string }>;

type Judgement = ReturnType<typeof judgeActions>;

/** A permission request the gate asked the editor about. */
type Asked = Readonly<{
	sessionId: string;
	host: string;
	request: PermissionRequest;
	judged: Judgement;
}>;

export type ProxyState = Readonly<{
	agent: string;
	/** Where a session the proxy never saw start is taken to run. */
	root: string;
	pending: ReadonlyMap<string, Pending>;
	sessions: ReadonlyMap<string, SessionLog>;
	asked: ReadonlyMap<string, Asked>;
	permissions: readonly PermissionEntry[];
}>;

type Step = Readonly<{ state: ProxyState; out: readonly Outgoing[] }>;

type Json = Readonly<Record<string, unknown>>;

export function initialProxyState(agent: string, root: string): ProxyState {
	return {
		agent,
		root,
		pending: new Map(),
		sessions: new Map(),
		asked: new Map(),
		permissions: [],
	};
}

const isRecord = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

function parse(line: string): Json | undefined {
	try {
		const value: unknown = JSON.parse(line);
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** A JSON-RPC id as a map key: `1` and `"1"` are different ids. */
const idKey = (id: unknown): string | undefined =>
	typeof id === "string" || typeof id === "number"
		? JSON.stringify(id)
		: undefined;

const forward = (state: ProxyState, to: Side, line: string): Step => ({
	state,
	out: [{ to, line }],
});

function sessionOf(
	state: ProxyState,
	sessionId: string,
	cwd?: string,
): SessionLog {
	return (
		state.sessions.get(sessionId) ?? {
			sessionId,
			cwd: cwd ?? state.root,
			prompts: 0,
			stopReasons: [],
			normalise: INITIAL_STATE,
			files: [],
		}
	);
}

const withSession = (state: ProxyState, session: SessionLog): ProxyState => ({
	...state,
	sessions: new Map(state.sessions).set(session.sessionId, session),
});

const contextOf = (
	state: ProxyState,
	session: SessionLog,
): NormaliseContext => ({
	host: `acp:${state.agent}`,
	sessionId: session.sessionId,
	root: session.cwd,
});

// ── editor → agent ──────────────────────────────────────────────────────────

/** What the receipt needs from an editor request, if anything. */
function pendingOf(
	method: string,
	params: Json,
	root: string,
): Pending | undefined {
	const cwd = str(params.cwd) ?? root;
	const sessionId = str(params.sessionId);
	switch (method) {
		case "session/new":
			return { method, cwd };
		case "session/load":
			return sessionId === undefined ? undefined : { method, cwd, sessionId };
		case "session/prompt":
			return sessionId === undefined ? undefined : { method, sessionId };
		default:
			return undefined;
	}
}

/** The kind of option the editor picked, from its answer to an ask. */
function editorAnswer(
	message: Json,
	options: readonly PermissionOption[],
): string {
	const result = isRecord(message.result) ? message.result : undefined;
	const outcome = isRecord(result?.outcome) ? result.outcome : undefined;
	if (outcome?.outcome !== "selected") return "cancelled";
	const optionId = str(outcome.optionId);
	return options.find((o) => o.optionId === optionId)?.kind ?? "cancelled";
}

function logAnswer(
	bridge: GateBridge,
	state: ProxyState,
	asked: Asked,
	answeredBy: PermissionEntry["answeredBy"],
	answer: string,
): ProxyState {
	const { request, judged } = asked;
	logPermission(bridge, {
		source: "acp",
		host: asked.host,
		sessionId: asked.sessionId,
		toolCallId: request.toolCallId,
		gate: request.gate,
		opaque: request.opaque,
		...judged,
		answer,
	});
	return {
		...state,
		permissions: [
			...state.permissions,
			{
				sessionId: asked.sessionId,
				toolCallId: request.toolCallId,
				verdict: judged.verdict,
				reason: judged.reason,
				answeredBy,
				answer,
			},
		],
	};
}

export function fromEditor(
	bridge: GateBridge,
	state: ProxyState,
	line: string,
): Step {
	const message = parse(line);
	if (message === undefined) return forward(state, "agent", line);
	const key = idKey(message.id);
	const method = str(message.method);

	if (method !== undefined) {
		const params = isRecord(message.params) ? message.params : {};
		const pending = pendingOf(method, params, state.root);
		if (key === undefined || pending === undefined) {
			return forward(state, "agent", line);
		}
		let next: ProxyState = {
			...state,
			pending: new Map(state.pending).set(key, pending),
		};
		if (pending.method === "session/prompt") {
			const session = sessionOf(next, pending.sessionId);
			next = withSession(next, { ...session, prompts: session.prompts + 1 });
		}
		return forward(next, "agent", line);
	}

	// The editor answering the agent: an ask the gate passed on is logged.
	const asked = key === undefined ? undefined : state.asked.get(key);
	if (key === undefined || asked === undefined) {
		return forward(state, "agent", line);
	}
	const rest = new Map(state.asked);
	rest.delete(key);
	const answer = editorAnswer(message, asked.request.options);
	const next = logAnswer(
		bridge,
		{ ...state, asked: rest },
		asked,
		"editor",
		answer,
	);
	return forward(next, "agent", line);
}

// ── agent → editor ──────────────────────────────────────────────────────────

/** The agent answering an editor request the receipt tracks. */
function recordResponse(
	state: ProxyState,
	key: string,
	message: Json,
): ProxyState {
	const pending = state.pending.get(key);
	if (pending === undefined) return state;
	const rest = new Map(state.pending);
	rest.delete(key);
	const next: ProxyState = { ...state, pending: rest };
	if (!isRecord(message.result)) return next;
	const { result } = message;
	switch (pending.method) {
		case "session/new": {
			const sessionId = str(result.sessionId);
			return sessionId === undefined
				? next
				: withSession(next, sessionOf(next, sessionId, pending.cwd));
		}
		case "session/load":
			return withSession(next, sessionOf(next, pending.sessionId, pending.cwd));
		case "session/prompt": {
			const stopReason = str(result.stopReason) as StopReason | undefined;
			if (stopReason === undefined) return next;
			const session = sessionOf(next, pending.sessionId);
			return withSession(next, {
				...session,
				stopReasons: [...session.stopReasons, stopReason],
			});
		}
	}
}

/**
 * Folds a `session/update` into its session: tool calls and the files
 * their diffs touch. An update the normaliser cannot read changes nothing;
 * it is still forwarded.
 */
function recordUpdate(state: ProxyState, params: Json): ProxyState {
	const sessionId = str(params.sessionId);
	const update = params.update;
	if (
		sessionId === undefined ||
		!isRecord(update) ||
		typeof update.sessionUpdate !== "string"
	) {
		return state;
	}
	const session = sessionOf(state, sessionId);
	try {
		const next = normaliseUpdate(
			session.normalise,
			update as unknown as SessionUpdate,
			contextOf(state, session),
		);
		const touched = next.events.flatMap((e) =>
			e.type === "diff" ? [e.path] : [],
		);
		return withSession(state, {
			...session,
			normalise: next.state,
			files: [...new Set([...session.files, ...touched])],
		});
	} catch {
		// A malformed update is the editor's to make sense of, not the proxy's.
		return state;
	}
}

const answerLine = (id: unknown, optionId: string | undefined): string =>
	JSON.stringify({
		jsonrpc: "2.0",
		id,
		result: {
			outcome:
				optionId === undefined
					? { outcome: "cancelled" }
					: { outcome: "selected", optionId },
		},
	});

const STANDING_ALLOW = "allow_always";

/** The request as the editor sees it: no standing allow on offer. */
function askLine(line: string, message: Json, params: Json): string {
	const options = params.options as readonly PermissionOption[];
	if (!options.some((o) => o.kind === STANDING_ALLOW)) return line;
	return JSON.stringify({
		...message,
		params: {
			...params,
			options: options.filter((o) => o.kind !== STANDING_ALLOW),
		},
	});
}

function gatePermission(
	bridge: GateBridge,
	state: ProxyState,
	line: string,
	message: Json,
	key: string,
): Step {
	const params = isRecord(message.params) ? message.params : {};
	const sessionId = str(params.sessionId);
	const toolCall = params.toolCall;
	if (
		sessionId === undefined ||
		!isRecord(toolCall) ||
		str(toolCall.toolCallId) === undefined ||
		!Array.isArray(params.options)
	) {
		// Not a request the gate can read: the editor answers it.
		return forward(state, "editor", line);
	}
	const session = sessionOf(state, sessionId);
	const ctx = contextOf(state, session);
	const normalised = normalisePermission(
		session.normalise,
		params as unknown as RequestPermissionRequest,
		ctx,
	);
	const { request } = normalised;
	const judged = judgeActions(bridge, request.gate, request.opaque);
	const next = withSession(state, { ...session, normalise: normalised.state });
	const asked: Asked = { sessionId, host: ctx.host, request, judged };

	const gateAnswers = judged.verdict === "deny" || judged.verdict === "allow";
	const optionId = gateAnswers
		? chooseOption(request.options, judged.verdict)
		: undefined;
	if (judged.verdict === "deny" || optionId !== undefined) {
		const kind =
			request.options.find((o) => o.optionId === optionId)?.kind ?? "cancelled";
		return {
			state: logAnswer(bridge, next, asked, "gate", kind),
			out: [{ to: "agent", line: answerLine(message.id, optionId) }],
		};
	}
	// An ask, or an allow with no allow-once to answer it: the person decides.
	return {
		state: { ...next, asked: new Map(next.asked).set(key, asked) },
		out: [{ to: "editor", line: askLine(line, message, params) }],
	};
}

export function fromAgent(
	bridge: GateBridge,
	state: ProxyState,
	line: string,
): Step {
	const message = parse(line);
	if (message === undefined) return forward(state, "editor", line);
	const key = idKey(message.id);
	const method = str(message.method);

	if (method === undefined) {
		const next =
			key === undefined ? state : recordResponse(state, key, message);
		return forward(next, "editor", line);
	}
	if (method === "session/request_permission" && key !== undefined) {
		try {
			return gatePermission(bridge, state, line, message, key);
		} catch {
			// A request the gate cannot read fails closed to `ask`: the person
			// in the editor decides.
			return forward(state, "editor", line);
		}
	}
	if (method === "session/update" && key === undefined) {
		const params = isRecord(message.params) ? message.params : {};
		return forward(recordUpdate(state, params), "editor", line);
	}
	return forward(state, "editor", line);
}

// ── the end ─────────────────────────────────────────────────────────────────

/** Ends the session: every ask the editor never answered is logged cancelled. */
export function closeProxyState(
	bridge: GateBridge,
	state: ProxyState,
): ProxyState {
	let next: ProxyState = { ...state, asked: new Map() };
	for (const asked of state.asked.values()) {
		next = logAnswer(bridge, next, asked, "editor", "cancelled");
	}
	return next;
}

export type SessionSummary = Readonly<{
	sessionId: string;
	cwd: string;
	prompts: number;
	stopReasons: readonly StopReason[];
	/** Distinct tool calls the agent reported or asked about. */
	toolCalls: number;
	/** Paths the agent's diffs touched, in the order first seen. */
	files: readonly string[];
}>;

export function summarise(state: ProxyState): readonly SessionSummary[] {
	return [...state.sessions.values()].map((s) => ({
		sessionId: s.sessionId,
		cwd: s.cwd,
		prompts: s.prompts,
		stopReasons: s.stopReasons,
		toolCalls: s.normalise.tools.size,
		files: s.files,
	}));
}
