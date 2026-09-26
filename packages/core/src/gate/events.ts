/**
 * Normalised gate events (FR-GATE-2, spec §6.2).
 *
 * Every host adapter (Claude Code, Codex, Cursor, MCP, ...) turns its own
 * hook payload into one `GateEvent`, so the rules, the classifier and every
 * later stage see the same shape whatever the host. Adapters normalise; they
 * never decide.
 */

import type { GATE_EVENT_KINDS } from "../policy/schema";
import type { ShellParser } from "./parsers/shell";

export type GateEventKind = (typeof GATE_EVENT_KINDS)[number];

/**
 * The host's permission mode, normalised. It is carried for later stages and
 * the audit log; the rules ignore it, so no mode can loosen a deny.
 */
export type PermissionMode =
	| "default"
	| "plan"
	| "accept_edits"
	| "bypass"
	| "unknown";

type GateEventBase = Readonly<{
	/** Host that produced the event (`claude-code`, `codex`, ...). */
	host: string;
	sessionId: string;
	/** Absolute path of the workspace root. */
	root: string;
	permissionMode: PermissionMode;
	/**
	 * Provenance of untrusted content in the session that could have steered
	 * this action (`web:https://…`, `mcp:<server>`, `file:<path>`). Carried
	 * for later stages; it never loosens a rule.
	 */
	untrusted: readonly string[];
}>;

export type ShellAction = Readonly<{
	command: string;
	/** Working directory of the command; the workspace root when absent. */
	cwd?: string;
}>;
export type FileWriteAction = Readonly<{ path: string; content?: string }>;
export type FileReadAction = Readonly<{ path: string }>;
export type McpAction = Readonly<{
	server: string;
	tool: string;
	input?: Readonly<Record<string, unknown>>;
}>;
export type NetworkAction = Readonly<{ url: string; method?: string }>;

export type GateEvent = GateEventBase &
	(
		| Readonly<{ kind: "shell"; action: ShellAction }>
		| Readonly<{ kind: "file.write"; action: FileWriteAction }>
		| Readonly<{ kind: "file.read.outside"; action: FileReadAction }>
		| Readonly<{ kind: "mcp"; action: McpAction }>
		| Readonly<{ kind: "network"; action: NetworkAction }>
	);

/** Branches a plain push to is `git.push.protected` and a lease push is forced. */
export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ["main", "master"];

/**
 * What classification needs beyond the event, injected so the classifier
 * stays pure. `shell: null` (grammar failed to load) makes every shell event
 * opaque, which the rules turn into `ask`: the gate fails closed.
 */
export type GateContext = Readonly<{
	shell: ShellParser | null;
	/** Home directory, for `~` and `$HOME`; unknown homes never count as inside the workspace. */
	home?: string;
	/**
	 * Defaults to `DEFAULT_PROTECTED_BRANCHES`. `evaluateGate` adds the
	 * policy's `protected_branches`.
	 */
	protectedBranches?: readonly string[];
	/** Branch checked out in the workspace, for pushes with an implicit target. */
	currentBranch?: string;
}>;
