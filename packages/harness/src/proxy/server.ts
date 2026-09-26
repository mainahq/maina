/**
 * ACP proxy mode (FR-HAR-3): `maina acp --agent <name>` for editors.
 *
 * An editor (Zed, a JetBrains IDE) launches maina as its ACP agent; the
 * proxy launches the real agent and passes every line between the two
 * through `./forward`, which forwards each one as it is, except that the
 * gate answers the agent's permission requests first (see there).
 *
 * The proxy serves one connection. It ends when either side goes away,
 * and cleans up the other: the editor hanging up stops the agent (close
 * stdin, TERM, then KILL); the agent exiting closes the editor's side and
 * stops reading it. `done` then resolves with the receipt of the session:
 * who ended it, every session with its turns, tool calls and files, and
 * every permission answer. An agent that cannot be started resolves `done`
 * with the error, after closing the editor's side.
 */

import type { Result } from "@mainahq/core";
import type { HarnessError } from "../events";
import type { GateBridge } from "../permissions/judge";
import { type AgentSpec, type SpawnAgent, spawnAgent } from "../worker";
import {
	closeProxyState,
	fromAgent,
	fromEditor,
	initialProxyState,
	type Outgoing,
	type PermissionEntry,
	type ProxyState,
	type SessionSummary,
	type Side,
	summarise,
} from "./forward";

/** The editor's end: what it writes (maina's stdin) and reads (maina's stdout). */
type EditorIo = Readonly<{
	input: ReadableStream<Uint8Array>;
	output: WritableStream<Uint8Array>;
}>;

type ProxyOptions = Readonly<{
	editor: EditorIo;
	agent: AgentSpec;
	/** The agent's cwd, and the root of a session the proxy never saw start. */
	root: string;
	/** The gate, the policy and the permission log. */
	bridge: GateBridge;
}>;

type ProxyDeps = Readonly<{
	spawn?: SpawnAgent;
	/** How long a stopped agent gets between SIGTERM and SIGKILL. */
	killGraceMs?: number;
	now?: () => number;
}>;

export type ProxyReceipt = Readonly<{
	agent: string;
	/** The side that went away first. */
	endedBy: Side;
	/** The agent's exit code, when it was the agent that went away. */
	agentExitCode?: number | null;
	startedAt: number;
	endedAt: number;
	sessions: readonly SessionSummary[];
	permissions: readonly PermissionEntry[];
}>;

type Proxy = Readonly<{
	/** Resolves once both sides are closed. */
	done: Promise<Result<ProxyReceipt, HarnessError>>;
}>;

const KILL_GRACE_MS = 2000;

const encoder = new TextEncoder();

/** Waits for `promise`, but no longer than `ms`; undefined on a timeout. */
async function within<T>(
	promise: Promise<T>,
	ms: number,
): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), ms);
	});
	const value = await Promise.race([promise, timeout]);
	clearTimeout(timer);
	return value;
}

/** Serialised writes to one side; a side that went away drops the rest. */
function sender(stream: WritableStream<Uint8Array>): Readonly<{
	send: (line: string) => Promise<void>;
	idle: () => Promise<void>;
	close: () => Promise<void>;
}> {
	const writer = stream.getWriter();
	let tail: Promise<void> = Promise.resolve();
	let broken = false;
	return {
		send: (line) => {
			tail = tail
				.then(() =>
					broken ? undefined : writer.write(encoder.encode(`${line}\n`)),
				)
				.catch(() => {
					broken = true;
				});
			return tail;
		},
		idle: () => tail,
		close: async () => {
			await tail;
			await writer.close().catch(() => undefined);
		},
	};
}

/** Calls `onLine` with each ndjson line, in order, until the stream ends. */
async function pump(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	onLine: (line: string) => Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const chunk = await reader.read().catch(() => ({ done: true as const }));
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
			const line = buffer.slice(0, i);
			buffer = buffer.slice(i + 1);
			if (line.trim() !== "") await onLine(line);
		}
	}
	buffer += decoder.decode();
	if (buffer.trim() !== "") await onLine(buffer);
}

export function startProxy(options: ProxyOptions, deps: ProxyDeps = {}): Proxy {
	const now = deps.now ?? Date.now;
	const killGraceMs = deps.killGraceMs ?? KILL_GRACE_MS;
	const { bridge, editor } = options;

	const done = (async (): Promise<Result<ProxyReceipt, HarnessError>> => {
		const startedAt = now();
		const toEditor = sender(editor.output);
		const editorReader = editor.input.getReader();
		const spawned = (deps.spawn ?? spawnAgent)(options.agent, options.root);
		if (!spawned.ok) {
			await within(toEditor.close(), killGraceMs);
			await editorReader.cancel().catch(() => undefined);
			return spawned;
		}
		const child = spawned.value;
		const toAgent = sender(child.input);
		const senders: Readonly<Record<Side, ReturnType<typeof sender>>> = {
			editor: toEditor,
			agent: toAgent,
		};

		let state: ProxyState = initialProxyState(options.agent.name, options.root);
		const deliver = async (out: readonly Outgoing[]): Promise<void> => {
			for (const { to, line } of out) await senders[to].send(line);
		};
		// The router never throws; if it ever did, the line still goes through.
		const route =
			(step: typeof fromEditor, to: Side) =>
			(line: string): Promise<void> => {
				try {
					const next = step(bridge, state, line);
					state = next.state;
					return deliver(next.out);
				} catch {
					return deliver([{ to, line }]);
				}
			};

		const editorGone = pump(editorReader, route(fromEditor, "agent")).then(
			() => "editor" as const,
		);
		const agentGone = pump(
			child.output.getReader(),
			route(fromAgent, "editor"),
		).then(() => "agent" as const);
		const endedBy = await Promise.race([editorGone, agentGone]);

		let agentExitCode: number | null | undefined;
		if (endedBy === "editor") {
			await within(toAgent.idle(), killGraceMs);
			await child.stop(killGraceMs);
			await within(agentGone, killGraceMs);
			await within(toEditor.close(), killGraceMs);
		} else {
			// What the agent said last still reaches the editor, then its side closes.
			await within(toEditor.close(), killGraceMs);
			await editorReader.cancel().catch(() => undefined);
			agentExitCode = await within(child.exited, killGraceMs);
			await child.stop(killGraceMs);
			await within(editorGone, killGraceMs);
		}

		const closed = closeProxyState(bridge, state);
		return {
			ok: true,
			value: {
				agent: options.agent.name,
				endedBy,
				...(endedBy === "agent"
					? { agentExitCode: agentExitCode ?? null }
					: {}),
				startedAt,
				endedAt: now(),
				sessions: summarise(closed),
				permissions: closed.permissions,
			},
		};
	})();

	return { done };
}
