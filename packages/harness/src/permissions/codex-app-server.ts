/**
 * Codex app-server approvals (FR-HAR-2).
 *
 * `codex app-server` speaks JSON-RPC over stdio (newline-delimited, without
 * the `jsonrpc` field) and, under an approval policy that asks, sends its
 * client a request before it runs a command or applies a patch. Driven that
 * way, Codex keeps a gate even with its own sandbox off (maina's sandbox
 * enforces instead), unlike `codex-acp` in `agent-full-access`, which stops
 * asking altogether.
 *
 * `connectCodexAppServer` is the transport: it serves the server's requests
 * by method and hands out its notifications. `attachCodexApprovals` answers
 * every approval request from the gate and logs it:
 *
 *   item/commandExecution/requestApproval   `shell`         accept | decline
 *     plus `network` for the host when it asks for network access
 *   item/fileChange/requestApproval         `file.write`    accept | decline
 *     per path the item announced in `item/started` or last updated in
 *     `item/fileChange/patchUpdated` (a move writes both ends)
 *   execCommandApproval (legacy)            `shell`         approved | denied
 *   applyPatchApproval (legacy)             `file.write`    approved | denied
 *
 * A standing approval (`acceptForSession`, `approved_for_session`) is never
 * given: it would let later calls skip the gate. For the same reason a
 * request that would grant more than the call itself is declined outright:
 * a file change asking to `grantRoot` writes for the rest of the session, a
 * command asking for `additionalPermissions`, and input to a running
 * terminal (`kind: writeStdin`), whose text the request does not carry.
 * `ask` declines, since a run has nobody to ask. A request whose target
 * cannot be read (no command, a file change for an item never announced) is
 * declined. Any other server request gets a JSON-RPC "method not found"
 * error, never an approval.
 *
 * Calls go through `../events` as the ACP tool calls they amount to, so the
 * gate judges Codex's actions exactly as an ACP agent's. A file change's
 * content, for the gate's secret scan, is the diff Codex reports.
 */

import { resolve } from "node:path";
import type { ToolCallUpdate } from "@agentclientprotocol/sdk";
import { gateEvents } from "../events";
import { type GateBridge, judgeActions, logPermission } from "./judge";

type Payload = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Payload =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

// ── transport ───────────────────────────────────────────────────────────────

type Handler = (params: unknown) => unknown;

export type CodexNotification = Readonly<{ method: string; params: unknown }>;

export type CodexRpc = Readonly<{
	/** Serves the server's `method` requests; returns the unregister function. */
	handle: (method: string, handler: Handler) => () => void;
	/** Hears every server notification; returns the unsubscribe function. */
	onNotification: (listener: (n: CodexNotification) => void) => () => void;
	/** Resolves once the server's output has ended. */
	closed: Promise<void>;
}>;

type CodexIo = Readonly<{
	/** The server's stdin. */
	input: WritableStream<Uint8Array>;
	/** The server's stdout. */
	output: ReadableStream<Uint8Array>;
}>;

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export function connectCodexAppServer(io: CodexIo): CodexRpc {
	const handlers = new Map<string, Handler>();
	const listeners = new Set<(n: CodexNotification) => void>();
	const writer = io.input.getWriter();
	const encoder = new TextEncoder();
	let writing = Promise.resolve();
	const send = (message: Payload): void => {
		writing = writing
			.then(() => writer.write(encoder.encode(`${JSON.stringify(message)}\n`)))
			// A closed pipe: the server is gone and nobody waits for the answer.
			.catch(() => undefined);
	};

	const serve = async (id: unknown, method: string, params: unknown) => {
		const handler = handlers.get(method);
		if (handler === undefined) {
			send({
				id,
				error: {
					code: METHOD_NOT_FOUND,
					message: `maina does not serve ${method}`,
				},
			});
			return;
		}
		try {
			send({ id, result: await handler(params) });
		} catch (e) {
			send({
				id,
				error: {
					code: INTERNAL_ERROR,
					message: e instanceof Error ? e.message : String(e),
				},
			});
		}
	};

	const dispatch = (line: string): void => {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (!isRecord(message) || typeof message.method !== "string") return;
		const { id, method, params } = message;
		if (id === undefined) {
			for (const listener of listeners) listener({ method, params });
			return;
		}
		void serve(id, method, params);
	};

	const closed = (async () => {
		const decoder = new TextDecoder();
		let buffered = "";
		try {
			for await (const chunk of io.output) {
				buffered += decoder.decode(chunk, { stream: true });
				for (;;) {
					const newline = buffered.indexOf("\n");
					if (newline < 0) break;
					const line = buffered.slice(0, newline).trim();
					buffered = buffered.slice(newline + 1);
					if (line !== "") dispatch(line);
				}
			}
		} catch {
			// A broken pipe ends the connection like a clean end does.
		}
	})();

	return {
		handle: (method, handler) => {
			handlers.set(method, handler);
			return () => {
				if (handlers.get(method) === handler) handlers.delete(method);
			};
		},
		onNotification: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		closed,
	};
}

// ── approvals ───────────────────────────────────────────────────────────────

type CodexContext = Readonly<{
	/** The worker's worktree: relative paths and a missing `cwd` resolve here. */
	root: string;
}>;

type Change = Readonly<{
	path: string;
	/** The new text or diff, when the change writes one. */
	content?: string;
	/** A move's destination. */
	movedTo?: string;
}>;

/** One file-change call as the ACP edit it amounts to. */
function editCall(
	id: string,
	changes: readonly Change[],
	root: string,
): ToolCallUpdate {
	const abs = (path: string): string => resolve(root, path);
	return {
		toolCallId: id,
		kind: "edit",
		title: "apply patch",
		locations: changes.flatMap((c) => [
			{ path: abs(c.path) },
			...(c.movedTo === undefined ? [] : [{ path: abs(c.movedTo) }]),
		]),
		content: changes.flatMap((c) =>
			c.content === undefined
				? []
				: [{ type: "diff" as const, path: abs(c.path), newText: c.content }],
		),
	};
}

/** `item/started` file-change changes: `{ path, kind: { type, move_path }, diff }`. */
function itemChanges(changes: unknown): readonly Change[] {
	if (!Array.isArray(changes)) return [];
	return changes.flatMap((c): Change[] => {
		if (!isRecord(c)) return [];
		const path = text(c.path);
		if (path === undefined) return [];
		const kind = isRecord(c.kind) ? c.kind : {};
		const movedTo = text(kind.move_path);
		const content = kind.type === "delete" ? undefined : text(c.diff);
		return [
			{
				path,
				...(content === undefined ? {} : { content }),
				...(movedTo === undefined ? {} : { movedTo }),
			},
		];
	});
}

/** Legacy `fileChanges`: `{ [path]: { type, content | unified_diff, move_path } }`. */
function patchChanges(fileChanges: unknown): readonly Change[] {
	if (!isRecord(fileChanges)) return [];
	return Object.entries(fileChanges).map(([path, change]): Change => {
		const c = isRecord(change) ? change : {};
		const content =
			c.type === "add"
				? text(c.content)
				: c.type === "update"
					? text(c.unified_diff)
					: undefined;
		const movedTo = text(c.move_path);
		return {
			path,
			...(content === undefined ? {} : { content }),
			...(movedTo === undefined ? {} : { movedTo }),
		};
	});
}

type Approval = Readonly<{
	sessionId: string;
	id: string;
	/** The calls to judge, or undefined when the target cannot be read. */
	calls: readonly ToolCallUpdate[] | undefined;
	/** Why the request is declined whatever the gate says: it asks for more than the call. */
	refused?: string;
}>;

/** A request for more than the call: a standing grant the gate never judged. */
function refusal(p: Payload): string | undefined {
	const grantRoot = text(p.grantRoot);
	if (grantRoot !== undefined) {
		return `asks for a standing write grant under ${grantRoot}, which would let later writes skip the gate; declined`;
	}
	if (
		p.additionalPermissions !== undefined &&
		p.additionalPermissions !== null
	) {
		return "asks for permissions beyond the command, which the gate cannot judge; declined";
	}
	if (p.kind !== undefined && p.kind !== null && p.kind !== "command") {
		return `a ${String(p.kind)} approval carries nothing the gate can judge; declined`;
	}
	return undefined;
}

/** The host a command asks network access for, as the fetch it amounts to. */
function networkCall(id: string, context: unknown): ToolCallUpdate[] {
	if (!isRecord(context)) return [];
	const host = text(context.host);
	if (host === undefined) return [];
	const scheme = text(context.protocol) ?? "https";
	return [
		{
			toolCallId: id,
			kind: "fetch",
			title: "network access",
			rawInput: { url: `${scheme}://${host}` },
		},
	];
}

const HOST = "codex";

/**
 * Answers every approval request `rpc` receives from the gate. Returns the
 * function that detaches it; requests after that get "method not found".
 */
export function attachCodexApprovals(
	rpc: CodexRpc,
	bridge: GateBridge,
	ctx: CodexContext,
): () => void {
	const { root } = ctx;
	const announced = new Map<string, readonly Change[]>();
	const unsubscribe = rpc.onNotification(({ method, params }) => {
		if (!isRecord(params)) return;
		const item = params.item;
		if (!isRecord(item) || item.type !== "fileChange") return;
		const id = text(item.id);
		if (id === undefined) return;
		// A finished item asks nothing more: forget it.
		if (method === "item/started") announced.set(id, itemChanges(item.changes));
		else if (method === "item/completed") announced.delete(id);
	});
	// A patch that grows after `item/started` is judged as it now stands.
	const unsubscribePatch = rpc.onNotification(({ method, params }) => {
		if (method !== "item/fileChange/patchUpdated" || !isRecord(params)) return;
		const id = text(params.itemId);
		if (id !== undefined) announced.set(id, itemChanges(params.changes));
	});

	const answer =
		(read: (p: Payload) => Approval, decisions: readonly [string, string]) =>
		(params: unknown) => {
			const approval = read(isRecord(params) ? params : {});
			const each = (approval.calls ?? []).map((call) =>
				gateEvents(call, { host: HOST, sessionId: approval.sessionId, root }),
			);
			const normalised = {
				gate: each.flatMap((n) => n.gate),
				opaque: approval.calls === undefined || each.some((n) => n.opaque),
			};
			const judged =
				approval.refused === undefined
					? judgeActions(bridge, normalised.gate, normalised.opaque)
					: {
							verdict: "deny" as const,
							reason: approval.refused,
							degraded: false,
							decisionIds: [],
						};
			const decision = judged.verdict === "allow" ? decisions[0] : decisions[1];
			logPermission(bridge, {
				source: "codex-app-server",
				host: HOST,
				sessionId: approval.sessionId,
				toolCallId: approval.id,
				gate: normalised.gate,
				opaque: normalised.opaque,
				...judged,
				answer: decision,
			});
			return { decision };
		};

	const command = (
		id: string,
		cmd: unknown,
		cwd: unknown,
	): ToolCallUpdate[] | undefined =>
		cmd === undefined || cmd === null
			? undefined
			: [
					{
						toolCallId: id,
						kind: "execute",
						title: "command",
						rawInput: { command: cmd, cwd: text(cwd) ?? root },
					},
				];

	const V2: readonly [string, string] = ["accept", "decline"];
	const LEGACY: readonly [string, string] = ["approved", "denied"];
	const unregister = [
		rpc.handle(
			"item/commandExecution/requestApproval",
			answer((p) => {
				const id = text(p.itemId) ?? "";
				const refused = refusal(p);
				const calls = command(id, p.command, p.cwd);
				return {
					sessionId: text(p.threadId) ?? "",
					id,
					calls:
						calls === undefined
							? undefined
							: [...calls, ...networkCall(id, p.networkApprovalContext)],
					...(refused === undefined ? {} : { refused }),
				};
			}, V2),
		),
		rpc.handle(
			"item/fileChange/requestApproval",
			answer((p) => {
				const id = text(p.itemId) ?? "";
				const changes = announced.get(id);
				const refused = refusal(p);
				return {
					sessionId: text(p.threadId) ?? "",
					id,
					calls:
						changes === undefined || changes.length === 0
							? undefined
							: [editCall(id, changes, root)],
					...(refused === undefined ? {} : { refused }),
				};
			}, V2),
		),
		rpc.handle(
			"execCommandApproval",
			answer((p) => {
				const id = text(p.callId) ?? "";
				return {
					sessionId: text(p.conversationId) ?? "",
					id,
					calls: command(id, p.command, p.cwd),
				};
			}, LEGACY),
		),
		rpc.handle(
			"applyPatchApproval",
			answer((p) => {
				const id = text(p.callId) ?? "";
				const changes = patchChanges(p.fileChanges);
				const refused = refusal(p);
				return {
					sessionId: text(p.conversationId) ?? "",
					id,
					calls:
						changes.length === 0 ? undefined : [editCall(id, changes, root)],
					...(refused === undefined ? {} : { refused }),
				};
			}, LEGACY),
		),
	];
	return () => {
		unsubscribe();
		unsubscribePatch();
		for (const off of unregister) off();
	};
}
