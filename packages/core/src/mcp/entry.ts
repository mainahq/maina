/**
 * The maina MCP server entry. Single source of truth so every client
 * registers the same `command` / `args` shape — and so a future change
 * is one edit.
 *
 * The launcher (`bunx` vs `npx`) is auto-detected per machine: prefer
 * `bunx` when Bun is installed (5-10× faster startup), fall back to
 * `npx` (universally available via npm). See `./launcher.ts` for the
 * detection logic and the dogfood incident that motivated this.
 *
 * Tests can pin the launcher via `buildMainaEntry({ launcher })` to keep
 * snapshots stable across machines.
 */

import { detectLauncher, type Launcher } from "./launcher";

export const MAINA_MCP_KEY = "maina";

export interface MainaMcpEntry {
	command: string;
	args: string[];
}

export interface BuildEntryOptions {
	launcher?: Launcher;
}

export function buildMainaEntry(opts: BuildEntryOptions = {}): MainaMcpEntry {
	const l = opts.launcher ?? detectLauncher();
	return {
		command: l.command,
		args: [...l.args],
	};
}

/**
 * Same shape as `buildMainaEntry()` but typed for serialisers that want
 * a plain `Record<string, unknown>` (e.g. the TOML emitter for Codex).
 */
export function buildMainaTomlSection(
	opts: BuildEntryOptions = {},
): Record<string, unknown> {
	const entry = buildMainaEntry(opts);
	return { command: entry.command, args: entry.args };
}
