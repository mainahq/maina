/**
 * Shared fixtures for the gate tests: one workspace, one home directory and
 * event builders with neutral defaults, so each test states only what it
 * varies.
 */

import type { GateContext, GateEvent } from "../events";
import { loadShellParser, type ShellParser } from "../parsers/shell";

export const ROOT = "/work/repo";
const HOME = "/home/dev";
const PROTECTED = ["main", "master", "v1/main"] as const;

let parser: ShellParser | null = null;

/** Loads the bash grammar once for the whole test file. */
export async function shellParser(): Promise<ShellParser> {
	if (parser !== null) return parser;
	const loaded = await loadShellParser();
	if (!loaded.ok) {
		return Promise.reject(new Error(`bash grammar: ${loaded.error.message}`));
	}
	parser = loaded.value;
	return parser;
}

export async function gateContext(
	overrides: Partial<GateContext> = {},
): Promise<GateContext> {
	return {
		shell: await shellParser(),
		home: HOME,
		protectedBranches: PROTECTED,
		...overrides,
	};
}

const base = {
	host: "claude-code",
	sessionId: "session-1",
	root: ROOT,
	permissionMode: "default",
	untrusted: [],
} as const;

export function shellEvent(
	command: string,
	overrides: Partial<Omit<GateEvent, "kind" | "action">> = {},
): GateEvent {
	return { ...base, ...overrides, kind: "shell", action: { command } };
}

export function writeEvent(path: string, content?: string): GateEvent {
	return {
		...base,
		kind: "file.write",
		action: content === undefined ? { path } : { path, content },
	};
}

export function readEvent(path: string): GateEvent {
	return { ...base, kind: "file.read.outside", action: { path } };
}

export function mcpEvent(
	server: string,
	tool: string,
	input: Readonly<Record<string, unknown>> = {},
): GateEvent {
	return { ...base, kind: "mcp", action: { server, tool, input } };
}

export function networkEvent(url: string, method?: string): GateEvent {
	return {
		...base,
		kind: "network",
		action: method === undefined ? { url } : { url, method },
	};
}
