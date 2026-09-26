/**
 * Hook routing (mainahq/maina#475). Pure: no I/O.
 *
 * `maina hook [--host <claude|codex|cursor>] <event>` answers one host hook.
 * Claude Code and Codex share their event names (PreToolUse, ...) but not
 * their answers: Codex runs a tool whose PreToolUse hook asks. So the host
 * a hook was registered for picks the adapter, and every generated
 * registration names it.
 *
 * Without `--host`, the event is the only hint: Cursor's camelCase events
 * are Cursor's, and a PascalCase event is ambiguous, so it fails closed with
 * the answer that blocks in both Claude Code and Codex. An unknown host, or
 * an event its adapter does not answer, fails closed too; nothing here ever
 * falls through to an allow.
 */

import { CLAUDE_HOOK_EVENTS } from "../adapters/claude-code";
import { CODEX_HOOK_EVENTS } from "../adapters/codex";
import { CURSOR_HOOK_EVENTS } from "../adapters/cursor";
import type { HookHost } from "./hook-fallback";

/** Each host's events, from its adapter. */
const HOST_EVENTS: Readonly<Record<HookHost, ReadonlySet<string>>> = {
	claude: CLAUDE_HOOK_EVENTS,
	codex: CODEX_HOOK_EVENTS,
	cursor: CURSOR_HOOK_EVENTS,
};

const isHost = (value: string): value is HookHost =>
	Object.hasOwn(HOST_EVENTS, value);

/** What `maina hook <args>` does. */
type HookRoute =
	| Readonly<{ type: "run"; host: HookHost; event: string }>
	| Readonly<{
			type: "fail-closed";
			/** The host to answer for, when it is known. */
			host: HookHost | undefined;
			event: string;
			cause: "unknown_host" | "host_ambiguous" | "gate_not_active";
	  }>;

/** The route for the arguments after `hook`. */
export function routeHook(args: readonly string[]): HookRoute {
	const named = args[0] === "--host";
	const event = (named ? args[2] : args[0]) ?? "";
	const host = named ? (args[1] ?? "") : undefined;
	if (host !== undefined && !isHost(host)) {
		return {
			type: "fail-closed",
			host: undefined,
			event,
			cause: "unknown_host",
		};
	}
	const resolved =
		host ?? (CURSOR_HOOK_EVENTS.has(event) ? ("cursor" as const) : undefined);
	if (resolved === undefined) {
		const shared =
			CLAUDE_HOOK_EVENTS.has(event) || CODEX_HOOK_EVENTS.has(event);
		return {
			type: "fail-closed",
			host: undefined,
			event,
			cause: shared ? "host_ambiguous" : "gate_not_active",
		};
	}
	if (!HOST_EVENTS[resolved].has(event)) {
		return {
			type: "fail-closed",
			host: resolved,
			event,
			cause: "gate_not_active",
		};
	}
	return { type: "run", host: resolved, event };
}
